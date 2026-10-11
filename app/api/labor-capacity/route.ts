import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {centerId,recordSpace} from '@/lib/workspace';
import {centerDefinition} from '@/lib/center-registry';
import {geographicNeighbors} from '@/lib/center-adjacency';
import {lockCenterPool} from '@/lib/center-resources';
import {laborSharingLock,sharedLaborRows,reconcileLaborShares,type LaborShare} from '@/lib/labor-sharing';
import {recordLaborRecovery,refreshLaborRecoveries,localAbsenceWindows} from '@/lib/labor-recovery-store';
import {emptyLaborOps,type LaborOps} from '@/lib/labor-operations';
import {laborCapacityInput,capacityOverlap,type LaborCapacityWindow} from '@/lib/labor-capacity';
import {laborCapacityRows,laborCapacityKey,capacityPersonEligible,assertLaborCapacitySchedule,notifyCapacity} from '@/lib/labor-capacity-store';
import type {State} from '@/lib/types';
import {isClosedTask} from '@/lib/task-lifecycle';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const rosterKey=(id:string)=>({workspace:recordSpace(id),kind:'laborOperations',id:'current'});

export const GET=withAuth('labor-capacity',async()=>{
 const id=centerId(),neighbors=await geographicNeighbors(db,id),own=await db.workRecord.findUnique({where:{workspace_kind_id:rosterKey(id)}}),ops=(own?.payload??emptyLaborOps()) as unknown as LaborOps;
 const rows=(await laborCapacityRows(db)).filter(r=>{const w=r.payload as unknown as LaborCapacityWindow;return w.ownerCenterId===id||w.borrowerCenterId===id});
 const centers=await db.center.findMany(),notices=await db.workRecord.findMany({where:{workspace:recordSpace(id),kind:'laborCapacityNotice'},orderBy:{updatedAt:'desc'},take:50});
 return NextResponse.json({centerId:id,canManage:currentPrincipal()?.role==='CENTER_ADMIN',rosterVersion:own?.version??0,workers:ops.people.filter(p=>p.active&&p.employment!=='CENTER_RESERVE').map(p=>({id:p.id,name:p.name,workCodes:p.workCodes})),neighbors:neighbors.map(n=>({id:n,name:centerDefinition(n).name})),windows:rows.map(r=>{const w=r.payload as unknown as LaborCapacityWindow;return {...w,version:r.version,bookings:centers.flatMap(c=>(c.state as unknown as State).missions.filter(m=>m.laborSupportIds?.includes(w.id)&&!isClosedTask(m.status)).map(m=>({id:m.id,label:m.label,date:m.scheduledDate,centerId:c.id,attendance:'RECONFIRM_PER_JOB'})))}}),notices:notices.map(r=>r.payload)},{headers:{'Cache-Control':'no-store'}});
});
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('offer'),requestId:z.string().uuid(),rosterVersion:z.number().int().nonnegative(),window:laborCapacityInput}).strict(),
 z.object({action:z.enum(['confirm','cancel','withdraw']),requestId:z.string().uuid(),id:z.string().uuid(),version:z.number().int().positive(),reason:z.string().trim().min(3).max(500)}).strict(),
]);
export const POST=withAuth('labor-capacity',async req=>{
 try{
  const b=command.parse(await req.json()),id=centerId(),actor=actorLabel(),digest=createHash('sha256').update(JSON.stringify({b,actor})).digest('hex');
  const result=await db.$transaction(async tx=>{
   await lockCenterPool(tx);await laborSharingLock(tx);
   const receiptKey={workspace:recordSpace(id),kind:'laborCapacityReceipt',id:b.requestId},prior=await tx.workRecord.findUnique({where:{workspace_kind_id:receiptKey}});
   if(prior){if((prior.payload as any).digest!==digest)throw Error('요청 ID 충돌');return {ok:true,alreadyApplied:true};}
   const rows=await laborCapacityRows(tx),centers=await tx.center.findMany();
   let w:LaborCapacityWindow;
   if(b.action==='offer'){
    const roster=await tx.workRecord.findUnique({where:{workspace_kind_id:rosterKey(id)}}),ops=(roster?.payload??emptyLaborOps()) as unknown as LaborOps;
    if((roster?.version??0)!==b.rosterVersion)throw Error('인력 명단이 변경되었습니다. 다시 조회하세요.');
    const person=ops.people.find(p=>p.id===b.window.workerId);if(!person)throw Error('소속 센터 신청자가 필요합니다.');
    w={...b.window,id:b.requestId,ownerCenterId:id,workerName:person.name,status:'OFFERED',actor,createdAt:new Date().toISOString()};
   }else{
    const row=rows.find(r=>r.id===b.id);if(!row||row.version!==b.version)throw Error('지원 예약 버전이 변경되었습니다. 다시 조회하세요.');
    w=structuredClone(row.payload) as unknown as LaborCapacityWindow;
    if(![w.ownerCenterId,w.borrowerCenterId].includes(id)||['CANCELLED','WITHDRAWN'].includes(w.status))throw Error('지원 예약 변경 권한·상태 확인 필요');
    if(b.action==='confirm'&&(id!==w.borrowerCenterId||w.status!=='OFFERED'))throw Error('지원받는 센터에서 새 제안을 확정하세요.');
    if(b.action==='cancel'&&centers.some(c=>(c.state as unknown as State).missions.some(m=>m.laborSupportIds?.includes(w.id)&&!isClosedTask(m.status))))throw Error('연결된 작업을 먼저 다른 인력·일정으로 재계획하거나 취소하세요.');
    if(b.action==='withdraw'&&(w.status!=='CONFIRMED'||Date.parse(w.date+'T00:00:00+09:00')+w.endMinute*60000<=Date.now()))throw Error('아직 끝나지 않은 확정 지원시간만 철회할 수 있습니다. 과거 근무는 실적으로 기록하세요.');
    w.status=b.action==='confirm'?'CONFIRMED':b.action==='withdraw'?'WITHDRAWN':'CANCELLED';w.reason=b.reason;
   }
   if(!['CANCELLED','WITHDRAWN'].includes(w.status)){
    if(!(await geographicNeighbors(tx,w.ownerCenterId)).includes(w.borrowerCenterId))throw Error('경계를 공유하는 직접 인접센터만 지원할 수 있습니다.');
    if(Date.parse(w.date+'T00:00:00+09:00')+w.startMinute*60000<=Date.now())throw Error('출발 전의 지원 일정만 예약할 수 있습니다.');
    const owner=centers.find(c=>c.id===w.ownerCenterId)?.state as unknown as State|undefined;
    if(!owner?.crewCapacity||owner.crewCapacity.workers<1)throw Error('보내는 센터의 일반인력 운영 용량을 먼저 확인하세요.');
    const own=await tx.workRecord.findUnique({where:{workspace_kind_id:rosterKey(w.ownerCenterId)}}),ops=(own?.payload??emptyLaborOps()) as unknown as LaborOps;
    if(!capacityPersonEligible(w,ops))throw Error('본인 동의 범위·가능 작업·근무 시간·기존 배정 확인 필요');
    if((await localAbsenceWindows(tx,w.ownerCenterId)).some(a=>a.workerId===w.workerId&&capacityOverlap(w,a)))throw Error('불참으로 기록된 시간은 새 지원시간으로 사용할 수 없습니다.');
    if(rows.some(r=>{const other=r.payload as unknown as LaborCapacityWindow;return other.id!==w.id&&!['CANCELLED','WITHDRAWN'].includes(other.status)&&other.ownerCenterId===w.ownerCenterId&&other.workerId===w.workerId&&capacityOverlap(w,other)}))throw Error('다른 지원 예약과 시간이 겹칩니다.');
    if((await sharedLaborRows(tx)).some(r=>{const s=r.payload as unknown as LaborShare;return s.ownerCenterId===w.ownerCenterId&&s.workerId===w.workerId&&s.status==='ASSIGNED'&&capacityOverlap(w,{date:s.date,startMinute:s.startMinute-s.travelMinutes,endMinute:s.startMinute+s.durationMinutes+s.travelMinutes})}))throw Error('이미 확정된 외부 작업 참석과 충돌합니다.');
   }
   const key=laborCapacityKey(w.id);
   if(b.action==='offer')await tx.workRecord.create({data:{...key,payload:json(w)}});
   else await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:json(w),version:{increment:1}}});
   if(b.action==='withdraw'){
    const state=centers.find(c=>c.id===w.borrowerCenterId)!.state as unknown as State;
    await recordLaborRecovery(tx,{id:b.requestId,kind:'WINDOW_WITHDRAWAL',centerId:w.borrowerCenterId,ownerCenterId:w.ownerCenterId,workerId:w.workerId,workerName:w.workerName,windowId:w.id,date:w.date,startMinute:w.startMinute,endMinute:w.endMinute,reason:w.reason,actor,missionIds:state.missions.filter(m=>m.laborSupportIds?.includes(w.id)).map(m=>m.id)});
    await reconcileLaborShares(tx);await refreshLaborRecoveries(tx,w.borrowerCenterId);
   }
   if(w.status==='CONFIRMED'){
    const owner=centers.find(c=>c.id===w.ownerCenterId)?.state as unknown as State|undefined;
    if(!owner||!centers.some(c=>c.id===w.borrowerCenterId))throw Error('양쪽 센터 등록 확인 필요');
    // Confirming consumes the sender's capacity, so it must fit their ledger.
    // It only adds an unused option for the receiver. Requiring the receiver's
    // already-broken schedule to fit here prevents recovery from an absence.
    // Assignment/plan approval still validates both support and all local work
    // atomically via syncLaborCapacityPlan; no job or attendance is changed here.
    await assertLaborCapacitySchedule(tx,w.ownerCenterId,owner);
   }
   await notifyCapacity(tx,w,w.status,{reason:w.reason});
   await tx.audit.create({data:{centerId:id,action:'labor.capacity.'+b.action,detail:{actor,windowId:w.id,requestId:b.requestId}}});
   await tx.workRecord.create({data:{...receiptKey,payload:{digest}}});
   return {ok:true,id:w.id,status:w.status};
  },{timeout:30000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'인력 지원 예약 처리 실패'},{status:409})}
});
