import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import type {Principal} from './auth';
import type {State} from './types';
import {centerRegistry,knownCenter} from './center-registry';
import {validateLoan,machineAvailableToCenter,type EquipmentLoan} from './center-sharing';
import {isClosedTask} from './task-lifecycle';
import {recordSpace} from './workspace';
import {geographicNeighbors} from './center-adjacency';
import type {SharingOffer,ResourceBlock} from './equipment-sharing-offers';
import {recordResourceNotice} from './center-resource-notices';
import {loanDependencies} from './loan-dependencies';
import {operatingCrewDemands} from './operating-capacity';
import {taskCrewStaff} from './planned-labor-demand';
import {readLaborCapacity} from './labor-capacity-store';
const key=(id:string)=>({workspace:'shared',kind:'equipmentLoan',id});
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
export const loanInput=z.object({id:z.string().uuid(),version:z.number().int().nonnegative(),machineId:z.string().min(1),ownerCenterId:z.string().refine(knownCenter),borrowerCenterId:z.string().refine(knownCenter),usableFrom:z.string(),usableUntil:z.string(),status:z.enum(['REQUESTED','CONFIRMED','CANCELLED']),transportConfirmed:z.boolean(),operatorConfirmed:z.boolean()}).strict();

/** Cross-center writes lock centers in a fixed order, then resource locks. */
export async function lockCenterPool(tx:Prisma.TransactionClient){
 await tx.$queryRaw`SELECT id FROM "Center" ORDER BY id FOR UPDATE`;
}
export async function resourceView(tx:Prisma.TransactionClient,state:State,id:string):Promise<State>{
 const next=structuredClone(state),centers=await tx.center.findMany({orderBy:{id:'asc'}});
 const rows=await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'},orderBy:{id:'asc'}});
 const loans=rows.map(r=>r.payload as unknown as EquipmentLoan);
 const neighbors=await geographicNeighbors(tx,id);
 const offers=(await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentSharingOffer'},orderBy:{id:'asc'}})).map(r=>r.payload as unknown as SharingOffer).filter(o=>o.enabled&&o.borrowerCenterId===id&&(o.ownerCenterId===id||neighbors.includes(o.ownerCenterId)));
 const blocks:ResourceBlock[]=[];
 for(const c of centers)if(c.id!==id)for(const m of (c.state as unknown as State).missions)if(m.resourceId&&m.scheduledDate&&m.status!=='CANCELLED')blocks.push({machineId:m.resourceId,date:m.scheduledDate});
 for(const row of await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'},orderBy:{id:'asc'}})){
  const r=row.payload as any;if(r.centerId===id)continue;
  for(let at=Date.parse(r.from);at<Date.parse(r.to);at+=86400000)blocks.push({machineId:r.resourceId,date:new Date(at+9*3600000).toISOString().slice(0,10)});
 }
 next.machines=next.machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===id).map(m=>({...m,ownerCenterId:id}));
 for(const c of centers){if(c.id===id||!neighbors.includes(c.id))continue;
  for(const m of (c.state as unknown as State).machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===c.id)){
   if(offers.some(o=>o.machineId===m.id&&o.ownerCenterId===c.id)||loans.some(l=>l.machineId===m.id&&l.ownerCenterId===c.id&&l.borrowerCenterId===id&&l.status==='CONFIRMED')||next.missions.some(t=>t.resourceId===m.id)){
    if(next.machines.some(x=>x.id===m.id))throw Error('센터 간 장비코드 중복을 확인하세요.');
    next.machines.push({...m,ownerCenterId:c.id});
   }
  }
 }
 const lendingDays=new Map<string,{ownerCenterId:string;date:string;capacity:number}>();
 for(const o of offers.filter(o=>o.ownerCenterId!==id)){
  const owner=centers.find(c=>c.id===o.ownerCenterId)?.state as unknown as State|undefined;if(!owner)continue;
  const last=Math.min(Date.parse(o.to),Date.parse(o.from)+366*86400000);
  for(let at=Date.parse(o.from);at<=last;at+=86400000){const date=new Date(at).toISOString().slice(0,10),key=o.ownerCenterId+':'+date;if(lendingDays.has(key))continue;
   const crew=Array(32).fill(0),vehicles=Array(32).fill(0),operators=Array(32).fill(0);
   for(const m of owner.missions.filter(m=>m.scheduledDate===date&&m.status!=='CANCELLED'))for(let t=(m.start%32+32)%32;t<Math.min(32,(m.start%32+32)%32+m.duration);t++){crew[t]+=taskCrewStaff(m);vehicles[t]+=m.transport;}
   const committed=new Set(loans.filter(l=>l.ownerCenterId===o.ownerCenterId&&l.status==='CONFIRMED'&&l.usableFrom<=date&&date<=l.usableUntil).map(l=>l.machineId)).size;
   for(const m of owner.missions.filter(m=>m.scheduledDate===date&&m.status!=='CANCELLED')){
    const demand=operatingCrewDemands(owner,m)?.[`${owner.centerSharing?.centerId??'demo'}:operators`]??0;
    for(let t=(m.start%32+32)%32;t<Math.min(32,(m.start%32+32)%32+m.duration);t++)operators[t]+=demand;
   }
   const capacity=Math.max(0,Math.min(owner.staffCount-Math.max(...crew),owner.transportCount-Math.max(...vehicles),owner.crewCapacity?owner.crewCapacity.operators-Math.max(...operators):Infinity)-committed);
   lendingDays.set(key,{ownerCenterId:o.ownerCenterId,date,capacity});
  }
 }
 next.centerSharing={centerId:id,neighborCenterIds:neighbors,loans,offers,blocks:blocks.sort((a,b)=>a.machineId.localeCompare(b.machineId)||a.date.localeCompare(b.date)),lendingDays:[...lendingDays.values()].sort((a,b)=>a.ownerCenterId.localeCompare(b.ownerCenterId)||a.date.localeCompare(b.date))};
 next.laborCapacity=await readLaborCapacity(tx,id);
 return next;
}
/** Final authority check uses the live owner ledger, not a borrowed cached copy. */
export async function assertResourceBooking(tx:Prisma.TransactionClient,centerId:string,resourceId:string,date:string){
 const centers=await tx.center.findMany(),owners=centers.filter(c=>(c.state as unknown as State).machines.some(m=>m.id===resourceId&&(!m.ownerCenterId||m.ownerCenterId===c.id)));
 if(owners.length!==1)throw Error('장비의 유일한 소유 센터 확인 필요');
 const owner=owners[0],machine=(owner.state as unknown as State).machines.find(m=>m.id===resourceId)!;
 if(machine.status!=='AVAILABLE'||machine.safetyLock)throw Error('장비 상태가 변경되어 새 계획을 승인할 수 없습니다.');
 const loans=(await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'}})).map(r=>r.payload as unknown as EquipmentLoan);
 if(!machineAvailableToCenter({...machine,ownerCenterId:owner.id},date,{centerId,neighborCenterIds:await geographicNeighbors(tx,centerId),loans}))throw Error('직접 인접·사용 기간·운송·운영담당자가 확인된 장비 대여 승인이 필요합니다.');
}
export async function saveLoan(tx:Prisma.TransactionClient,input:unknown,actor:Principal,reason?:string){
 const b=loanInput.parse(input);
 const staffRequest=actor.role==='CENTER_STAFF'&&b.version===0&&b.status==='REQUESTED'&&b.borrowerCenterId===actor.centerId;
 if(!knownCenter(actor.centerId)||(actor.role!=='CENTER_ADMIN'&&!staffRequest))throw Error('센터 관리자 권한 필요');
 await lockCenterPool(tx);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${b.machineId}`},0))`;
 const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:key(b.id)}}),old=previous?.payload as unknown as EquipmentLoan|undefined;
 if(staffRequest&&previous)throw Error('센터 담당자는 신규 차용 요청만 등록할 수 있습니다.');
 if((previous?.version??0)!==b.version)throw Error('대여 내용이 변경되었습니다. 다시 확인하세요.');
 if(old&&['machineId','ownerCenterId','borrowerCenterId'].some(k=>(old as any)[k]!== (b as any)[k]))throw Error('대여의 장비·센터 식별자는 변경할 수 없습니다.');
 if(old?.status==='CANCELLED'||old?.status==='RETURNED')throw Error('종료한 대여는 새 요청으로 접수하세요.');
 if(old?.status==='CONFIRMED'&&b.status==='REQUESTED')throw Error('확정된 대여를 신청 상태로 되돌릴 수 없습니다.');
 if(old?.status==='CONFIRMED'&&(b.status!==old.status||b.usableFrom!==old.usableFrom||b.usableUntil!==old.usableUntil)&&!reason)throw Error('대여 관리에서 변경 영향을 먼저 확인하세요.');
 if(!old&&(actor.centerId!==b.borrowerCenterId||b.status!=='REQUESTED'))throw Error('사용할 센터가 먼저 대여를 신청해야 합니다.');
 if(old&&actor.centerId!==b.ownerCenterId&&!(actor.centerId===b.borrowerCenterId&&b.status==='CANCELLED'))throw Error('소유 센터의 승인·변경이 필요합니다.');
 const centers=await tx.center.findMany(),owner=centers.find(c=>c.id===b.ownerCenterId),state=owner?.state as unknown as State|undefined;
 const machine=state?.machines.find(m=>m.id===b.machineId&&(!m.ownerCenterId||m.ownerCenterId===owner?.id));
 if(!machine||!centers.some(c=>c.id===b.borrowerCenterId))throw Error('장비와 양쪽 센터를 먼저 등록하세요.');
 const {version:_,...loan}=b;
 const rows=await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'}});
 validateLoan(loan,rows.map(r=>r.payload as unknown as EquipmentLoan));
 if(loan.status==='CONFIRMED'){
  if(!(await geographicNeighbors(tx,loan.ownerCenterId)).includes(loan.borrowerCenterId))throw Error('면 경계의 직접 인접 관계를 확인한 뒤 승인하세요.');
  if(machine.status!=='AVAILABLE'||machine.safetyLock)throw Error('대여할 수 없는 장비 상태입니다.');
  for(const c of centers)for(const m of (c.state as unknown as State).missions){
   if(c.id===loan.borrowerCenterId||isClosedTask(m.status))continue;
   if(m.resourceId===loan.machineId&&m.scheduledDate&&loan.usableFrom<=m.scheduledDate&&m.scheduledDate<=loan.usableUntil)throw Error('대여 기간에 다른 센터 작업이 있습니다.');
  }
  const bookings=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
  for(const row of bookings){const r=row.payload as any;const from=new Date(Date.parse(r.from)+9*3600000).toISOString().slice(0,10),to=new Date(Date.parse(r.to)-1+9*3600000).toISOString().slice(0,10);
   if(r.resourceId===loan.machineId&&r.centerId!==loan.borrowerCenterId&&from<=loan.usableUntil&&loan.usableFrom<=to)throw Error('대여 기간의 기존 예약과 충돌합니다.');
  }
 }
 // Never revoke an approved job silently. Reschedule/cancel those jobs first.
 if(old?.status==='CONFIRMED'){
  const linked=await loanDependencies(tx,old,loan);
  if(linked.tasks.some(t=>t.affected)||linked.reservations.some(r=>r.affected))throw Error('연결된 미완료 작업·예약을 먼저 재계획 또는 예약 취소하세요.');
  if(loan.status==='CANCELLED'&&linked.preservedCompleted)throw Error('이미 사용한 대여는 취소 대신 반납 처리하세요.');
 }
 await tx.workRecord.upsert({where:{workspace_kind_id:key(b.id)},create:{...key(b.id),version:b.version+1,payload:loan},update:{version:b.version+1,payload:loan}});
 await tx.audit.create({data:{centerId:actor.centerId,action:'equipmentLoan.'+b.status,detail:{actorId:actor.id,before:old?json(old):null,after:loan,reason:reason??null}}});
 const event=old?.status==='CONFIRMED'&&loan.status==='CONFIRMED'?'CHANGED':loan.status;
 await recordResourceNotice(tx,`loan:${loan.id}:${b.version+1}`,{event,loanId:loan.id,machineId:loan.machineId,ownerCenterId:loan.ownerCenterId,borrowerCenterId:loan.borrowerCenterId,from:loan.usableFrom,to:loan.usableUntil,...(reason?{reason}:{})});
 return {loan,version:b.version+1};
}
/** A fault holds future affected work; completed records and booking history remain. */
export async function markSharedFailure(tx:Prisma.TransactionClient,machineId:string,from:string,ownerId:string,actor:string,expectedRepairOn?:string){
 await lockCenterPool(tx);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${machineId}`},0))`;
 const centers=await tx.center.findMany(),owner=centers.find(c=>c.id===ownerId),owned=(owner?.state as unknown as State|undefined)?.machines.find(m=>m.id===machineId&&(!m.ownerCenterId||m.ownerCenterId===ownerId));
 if(!owned)throw Error('장비 소유 센터에서 고장을 기록하세요.');
 if(owned.status==='MAINTENANCE')throw Error('이미 정비 필요 상태입니다. 기존 고장 대응에서 재계획하세요.');
 const failureId=crypto.randomUUID();
 await tx.workRecord.create({data:{workspace:recordSpace(ownerId),kind:'equipmentFailure',id:failureId,payload:{machineId,from,expectedRepairOn:expectedRepairOn??null,actor,recordedAt:new Date().toISOString(),requiresActualRepairConfirmation:true}}});
 const impacts:{centerId:string;taskIds:string[]}[]=[];
 for(const row of centers){const state=structuredClone(row.state) as unknown as State;
  const affected=state.missions.filter(m=>m.resourceId===machineId&&!isClosedTask(m.status)&&!!m.scheduledDate&&m.scheduledDate>=from);
  if(row.id!==ownerId&&!affected.length)continue;
  for(const m of state.machines.filter(m=>m.id===machineId))m.status='MAINTENANCE';
  for(const m of affected)m.status='HELD';
  state.planVersion++;for(const r of state.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
  await tx.center.update({where:{id:row.id},data:{state:json(state),version:{increment:1}}});
  if(affected.length){const id=crypto.randomUUID();impacts.push({centerId:row.id,taskIds:affected.map(m=>m.id)});
   await tx.workRecord.create({data:{workspace:recordSpace(row.id),kind:'resourceImpact',id,payload:{machineId,ownerId,from,expectedRepairOn:expectedRepairOn??null,actor,taskIds:affected.map(m=>m.id),status:'REPLAN_REQUIRED'}}});
   for(const farmerId of new Set(affected.flatMap(m=>state.fields.filter(f=>f.id===m.fieldId).map(f=>f.farmerId))))await tx.outbox.create({data:{status:'RECORDED_ONLY',id:`resource-impact:${id}:${farmerId}`,centerId:row.id,farmerId,planVersion:state.planVersion,body:'장비 고장으로 작업을 보류하고 대체 장비와 일정을 확인 중입니다. 확정 후 다시 안내합니다.'}});
  }
 }
 const loans=await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'}});
 const borrowers=new Set([ownerId,...impacts.map(x=>x.centerId),...loans.flatMap(r=>{const l=r.payload as unknown as EquipmentLoan;return l.machineId===machineId&&l.status==='CONFIRMED'&&l.usableUntil>=from?[l.borrowerCenterId]:[]})]);
 for(const borrowerCenterId of borrowers)await recordResourceNotice(tx,`failure:${failureId}:${borrowerCenterId}`,{event:'FAILURE',machineId,ownerCenterId:ownerId,borrowerCenterId,from,...(expectedRepairOn?{to:expectedRepairOn}:{}),reason:'고장으로 대체 장비와 일정 검토가 필요합니다. 수리 예정일만으로 가용 상태가 복구되지 않습니다.'});
 return impacts;
}
