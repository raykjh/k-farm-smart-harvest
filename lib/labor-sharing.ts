import type {Prisma} from '@prisma/client';
import type {State} from './types';
import {recordSpace} from './workspace';
import {centerRegistry} from './center-registry';
import {geographicNeighbors} from './center-adjacency';
import {availableFor,laborScore,emptyLaborOps,type LaborOps,type LaborJob} from './labor-operations';
import {capacityBusy,laborCapacityRows,capacityAllowsAttendance} from './labor-capacity-store';
import type {LaborCapacityWindow} from './labor-capacity';

export type LaborShare={id:string;ownerCenterId:string;borrowerCenterId:string;workerId:string;workerName:string;jobId:string;sourceHash:string;date:string;startMinute:number;durationMinutes:number;travelMinutes:number;distanceKm:number;response:'APP'|'PHONE';consent:true;status:'WAITLIST'|'ASSIGNED'|'CANCELLED'|'COMPLETED';reason:string;actor:string;createdAt:string;worked?:boolean};
export const laborSharingLock=async(tx:Prisma.TransactionClient)=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'labor-sharing'}))`};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
export function shareOverlap(a:Pick<LaborShare,'date'|'startMinute'|'durationMinutes'|'travelMinutes'>,b:Pick<LaborShare,'date'|'startMinute'|'durationMinutes'|'travelMinutes'>){return a.date===b.date&&a.startMinute-a.travelMinutes<b.startMinute+b.durationMinutes+b.travelMinutes&&b.startMinute-b.travelMinutes<a.startMinute+a.durationMinutes+a.travelMinutes;}
export function eligibleShare(offer:LaborShare,owner:LaborOps,job:LaborJob,neighbors:string[]){
 const worker=owner.people.find(p=>p.id===offer.workerId);
 const travelJob={...job,startMinute:job.startMinute-offer.travelMinutes,durationMinutes:job.durationMinutes+offer.travelMinutes*2};
 return !!worker&&worker.employment!=='CENTER_RESERVE'&&neighbors.includes(offer.borrowerCenterId)&&job.status==='OPEN'&&job.sourceHash===offer.sourceHash&&job.date===offer.date&&job.startMinute===offer.startMinute&&job.durationMinutes===offer.durationMinutes&&availableFor(worker,travelJob)&&!owner.jobs.some(j=>j.status!=='STALE'&&j.assigned.includes(worker.id)&&shareOverlap(offer,{...j,travelMinutes:0}));
}
export async function sharedLaborRows(tx:Prisma.TransactionClient){return tx.workRecord.findMany({where:{workspace:'shared',kind:'laborShare'},orderBy:{id:'asc'}})}
export async function externalLaborBusy(tx:Prisma.TransactionClient,ownerCenterId:string){return [...await capacityBusy(tx,ownerCenterId),...(await sharedLaborRows(tx)).map(r=>r.payload as unknown as LaborShare).filter(s=>s.ownerCenterId===ownerCenterId&&s.status==='ASSIGNED').map(s=>({workerId:s.workerId,date:s.date,startMinute:s.startMinute-s.travelMinutes,durationMinutes:s.durationMinutes+2*s.travelMinutes}))];}
/** All mutating labor paths hold the shared lock. Never lock a foreign Center row
 * here: center -> shared labor -> own roster is the single lock ordering. */
export async function reconcileLaborShares(tx:Prisma.TransactionClient,override?:{centerId:string;state:State}){
 await laborSharingLock(tx);
 const rows=await sharedLaborRows(tx);if(!rows.length)return;
 const capacityWindows=(await laborCapacityRows(tx)).map(r=>r.payload as unknown as LaborCapacityWindow);
 const rosters=await tx.workRecord.findMany({where:{kind:'laborOperations',id:'current'}}),centers=await tx.center.findMany();
 const ops=(id:string)=>(rosters.find(r=>r.workspace===recordSpace(id))?.payload??emptyLaborOps()) as unknown as LaborOps;
 const neighbors=new Map<string,string[]>();for(const c of centerRegistry)neighbors.set(c.id,await geographicNeighbors(tx,c.id));
 const previous=rows.map(r=>r.payload as unknown as LaborShare),next=structuredClone(previous),assigned:LaborShare[]=[];
 const jobs=new Map<string,{centerId:string;job:LaborJob}>();
 for(const offer of next){const job=ops(offer.borrowerCenterId).jobs.find(j=>j.id===offer.jobId);if(job)jobs.set(offer.borrowerCenterId+':'+job.id,{centerId:offer.borrowerCenterId,job});}
 for(const {centerId,job} of [...jobs.values()].sort((a,b)=>a.job.date.localeCompare(b.job.date)||a.job.startMinute-b.job.startMinute||a.job.id.localeCompare(b.job.id))){
  const state=override?.centerId===centerId?override.state:centers.find(c=>c.id===centerId)?.state as unknown as State|undefined,m=state?.missions.find(m=>m.id===job.missionId);
  const offers=next.filter(s=>s.borrowerCenterId===centerId&&s.jobId===job.id&&!['CANCELLED','COMPLETED'].includes(s.status));
  // Completed work remains an actual-work review, never automatically marked worked.
  if(job.status==='COMPLETED'){assigned.push(...offers.filter(s=>s.status==='ASSIGNED'));continue;}
  const slots=Math.max(0,job.count-job.assigned.length);
  let used=0;
  offers.sort((a,b)=>laborScore(ops(b.ownerCenterId),b.workerId)-laborScore(ops(a.ownerCenterId),a.workerId)||a.distanceKm-b.distanceKm||a.id.localeCompare(b.id));
  for(const offer of offers){
   const started=Date.now()>=Date.parse(offer.date+'T00:00:00+09:00')+offer.startMinute*60000;
   const owner=ops(offer.ownerCenterId),eligible=m&&m.status==='PLANNED'&&m.scheduledDate===job.date&&eligibleShare(offer,owner,job,neighbors.get(offer.ownerCenterId)??[])&&capacityAllowsAttendance(capacityWindows,offer,m);
   if(!eligible){offer.status='CANCELLED';offer.reason='작업·인력·인접지역 조건 변경: 새 일정 참석 재확인 필요';continue;}
   if(started){if(offer.status==='ASSIGNED'){assigned.push(offer);used++;}else{offer.status='CANCELLED';offer.reason='출발·작업 시작 시각 경과: 새 지원 확인 필요';}continue;}
   const overlap=assigned.some(a=>a.ownerCenterId===offer.ownerCenterId&&a.workerId===offer.workerId&&shareOverlap(a,offer));
   offer.status=used<slots&&!overlap?'ASSIGNED':'WAITLIST';offer.reason=offer.status==='ASSIGNED'?'센터 내부 참석자 우선 배정 후 부족분 지원':'내부 인력 우선 또는 다른 배정으로 대기';
   if(offer.status==='ASSIGNED'){used++;assigned.push(offer);}
  }
 }
 for(const offer of next){
  if(!jobs.has(offer.borrowerCenterId+':'+offer.jobId)&&!['CANCELLED','COMPLETED'].includes(offer.status)){offer.status='CANCELLED';offer.reason='연결 작업 없음: 참석 재확인 필요';}
  const old=previous.find(s=>s.id===offer.id)!;if(JSON.stringify(old)===JSON.stringify(offer))continue;
  await tx.workRecord.update({where:{workspace_kind_id:{workspace:'shared',kind:'laborShare',id:offer.id}},data:{payload:json(offer),version:{increment:1}}});
  if(old.status!==offer.status)for(const id of [offer.ownerCenterId,offer.borrowerCenterId])await tx.workRecord.create({data:{workspace:recordSpace(id),kind:'laborShareNotice',id:crypto.randomUUID(),payload:json({offerId:offer.id,workerName:offer.workerName,jobId:offer.jobId,date:offer.date,status:offer.status,reason:offer.reason,at:new Date().toISOString(),delivery:'INTERNAL_RECORD_ONLY'})}});
 }
}
