import {isClosedTask} from './task-lifecycle';
import {assertResourceBooking} from './center-resources';
import type {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {reconcileLaborPlan} from './labor-plan-sync';
import {laborSharingLock} from './labor-sharing';
import {syncLaborCapacityPlan} from './labor-capacity-store';
import {recordSpace} from './workspace';
import {ordinaryWorkerDemand} from './planned-labor-demand';
import type {WorkMission} from './replan-work-split';
import type {Mission,State} from './types';
import {reservationSchema,validateReservations,type SharedReservation} from './shared-reservations';
export function missionReservation(centerId:string,m:Mission,id=`plan:${centerId}:${m.id}`):SharedReservation|null{
 if(m.status==='CANCELLED')return null;
 if(!m.resourceId||!m.scheduledDate)return null;
 const start=Date.parse(m.scheduledDate+'T08:00:00+09:00')+((m.start%32+32)%32)*900000;
 return reservationSchema.parse({id,centerId,taskId:m.id,resourceId:m.resourceId,from:new Date(start).toISOString(),to:new Date(start+m.duration*900000).toISOString()});
}
/** Caller holds its Center row lock. Reservations, plan and outbox share one transaction. */
export async function syncChangedPlanReservations(tx:Prisma.TransactionClient,centerId:string,before:State,after:State,changedIds:string[],actor:string,allowRemoval=false){
 const ids=new Set(changedIds);if(ids.size!==changedIds.length)throw Error('변경 작업 중복');
 const oldTasks=before.missions.filter(m=>ids.has(m.id)),newTasks=after.missions.filter(m=>ids.has(m.id));
 if((!allowRemoval&&newTasks.length!==ids.size)||[...ids].some(id=>!oldTasks.some(m=>m.id===id)&&!newTasks.some(m=>m.id===id))||oldTasks.some(m=>isClosedTask(m.status)))throw Error('변경 가능한 작업 연결 확인 필요');
 const resources=[...new Set([...oldTasks,...newTasks].map(m=>m.resourceId).filter((x):x is string=>!!x))].sort();
 for(const id of resources)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${id}`},0))`;
 const rows=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
 const active=rows.map(row=>({row,r:reservationSchema.parse(row.payload)}));
 const linked=active.filter(x=>x.r.centerId===centerId&&ids.has(x.r.taskId));
 if(new Set(linked.map(x=>x.r.taskId)).size!==linked.length)throw Error('작업에 여러 예약이 연결되어 있습니다.');
 for(const {r} of linked){const old=oldTasks.find(m=>m.id===r.taskId);const expected=old?missionReservation(centerId,old,r.id):null;if(!expected||expected.resourceId!==r.resourceId||Date.parse(expected.from)!==Date.parse(r.from)||Date.parse(expected.to)!==Date.parse(r.to))throw Error('기존 일정과 예약이 다릅니다. 먼저 확인하세요.');}
 const next=newTasks.flatMap(m=>{const r=missionReservation(centerId,m,linked.find(x=>x.r.taskId===m.id)?.r.id);return r?[r]:[]});
 for(const r of next)await assertResourceBooking(tx,centerId,r.resourceId,new Date(Date.parse(r.from)+9*3600000).toISOString().slice(0,10));
 for(const r of next)if(await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'shared',kind:'cancelledReservation',id:r.id}}}))r.id+=':resumed:'+randomUUID();
 validateReservations(next,active.filter(x=>!linked.includes(x)).map(x=>x.r));
 // Until all historical missions are indexed, check other centers' legacy schedules too.
 const centers=await tx.center.findMany();
 const legacy=centers.flatMap(c=>(c.id===centerId?after:c.state as unknown as State).missions.filter(m=>!(c.id===centerId&&ids.has(m.id))).flatMap(m=>{const r=missionReservation(c.id,m);return r?[r]:[]}));
 for(const r of next)if(legacy.some(x=>x.resourceId===r.resourceId&&Date.parse(x.from)<Date.parse(r.to)&&Date.parse(r.from)<Date.parse(x.to)))throw Error('기존 센터 작업과 예약 충돌');
 for(const {r} of linked)await tx.workRecord.delete({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:r.id}}});
 for(const r of next){const version=(linked.find(x=>x.r.id===r.id)?.row.version??0)+1;await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:r.id,version,payload:r}});}
 // Keep the recruitment index in step with the changed plan. Added split days
 // inherit demand provenance, not the parent's attendance or assignments.
 for(const m of newTasks as WorkMission[]){
  const key={workspace:recordSpace(centerId),kind:'laborDemand',id:m.id};
  const existing=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  const source=existing??(m.equipmentSplit?await tx.workRecord.findUnique({where:{workspace_kind_id:{...key,id:m.equipmentSplit.sourceId}}}):null);
  if(!source||isClosedTask(m.status))continue;
  const payload=JSON.parse(JSON.stringify({...source.payload as object,missionId:m.id,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,people:ordinaryWorkerDemand(m),totalCenterStaff:m.staff,owner:m.owner,status:'UNASSIGNED',...(m.equipmentSplit?{splitFromMissionId:m.equipmentSplit.sourceId}:{}),note:'변경계획의 인력 수요. 실제 참석은 다시 확인합니다.'}));
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload},update:{payload,version:{increment:1}}});
 }
 await tx.audit.create({data:{centerId,action:'plan.reservations.sync',detail:{actor,before:linked.map(x=>x.r),after:next,taskIds:changedIds}}});
 await reconcileLaborPlan(tx,centerId,after);
 await laborSharingLock(tx);
 await syncLaborCapacityPlan(tx,centerId,before,after,changedIds);
 return {updated:next.length,released:linked.filter(x=>!next.some(r=>r.id===x.r.id)).length};
}
