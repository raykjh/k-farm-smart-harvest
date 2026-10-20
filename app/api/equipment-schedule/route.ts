import {NextResponse} from 'next/server';
import {z} from 'zod';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {db} from '@/lib/db';
import {lockCenterPool} from '@/lib/center-resources';
import {missionReservation} from '@/lib/plan-reservation-sync';
import {cancelLinkedReservation} from '@/lib/reservation-operations';
import {mutateReservation} from '@/lib/reservation-lifecycle';
import {reservationSchema,validateReservations} from '@/lib/shared-reservations';
import {planningState,readExecutionHistory} from '@/lib/replan-history';
import {recordSpace} from '@/lib/workspace';
import {immovable} from '@/lib/replan-scope';
import {queueEquipmentReview,processEquipmentReview} from '@/lib/equipment-scheduling';
import type {State} from '@/lib/types';
const signature=(b:z.infer<typeof schema>)=>JSON.stringify([b.machineId,b.ownerVersion,b.cancel.map(c=>[c.id,c.version,c.centerVersion])]);
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const schema=z.object({machineId:z.string().min(1).max(100),ownerVersion:z.number().int(),requestId:z.string().uuid(),cancel:z.array(z.object({id:z.string().min(1),version:z.number().int().nonnegative(),centerVersion:z.number().int()}).strict()).max(600)}).strict();
export const GET=withAuth('equipment-schedule',async req=>{
 try{
  const machineId=new URL(req.url).searchParams.get('machineId'),actor=currentPrincipal()!;
  const centers=await db.center.findMany({orderBy:{id:'asc'}}),owners=centers.filter(c=>(c.state as unknown as State).machines.some(m=>m.id===machineId&&(!m.ownerCenterId||m.ownerCenterId===c.id)));
  if(owners.length!==1)throw Error('장비 소유 센터 확인 필요');
  const owner=owners[0],owned=owner.id===actor.centerId,rows=await db.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
  const bookings=rows.map(r=>({...reservationSchema.parse(r.payload),version:r.version})).filter(r=>r.resourceId===machineId&&(owned||r.centerId===actor.centerId));
  const visible=centers.filter(c=>owned||c.id===actor.centerId);
  const items=[];
  for(const center of visible){
   const state=planningState(center.state as unknown as State,await readExecutionHistory(db,recordSpace(center.id)));
   const legacy=state.missions.filter(m=>m.resourceId===machineId&&!immovable(m)).flatMap(m=>{const r=missionReservation(center.id,m);return r&&!bookings.some(b=>b.centerId===center.id&&b.taskId===m.id)?[{...r,version:0}]:[]});
   for(const r of [...bookings.filter(r=>r.centerId===center.id),...legacy]){
    const task=state.missions.find(m=>m.id===r.taskId);
    // The owner sees equipment occupancy, never another center's land/worker PII.
    items.push({...r,centerVersion:center.version,label:owned&&center.id!==actor.centerId?r.taskId:task?.label??r.taskId,canCancel:Date.parse(r.from)>Date.now()&&(!task||!immovable(task))});
   }
  }
  const reviews=owned?await db.workRecord.findMany({where:{workspace:'shared',kind:'equipmentScheduleReview'},orderBy:{updatedAt:'desc'},take:100}):[];
  const latest=reviews.find(r=>(r.payload as any).machineId===machineId);
  return NextResponse.json({machineId,ownerCenterId:owner.id,ownerVersion:owner.version,owned,items:items.sort((a,b)=>a.from.localeCompare(b.from)),review:latest?{id:latest.id,...latest.payload as object}:null});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'조회 실패'},{status:409})}
});
export const POST=withAuth('equipment-schedule',async req=>{
 try{
  const b=schema.parse(await req.json()),actor=currentPrincipal()!;
  const result=await db.$transaction(async tx=>{
   await lockCenterPool(tx);
   const receiptKey={workspace:recordSpace(actor.centerId!),kind:'equipmentScheduleApply',id:b.requestId},receipt=await tx.workRecord.findUnique({where:{workspace_kind_id:receiptKey}});
   if(receipt){const p=receipt.payload as any;if(p.actorId!==actor.id||signature(p.input)!==signature(b))throw Error('이미 다른 내용으로 저장한 요청입니다.');return p.result;}
   const centers=await tx.center.findMany({orderBy:{id:'asc'}}),owners=centers.filter(c=>(c.state as unknown as State).machines.some(m=>m.id===b.machineId&&(!m.ownerCenterId||m.ownerCenterId===c.id)));
   if(owners.length!==1)throw Error('장비 소유 정보가 변경되었습니다.');
   const owner=owners[0],owned=owner.id===actor.centerId;
   if(owner.version!==b.ownerVersion)throw Error('장비 정보가 변경되었습니다. 다시 불러오세요.');
   if(new Set(b.cancel.map(r=>r.id)).size!==b.cancel.length)throw Error('예약 중복');
   const bookings=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
   const validated=[];
   // Validate every row against the same baseline before any cancellation.
   for(const change of b.cancel){
    const stored=bookings.find(r=>r.id===change.id);
    let booking=stored?reservationSchema.parse(stored.payload):undefined;
    if(!stored&&change.version===0){
     booking=centers.flatMap(c=>(c.state as unknown as State).missions.flatMap(m=>{const r=missionReservation(c.id,m);return r&&r.id===change.id?[r]:[]}))[0];
    }
    if(booking&&Date.parse(booking.from)<=Date.now())throw Error('시작된 예약은 취소할 수 없습니다.');
    if(!booking||booking.resourceId!==b.machineId||!owned&&booking.centerId!==actor.centerId)throw Error('이 장비의 담당 예약만 변경할 수 있습니다.');
    const center=centers.find(c=>c.id===booking!.centerId);
    if(!center||center.version!==change.centerVersion||(stored?.version??0)!==change.version)throw Error('예약 일정이 변경되었습니다. 다시 불러오세요.');
    if(!stored){validateReservations([booking],[...bookings.map(r=>reservationSchema.parse(r.payload)),...validated.filter(v=>v.version===1).map(v=>v.booking)]);await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});}
    validated.push({booking,version:stored?.version??1,linked:(center.state as unknown as State).missions.some(m=>m.id===booking!.taskId)});
   }
   for(const {booking,version,linked} of validated){
    if(linked)await cancelLinkedReservation(tx,booking.id,version,'장비 상세에서 예약 취소',actor,true);
    else await mutateReservation(tx,{action:'cancel',id:booking.id,version,reason:'장비 상세에서 예약 취소'},actor,true);
   }
   let reviewId:string|null=null;
   if(owned){
    const existing=await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentScheduleReview'},orderBy:{updatedAt:'desc'}});
    const pending=!b.cancel.length&&existing.find(r=>(r.payload as any).machineId===b.machineId&&(['PENDING','PROCESSING'].includes((r.payload as any).status)||(r.payload as any).status==='NEEDS_ATTENTION'&&(r.payload as any).results.every((v:any)=>['PENDING_AI','NO_WORK'].includes(v.status))));
    reviewId=pending?pending.id:await queueEquipmentReview(tx,b.machineId,actor,'장비 예약 변경에 따른 지역 일정 검토');
   }
   const result={ok:true,cancelled:b.cancel.length,reviewId,owned};
   await tx.workRecord.create({data:{...receiptKey,payload:json({actorId:actor.id,input:b,result})}});
   return result;
  },{timeout:30000});
  const review=result.reviewId?await processEquipmentReview(result.reviewId):null;
  return NextResponse.json({...result,review});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'일정 적용 실패'},{status:409})}
});
