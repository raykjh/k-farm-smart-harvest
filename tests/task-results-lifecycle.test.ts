import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {registeredDemo} from './registered-demo-fixture';
import {receiveWorkResult as receive,correctWorkDuration as correct} from '../lib/work-result-receipt';
import {saveExecution,readReport} from '../lib/execution-records';
import {cancelTasks as cancelOperation} from '../lib/task-cancellations';
import {checkCultivation,type Cultivation} from '../lib/cultivation';
import {missionReservation} from '../lib/plan-reservation-sync';
import {fieldDurationSummary} from '../lib/field-work-history';
import {scheduleChangeRows,taskResourceLabel,changedResourceLabel,scheduleTimeLabel} from '../lib/schedule-display';
import {missionResourceUse} from '../lib/scheduling-constraints';
import {ordinaryWorkerDemand,operatingTaskCrew} from '../lib/planned-labor-demand';
import type {State} from '../lib/types';
import {asPrincipal} from '../lib/auth';
import {testPrincipal,testSession} from './auth-fixture';
import {NextRequest} from 'next/server';
import {catalogContext,catalogState,catalogField} from './catalog-fixtures';
import {POST as createCultivation} from '../app/api/cultivations/route';
import {GET as previewDispatch,POST as approveDispatch} from '../app/api/annual-dispatch/route';
import {POST as changeCultivation} from '../app/api/cultivation-change/route';
const receiveWorkResult=(b:unknown)=>asPrincipal(testPrincipal,()=>receive(b));
const correctWorkDuration=(b:unknown)=>asPrincipal(testPrincipal,()=>correct(b));
const cancelTasks=(b:unknown)=>asPrincipal(testPrincipal,()=>cancelOperation(b));

const kinds=['fields','cultivation','fieldParticipation','fieldClosure','taskCancellation','taskExecutionAssessment','workDurationCorrection','annualReservation','cancelledReservation','cultivationPlan','annualDispatchApproval'];
let base:Awaited<ReturnType<typeof laborCapacityFixture>>,saved:Awaited<ReturnType<typeof db.workRecord.findMany>>,state:State,cycle:Cultivation;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
beforeEach(async()=>{
 base=await laborCapacityFixture();
 saved=await db.workRecord.findMany({where:{kind:{in:kinds}}});
 await db.workRecord.deleteMany({where:{kind:{in:kinds}}});
 state=registeredDemo().state;state.events=[];state.revisions=[];state.fields=state.fields.slice(0,2).map(f=>({...f,source:'REGISTERED',mode:'완전 위탁형'}));
 const task=state.missions[0];
 state.missions=[0,1,2,3].map((i)=>({...task,id:'lifecycle-'+i,fieldId:state.fields[i===3?1:0].id,scheduledDate:'2026-01-01',status:i===2?'COMPLETED':'PLANNED',resourceId:i===0?'JB23DR01':null,owner:i===0?'장비':'센터 인력',start:i*4,duration:4,staff:1,machineOperators:i===0?1:0,ordinaryWorkers:i===0?0:1,farmerWorkers:0,kind:'PROCESS',predecessorMissionIds:[],originalScheduledDate:undefined}));
 cycle={id:randomUUID(),pnu:state.fields[0].id,crop:'rice',start:'2026-01-01',end:'2099-12-31',source:'REGISTERED'};
 for(const m of state.missions.filter(m=>m.fieldId===cycle.pnu))Object.assign(m,{cultivationId:cycle.id});
 await db.center.update({where:{id:'demo'},data:{state:json(state),version:1}});
 await db.workRecord.createMany({data:[
  {workspace:'sandbox',kind:'fields',id:'current',payload:state.fields.map(f=>({pnu:f.id,address:f.address,area:f.area,crop:'rice',mode:'full',group:'',rights:'pending'}))},
  {workspace:'sandbox',kind:'cultivation',id:cycle.id,payload:json(cycle)},
  {workspace:'sandbox',kind:'fieldParticipation',id:cycle.pnu,payload:{pnu:cycle.pnu,status:'ACTIVE'}},
 ]});
});
afterEach(async()=>{await db.workRecord.deleteMany({where:{kind:{in:kinds}}});if(saved.length)await db.workRecord.createMany({data:saved as any});await base.cleanup()});
const result=()=>({id:randomUUID(),missionId:state.missions[0].id,expectedPlanVersion:state.planVersion,resourceId:'JB23DR01',startedAt:'2026-01-01T09:00:00+09:00',finishedAt:'2026-01-01T10:00:00+09:00'});
const cancel=(category='UNNECESSARY')=>({requestId:randomUUID(),expectedPlanVersion:state.planVersion,missionIds:[state.missions[0].id],category,reason:'격리 검증',unperformedConfirmed:true});
const readState=async()=>(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;

it('receives the assigned equipment result exactly once and appends an auditable field correction',async()=>{
 const b=result();await receiveWorkResult(b);await receiveWorkResult(b);
 expect((await readState()).planVersion).toBe(2);
 let report=await db.$transaction(readReport),row=report.rows[0];
 expect(row).toMatchObject({fieldId:cycle.pnu,confirmed:true,executionMinutes:60,reportOrigin:{type:'EQUIPMENT_REPORT'},fieldAreaM2:state.fields[0].area});
 const correction={id:randomUUID(),missionId:b.missionId,expectedPlanVersion:2,expectedEvidenceId:b.id,minutes:45,reason:'장비 보고서 정정'};
 await correctWorkDuration(correction);await correctWorkDuration(correction);
 await expect(correctWorkDuration({...correction,minutes:40})).rejects.toThrow('요청 ID');
 expect((await readState()).planVersion).toBe(3);
 report=await db.$transaction(readReport);expect(report.rows[0]).toMatchObject({executionMinutes:45,evidenceId:correction.id});
 expect(fieldDurationSummary(report.rows)[0]).toMatchObject({count:1,meanMinutes:45,source:'ACTUAL'});
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'taskExecutionAssessment'}})).toBe(2);
 const original=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'taskExecutionAssessment',id:b.id}}});
 expect((original.payload as any).actualFinishedAt).toBe(b.finishedAt);
});
it('rejects a wrong device, stale version, wrong workday and future results without recording completion',async()=>{
 for(const patch of [{resourceId:'JB23DR02'},{expectedPlanVersion:0},{startedAt:'2025-12-31T09:00:00+09:00'},{finishedAt:'2099-01-01T10:00:00+09:00'}])await expect(receiveWorkResult({...result(),...patch})).rejects.toThrow();
 expect(await readState()).toEqual(json(state));expect(await db.workRecord.count({where:{kind:'taskExecutionAssessment'}})).toBe(0);
});
it('accepts a later report after a held result, and distinguishes registered from directly employed labor',async()=>{
 const id=randomUUID();await saveExecution({id,missionId:'lifecycle-1',expectedPlanVersion:1,expectedEvidenceId:null,status:'HELD',startedAt:null,finishedAt:null,actor:'test',reason:'미수행'});
 await receiveWorkResult({...result(),missionId:'lifecycle-1',expectedPlanVersion:2,expectedEvidenceId:id,resourceId:null,laborSource:'DIRECT_EMPLOYMENT'});
 const row=(await db.$transaction(readReport)).rows[1];expect(row).toMatchObject({confirmed:true,reportOrigin:{type:'LABOR_REPORT',laborSource:'DIRECT_EMPLOYMENT'}});
 await expect(receiveWorkResult({...result(),missionId:'lifecycle-3',expectedPlanVersion:3,resourceId:null})).rejects.toThrow('인력 구분');
 await receiveWorkResult({...result(),missionId:'lifecycle-3',expectedPlanVersion:3,resourceId:null,laborSource:'REGISTERED'});
 expect((await db.$transaction(readReport)).rows[3].reportOrigin?.laborSource).toBe('REGISTERED');
});
it('keeps demo and actual duration observations in separate summaries',async()=>{
 const report=await db.$transaction(readReport),r={...report.rows[0],confirmed:true,executionMinutes:30};
 const summaries=fieldDurationSummary([r,{...r,source:'SIMULATED',executionMinutes:90}]);
 expect(summaries.map(s=>s.meanMinutes).sort((a,b)=>a-b)).toEqual([30,90]);
});
it('withdrawal closes all remaining field tasks, releases reservations, and retains completed work and another field',async()=>{
 const booking=missionReservation('demo',state.missions[0])!;
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 const b=cancel('WITHDRAWAL');const response=await cancelTasks(b);expect(response.cancelled).toBe(2);await cancelTasks(b);
 const after=await readState();expect(after.missions.map(m=>m.status)).toEqual(['CANCELLED','CANCELLED','COMPLETED','PLANNED']);
 expect(after.missions[2]).toEqual(json(state.missions[2]));expect(after.missions[3]).toEqual(json(state.missions[3]));
 expect(after.fields[0].serviceStatus).toBe('WITHDRAWN');
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}})).payload).toHaveLength(1);
 expect(await db.workRecord.count({where:{kind:'fieldClosure'}})).toBe(1);
 expect(await db.workRecord.count({where:{kind:'resourceReservation',id:booking.id}})).toBe(0);
 const stored=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'cultivation',id:cycle.id}}})).payload as any;
 expect(stored.closedAt).toBeTruthy();expect(stored.closureCategory).toBe('WITHDRAWAL');
});
it('crop termination keeps the field, requires crop selection, and permits a replacement cycle without overwriting the old one',async()=>{
 await cancelTasks(cancel('CROP_CHANGE'));const after=await readState();expect(after.fields[0]).toMatchObject({serviceStatus:'CROP_REQUIRED',crop:null});
 const entries=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}})).payload as any[];
 expect(entries).toHaveLength(2);expect(entries[0]).toMatchObject({crop:'',group:''});
 const old=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'cultivation',id:cycle.id}}})).payload as unknown as Cultivation;
 expect(()=>checkCultivation({...cycle,id:randomUUID(),crop:'potato'},[old])).not.toThrow();
 expect(after.missions[2]).toEqual(json(state.missions[2]));
});
it('reselects a crop through the normal API, creates its real schedule, and cannot reopen a terminated plan',async()=>{
 const session=await testSession();
 try{
  const resources=catalogState();Object.assign(state,{machines:resources.machines,staffCount:resources.staffCount,transportCount:resources.transportCount,crewCapacity:resources.crewCapacity});
  await db.center.update({where:{id:'demo'},data:{state:json(state)}});
  await cancelTasks(cancel('CROP_CHANGE'));
  const inventoryKey={workspace:'sandbox',kind:'fields',id:'current'},inventory=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:inventoryKey}});
  await db.workRecord.update({where:{workspace_kind_id:inventoryKey},data:{payload:(inventory.payload as any[]).map(f=>f.pnu===cycle.pnu?{...f,conditions:catalogField('soybean').conditions}:f)}});
  const request=(path:string,body?:unknown)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{headers:session.headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const id=randomUUID(),created=await createCultivation(request('cultivations',{cultivation:{id,pnu:cycle.pnu,crop:'soybean',start:'2034-01-01',end:'2034-12-31',source:'REGISTERED'},context:catalogContext()}));
  expect(created.status,await created.clone().text()).toBe(200);
  const preview=await previewDispatch(request('annual-dispatch?cultivationId='+id)),d=await preview.json();
  expect(preview.status,JSON.stringify(d)).toBe(200);expect(d.feasibility.every((r:any)=>r.status==='CAPACITY_FEASIBLE'),JSON.stringify(d)).toBe(true);
  const approved=await approveDispatch(request('annual-dispatch',{cultivationId:id,token:d.token,demoAcknowledged:true}));expect(approved.status,await approved.clone().text()).toBe(200);
  const after=await readState();expect(after.fields[0].serviceStatus).toBeUndefined();expect(after.fields[0].crop).toBe('콩');
  const newMissions=after.missions.filter(m=>(m as any).cultivationId===id);expect(newMissions.length).toBe(d.assignments.length);expect(newMissions.length).toBeGreaterThan(3);
  expect(newMissions.every(m=>m.owner!=='농부')).toBe(true);expect(after.missions.find(m=>m.id==='lifecycle-2')).toEqual(json(state.missions[2]));
  const entries=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}})).payload as any[];expect(entries[0].crop).toBe('soybean');
  expect((await previewDispatch(request('annual-dispatch?cultivationId='+cycle.id))).status).toBe(409);
  expect((await changeCultivation(request('cultivation-change',{id:cycle.id,crop:'rice',area:1000,action:'preview'}))).status).toBe(409);
 }finally{await session.cleanup()}
},30000);
it('a recorded optional omission leaves later work intact, but essential planting cannot be omitted under a successor',async()=>{
 Object.assign(state.missions[1],{predecessorMissionIds:[state.missions[0].id]});
 await db.center.update({where:{id:'demo'},data:{state:json(state)}});
 await expect(cancelTasks(cancel())).rejects.toThrow('후속 작업');
 state.missions[0].kind='CONDITIONAL';await db.center.update({where:{id:'demo'},data:{state:json(state)}});
 await cancelTasks(cancel());expect((await readState()).missions[1]).toEqual(json(state.missions[1]));
});
it('labels model and name, describes date/equipment differences and budgets former farmer work as ordinary labor',()=>{
 const before=structuredClone(state),after=structuredClone(state);Object.assign(after.machines[0],{name:'콤바인1호',ledger:{model:'DX10'}});
 after.missions[0].resourceId=after.machines[0].id;after.missions[0].scheduledDate='2026-01-02';
 expect(taskResourceLabel(after,after.missions[0])).toBe('DX10 (콤바인1호)');
 const farmer={...after.missions[1],owner:'농부' as const,staff:0,ordinaryWorkers:0,farmerWorkers:2};
 expect(taskResourceLabel(after,farmer)).toBe('인력');expect(ordinaryWorkerDemand(farmer)).toBe(2);
 expect(missionResourceUse(after,farmer)).toMatchObject({staff:2,person:null});
 expect(operatingTaskCrew({crew:{machineOperators:0,ordinaryWorkers:0,farmerWorkers:2}} as any)).toEqual({machineOperators:0,ordinaryWorkers:2,farmerWorkers:0});
 const row=scheduleChangeRows(before,after,[after.missions[0].id])[0];expect(row).toMatchObject({field:after.fields[0].address,crop:after.missions[0].crop,task:after.missions[0].label,before:{date:'2026-01-01'},after:{date:'2026-01-02'}});expect(row.changed).toContain('date');
 const first={...row.before,resource:'콤바인',resourceId:'JB23CB01',startMinute:480,minutes:60},second={...first,resourceId:'JB23CB02',startMinute:540};
 expect(changedResourceLabel(first,second)).toBe('콤바인 · JB23CB01');expect(changedResourceLabel(second,first)).toBe('콤바인 · JB23CB02');
 expect(changedResourceLabel({...first,resource:'인력',resourceId:null},second,false)).toBe('Labor');
 expect(scheduleTimeLabel(first)).toBe('08:00–09:00');expect(scheduleTimeLabel(second)).toBe('09:00–10:00');
 after.missions[0].start=before.missions[0].start+32;expect(scheduleChangeRows(before,after,[after.missions[0].id])[0].changed).not.toContain('time');
 after.missions[0].start++;expect(scheduleChangeRows(before,after,[after.missions[0].id])[0].changed).toContain('time');
});
