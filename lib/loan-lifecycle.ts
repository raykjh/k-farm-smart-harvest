import {isCenterOperator} from './auth-policy';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import type {Principal} from './auth';
import type {State} from './types';
import {knownCenter} from './center-registry';
import {recordSpace} from './workspace';
import {validateLoan,type EquipmentLoan} from './center-sharing';
import {lockCenterPool,saveLoan} from './center-resources';
import {loanDependencies} from './loan-dependencies';
import {recordResourceNotice} from './center-resource-notices';
import {geographicNeighbors} from './center-adjacency';
import {isClosedTask} from './task-lifecycle';

const terms=z.object({id:z.string().uuid(),version:z.number().int().positive(),operation:z.enum(['CHANGE','CANCEL','RETURN']),from:z.string().date().optional(),to:z.string().date().optional(),returnedOn:z.string().date().optional(),reason:z.string().trim().min(1).max(500)});
export const loanLifecycleInput=z.discriminatedUnion('action',[
 terms.extend({action:z.literal('previewLoan')}).strict(),
 terms.extend({action:z.literal('manageLoan'),requestId:z.string().uuid(),reviewToken:z.string().regex(/^[a-f0-9]{64}$/),returnedConfirmed:z.boolean().optional(),operatorConfirmed:z.boolean().optional(),transportConfirmed:z.boolean().optional()}).strict(),
]);
type Terms=z.infer<typeof terms>;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=(id:string)=>({workspace:'shared',kind:'equipmentLoan',id});
function manager(actor:Principal){if(!isCenterOperator(actor)||!knownCenter(actor.centerId))throw Error('센터 관리자 권한 필요');}
function command(b:Terms):Terms{return {id:b.id,version:b.version,operation:b.operation,from:b.from,to:b.to,returnedOn:b.returnedOn,reason:b.reason};}

/** Read-only impact review; authority and all live dependencies are rechecked on apply. */
async function review(tx:Prisma.TransactionClient,b:Terms,actor:Principal){
 manager(actor);
 const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key(b.id)}}),old=row.payload as unknown as EquipmentLoan;
 if(![old.ownerCenterId,old.borrowerCenterId].includes(actor.centerId!))throw Error('해당 대여의 소유·사용 센터만 검토할 수 있습니다.');
 if(row.version!==b.version)throw Error('대여 내용이 변경되었습니다. 다시 불러오세요.');
 if(old.status==='CANCELLED'||old.status==='RETURNED')throw Error('이미 종료한 대여입니다.');
 if(b.operation!=='CANCEL'&&actor.centerId!==old.ownerCenterId)throw Error('기간 변경·반납은 소유 센터가 확인합니다.');
 if(b.operation!=='CANCEL'&&old.status!=='CONFIRMED')throw Error('확정된 대여만 기간 변경·반납할 수 있습니다.');
 if(b.operation==='CHANGE'&&(!b.from||!b.to||b.returnedOn)||b.operation==='RETURN'&&(!b.returnedOn||b.from||b.to)||b.operation==='CANCEL'&&(b.from||b.to||b.returnedOn))throw Error('처리 종류에 맞는 날짜를 입력하세요.');
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const next:EquipmentLoan={...old,...(b.operation==='CHANGE'?{usableFrom:b.from!,usableUntil:b.to!}:{}),status:b.operation==='CANCEL'?'CANCELLED':b.operation==='RETURN'?'RETURNED':'CONFIRMED'};
 const centers=await tx.center.findMany({orderBy:{id:'asc'}}),owner=centers.find(c=>c.id===old.ownerCenterId),machine=(owner?.state as unknown as State|undefined)?.machines.find(m=>m.id===old.machineId&&(!m.ownerCenterId||m.ownerCenterId===old.ownerCenterId));
 const loans=await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'},orderBy:{id:'asc'}});
 const bookings=(await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'},orderBy:{id:'asc'}})).filter(r=>(r.payload as any).resourceId===old.machineId);
 const history=await tx.workRecord.findMany({where:{workspace:recordSpace(old.borrowerCenterId),kind:'taskExecutionAssessment'},orderBy:{id:'asc'}});
 const linked=await loanDependencies(tx,old,next),blockers:string[]=[];
 try{validateLoan(next,loans.map(r=>r.payload as unknown as EquipmentLoan));}catch(e){blockers.push((e as Error).message);}
 if(!machine)blockers.push('소유 센터 장비대장을 확인하세요.');
 if(linked.tasks.some(t=>t.affected)||linked.reservations.some(r=>r.affected))blockers.push('연결된 미완료 작업·예약을 먼저 재계획하거나 예약 해제하세요.');
 if(b.operation==='CHANGE'){
  if(old.usableFrom===b.from&&old.usableUntil===b.to)blockers.push('변경할 사용 기간을 입력하세요.');
  if(old.usableFrom<today&&old.usableFrom!==b.from)blockers.push('이미 시작된 대여의 시작일은 변경할 수 없습니다.');
  if(b.to!<today)blockers.push('사용 종료일은 오늘 이후로 정하세요. 종료한 대여는 반납 처리하세요.');
  if(machine?.status!=='AVAILABLE'||machine.safetyLock)blockers.push('장비의 가용·안전 상태를 확인하세요.');
  if(!(await geographicNeighbors(tx,old.ownerCenterId)).includes(old.borrowerCenterId))blockers.push('면 경계의 직접 인접 관계를 확인하세요.');
  if(centers.some(c=>c.id!==old.borrowerCenterId&&(c.state as unknown as State).missions.some(m=>m.resourceId===old.machineId&&!isClosedTask(m.status)&&m.scheduledDate&&b.from!<=m.scheduledDate&&m.scheduledDate<=b.to!)))blockers.push('변경 기간에 다른 센터 작업이 있습니다.');
  if(bookings.some(row=>{const r=row.payload as any;return r.centerId!==old.borrowerCenterId&&Date.parse(r.from)<Date.parse(b.to!+'T23:59:59.999+09:00')&&Date.parse(b.from!+'T00:00:00+09:00')<Date.parse(r.to);}))blockers.push('변경 기간에 다른 센터 예약이 있습니다.');
 }
 if(b.operation==='CANCEL'&&linked.preservedCompleted)blockers.push('이미 사용한 대여는 취소 대신 반납 처리하세요.');
 if(b.operation==='RETURN'){
  if(b.returnedOn!<old.usableFrom||b.returnedOn!>today)blockers.push('반납일은 사용 시작일 이후이면서 오늘까지여야 합니다.');
  if(machine?.status==='WORKING')blockers.push('작업 중인 장비는 정지·복귀 확인 후 반납 처리하세요.');
  if(linked.tasks.some(t=>t.status==='COMPLETED'&&t.date&&t.date>b.returnedOn!))blockers.push('반납일 이후의 완료 기록을 확인하세요.');
 }
 // Include complete source snapshots, not just plan versions; legacy writers may not bump them.
 const token=hash({actorId:actor.id,centerId:actor.centerId,today,input:command(b),row,centers,loans,bookings,history});
 return {token,loan:{...old,version:row.version},next,blockers:[...new Set(blockers)],...linked};
}
export type LoanReview=Awaited<ReturnType<typeof review>>;
export async function manageLoan(tx:Prisma.TransactionClient,raw:unknown,actor:Principal){
 const b=loanLifecycleInput.parse(raw);manager(actor);
 if(b.action==='previewLoan')return review(tx,command(b),actor);
 await lockCenterPool(tx);
 const receiptKey={workspace:recordSpace(actor.centerId!),kind:'loanLifecycleReceipt',id:b.requestId},requestHash=hash({actorId:actor.id,input:b});
 const receipt=await tx.workRecord.findUnique({where:{workspace_kind_id:receiptKey}});
 if(receipt){const saved=receipt.payload as any;if(saved.requestHash!==requestHash)throw Error('같은 처리 번호의 내용이 다릅니다.');return {...saved.result,alreadyApplied:true};}
 const checked=await review(tx,command(b),actor);
 if(checked.token!==b.reviewToken)throw Error('대여·작업·예약 자료가 변경되었습니다. 영향을 다시 확인하세요.');
 if(checked.blockers.length)throw Error(checked.blockers.join(' '));
 const {loan:old,next}=checked;
 let result:{loan:EquipmentLoan;version:number};
 if(b.operation==='RETURN'){
  if(!b.returnedConfirmed)throw Error('장비의 실제 복귀·인수 점검을 확인하세요.');
  const loan:EquipmentLoan={...next,returnedOn:b.returnedOn,returnedAt:new Date().toISOString(),returnedBy:actor.id};
  // Do not reset maintenance/safety state or rewrite completed work/reservations.
  await tx.workRecord.update({where:{workspace_kind_id:key(b.id)},data:{version:{increment:1},payload:loan}});
  await tx.audit.create({data:{centerId:actor.centerId!,action:'equipmentLoan.RETURNED',detail:{actorId:actor.id,reason:b.reason,before:old,after:loan}}});
  await recordResourceNotice(tx,`loan:${b.id}:${b.version+1}`,{event:'RETURNED',loanId:b.id,machineId:old.machineId,ownerCenterId:old.ownerCenterId,borrowerCenterId:old.borrowerCenterId,from:old.usableFrom,to:b.returnedOn,reason:b.reason});
  result={loan,version:b.version+1};
 }else{
  if(b.operation==='CHANGE'&&(!b.operatorConfirmed||!b.transportConfirmed))throw Error('변경 기간의 운영담당자와 운송·복귀 조건을 다시 확인하세요.');
  result=await saveLoan(tx,{id:old.id,version:b.version,machineId:old.machineId,ownerCenterId:old.ownerCenterId,borrowerCenterId:old.borrowerCenterId,usableFrom:next.usableFrom,usableUntil:next.usableUntil,status:next.status,operatorConfirmed:old.operatorConfirmed,transportConfirmed:old.transportConfirmed},actor,b.reason);
 }
 await tx.workRecord.create({data:{...receiptKey,payload:JSON.parse(JSON.stringify({requestHash,result}))}});
 return result;
}
