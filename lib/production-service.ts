import {centerId as activeCenterId,recordSpace} from './workspace';
import {resourceView} from './center-resources';
import type {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {planContinuousProduction,productionCriteria,serviceTerm,type Participation,type ProductionCriteria,type CropSelector} from './continuous-production';
import {adviseOperatingCrop,replayOperatingCrop,type OperatingCropDecision} from './operating-crop-adviser';
import type {FieldEntry} from './field-record';
import type {Cultivation} from './cultivation';
import type {State,Mission} from './types';
import {planningState,readExecutionHistory} from './replan-history';
import {commitDelegatedPlans} from './delegated-commit';
import {reservationSchema} from './shared-reservations';
import {SCHEDULING_ENGINE_VERSION} from './scheduling-engine';
import {dispatchPlacementKey} from './annual-dispatch';
import {readProductionCoordination} from './production-coordination-store';
import {coordinationVersion} from './production-coordination';
export const productionKey=(kind:string,id='current')=>({where:{workspace_kind_id:{workspace:recordSpace(),kind,id}}});
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const productionSourceHash=(v:unknown)=>hash({engine:SCHEDULING_ENGINE_VERSION,coordinationVersion,cropReviewVersion:2,value:v});
export function savedCropSelector(view:any,strict=true):CropSelector{
 const decisions=new Map<string,OperatingCropDecision>((view?.items??[]).filter((i:any)=>i.decision?.source==='NEBIUS').map((i:any)=>[i.pnu,i.decision]));
 return async(pnu,facts)=>{const saved=decisions.get(pnu);if(!saved)return adviseOperatingCrop(facts,false);
  try{return replayOperatingCrop(saved,facts)}catch(e){if(strict)throw e;return adviseOperatingCrop(facts,false)}
 };
}
export const productionToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export async function lockProduction(tx:Prisma.TransactionClient){
 await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${recordSpace()}`}))`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-coordination'}))`;
}
export async function readProductionSource(tx:Prisma.TransactionClient){
 const center=await tx.center.findUnique({where:{id:activeCenterId()}});
 const inventory=await tx.workRecord.findUnique(productionKey('fields'));
 const records=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:{in:['cultivation','consultation','fieldParticipation','productionCriteria','delegatedSettings']}},orderBy:{id:'asc'}});
 const criteriaRow=records.find(r=>r.kind==='productionCriteria');
 const legacy=records.find(r=>r.kind==='delegatedSettings')?.payload as any;
 const criteria:ProductionCriteria=productionCriteria.parse(criteriaRow?.payload??{profiles:legacy?.context?[{id:'legacy',name:'기존 센터 작업 기준',context:legacy.context}]:[]});
 const contacts=records.filter(r=>r.kind==='consultation').map(r=>({id:r.id,payload:r.payload as any}));
 const shared=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'},orderBy:{id:'asc'}});
 const history=await readExecutionHistory(tx);
 const today=productionToday(),coordination=await readProductionCoordination(tx,activeCenterId(),today);
 return {state:center?await resourceView(tx,center.state as unknown as State,activeCenterId()):undefined,fields:(inventory?.payload??[]) as FieldEntry[],version:inventory?.version??0,cycles:records.filter(r=>r.kind==='cultivation').map(r=>r.payload as unknown as Cultivation),participations:records.filter(r=>r.kind==='fieldParticipation').map(r=>r.payload as unknown as Participation),criteria,contacts,shared:shared.map(r=>r.payload),history,today,coordination};
}
export type ProductionSource=Awaited<ReturnType<typeof readProductionSource>>;
export async function calculateProduction(s:ProductionSource,selectCrop?:CropSelector){
 const empty:State={name:'센터',planVersion:0,fields:[],missions:[],machines:[],events:[],revisions:[],registered:false,planned:false,ruleVersion:'UNCONFIGURED',staffCount:0,transportCount:0};
 const state=planningState(s.state??empty,s.history);
 // Include foreign shared bookings as occupancy, never as executable local tasks.
 for(const payload of s.shared){
  const r=reservationSchema.parse(payload);if(r.centerId===activeCenterId()||!state.machines.some(m=>m.id===r.resourceId))continue;
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
 return {...(await planContinuousProduction({...s,state,names,consentedPnus},selectCrop)),...(!s.state?{error:'센터 장비·인력 등록이 필요합니다.'}:{})};
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
 const view=(await calculateProduction(source,savedCropSelector(reviewed)));
 const selected=view.items.filter(i=>input.pnus.includes(i.pnu));
 if(new Set(input.pnus).size!==input.pnus.length||selected.length!==input.pnus.length||selected.some(i=>i.status!=='REVIEW'||!i.proposal))throw Error('확정 가능한 새 계획을 선택하세요.');
 const plans=selected.map(i=>i.proposal!);
 if(reviewed?.fingerprint!==input.fingerprint||plans.some(p=>{
  const old=reviewed.items?.find((i:any)=>i.pnu===p.cultivation.pnu)?.proposal;
  return !old||old.cultivation.id!==p.cultivation.id||old.cultivation.crop!==p.cultivation.crop||dispatchPlacementKey(old.dispatch.assignments)!==dispatchPlacementKey(p.dispatch.assignments);
 }))throw Error('계산된 배치가 검토한 내용과 다릅니다. 새 계획을 확인하세요.');
 const names=Object.fromEntries(source.contacts.map(c=>[c.id,c.payload.farmer?.name??'']));
 const result=await commitDelegatedPlans(tx,{...source,state:source.state,plans,names,proposalId:input.requestId,actor});
 await tx.workRecord.create({data:{workspace:recordSpace(),kind:'productionApproval',id:input.requestId,payload:json({actor,inputHash:hash(input),input,plans,decisions:selected.map(i=>({pnu:i.pnu,decision:i.decision})),result,approvedAt:new Date().toISOString()})}});
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
