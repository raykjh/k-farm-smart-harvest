import {it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
const completion=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',()=>({budgetedCompletion:completion,APPROVED_MODEL:'offline-test-only'}));
import {db} from '../lib/db';
import {saveRegistration} from '../lib/registration-service';
import {reviewProductionCrop,returnToRuleReview} from '../lib/production-ai-review';
import {approveProduction,refreshProduction,productionKey} from '../lib/production-service';
import {adviseOperatingCrop} from '../lib/operating-crop-adviser';
import {seedProductionCropReview,productionCropRegistration} from '../scripts/fixtures/production-crop-review';
import {permitted} from '../lib/auth-policy';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();completion.mockReset()});
it('allows both center roles to review and reset only within their own center',()=>{
 const staff={id:'test',name:'test',username:'test',role:'CENTER_STAFF',centerId:'demo'} as any;
 expect(permitted(staff,'continuous-production','POST',{action:'refresh'})).toBe(true);
 for(const action of ['ai-review','rule-review']){
  expect(permitted(staff,'continuous-production','POST',{action})).toBe(true);
  expect(permitted({...staff,role:'CENTER_ADMIN'},'continuous-production','POST',{action})).toBe(true);
  expect(permitted({...staff,role:'CENTER_ADMIN',centerId:null},'continuous-production','POST',{action})).toBe(false);
 }
});
async function isolated(run:(tx:Prisma.TransactionClient)=>Promise<void>){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Test DB only');
 const before=await db.workRecord.count();
 const transaction=db.$transaction.bind(db);
 await expect(transaction(async tx=>{
  await seedProductionCropReview(tx);
  // Service phases use the same rollback fixture. Live E2E separately verifies
  // real commits and lock release across the network boundary.
  const spy=vi.spyOn(db,'$transaction').mockImplementation(((fn:any)=>fn(tx)) as any);
  try{await run(tx)}finally{spy.mockRestore()}
  throw Error('ROLLBACK_CROP_AI');
 },{timeout:60000})).rejects.toThrow('ROLLBACK_CROP_AI');
 expect(await db.workRecord.count()).toBe(before);
}
async function validResponse(body:any){
 const facts=JSON.parse(body.messages[1].content),decision=await adviseOperatingCrop(facts.candidates,false,facts.priority);
 return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'choose_operating_crop',arguments:JSON.stringify({candidateId:decision.candidateId,evidence:decision.evidence.map(({candidateId,metric})=>({candidateId,metric})),rejections:decision.rejections})}}]}}]};
}
it('persists explicit AI crop choice, replays on refresh/approval, and saves common reservations and notification exactly once',async()=>isolated(async tx=>{
 vi.stubEnv('AI_MODE','nebius');completion.mockImplementation(validResponse);
 const request=productionCropRegistration();await saveRegistration(tx,request,'tester');
 const before=await refreshProduction(tx);expect(completion).not.toHaveBeenCalled();
 expect(before.items[0].candidateFacts).toHaveLength(2);expect(before.items[0].proposal.cultivation.crop).toBe('pepper');
 const input={requestId:randomUUID(),fingerprint:before.fingerprint,pnu:request.consultation.fields[0].pnu,priority:'MIN_LABOR' as const};
 const reviewed=await reviewProductionCrop(input,'tester');expect(reviewed.view.items[0].proposal.cultivation.crop).toBe('potato');
 expect(reviewed.view.items[0].decision.source).toBe('NEBIUS');expect(completion).toHaveBeenCalledOnce();
 expect((await reviewProductionCrop(input,'tester')).alreadyReviewed).toBe(true);
 expect((await refreshProduction(tx)).fingerprint).toBe(reviewed.view.fingerprint);expect(completion).toHaveBeenCalledOnce();
 await expect(approveProduction(tx,{requestId:randomUUID(),fingerprint:before.fingerprint,pnus:[input.pnu]},'tester')).rejects.toThrow('변경');
 const approval={requestId:randomUUID(),fingerprint:reviewed.view.fingerprint,pnus:[input.pnu]};
 const result=await approveProduction(tx,approval,'tester');expect(result.fields).toBe(1);expect(result.notifications).toBe(1);
 expect(await tx.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBeGreaterThan(0);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'laborDemand'}})).toBeGreaterThan(0);
 const receipt=await tx.workRecord.findUniqueOrThrow(productionKey('productionApproval',approval.requestId));expect((receipt.payload as any).decisions[0].decision).toMatchObject({source:'NEBIUS',replayed:true,inferenceCalled:false});
 expect((await approveProduction(tx,approval,'tester')).alreadyApplied).toBe(true);expect(completion).toHaveBeenCalledOnce();
}));
it('retains an invalid response as operator review and blocks approval until explicit audited rule review',async()=>isolated(async tx=>{
 vi.stubEnv('AI_MODE','nebius');completion.mockResolvedValue({choices:[]});await saveRegistration(tx,productionCropRegistration(),'tester');
 const before=await refreshProduction(tx),input={requestId:randomUUID(),fingerprint:before.fingerprint,pnu:before.items[0].pnu,priority:'BALANCED' as const};
 await expect(reviewProductionCrop(input,'tester')).rejects.toThrow('OPERATOR_REVIEW');
 const failed=await refreshProduction(tx);expect(failed.aiReviewError).toBeTruthy();expect(failed.items[0].decision.source).toBe('RULES');
 await expect(reviewProductionCrop(input,'tester')).rejects.toThrow('OPERATOR_REVIEW');expect(completion).toHaveBeenCalledOnce();
 await expect(approveProduction(tx,{requestId:randomUUID(),fingerprint:failed.fingerprint,pnus:[input.pnu]},'tester')).rejects.toThrow('AI 검토 오류');
 const reset=await returnToRuleReview(failed.fingerprint,'tester');expect(reset.view.aiReviewError).toBeUndefined();expect(reset.view.items[0].decision.source).toBe('RULES');
 expect(await tx.audit.count({where:{action:'production.crop.rule-review'}})).toBe(1);
}));
it('rejects a stale model result after a resource edit, without making reservations or retrying',async()=>isolated(async tx=>{
 vi.stubEnv('AI_MODE','nebius');await saveRegistration(tx,productionCropRegistration(),'tester');
 const before=await refreshProduction(tx),center=await tx.center.findUniqueOrThrow({where:{id:'demo'}});
 completion.mockImplementation(async body=>{await tx.center.update({where:{id:'demo'},data:{state:{...(center.state as any),transportCount:1}}});return validResponse(body)});
 await expect(reviewProductionCrop({requestId:randomUUID(),fingerprint:before.fingerprint,pnu:before.items[0].pnu,priority:'BALANCED'},'tester')).rejects.toThrow('변경');
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(0);expect(await tx.outbox.count({where:{centerId:'demo'}})).toBe(0);expect(completion).toHaveBeenCalledOnce();
 expect((await refreshProduction(tx)).items[0].decision.source).toBe('RULES');
}));
it('blocks a concurrent review and cross-actor reuse before another paid call',async()=>isolated(async tx=>{
 vi.stubEnv('AI_MODE','nebius');await saveRegistration(tx,productionCropRegistration(),'tester');const view=await refreshProduction(tx);
 const input={requestId:randomUUID(),fingerprint:view.fingerprint,pnu:view.items[0].pnu,priority:'BALANCED' as const};
 completion.mockImplementation(async body=>{
  await expect(reviewProductionCrop({...input,requestId:randomUUID()},'tester')).rejects.toThrow('진행 중');
  await expect(reviewProductionCrop(input,'other-actor')).rejects.toThrow('충돌');return validResponse(body);
 });
 await reviewProductionCrop(input,'tester');expect(completion).toHaveBeenCalledOnce();
}));
