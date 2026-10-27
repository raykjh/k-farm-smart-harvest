import {centerId as activeCenterId,recordSpace} from './workspace';
import {resourceView} from './center-resources';
import type {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {planContinuousProduction,productionCriteria,serviceTerm,type Participation,type ProductionCriteria,type CropSelector,type ProductionRunOptions} from './continuous-production';
import {adviseOperatingCrop,replayOperatingCrop,type OperatingCropDecision} from './operating-crop-adviser';
import type {FieldEntry} from './field-record';
import type {Cultivation} from './cultivation';
import type {State,Mission} from './types';
import type {AnnualPlan} from './annual-plan';
import {planningState,readExecutionHistory} from './replan-history';
import {commitDelegatedPlans} from './delegated-commit';
import {reservationSchema} from './shared-reservations';
import {SCHEDULING_ENGINE_VERSION} from './scheduling-engine';
import {dispatchPlacementKey} from './annual-dispatch';
import {readProductionCoordination} from './production-coordination-store';
import {coordinationVersion} from './production-coordination';
import {laborPoliciesForDates} from './labor-policy-store';
import {payBasis,type PayBasis} from './labor-policy';
import {centerRegistry} from './center-registry';
import {workloadObservations} from './workload-history';
import type {ReportEvidence} from './work-report';
import type {LaborOps} from './labor-operations';
export const productionKey=(kind:string,id='current')=>({where:{workspace_kind_id:{workspace:recordSpace(),kind,id}}});
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const productionSourceHash=(v:unknown)=>hash({engine:SCHEDULING_ENGINE_VERSION,coordinationVersion,cropReviewVersion:2,continuationVersion:3,value:v});
export function savedCropSelector(view:any,strict=true):CropSelector{
 const decisions=new Map<string,OperatingCropDecision>((view?.items??[]).filter((i:any)=>i.decision?.source==='NEBIUS').map((i:any)=>[i.pnu,i.decision]));
 return async(pnu,facts)=>{const saved=decisions.get(pnu);if(!saved)return adviseOperatingCrop(facts,false);
  try{return replayOperatingCrop(saved,facts)}catch(e){if(strict)throw e;return adviseOperatingCrop(facts,false)}
 };
}
export const productionToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export async function lockProduction(tx:Prisma.TransactionClient){
 // Joint decisions depend on the four-center snapshot. Match resource changes'
 // deterministic row-lock order and keep foreign wages/resources/land stable
 // through the final recheck and commit (model inference runs outside this lock).
 await tx.$queryRaw`SELECT id FROM "Center" ORDER BY id FOR UPDATE`;
 for(const space of centerRegistry.map(c=>recordSpace(c.id)).sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${space}`}))`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-coordination'}))`;
}
// Explicit scope is for server-side aggregate planning only. HTTP callers never
// choose a commit scope; commits continue to use the authenticated center.
export async function readProductionSource(tx:Prisma.TransactionClient,scopeId=activeCenterId(),sharedCoordination?:Awaited<ReturnType<typeof readProductionCoordination>>){
 const center=await tx.center.findUnique({where:{id:scopeId}});
 const inventory=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(scopeId),kind:'fields',id:'current'}}});
 const records=await tx.workRecord.findMany({where:{workspace:recordSpace(scopeId),kind:{in:['cultivation','cultivationPlan','consultation','fieldParticipation','productionCriteria','delegatedSettings','laborOperations']}},orderBy:{id:'asc'}});
 // Historical missions may predate persisted operation kinds. Read the exact
 // saved plan, never today's crop catalog, without rewriting any old record.
 const operationKinds=records.filter(r=>r.kind==='cultivationPlan').flatMap(r=>{
  const plan=r.payload as unknown as AnnualPlan;
  return (plan.plots??[]).flatMap(p=>p.tasks.filter(t=>t.cultivationId===r.id).map(t=>({cultivationId:r.id,pnu:p.pnu,taskId:t.id,kind:t.kind})));
 });
 const criteriaRow=records.find(r=>r.kind==='productionCriteria');
 const legacy=records.find(r=>r.kind==='delegatedSettings')?.payload as any;
 const criteria:ProductionCriteria=productionCriteria.parse(criteriaRow?.payload??{profiles:legacy?.context?[{id:'legacy',name:'기존 센터 작업 기준',context:legacy.context}]:[]});
 const contacts=records.filter(r=>r.kind==='consultation').map(r=>({id:r.id,payload:r.payload as any}));
 const shared=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'},orderBy:{id:'asc'}});
 const history=await readExecutionHistory(tx,recordSpace(scopeId));
 const today=productionToday(),coordination=sharedCoordination?{...sharedCoordination,centerId:scopeId}:await readProductionCoordination(tx,scopeId,today);
 // Planning can cross a calendar year. Keep the exact reviewed yearly wage
 // policy in the source fingerprint; a missing future policy remains unknown.
 const year=Number(today.slice(0,4)),policies=await laborPoliciesForDates(tx,scopeId,[0,1,2].map(n=>`${year+n}-01-01`));
 const observedWorkload=workloadObservations(records.filter(r=>r.kind==='cultivationPlan').map(r=>r.payload as unknown as AnnualPlan),history as ReportEvidence[],records.find(r=>r.kind==='laborOperations')?.payload as unknown as LaborOps|undefined,today);
 const laborPayByYear=Object.fromEntries(Object.entries(policies).flatMap(([key,value])=>{const basis=payBasis(value.policy,value.version);return basis?[[key,basis]]:[]}));
 return {scopeId,state:center?await resourceView(tx,center.state as unknown as State,scopeId):undefined,fields:(inventory?.payload??[]) as FieldEntry[],version:inventory?.version??0,cycles:records.filter(r=>r.kind==='cultivation').map(r=>r.payload as unknown as Cultivation),participations:records.filter(r=>r.kind==='fieldParticipation').map(r=>r.payload as unknown as Participation),criteria,contacts,shared:shared.map(r=>r.payload),history,today,coordination,operationKinds,laborPayByYear,workloadObservations:observedWorkload};
}
export type ProductionSource=Omit<Awaited<ReturnType<typeof readProductionSource>>,'laborPayByYear'|'workloadObservations'>&{workloadObservations?:import('./workload-history').WorkloadObservation[];laborPayByYear?:Record<string,PayBasis>};
export async function calculateProduction(s:ProductionSource,selectCrop?:CropSelector,options:ProductionRunOptions={}){
 const empty:State={name:'센터',planVersion:0,fields:[],missions:[],machines:[],events:[],revisions:[],registered:false,planned:false,ruleVersion:'UNCONFIGURED',staffCount:0,transportCount:0};
 const state=planningState(s.state??empty,s.history);
 const kinds=new Map(s.operationKinds.map(t=>[JSON.stringify([t.cultivationId,t.pnu,t.taskId]),t.kind]));
 for(const m of state.missions){
  if(m.kind)continue;
  const kind=kinds.get(JSON.stringify([(m as Mission&{cultivationId?:string}).cultivationId,m.fieldId,m.id]));
  if(kind)m.kind=kind;
 }
 // Include foreign shared bookings as occupancy, never as executable local tasks.
 for(const payload of s.shared){
  const r=reservationSchema.parse(payload);if(r.centerId===(s.scopeId??activeCenterId())||!state.machines.some(m=>m.id===r.resourceId))continue;
  const start=Math.max(Date.parse(r.from),Date.parse(s.today+'T00:00:00+09:00')),end=Date.parse(r.to);
  if(end-start>731*86400000)throw Error('장기간의 타 센터 예약을 확인하세요.');
  const firstDay=Date.parse(new Date(start+9*3600000).toISOString().slice(0,10)+'T00:00:00+09:00');
  for(let day=firstDay;day<end;day+=86400000){
   const from=Math.max(start,day+480*60000),to=Math.min(end,day+960*60000);if(from>=to)continue;
   const date=new Date(day+9*3600000).toISOString().slice(0,10),slot=Math.floor((from-day-480*60000)/900000),last=Math.ceil((to-day-480*60000)/900000);
   state.missions.push({id:'occupancy:'+r.id+':'+date,fieldId:'external:'+r.centerId,label:'타 센터 예약',crop:'쌀',scheduledDate:date,month:Number(date.slice(5,7)),owner:'장비',status:'PLANNED',resourceId:r.resourceId,start:slot,duration:last-slot,deadline:32,priority:1,batchKey:r.id,staff:0,transport:0,resourceOccupancyOnly:true} as Mission);
  }
 }
 const names=Object.fromEntries(s.contacts.map(c=>[c.id,c.payload.farmer?.name??'']));
 const consentedPnus=s.fields.filter(f=>s.contacts.some(c=>c.id===f.consultationId&&c.payload.consent===true&&c.payload.fields?.some((p:any)=>p.pnu===f.pnu&&p.mode==='delegated'&&p.tenure==='owned'))).map(f=>f.pnu);
 return {...(await planContinuousProduction({...s,state,names,consentedPnus},selectCrop,options)),...(!s.state?{error:'센터 장비·인력 등록이 필요합니다.'}:{})};
}
export async function refreshProduction(tx:Prisma.TransactionClient,force=false){
 await lockProduction(tx);
 const source=await readProductionSource(tx),fingerprint=productionSourceHash(source);
 const previous=await tx.workRecord.findUnique(productionKey('continuousProduction'));
 const saved=previous?.payload as any;
 if(!force&&(saved?.sourceFingerprint??saved?.fingerprint)===fingerprint)return saved;
 const view=(await calculateProduction(source)),payload={fingerprint,sourceFingerprint:fingerprint,calculatedAt:new Date().toISOString(),...view};
 await tx.workRecord.upsert({...productionKey('continuousProduction'),create:{workspace:recordSpace(),kind:'continuousProduction',id:'current',payload:json(payload)},update:{payload:json(payload),version:{increment:1},updatedAt:new Date()}});
 return payload;
}
export async function registerParticipation(tx:Prisma.TransactionClient,fields:FieldEntry[],rawTerm:unknown){
 const term=serviceTerm.parse(rawTerm),now=new Date().toISOString();
 for(const field of fields.filter(f=>f.mode==='full')){
  if(!field.consultationId)throw Error('농부 상담 연결 필요');
  const payload:Participation={pnu:field.pnu,consultationId:field.consultationId,receivedAt:now,status:'ACTIVE',term,changedAt:now,reason:'최초 연속 관리 신청'};
  await tx.workRecord.create({data:{workspace:recordSpace(),kind:'fieldParticipation',id:field.pnu,payload:json(payload)}});
 }
}
export async function approveProduction(tx:Prisma.TransactionClient,input:{requestId:string;fingerprint:string;pnus:string[]},actor:string){
 await lockProduction(tx);
 const receipt=await tx.workRecord.findUnique(productionKey('productionApproval',input.requestId));
 if(receipt){const p=receipt.payload as any;if(p.actor!==actor||p.inputHash!==hash(input))throw Error('확정 요청 ID 충돌');return {...p.result,alreadyApplied:true}}
 const source=await readProductionSource(tx);
 const reviewed=(await tx.workRecord.findUnique(productionKey('continuousProduction')))?.payload as any;
 if(!source.state||reviewed?.fingerprint!==input.fingerprint||productionSourceHash(source)!==(reviewed?.sourceFingerprint??reviewed?.fingerprint))throw Error('농지·계획·참여조건·자원이 변경되었습니다. 다시 확인하세요.');
 if(reviewed.aiReviewError)throw Error('AI 검토 오류를 확인하세요. 다시 검토하거나 계산 기준으로 명시적으로 되돌린 뒤 승인하세요.');
 const integrated=reviewed.integratedPlan;
 if(integrated?.networkSourceHashes){
  // A staged joint decision also depends on other centers' unapproved land,
  // labor policies and resources, not only already-persisted reservations.
  const current=[];
  // No coordination inputs are written between these reads. Keep this reuse
  // inside the locked pre-commit phase; refresh after commit reads again.
  for(const center of centerRegistry)current.push([center.id,productionSourceHash(await readProductionSource(tx,center.id,source.coordination))]);
  if(hash(current)!==hash(integrated.networkSourceHashes))throw Error('다른 센터의 농지·자원·비용 근거가 변경되었습니다. 통합계획을 다시 검토하세요.');
 }
 if(integrated&&input.pnus.some(p=>!integrated.choices.some((c:{pnu:string})=>c.pnu===p)))throw Error('통합계획의 검토 대상과 승인 대상이 다릅니다.');
 const view=(await calculateProduction(source,integrated?undefined:savedCropSelector(reviewed),integrated?{choices:integrated.choices}:{}));
 const selected=view.items.filter(i=>input.pnus.includes(i.pnu));
 if(new Set(input.pnus).size!==input.pnus.length||selected.length!==input.pnus.length||selected.some(i=>i.status!=='REVIEW'||!i.proposal))throw Error('확정 가능한 새 계획을 선택하세요.');
 const plans=selected.map(i=>i.proposal!);
 if(reviewed?.fingerprint!==input.fingerprint||plans.some(p=>{
  const old=reviewed.items?.find((i:any)=>i.pnu===p.cultivation.pnu)?.proposal;
  return !old||old.cultivation.id!==p.cultivation.id||old.cultivation.crop!==p.cultivation.crop||dispatchPlacementKey(old.dispatch.assignments)!==dispatchPlacementKey(p.dispatch.assignments);
 }))throw Error('계산된 배치가 검토한 내용과 다릅니다. 새 계획을 확인하세요.');
 const names=Object.fromEntries(source.contacts.map(c=>[c.id,c.payload.farmer?.name??'']));
 const result=await commitDelegatedPlans(tx,{...source,state:source.state,plans,names,proposalId:input.requestId,actor});
 await tx.workRecord.create({data:{workspace:recordSpace(),kind:'productionApproval',id:input.requestId,payload:json({actor,inputHash:hash(input),input,plans,decisions:selected.map(i=>({pnu:i.pnu,decision:i.decision})),...(integrated?{integratedPlan:integrated}:{}),result,approvedAt:new Date().toISOString()})}});
 if(integrated){
  const jobs=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'productionAutoJob'}});
  for(const job of jobs.filter(r=>(r.payload as any).requestId===integrated.requestId)){
   const p=job.payload as any,approvedPnus=[...new Set([...(p.approvedPnus??[]),...input.pnus])];
   await tx.workRecord.update({where:{workspace_kind_id:{workspace:job.workspace,kind:job.kind,id:job.id}},data:{payload:json({...p,approvedPnus,status:integrated.choices.every((c:{pnu:string})=>approvedPnus.includes(c.pnu))?'CONFIRMED':'PARTIALLY_CONFIRMED',approvedAt:new Date().toISOString()}),version:{increment:1},updatedAt:new Date()}});
  }
 }
 await tx.audit.create({data:{centerId:activeCenterId(),action:'production.continuous.approve',detail:json({actor,...input,...result})}});
 await refreshProduction(tx);
 return result;
}
export async function changeParticipation(tx:Prisma.TransactionClient,pnu:string,patch:{status:Participation['status'];term?:unknown;reason:string;expectedChangedAt:string|null},actor:string){
 await lockProduction(tx);
 const source=await readProductionSource(tx),field=source.fields.find(f=>f.pnu===pnu&&f.mode==='full');
 if(!field?.consultationId)throw Error('완전 위탁형 등록 농지가 필요합니다.');
 const previous=source.participations.find(p=>p.pnu===pnu),now=new Date().toISOString();
 if((previous?.changedAt??null)!==patch.expectedChangedAt)throw Error('참여 조건이 변경되었습니다. 다시 확인하세요.');
 if(!previous&&!patch.term)throw Error('연속 관리 기간과 동의 확인이 필요합니다.');
 const term=patch.term?serviceTerm.parse(patch.term):previous!.term;
 const next:Participation={pnu,consultationId:field.consultationId,receivedAt:previous?.receivedAt??now,status:patch.status,term,changedAt:now,reason:patch.reason};
 await tx.workRecord.upsert({...productionKey('fieldParticipation',pnu),create:{workspace:recordSpace(),kind:'fieldParticipation',id:pnu,payload:json(next)},update:{payload:json(next),version:{increment:1}}});
 await tx.audit.create({data:{centerId:activeCenterId(),action:'production.participation.change',detail:json({actor,before:previous??null,after:next})}});
 // A pause/end only prevents NEW cultivation. Never erase existing work/contracts.
 return refreshProduction(tx);
}
