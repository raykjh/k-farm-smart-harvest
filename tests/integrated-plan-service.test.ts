import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db} from '../lib/db';
import {centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {inCenter} from '../lib/workspace';
import {createJointDraft,stageJointDraft,readJointDraftViews} from '../lib/integrated-plan-service';
import {approveProduction,productionKey,refreshProduction} from '../lib/production-service';
import {jointSource,fakeJointCompletion} from './integrated-plan-fixture';
import {reviewProductionAutomatically} from '../lib/production-auto-review';
import {NextRequest} from 'next/server';
import {testSession} from './auth-fixture';
import {GET as getProduction,POST as postProduction} from '../app/api/continuous-production/route';
const json=(x:unknown)=>JSON.parse(JSON.stringify(x));
async function isolated(run:(tx:Prisma.TransactionClient)=>Promise<void>){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Disposable database only');
 const before=await db.workRecord.count(),notices=await db.outbox.count(),transaction=db.$transaction.bind(db);
 await expect(transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:['shared',...centerRegistry.map(c=>recordSpace(c.id))]}}});
  for(const center of centerRegistry){const source=jointSource(center.id,center.id==='demo'?2:0);
   await tx.center.upsert({where:{id:center.id},create:{id:center.id,state:json(source.state)},update:{state:json(source.state)}});
   for(const [kind,id,payload] of [['fields','current',source.fields],['productionCriteria','current',source.criteria],...source.contacts.map(c=>['consultation',c.id,c.payload]),...source.participations.map(p=>['fieldParticipation',p.pnu,p])] as [string,string,unknown][])await tx.workRecord.create({data:{workspace:recordSpace(center.id),kind,id,payload:json(payload)}});
  }
  const spy=vi.spyOn(db,'$transaction').mockImplementation(((fn:any)=>fn(tx)) as any);
  try{await run(tx)}finally{spy.mockRestore()}
  throw Error('ROLLBACK_JOINT_PLAN');
 },{timeout:60000})).rejects.toThrow('ROLLBACK_JOINT_PLAN');
 expect(await db.workRecord.count()).toBe(before);expect(await db.outbox.count()).toBe(notices);
}
it('AI tool evaluation → saved draft → center review → existing approval/reservation/labor/outbox, exactly once',async()=>isolated(async tx=>{
 const before=await tx.center.findMany({orderBy:{id:'asc'}}),outbox=await tx.outbox.count(),input={requestId:randomUUID(),mode:'AI' as const,audience:'demo'},completion=vi.fn(fakeJointCompletion);
 const draft=await createJointDraft(input,'tester',completion);expect(draft.source).toBe('NEBIUS');expect(completion).toHaveBeenCalledTimes(2);
 expect(await tx.center.findMany({orderBy:{id:'asc'}})).toEqual(before);expect(await tx.outbox.count()).toBe(outbox);
 expect((await createJointDraft(input,'tester',completion)).selected.id).toBe(draft.selected.id);expect(completion).toHaveBeenCalledTimes(2);
 const staged=await stageJointDraft(tx,{requestId:input.requestId,audience:'demo',fingerprint:draft.fingerprint},'tester');
 expect(staged.view.integratedPlan.source).toBe('NEBIUS');expect((await refreshProduction(tx)).fingerprint).toBe(staged.view.fingerprint);
 expect(await tx.center.findMany({orderBy:{id:'asc'}})).toEqual(before);
 const approval={requestId:randomUUID(),fingerprint:staged.view.fingerprint,pnus:staged.view.items.filter((i:any)=>i.proposal).map((i:any)=>i.pnu)};
 const result=await approveProduction(tx,approval,'tester');expect(result.fields).toBe(2);expect(result.notifications).toBe(2);
 expect(await tx.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBeGreaterThan(0);
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'laborDemand'}})).toBeGreaterThan(0);
 expect((await tx.workRecord.findUniqueOrThrow(productionKey('productionApproval',approval.requestId))).payload).toMatchObject({integratedPlan:{requestId:input.requestId,source:'NEBIUS'}});
 expect((await approveProduction(tx,approval,'tester')).alreadyApplied).toBe(true);expect(completion).toHaveBeenCalledTimes(2);
}));
it('stale resources and cross-center staging fail without touching approved work',async()=>isolated(async tx=>{
 const input={requestId:randomUUID(),mode:'RULES' as const,audience:'demo'},draft=await createJointDraft(input,'tester');
 expect((await readJointDraftViews(tx,'demo'))[0].freshness).toBe('CURRENT');
 await expect(inCenter('janggye',()=>stageJointDraft(tx,{requestId:input.requestId,audience:'demo',fingerprint:draft.fingerprint},'tester'))).rejects.toThrow('소속 센터');
 const before=await tx.center.findUniqueOrThrow({where:{id:'demo'}});
 await tx.center.update({where:{id:'demo'},data:{state:{...before.state as object,transportCount:1}}});
 const count=await tx.workRecord.count();
 expect((await readJointDraftViews(tx,'demo'))[0].freshness).toBe('STALE');
 expect(await tx.workRecord.count()).toBe(count);
 await expect(stageJointDraft(tx,{requestId:input.requestId,audience:'demo',fingerprint:draft.fingerprint},'tester')).rejects.toThrow('변경');
 expect(await tx.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(0);
}));
it('background AI persists a review once, with no automatic approval or duplicate inference',async()=>isolated(async tx=>{
 vi.stubEnv('KFARM_PRODUCTION_AI','1');vi.stubEnv('AI_MODE','nebius');
 try{
  const before=await tx.center.findMany({orderBy:{id:'asc'}}),completion=vi.fn(fakeJointCompletion);
  await refreshProduction(tx);
  expect(await reviewProductionAutomatically(completion)).toBe('AWAITING_CONFIRMATION');
  expect(await reviewProductionAutomatically(completion)).toBe('UNCHANGED');
  expect(completion).toHaveBeenCalledTimes(2);
  expect(await tx.center.findMany({orderBy:{id:'asc'}})).toEqual(before);
  expect(await tx.workRecord.count({where:{kind:'productionApproval'}})).toBe(0);
  expect((await tx.workRecord.findUniqueOrThrow(productionKey('continuousProduction'))).payload).toMatchObject({integratedPlan:{source:'NEBIUS'}});
 }finally{vi.unstubAllEnvs()}
}));
it('staff confirms the saved AI plan through the real route, but cannot confirm rules or another center plan',async()=>{
 const staff=await testSession('CENTER_STAFF'),neighbor=await testSession('CENTER_STAFF','janggye');
 const request=(session:typeof staff,body?:unknown)=>new NextRequest('http://127.0.0.1:3100/api/continuous-production',{headers:session.headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 try{await isolated(async tx=>{
  const initial=await refreshProduction(tx),command={action:'approve',requestId:randomUUID(),fingerprint:initial.fingerprint,pnus:initial.items.filter((i:any)=>i.proposal).map((i:any)=>i.pnu),provisionalAcknowledged:true};
  expect((await postProduction(request(staff,command))).status).toBe(409);
  expect(await tx.workRecord.count({where:{kind:'productionApproval'}})).toBe(0);
  const input={requestId:randomUUID(),mode:'AI' as const,audience:'demo'},draft=await createJointDraft(input,'tester',fakeJointCompletion);
  const staged=await stageJointDraft(tx,{requestId:input.requestId,audience:'demo',fingerprint:draft.fingerprint},'tester');
  expect(await (await getProduction(request(staff))).json()).toMatchObject({canManage:false,canApprove:true});
  expect(await (await getProduction(request(neighbor))).json()).toMatchObject({canManage:false,canApprove:false});
  const approve={...command,fingerprint:staged.view.fingerprint,pnus:staged.view.items.filter((i:any)=>i.proposal).map((i:any)=>i.pnu)};
  expect((await postProduction(request(neighbor,approve))).status).toBe(409);
  const saved=await postProduction(request(staff,approve));expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({fields:2});
  const replay=await postProduction(request(staff,approve));expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({alreadyApplied:true,fields:2});
  expect((await postProduction(request(staff,{...approve,fingerprint:'0'.repeat(64)}))).status).toBe(409);
  expect(await tx.workRecord.count({where:{kind:'productionApproval'}})).toBe(1);
  expect(await tx.workRecord.count({where:{kind:'cultivation'}})).toBe(2);
 })}finally{await db.audit.deleteMany({where:{OR:[{detail:{path:['actorId'],equals:staff.id}},{detail:{path:['actorId'],equals:neighbor.id}}]}});await staff.cleanup();await neighbor.cleanup()}
});
