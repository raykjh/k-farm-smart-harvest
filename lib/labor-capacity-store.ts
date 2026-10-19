import type {Prisma} from '@prisma/client';
import type {Mission,State} from './types';
import {recordSpace} from './workspace';
import {geographicNeighbors} from './center-adjacency';
import {availableFor,emptyLaborOps,type LaborOps} from './labor-operations';
import {laborCapacityBlocks,withLaborSupport,capacityOverlap,supportKey,type LaborCapacityWindow,type LaborCapacityView} from './labor-capacity';
import {crewCapacityLimits} from './operating-capacity';
import {missionResourceUse} from './scheduling-constraints';
import {dateSlot,verifySchedule,type SchedulingJob} from './scheduling-engine';
import {isClosedTask} from './task-lifecycle';
import {reserveLaborWindows,isReserveSupport} from './center-reserve';
import {localAbsenceWindows,recoveryRows,type LaborRecovery} from './labor-recovery-store';

export const laborCapacityKey=(id:string)=>({workspace:'shared',kind:'laborCapacityWindow',id});
export const capacityToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export async function laborCapacityRows(tx:Prisma.TransactionClient){return tx.workRecord.findMany({where:{workspace:'shared',kind:'laborCapacityWindow'},orderBy:{id:'asc'}})}
export function capacityPersonEligible(w:LaborCapacityWindow,ops:LaborOps){
 const p=ops.people.find(p=>p.id===w.workerId);
 return !!p&&p.employment!=='CENTER_RESERVE'&&w.workCodes.every(workCode=>availableFor(p,{date:w.date,startMinute:w.startMinute,durationMinutes:w.endMinute-w.startMinute,workCode} as any))&&!ops.jobs.some(j=>j.status!=='STALE'&&j.assigned.includes(p.id)&&capacityOverlap(w,{date:j.date,startMinute:j.startMinute,endMinute:j.startMinute+j.durationMinutes}));
}
export async function readLaborCapacity(tx:Prisma.TransactionClient,id:string):Promise<LaborCapacityView>{
 const rows=await laborCapacityRows(tx),windows=rows.map(r=>r.payload as unknown as LaborCapacityWindow).filter(w=>w.status==='CONFIRMED'&&w.date>=capacityToday()&&(w.ownerCenterId===id||w.borrowerCenterId===id));
 const absences=(await localAbsenceWindows(tx,id)).filter(w=>w.date>=capacityToday()&&w.resolution!=='REPLACED').map(({workerId,date,startMinute,endMinute})=>({workerId,date,startMinute,endMinute}));
 const roster=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(id),kind:'laborOperations',id:'current'}}});
 const reserves=reserveLaborWindows((roster?.payload??emptyLaborOps()) as unknown as LaborOps,id,capacityToday(),absences);
 if(!windows.length)return {incoming:[],outgoing:[],...(reserves.length?{reserves}:{}),...(absences.length?{absences}:{})};
 const neighbors=await geographicNeighbors(tx,id),rosters=await tx.workRecord.findMany({where:{kind:'laborOperations',id:'current'}});
 const withdrawals=(await recoveryRows(tx,id)).map(r=>r.payload as unknown as LaborRecovery).filter(r=>r.kind==='SHARE_WITHDRAWAL'&&r.resolution!=='REPLACED');
 const incoming=windows.filter(w=>w.borrowerCenterId===id&&neighbors.includes(w.ownerCenterId)&&capacityPersonEligible(w,(rosters.find(r=>r.workspace===recordSpace(w.ownerCenterId))?.payload??emptyLaborOps()) as unknown as LaborOps)).map(w=>{
  const excludedIntervals=withdrawals.filter(r=>r.ownerCenterId===w.ownerCenterId&&r.workerId===w.workerId&&r.date===w.date).map(({startMinute,endMinute})=>({startMinute,endMinute}));
  return excludedIntervals.length?{...w,excludedIntervals}:w;
 });
 // A revoked eligibility must never release the owner's reservation implicitly.
 return {incoming,outgoing:windows.filter(w=>w.ownerCenterId===id),...(reserves.length?{reserves}:{}),...(absences.length?{absences}:{})};
}
export async function capacityBusy(tx:Prisma.TransactionClient,id:string){return [...(await laborCapacityRows(tx)).map(r=>r.payload as unknown as LaborCapacityWindow).filter(w=>w.ownerCenterId===id&&w.status==='CONFIRMED'),...await localAbsenceWindows(tx,id)].map(w=>({workerId:w.workerId,date:w.date,startMinute:w.startMinute,durationMinutes:w.endMinute-w.startMinute}));}
export async function assertCapacityRoster(tx:Prisma.TransactionClient,id:string,ops:LaborOps){
 const active=(await laborCapacityRows(tx)).map(r=>r.payload as unknown as LaborCapacityWindow).filter(w=>w.ownerCenterId===id&&w.status==='CONFIRMED'&&w.date>=capacityToday());
 if(active.some(w=>!capacityPersonEligible(w,ops)))throw Error('확정된 인접센터 지원 시간·가능 작업과 충돌합니다. 지원 예약부터 조정하세요.');
}
export async function assertLaborCapacitySchedule(tx:Prisma.TransactionClient,id:string,state:State){
 const view=await readLaborCapacity(tx,id),s={...state,laborCapacity:view};
 if(!view.incoming.length&&!view.outgoing.length&&!view.absences?.length&&!s.missions.some(m=>m.laborSupportIds?.length&&!isClosedTask(m.status)))return;
 const tasks:SchedulingJob[]=s.missions.filter(m=>!isClosedTask(m.status)&&m.scheduledDate&&m.scheduledDate>=capacityToday()).map(m=>{
  const original=dateSlot(m.scheduledDate!)+(m.start%32+32)%32;
  return withLaborSupport(s,{...missionResourceUse(s,m),id:m.id,original,duration:m.duration,allowed:[original],locked:true,selected:false,preferred:null,predecessor:null},m);
 });
 verifySchedule({tasks,purpose:'INITIAL',freezeBefore:0,daily:false,staffCapacity:s.staffCount,transportCapacity:s.transportCount,capacityLimits:crewCapacityLimits(s),capacityBlocks:laborCapacityBlocks(s)},tasks.map(t=>({id:t.id,start:t.original,laborSupportIds:t.laborSupportIds??[]})),'INITIAL_DISPATCH');
}
export async function notifyCapacity(tx:Prisma.TransactionClient,w:LaborCapacityWindow,event:string,detail:unknown){
 for(const center of [w.ownerCenterId,w.borrowerCenterId])await tx.workRecord.create({data:{workspace:recordSpace(center),kind:'laborCapacityNotice',id:crypto.randomUUID(),payload:JSON.parse(JSON.stringify({windowId:w.id,workerName:w.workerName,date:w.date,event,detail,at:new Date().toISOString(),delivery:'INTERNAL_RECORD_ONLY'}))}});
}
/** Called in the same locked plan transaction as equipment reservations. */
export async function syncLaborCapacityPlan(tx:Prisma.TransactionClient,id:string,before:State,after:State,changedIds:string[]){
 await assertLaborCapacitySchedule(tx,id,after);
 const windows=(await laborCapacityRows(tx)).map(r=>r.payload as unknown as LaborCapacityWindow);
 for(const taskId of changedIds){
  const old=before.missions.find(m=>m.id===taskId),m=after.missions.find(m=>m.id===taskId);
  const changed=old?.scheduledDate!==m?.scheduledDate||old?.start!==m?.start||old?.duration!==m?.duration||old?.status!==m?.status||supportKey(old?.laborSupportIds)!==supportKey(m?.laborSupportIds);
  if(!changed)continue;
  for(const windowId of new Set([...old?.laborSupportIds??[],...m?.laborSupportIds??[]])){
   // Center employees are assigned/notified in the local attendance ledger,
   // not fictitious inter-center borrowing records.
   if(isReserveSupport(windowId))continue;
   const w=windows.find(w=>w.id===windowId);if(!w)throw Error('인력 지원 예약 연결 확인 필요');
   await notifyCapacity(tx,w,'PLAN_CHANGED',{missionId:taskId,date:m?.scheduledDate??null,task:m?.label??old?.label,status:m?.status??'REMOVED',attendanceReconfirmationRequired:true});
  }
 }
}
export function capacityAllowsAttendance(windows:LaborCapacityWindow[],offer:{ownerCenterId:string;borrowerCenterId:string;workerId:string;date:string;startMinute:number;durationMinutes:number;travelMinutes:number},mission:Mission|undefined){
 const used={date:offer.date,startMinute:offer.startMinute-offer.travelMinutes,endMinute:offer.startMinute+offer.durationMinutes+offer.travelMinutes};
 if(windows.some(w=>w.status==='WITHDRAWN'&&w.ownerCenterId===offer.ownerCenterId&&w.workerId===offer.workerId&&capacityOverlap(w,used)))return false;
 return windows.filter(w=>w.status==='CONFIRMED'&&w.ownerCenterId===offer.ownerCenterId&&w.workerId===offer.workerId&&capacityOverlap(w,used)).every(w=>w.borrowerCenterId===offer.borrowerCenterId&&mission?.laborSupportIds?.includes(w.id)&&used.startMinute>=w.startMinute&&used.endMinute<=w.endMinute);
}
