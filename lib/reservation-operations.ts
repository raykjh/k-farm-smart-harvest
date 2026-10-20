import {planningState,readExecutionHistory} from './replan-history';
import {immovable} from './replan-scope';
import {hasCenterOperationsRole} from './auth-policy';
import {isClosedTask} from './task-lifecycle';
import type {Prisma} from '@prisma/client';
import {reconcileLaborPlan} from './labor-plan-sync';
import type {Principal} from './auth';
import type {State} from './types';
import {missionReservation} from './plan-reservation-sync';
import {reservationSchema,validateReservations} from './shared-reservations';
function authority(p:Principal,centerId:string){if(p.role!=='SUPER_ADMIN'&&(!hasCenterOperationsRole(p)||p.centerId!==centerId))throw Error('해당 센터 관리자 권한이 필요합니다.');}
export async function migrateReservations(tx:Prisma.TransactionClient,centerId:string,actor:Principal,apply:boolean){
 authority(actor,centerId);
 await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${centerId} FOR UPDATE`;
 const row=await tx.center.findUniqueOrThrow({where:{id:centerId}}),state=row.state as unknown as State;
 const proposed=state.missions.filter(m=>!isClosedTask(m.status)).flatMap(m=>{const r=missionReservation(centerId,m);return r?[r]:[]});
 for(const id of [...new Set(proposed.map(r=>r.resourceId))].sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${id}`},0))`;
 const rows=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
 const existing=rows.map(r=>reservationSchema.parse(r.payload));
 const missing=proposed.filter(r=>{const links=existing.filter(x=>x.centerId===centerId&&x.taskId===r.taskId);if(!links.length)return true;if(links.length!==1||links[0].resourceId!==r.resourceId||Date.parse(links[0].from)!==Date.parse(r.from)||Date.parse(links[0].to)!==Date.parse(r.to))throw Error('기존 예약과 일정 불일치');return false;});
 validateReservations(missing,existing);
 const others=await tx.center.findMany({where:{id:{not:centerId}}});
 const legacy=others.flatMap(c=>(c.state as unknown as State).missions.flatMap(m=>{const r=missionReservation(c.id,m);return r?[r]:[]}));
 for(const r of missing)if(legacy.some(x=>x.resourceId===r.resourceId&&Date.parse(x.from)<Date.parse(r.to)&&Date.parse(r.from)<Date.parse(x.to)))throw Error('다른 센터 기존 일정과 충돌');
 if(apply){for(const r of missing)await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:r.id,payload:r}});await tx.audit.create({data:{centerId,action:'reservation.migrate',detail:{actorId:actor.id,count:missing.length}}});}
 return {ok:true,candidates:proposed.length,added:apply?missing.length:0,pending:missing.length,applied:apply};
}
export async function cancelLinkedReservation(tx:Prisma.TransactionClient,id:string,version:number,reason:string,actor:Principal,allowEquipmentOwner=false){
 const key={workspace:'shared',kind:'resourceReservation',id};
 const initial=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),initialBooking=reservationSchema.parse(initial.payload);
 if(allowEquipmentOwner&&actor.centerId!==initialBooking.centerId){
  const owner=await tx.center.findUnique({where:{id:actor.centerId??''}}),machine=(owner?.state as unknown as State|undefined)?.machines.find(m=>m.id===initialBooking.resourceId&&(!m.ownerCenterId||m.ownerCenterId===actor.centerId));
  if(!hasCenterOperationsRole(actor)||!machine)throw Error('장비 소속 센터 권한이 필요합니다.');
 }else authority(actor,initialBooking.centerId);
 await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${initialBooking.centerId} FOR UPDATE`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${initialBooking.resourceId}`},0))`;
 const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}});
 if(row.version!==version)throw Error('예약 버전이 변경되었습니다.');
 const r=reservationSchema.parse(row.payload);if(r.resourceId!==initialBooking.resourceId||r.centerId!==initialBooking.centerId)throw Error('예약이 변경되었습니다.');
 if(Date.parse(r.from)<=Date.now())throw Error('시작 시각이 지난 작업은 실적 확인 후 처리하세요.');
 const center=await tx.center.findUniqueOrThrow({where:{id:r.centerId}}),state=center.state as unknown as State;
 const mission=state.missions.find(m=>m.id===r.taskId);if(!mission||immovable(planningState(state,await readExecutionHistory(tx,initialBooking.centerId==='demo'?'sandbox':`center:${initialBooking.centerId}`)).missions.find(m=>m.id===mission.id)!))throw Error('취소 가능한 미완료 작업이 아닙니다.');
 const expected=missionReservation(r.centerId,mission,r.id);if(!expected||expected.resourceId!==r.resourceId||Date.parse(expected.from)!==Date.parse(r.from)||Date.parse(expected.to)!==Date.parse(r.to))throw Error('일정과 예약 불일치');
 const before=structuredClone(mission);
 mission.status='HELD';mission.originalScheduledDate??=mission.scheduledDate;delete mission.scheduledDate;mission.resourceId=null;
 state.planVersion++;for(const proposal of state.revisions??[])if(proposal.status==='REVIEW_REQUIRED')proposal.status='SUPERSEDED';
 await reconcileLaborPlan(tx,r.centerId,state);
 await tx.workRecord.create({data:{workspace:'shared',kind:'cancelledReservation',id,version:version+1,payload:{reservation:r,before,reason,actorId:actor.id}}});
 await tx.workRecord.delete({where:{workspace_kind_id:key}});
 await tx.center.update({where:{id:r.centerId},data:{state:JSON.parse(JSON.stringify(state)),version:{increment:1}}});
 const farmer=state.fields.find(f=>f.id===mission.fieldId)?.farmerId;
 if(farmer)await tx.outbox.create({data:{status:'RECORDED_ONLY',id:'cancel-reservation:'+id,centerId:r.centerId,farmerId:farmer,planVersion:state.planVersion,body:`[모의 알림] ${mission.label}의 예약이 취소되어 재배정 대기 중입니다. 센터에 문의하세요.`}});
 await tx.audit.create({data:{centerId:r.centerId,action:'reservation.cancelLinked',detail:{actorId:actor.id,before,after:mission,reason,reservationId:id}}});
 return {ok:true,status:'CANCELLED',taskStatus:'HELD',planVersion:state.planVersion};
}
