import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db} from '../lib/db';
import type {Principal} from '../lib/auth';
import {emptyCenter} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {saveLoan,markSharedFailure,resourceView} from '../lib/center-resources';
import {manageLoan} from '../lib/loan-lifecycle';
import {acknowledgeResourceNotice} from '../lib/center-resource-notices';
import {machineAvailableToCenter,type EquipmentLoan} from '../lib/center-sharing';
import {missionReservation} from '../lib/plan-reservation-sync';
import {cancelLinkedReservation} from '../lib/reservation-operations';
import {mutateReservation} from '../lib/reservation-lifecycle';
import {permitted} from '../lib/auth-policy';
import type {Mission,State} from '../lib/types';

const owner={id:'owner-operator',centerId:'demo',role:'CENTER_ADMIN',username:'owner',name:'Owner',enabled:true} as Principal;
const borrower={...owner,id:'borrower-operator',centerId:'janggye'},stranger={...owner,id:'stranger',centerId:'gyenam'};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)),loanKey=(id:string)=>({workspace_kind_id:{workspace:'shared',kind:'equipmentLoan',id}});
const task=(id='task',date='2090-05-18'):Mission=>({id,fieldId:'field',label:'경운',crop:'쌀',scheduledDate:date,month:5,owner:'장비',status:'PLANNED',resourceId:'OWNERTR01',start:0,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1});
async function isolated(run:(tx:Prisma.TransactionClient)=>Promise<void>){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated test DB only');
 const before=await db.workRecord.count();let completed=false;
 try{await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:['shared','sandbox','center:janggye']}}});
  for(const [index,id] of ['demo','janggye'].entries()){
   const s=emptyCenter(id);s.staffCount=3;s.transportCount=2;s.fields=[];s.missions=[];s.machines=id==='demo'?[{id:'OWNERTR01',name:'트랙터',type:'트랙터',capacityHaHour:1,status:'AVAILABLE',safetyLock:false,ownerCenterId:'demo'}]:[];
   await tx.center.upsert({where:{id},create:{id,state:json(s)},update:{state:json(s)}});
   await tx.workRecord.create({data:{workspace:recordSpace(id),kind:'centerGeography',id:'current',payload:{geometry:{type:'Polygon',coordinates:[[[index,0],[index+1,0],[index+1,1],[index,1],[index,0]]]}}}});
  }
  await run(tx);completed=true;throw Error('ROLLBACK_LOAN_TEST');
 },{timeout:30000});}catch(e){if(!completed||!(e instanceof Error)||e.message!=='ROLLBACK_LOAN_TEST')throw e;}
 expect(await db.workRecord.count()).toBe(before);
}
async function approved(tx:Prisma.TransactionClient,from='2090-05-01',to='2090-05-31'){
 const input={id:randomUUID(),version:0,machineId:'OWNERTR01',ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:from,usableUntil:to,status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
 await saveLoan(tx,input,borrower);return (await saveLoan(tx,{...input,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true},owner));
}
async function review(tx:Prisma.TransactionClient,loan:EquipmentLoan,change:object,actor=owner){return manageLoan(tx,{action:'previewLoan',id:loan.id,version:2,reason:'검증용 처리 사유',...change},actor) as Promise<any>;}
function apply(reviewed:any,change:object){return {action:'manageLoan',id:reviewed.loan.id,version:reviewed.loan.version,reason:'검증용 처리 사유',...change,requestId:randomUUID(),reviewToken:reviewed.token,...((change as any).operation==='CHANGE'?{operatorConfirmed:true,transportConfirmed:true}:{})};}
async function setTasks(tx:Prisma.TransactionClient,missions:Mission[]){const row=await tx.center.findUniqueOrThrow({where:{id:'janggye'}});await tx.center.update({where:{id:'janggye'},data:{state:json({...row.state as object,missions})}});}

it('stores notices for both centers, keeps acknowledgements local, and records fault notices before work exists',async()=>isolated(async tx=>{
 const {loan}=await approved(tx);
 const notices=()=>tx.workRecord.findMany({where:{kind:'centerResourceNotice'}});
 expect(await notices()).toHaveLength(4);
 const id=`loan:${loan.id}:2`;
 await acknowledgeResourceNotice(tx,id,{...owner,role:'CENTER_STAFF'});
 expect((await acknowledgeResourceNotice(tx,id,owner)).alreadyAcknowledged).toBe(true);
 const rows=await notices();expect((rows.find(r=>r.id===id&&r.workspace==='sandbox')!.payload as any).acknowledgedAt).toBeTruthy();expect((rows.find(r=>r.id===id&&r.workspace==='center:janggye')!.payload as any).acknowledgedAt).toBeNull();
 await expect(acknowledgeResourceNotice(tx,id,stranger)).rejects.toThrow();
 await markSharedFailure(tx,loan.machineId,loan.usableFrom,'demo',owner.id);
 expect((await notices()).some(r=>r.workspace==='center:janggye'&&(r.payload as any).event==='FAILURE')).toBe(true);
 expect(permitted({...owner,role:'CENTER_STAFF'},'center-resources','POST',{action:'ackNotice'})).toBe(true);
 expect(permitted({...owner,role:'CENTER_STAFF'},'center-resources','POST',{action:'manageLoan'})).toBe(true);
}));

it('limits automatic lending by the owner operator pool, not available general workers',async()=>isolated(async tx=>{
 const id=randomUUID(),date='2090-05-18';
 await tx.workRecord.create({data:{workspace:'shared',kind:'equipmentSharingOffer',id,payload:{id,version:1,machineId:'OWNERTR01',ownerCenterId:'demo',borrowerCenterId:'janggye',from:date,to:date,compatibleMachineIds:['LOCALTR01'],outboundSlots:2,returnSlots:2,agreementRef:'isolated assumption',conditions:'isolated',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true}}});
 const source=(await tx.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State,target=(await tx.center.findUniqueOrThrow({where:{id:'janggye'}})).state as unknown as State;
 source.crewCapacity={operators:1,workers:2};
 const save=()=>tx.center.update({where:{id:'demo'},data:{state:json(source)}});
 const available=async()=>(await resourceView(tx,target,'janggye')).centerSharing!.lendingDays!.find(d=>d.date===date)!.capacity;
 await save();expect(await available()).toBe(1);
 source.missions=[{...task(),resourceId:'OTHERTR01',machineOperators:1,ordinaryWorkers:0}];await save();expect(await available()).toBe(0);
 source.missions=[];source.crewCapacity={operators:0,workers:3};await save();expect(await available()).toBe(0);
}));

it('changes the period after review, restricts ownership, and makes retries idempotent without duplicate notices',async()=>isolated(async tx=>{
 const {loan}=await approved(tx),change={operation:'CHANGE',from:'2090-05-01',to:'2090-06-01'};
 await expect(review(tx,loan,change,borrower)).rejects.toThrow('소유 센터');
 await expect(review(tx,loan,{operation:'CANCEL'},stranger)).rejects.toThrow('소유·사용');
 await expect(saveLoan(tx,{...loan,version:2,usableUntil:change.to},owner)).rejects.toThrow('영향');
 const r=await review(tx,loan,change);expect(r.blockers).toEqual([]);const b=apply(r,change);
 await expect(manageLoan(tx,{...b,operatorConfirmed:false},owner)).rejects.toThrow('다시 확인');
 const saved=await manageLoan(tx,b,owner);expect(saved.loan.usableUntil).toBe(change.to);
 expect((await manageLoan(tx,b,owner)).alreadyApplied).toBe(true);
 expect(await tx.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(6);
 await expect(manageLoan(tx,{...b,reason:'다른 내용'},owner)).rejects.toThrow('같은 처리 번호');
 expect((await tx.workRecord.findUniqueOrThrow({where:loanKey(loan.id)})).version).toBe(3);
}));

it('blocks linked work and standalone bookings until released; cancellation retains the held task and archived booking',async()=>isolated(async tx=>{
 const {loan}=await approved(tx),m=task();await setTasks(tx,[m]);
 const booking=missionReservation('janggye',m)!;
 await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 const standalone={...booking,id:'standalone',taskId:'unindexed',from:'2090-05-20T08:00:00+09:00',to:'2090-05-20T09:00:00+09:00'};
 await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:standalone.id,payload:standalone}});
 const change={operation:'CANCEL'},r=await review(tx,loan,change,borrower);
 expect(r.tasks.filter((t:any)=>t.affected)).toHaveLength(1);expect(r.reservations.filter((b:any)=>b.affected)).toHaveLength(2);
 await expect(manageLoan(tx,apply(r,change),borrower)).rejects.toThrow('연결');
 const shortened=await review(tx,loan,{operation:'CHANGE',from:'2090-05-01',to:'2090-05-17'});expect(shortened.blockers).not.toEqual([]);
 await cancelLinkedReservation(tx,booking.id,1,'재계획을 위한 해제',borrower);
 expect((await review(tx,loan,change,borrower)).blockers).not.toEqual([]);
 await mutateReservation(tx,{action:'cancel',id:standalone.id,version:1,reason:'독립 예약 해제'},owner);
 const ready=await review(tx,loan,change,borrower);expect(ready.blockers).toEqual([]);
 const saved=await manageLoan(tx,apply(ready,change),borrower);expect(saved.loan.status).toBe('CANCELLED');
 const state=(await tx.center.findUniqueOrThrow({where:{id:'janggye'}})).state as unknown as State;
 expect(state.missions).toHaveLength(1);expect(state.missions[0]).toMatchObject({status:'HELD',resourceId:null});
 expect(await tx.workRecord.count({where:{kind:'cancelledReservation'}})).toBe(2);
}));

it('rejects a stale review when a booking is inserted, even if the center plan version stays unchanged',async()=>isolated(async tx=>{
 const {loan}=await approved(tx),change={operation:'CANCEL'},r=await review(tx,loan,change);
 const booking=missionReservation('janggye',task())!;await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 await expect(manageLoan(tx,apply(r,change),owner)).rejects.toThrow('다시 확인');
 expect((await tx.workRecord.findUniqueOrThrow({where:loanKey(loan.id)})).version).toBe(2);
 expect(await tx.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(4);
}));

it('returns only after physical receipt confirmation and preserves actual completion, historical bookings, and maintenance locks',async()=>isolated(async tx=>{
 const {loan}=await approved(tx,'2026-01-01','2026-01-31'),m=task('completed','2026-01-10');await setTasks(tx,[m]);
 await tx.workRecord.create({data:{workspace:'center:janggye',kind:'taskExecutionAssessment',id:m.id,payload:{missionId:m.id,source:'ACTUAL',plannedDate:m.scheduledDate,assessment:'COMPLETED',actualStartedAt:'2026-01-10T08:00:00+09:00'}}});
 const booking=missionReservation('janggye',m)!;await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 const ownerRow=await tx.center.findUniqueOrThrow({where:{id:'demo'}}),s=ownerRow.state as unknown as State;s.machines[0].status='MAINTENANCE';s.machines[0].safetyLock=true;
 await tx.center.update({where:{id:'demo'},data:{state:json(s)}});
 const centers=await tx.center.findMany({orderBy:{id:'asc'}}),change={operation:'RETURN',returnedOn:'2026-01-31'},r=await review(tx,loan,change);
 expect(r.preservedCompleted).toBe(1);expect(r.blockers).toEqual([]);
 expect((await review(tx,loan,{operation:'CANCEL'})).blockers).toContain('이미 사용한 대여는 취소 대신 반납 처리하세요.');
 await expect(manageLoan(tx,apply(r,change),owner)).rejects.toThrow('실제 복귀');
 const b={...apply(r,change),returnedConfirmed:true},saved=await manageLoan(tx,b,owner);
 expect(saved.loan).toMatchObject({status:'RETURNED',returnedOn:'2026-01-31',returnedBy:owner.id});
 expect((await manageLoan(tx,b,owner)).alreadyApplied).toBe(true);
 expect(await tx.center.findMany({orderBy:{id:'asc'}})).toEqual(centers);
 expect(await tx.workRecord.count({where:{kind:'resourceReservation',id:booking.id}})).toBe(1);
 expect(machineAvailableToCenter(s.machines[0],'2026-01-31',{centerId:'janggye',neighborCenterIds:['demo'],loans:[saved.loan]})).toBe(false);
 await expect(saveLoan(tx,{...loan,version:3},owner)).rejects.toThrow('종료');
 expect(await tx.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(6);
}));

it('does not auto-return overdue loans or accept a future return date or a running machine',async()=>isolated(async tx=>{
 const {loan}=await approved(tx,'2026-01-01','2026-01-31');await setTasks(tx,[task('overdue','2026-01-10')]);
 expect((await review(tx,loan,{operation:'RETURN',returnedOn:'2026-01-31'})).blockers).not.toEqual([]);
 expect((await tx.workRecord.findUniqueOrThrow({where:loanKey(loan.id)})).payload).toEqual(loan);
 await setTasks(tx,[]);
 expect((await review(tx,loan,{operation:'RETURN',returnedOn:'2099-01-01'})).blockers).toContain('반납일은 사용 시작일 이후이면서 오늘까지여야 합니다.');
 const row=await tx.center.findUniqueOrThrow({where:{id:'demo'}}),s=row.state as unknown as State;s.machines[0].status='WORKING';await tx.center.update({where:{id:'demo'},data:{state:json(s)}});
 expect((await review(tx,loan,{operation:'RETURN',returnedOn:'2026-01-31'})).blockers).toContain('작업 중인 장비는 정지·복귀 확인 후 반납 처리하세요.');
}));

it('withdraws an unapproved duplicate request without treating another confirmed loan\'s jobs as its own',async()=>isolated(async tx=>{
 const {loan}=await approved(tx);await setTasks(tx,[task()]);
 const input={...loan,id:randomUUID(),version:0,status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
 await saveLoan(tx,input,borrower);
 const r=await manageLoan(tx,{action:'previewLoan',id:input.id,version:1,operation:'CANCEL',reason:'중복 신청 철회'},borrower) as any;
 expect(r.blockers).toEqual([]);expect(r.tasks).toEqual([]);
 const result=await manageLoan(tx,{...apply(r,{operation:'CANCEL'}),reason:'중복 신청 철회'},borrower);
 expect(result.loan.status).toBe('CANCELLED');
 expect((await tx.workRecord.findUniqueOrThrow({where:loanKey(loan.id)})).payload).toEqual(loan);
}));
