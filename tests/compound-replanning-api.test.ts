import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {seedMission} from './labor-recovery-fixture';
import {recordSpace} from '../lib/workspace';
import {dateSlot} from '../lib/scheduling-engine';
import {emptyLaborOps} from '../lib/labor-operations';
import type {State,Mission} from '../lib/types';

// No external weather/AI/SMS call; the HTTP solver and PostgreSQL are real.
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {POST as resources,GET as resourcesGet} from '../app/api/center-resources/route';
import {POST as replan} from '../app/api/replanning/route';
import {POST as labor,GET as laborGet} from '../app/api/labor-operations/route';
import {POST as capacity,GET as capacityGet} from '../app/api/labor-capacity/route';
import {POST as sharing} from '../app/api/labor-sharing/route';
import {GET as recoveryGet} from '../app/api/labor-recovery/route';

const day='2032-09-01',next='2032-09-02',repaired='2032-09-08';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
type Session=Awaited<ReturnType<typeof testSession>>;
async function call(handler:(r:NextRequest)=>Promise<Response>,path:string,s:Session,body?:object,expected=200){
 const r=await handler(new NextRequest('http://127.0.0.1:3100/api/'+path,{method:body?'POST':'GET',headers:s.headers,...(body?{body:JSON.stringify(body)}:{})})),data=await r.json();
 expect(r.status,JSON.stringify(data)).toBe(expected);return data;
}

it('persists combined failure and absence, preserves lender work, confirms both resources, approves atomically and reconfirms attendance',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated DB required');
 const extraKinds=['equipmentFailure','resourceImpact','centerResourceNotice'];
 const extraBefore=await db.workRecord.findMany({where:{kind:{in:extraKinds}}});
 const fixture=await laborCapacityFixture(),receiver=await testSession(),owner=await testSession('CENTER_ADMIN','janggye'),foreign=await testSession('CENTER_ADMIN','gyenam');
 const calls=await db.aiCall.count();
 try{
  const {m,closed}=await seedMission('demo');
  const operators:Record<string,string>={};
  for(const center of ['demo','janggye']){
   const row=await db.center.findUniqueOrThrow({where:{id:center}}),s=row.state as unknown as State;
   s.crewCapacity={operators:1,workers:1};s.staffCount=2;s.transportCount=1;
   const machineId=center==='demo'?'JB23PD01':'JSJGPD01';
   s.machines=[{id:machineId,ownerCenterId:center,name:'감자 굴취기',type:'감자 굴취기',capacityHaHour:0.2,status:'AVAILABLE',safetyLock:false,compatibleCrops:['potato']}];
   const operatorId=randomUUID();operators[center]=operatorId;
   s.operatorRoster=[{id:operatorId,name:'홍운영',active:true,kinds:['PD'],weekdays:[0,1,2,3,4,5,6],from:day,until:repaired,excludedDates:[],startMinute:480,endMinute:960,evidence:'격리된 자격·근무 가정'}];
   if(center==='demo'){
    const selected={...m,label:'감자 굴취 및 수거 보조',crop:'감자' as const,owner:'장비' as const,resourceId:machineId,staff:2,ordinaryWorkers:1,machineOperators:1,operatorIds:[operatorId],duration:28,compatibilityCrop:'potato' as const,planningWindow:{from:day,to:next,duration:28,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
    s.missions=[closed,selected];s.fields[0].crop='감자';
   }else{
    // Any lender booking excludes the full machine-day, not just its shift.
    const booked={...m,id:'lender-fixed',fieldId:'lender-field',label:'기존 확정 굴취',crop:'감자' as const,owner:'장비' as const,resourceId:machineId,staff:1,ordinaryWorkers:0,machineOperators:1,operatorIds:[operatorId],scheduledDate:next,start:dateSlot(next)-dateSlot('2026-09-09'),planningLocked:true};s.missions=[booked];
   }
   await db.center.update({where:{id:center},data:{state:json(s)}});
  }
  const lenderBefore=await db.center.findUniqueOrThrow({where:{id:'janggye'}}),mId=m.id;
  const helper={...fixture.worker,id:randomUUID(),name:'홍지원'};
  await db.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('janggye'),kind:'laborOperations',id:'current'}},data:{payload:json({...emptyLaborOps(),people:[helper]})}});
  const editLabor=async(body:object)=>call(labor,'labor-operations',receiver,{...body,version:(await call(laborGet,'labor-operations',receiver)).version,requestId:randomUUID()});
  await editLabor({action:'open',demandId:mId,pay:'격리된 근무 조건',simpleWorkConfirmed:true});
  const job=(await call(laborGet,'labor-operations',receiver)).payload.jobs[0];
  await editLabor({action:'response',jobId:job.id,workerId:fixture.worker.id,response:'PHONE'});
  await editLabor({action:'absence',jobId:job.id,workerId:fixture.worker.id,reason:'당일 불참 확인'});
  expect((await call(recoveryGet,'labor-recovery',receiver)).issues[0].status).toBe('OPEN');
  await call(resources,'center-resources',receiver,{action:'failure',machineId:'JB23PD01',from:day,expectedRepairOn:repaired});

  const offer={id:randomUUID(),version:0,machineId:'JSJGPD01',borrowerCenterId:'demo',from:day,to:repaired,compatibleMachineIds:['JB23PD01'],outboundSlots:2,returnSlots:2,agreementRef:'ISOLATED_TEST_ONLY',conditions:'합성 호환성·운송·운영 확인',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};
  await call(resources,'center-resources',owner,{action:'sharingOffer',offer});
  const request={action:'preview',ids:[mId],preferred:day,scope:'PRESERVE',reason:'장비 고장과 인력 불참 동시 대응',decisionSource:'DEVELOPMENT_REVIEW'};
  const shortage=await call(replan,'replanning',receiver,request);
  expect(shortage.status,JSON.stringify(shortage)).toBe('NO_FEASIBLE_PLAN');
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);

  const windowId=randomUUID(),window={workerId:helper.id,borrowerCenterId:'demo',date:day,startMinute:480,endMinute:960,travelMinutes:30,workCodes:['harvest'],response:'PHONE',consent:true,reason:'격리 검증에서 참석과 이동 확인'};
  await call(capacity,'labor-capacity',owner,{action:'offer',requestId:windowId,rosterVersion:(await call(capacityGet,'labor-capacity',owner)).rosterVersion,window});
  expect((await call(replan,'replanning',receiver,request)).status).toBe('NO_FEASIBLE_PLAN');
  const beforeConfirmation=await db.center.findUniqueOrThrow({where:{id:'demo'}});
  // Sending a named helper must still fail if the sender's ordinary capacity is
  // committed, even though the recipient is waiting for a recovery option.
  const sender=lenderBefore.state as unknown as State;
  await db.center.update({where:{id:'janggye'},data:{state:json({...sender,missions:[...sender.missions,{...m,id:'sender-crew-occupied',scheduledDate:day,start:dateSlot(day)-dateSlot('2026-09-09'),duration:32,resourceId:null,staff:1,ordinaryWorkers:1,machineOperators:0}]})}});
  await call(capacity,'labor-capacity',receiver,{action:'confirm',id:windowId,version:1,requestId:randomUUID(),reason:'보내는 센터의 인원 부족 검증'},409);
  expect((await call(capacityGet,'labor-capacity',receiver)).windows.find((w:any)=>w.id===windowId).status).toBe('OFFERED');
  await db.center.update({where:{id:'janggye'},data:{state:json(sender),updatedAt:lenderBefore.updatedAt}});
  await call(capacity,'labor-capacity',receiver,{action:'confirm',id:windowId,version:1,requestId:randomUUID(),reason:'지원 인원 확인'});
  expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(beforeConfirmation);
  expect((await call(recoveryGet,'labor-recovery',receiver)).issues[0].status).toBe('OPEN');
  const proposal=await call(replan,'replanning',receiver,request);
  expect(proposal.status,JSON.stringify(proposal)).toBe('FEASIBLE');expect(proposal.diff).toHaveLength(1);
  expect(proposal.diff[0]).toMatchObject({date:day,afterResource:'JSJGPD01',afterLaborSupport:[windowId]});
  expect(proposal.assignments.find((a:any)=>a.id===mId)).toMatchObject({start:dateSlot(day)+2,operatorIds:[operators.demo],laborSupportIds:[windowId]});
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0); // calculation does not reserve
  await call(replan,'replanning',foreign,{action:'approve',proposalId:proposal.proposalId},409);
  // Revoke a resource after calculation; stale approval must roll back everything.
  await call(resources,'center-resources',owner,{action:'sharingOffer',offer:{...offer,version:1,enabled:false}});
  await call(replan,'replanning',receiver,{action:'approve',proposalId:proposal.proposalId},409);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);
  await call(resources,'center-resources',owner,{action:'sharingOffer',offer:{...offer,version:2}});
  const fresh=await call(replan,'replanning',receiver,request);
  await call(replan,'replanning',receiver,{action:'approve',proposalId:fresh.proposalId});
  expect((await call(replan,'replanning',receiver,{action:'approve',proposalId:fresh.proposalId})).alreadyApplied).toBe(true);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions.find(t=>t.id===mId)).toMatchObject({scheduledDate:day,resourceId:'JSJGPD01',laborSupportIds:[windowId],status:'PLANNED'});
  expect(saved.missions.find(t=>t.id===closed.id)).toEqual(closed);
  expect(saved.machines.find(t=>t.id==='JB23PD01')?.status).toBe('MAINTENANCE');
  expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(lenderBefore);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(1);
  const reservation=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:'plan:demo:'+mId}}});
  expect(reservation.payload).toMatchObject({resourceId:'JSJGPD01',centerId:'demo'});
  const laborAfter=await call(laborGet,'labor-operations',receiver),renewed=laborAfter.payload.jobs.find((j:any)=>j.replacesJobId===job.id);
  expect(renewed).toBeTruthy();expect(renewed.responses).toEqual({});expect(renewed.borrowedNames).toEqual([]);
  await call(sharing,'labor-sharing',owner,{action:'offer',requestId:randomUUID(),version:(await call(laborGet,'labor-operations',owner)).version,borrowerCenterId:'demo',jobId:renewed.id,sourceHash:renewed.sourceHash,workerId:helper.id,response:'PHONE',travelMinutes:30,distanceKm:5,consent:true});
  expect((await call(laborGet,'labor-operations',receiver)).payload.jobs.find((j:any)=>j.id===renewed.id).borrowedNames).toEqual(['홍지원']);
  for(const session of [receiver,owner]){
   expect((await call(capacityGet,'labor-capacity',session)).notices.some((n:any)=>n.event==='PLAN_CHANGED')).toBe(true);
   expect((await call(resourcesGet,'center-resources',session)).notices.some((n:any)=>n.event==='CONFIRMED')).toBe(true);
  }
  expect(await db.outbox.count({where:{id:{startsWith:'replan:'+fresh.proposalId+':'}}})).toBe(1);
  expect(await db.aiCall.count()).toBe(calls);
  const dir='.data/validation/20261003-compound-congestion';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/api-result.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'kfarm_test',commonHttpSolver:true,equipmentAndLaborNeededTogether:true,offeredLaborNotCounted:true,lenderWorkAndCompletedWorkUnchanged:true,staleApprovalRejected:true,duplicateApprovalDeduplicated:true,equipmentReservations:1,attendanceReconfirmed:true,farmerOutboxRecords:1,noticesToBothCenters:true,paidAiCalls:0,externalSms:false,hardwareCommands:false},null,2));
 }finally{
  await receiver.cleanup();await owner.cleanup();await foreign.cleanup();await fixture.cleanup();
  await db.workRecord.deleteMany({where:{kind:{in:extraKinds}}});if(extraBefore.length)await db.workRecord.createMany({data:extraBefore as any});
 }
},60000);
