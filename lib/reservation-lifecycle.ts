import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import type {Principal} from './auth';
import type {State} from './types';
import {reservationSchema,validateReservations,type SharedReservation} from './shared-reservations';
export const reservationAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('approve'),reservation:reservationSchema}).strict(),
 z.object({action:z.literal('change'),id:z.string().min(1),version:z.number().int().positive(),from:z.string(),to:z.string()}).strict(),
 z.object({action:z.literal('cancel'),id:z.string().min(1),version:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict(),
]);
const key=(id:string)=>({workspace:'shared',kind:'resourceReservation',id});
/** Independent loan-slot lifecycle. Existing scheduled jobs must use plan approval instead. */
export async function mutateReservation(tx:Prisma.TransactionClient,input:unknown,actor:Principal){
 const b=reservationAction.parse(input),id=b.action==='approve'?b.reservation.id:b.id;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation:${id}`},0))`;
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:key(id)}});
 if(b.action==='approve'&&await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'shared',kind:'cancelledReservation',id}}}))throw Error('취소된 예약 ID는 재사용할 수 없습니다.');
 if(b.action==='approve'&&row)throw Error('이미 등록된 예약입니다.');
 if(b.action!=='approve'&&(!row||row.version!==b.version))throw Error('예약이 변경되었거나 없습니다. 새로 조회하세요.');
 const old=row?reservationSchema.parse(row.payload):null;
 const r:SharedReservation=b.action==='approve'?b.reservation:b.action==='change'?reservationSchema.parse({...old,from:b.from,to:b.to}):old!;
 // All shared writers acquire exactly the same resource lock.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${r.resourceId}`},0))`;
 const centers=await tx.center.findMany({orderBy:{id:'asc'}});
 const owners=centers.filter(c=>(c.state as unknown as State).machines.some(m=>m.id===r.resourceId&&(!m.ownerCenterId||m.ownerCenterId===c.id)));
 if(owners.length!==1)throw Error('장비 원소속을 유일하게 확인할 수 없습니다.');
 const owner=owners[0],machine=(owner.state as unknown as State).machines.find(m=>m.id===r.resourceId)!;
 if(actor.role!=='SUPER_ADMIN'&&(actor.role!=='CENTER_ADMIN'||actor.centerId!==owner.id))throw Error('장비 소속 센터 관리자만 승인·변경·취소할 수 있습니다.');
 if(!centers.some(c=>c.id===r.centerId))throw Error('대여 센터가 등록되지 않았습니다.');
 // Avoid silently detaching a booking from an approved job or changing work windows.
 if(centers.some(c=>(c.state as unknown as State).missions.some(m=>m.id===r.taskId&&c.id===r.centerId)))throw Error('연결된 작업은 일정 재계획·승인에서 함께 변경해야 합니다.');
 if(b.action!=='cancel'){
  if(machine.status!=='AVAILABLE'||machine.safetyLock)throw Error('사용 가능한 장비가 아닙니다.');
  for(const c of centers)for(const m of (c.state as unknown as State).missions){
   if(m.resourceId!==r.resourceId||!m.scheduledDate)continue;
   const start=Date.parse(m.scheduledDate+'T08:00:00+09:00')+((m.start%32+32)%32)*15*60000;
   if(start<Date.parse(r.to)&&Date.parse(r.from)<start+m.duration*15*60000)throw Error('기존 작업 일정과 충돌합니다.');
  }
  const all=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation',id:{not:id}}});
  validateReservations([r],all.map(x=>reservationSchema.parse(x.payload)));
 }
 const version=(row?.version??0)+1;
 if(b.action==='cancel'){
  await tx.workRecord.create({data:{workspace:'shared',kind:'cancelledReservation',id,version,payload:{reservation:r,reason:b.reason,actorId:actor.id}}});
  await tx.workRecord.delete({where:{workspace_kind_id:key(id)}});
 }
 else await tx.workRecord.upsert({where:{workspace_kind_id:key(id)},create:{...key(id),version,payload:r},update:{version,payload:r}});
 await tx.audit.create({data:{centerId:owner.id,action:'sharedReservation.'+b.action,detail:{actorId:actor.id,reservationId:id,before:old,after:b.action==='cancel'?null:r,version,reason:b.action==='cancel'?b.reason:null}}});
 return {id,version,status:b.action==='cancel'?'CANCELLED':'CONFIRMED'};
}
