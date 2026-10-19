import {centerId as activeCenterId,recordSpace} from './workspace';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {consultationSchema} from './consultation';
import {fieldInventory} from './field-record';
import {assertOwnerApplication} from './application-policy';
import {cultivationSchema,checkCultivation,previousCultivationTerminals,type Cultivation} from './cultivation';
import {planningContext} from './planning-context';
import {buildAnnualPlan,type AnnualPlan} from './annual-plan';
import {previewAnnualDispatch} from './annual-dispatch';
import type {State} from './types';
import {resourceView} from './center-resources';
import {serviceTerm} from './continuous-production';
import {lockProduction,registerParticipation,refreshProduction} from './production-service';
import {authorizeDemoRegistration,saveRegistrationOrigin} from './registration-origin';
export const registrationCommand=z.object({
 requestId:z.string().uuid(),consultationId:z.string().uuid(),consultationVersion:z.number().int().nonnegative(),fieldVersion:z.number().int().nonnegative(),testDataOnly:z.literal(true),
 consultation:consultationSchema,cultivations:z.array(z.object({cultivation:cultivationSchema,context:planningContext}).strict()).max(30).default([]),
 continuousService:serviceTerm.optional(),
 demoInputBatchId:z.string().uuid().optional(),
}).strict();
export type RegistrationCommand=z.infer<typeof registrationCommand>;
// Caller owns the transaction. No external effects or synthetic scheduling shortcuts.
export async function saveRegistration(tx:Prisma.TransactionClient,input:unknown,actorId:string){
 const b=registrationCommand.parse(input),workspace=recordSpace();
 const hash=createHash('sha256').update(JSON.stringify(b)).digest('hex');
 await lockProduction(tx);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consultation:${workspace}:${b.consultationId}`}))`;
 const key=(kind:string,id:string)=>({where:{workspace_kind_id:{workspace,kind,id}}});
 const receipt=await tx.workRecord.findUnique(key('registrationReceipt',b.requestId));
 if(receipt){const p=receipt.payload as any;if(p.actorId!==actorId||p.hash!==hash)throw Error('요청 식별자가 다른 입력에 사용되었습니다.');return {...p.result,alreadyApplied:true};}
 const old=await tx.workRecord.findUnique(key('consultation',b.consultationId));
 if(b.demoInputBatchId){
  if(old||b.consultationVersion!==0)throw Error('기존 상담을 가상 신청으로 변경할 수 없습니다.');
  await authorizeDemoRegistration(tx,b.demoInputBatchId,b.requestId,hash);
 }
 const inventory=await tx.workRecord.findUnique(key('fields','current'));
 if((old?.version??0)!==b.consultationVersion||(inventory?.version??0)!==b.fieldVersion)throw Error('상담 또는 농지가 변경되었습니다. 다시 불러오세요.');
 if(!b.consultation.consent||!b.consultation.farmer.name.trim()||!b.consultation.farmer.birth||!b.consultation.farmer.phone.trim())throw Error('신청인 정보와 설명 확인이 필요합니다.');
 if(!b.consultation.fields.length)throw Error('등록할 농지가 필요합니다.');
 if(b.consultation.fields.some(f=>f.mode!=='delegated'))throw Error('농지는 위탁으로만 등록합니다. 작물 선택과 농작업은 센터에서 관리하며 근무 신청은 인력에서 별도로 등록하세요.');
 const fields=fieldInventory.parse(b.consultation.fields.map(f=>{
  if(f.tenure!=='owned')throw Error('신규 신청 대상은 본인 소유 농지입니다.');
  assertOwnerApplication(b.consultation,f.pnu);
  return {pnu:f.pnu,address:f.address,area:Number(f.area),crop:f.crop,mode:'full',group:'',rights:'pending',consultationId:b.consultationId,conditions:f.conditions,...(f.boundary?{boundary:f.boundary}:{})};
 }));
 const merged=fieldInventory.parse([...(inventory?.payload as any[]??[]),...fields]);
 for(const pnu of fields.map(f=>f.pnu).sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`field-custody:${pnu}`},0))`;
 const otherInventories=await tx.workRecord.findMany({where:{kind:'fields',id:'current',workspace:{not:workspace}}});
 if(otherInventories.some(r=>Array.isArray(r.payload)&&r.payload.some((f:any)=>fields.some(x=>x.pnu===f.pnu))))throw Error('다른 센터가 관리 중인 농지입니다. 관리 이관 여부를 먼저 확인하세요.');
 const prior=await tx.workRecord.findMany({where:{workspace,kind:'cultivation'}});
 const existing=prior.map(r=>r.payload as unknown as Cultivation);
 const version=(inventory?.version??0)+1,plans=[];
 const center=await tx.center.findUnique({where:{id:activeCenterId()}});
 const resources=center?await resourceView(tx,center.state as unknown as State,activeCenterId()):undefined;
 for(const item of b.cultivations){
  const c=item.cultivation,f=fields.find(f=>f.pnu===c.pnu);
  if(!f||f.crop!==c.crop||c.source!=='REGISTERED'||existing.some(x=>x.id===c.id))throw Error('신규 농지·작물·재배 연결이 일치하지 않습니다.');
  checkCultivation(c,existing);
  const plan=buildAnnualPlan([f],Number(c.start.slice(0,4)),version,item.context,c,undefined,resources);
  if(c.previousId){const prev=existing.find(x=>x.id===c.previousId)!,stored=await tx.workRecord.findUnique(key('cultivationPlan',prev.id));const previousPlan=plans.find(p=>p.cultivation.id===prev.id)?.plan??stored?.payload as AnnualPlan|undefined;const terminals=previousCultivationTerminals(prev,previousPlan?.plots.flatMap(p=>p.tasks)??[]);for(const t of plan.plots[0].tasks)if(!t.predecessorKeys.length)t.predecessorKeys.push(...terminals);}
  existing.push(c);plans.push({cultivation:c,plan});
 }
 const put=async(kind:string,id:string,version:number,payload:unknown)=>tx.workRecord.upsert({...key(kind,id),create:{workspace,kind,id,version,payload:JSON.parse(JSON.stringify(payload))},update:{version,payload:JSON.parse(JSON.stringify(payload)),updatedAt:new Date()}});
 await put('consultation',b.consultationId,b.consultationVersion+1,b.consultation);
 await put('fields','current',version,merged);
 if(b.demoInputBatchId)await saveRegistrationOrigin(tx,{batchId:b.demoInputBatchId,consultationId:b.consultationId,requestId:b.requestId,inputHash:hash,pnus:fields.map(f=>f.pnu),actorId});
 const drafts=[];
 for(const {cultivation,plan} of plans){
  await put('cultivation',cultivation.id,1,cultivation);await put('cultivationPlan',cultivation.id,1,plan);
  // Persist drafts only. Resource changes require a fresh preview and approval later.
  drafts.push({id:cultivation.id,taskCount:plan.taskCount,dispatch:resources?(await previewAnnualDispatch(plan,resources)):null});
 }
 if(b.continuousService)await registerParticipation(tx,fields,b.continuousService);
 const production=b.continuousService?await refreshProduction(tx):null;
 const result={consultationId:b.consultationId,consultationVersion:b.consultationVersion+1,fieldVersion:version,fields:fields.length,drafts,rights:'pending',approvalRequired:true,production:production?{asOf:production.asOf,items:production.items.filter((i:any)=>fields.some(f=>f.pnu===i.pnu)).map((i:any)=>({pnu:i.pnu,status:i.status,reason:i.reason}))}:null};
 await put('registrationReceipt',b.requestId,1,{actorId,hash,result});
 await tx.audit.create({data:{centerId:activeCenterId(),action:'registration.atomic',detail:{actorId,requestId:b.requestId,consultationId:b.consultationId,fields:fields.length,cultivations:plans.length}}});
 return result;
}
