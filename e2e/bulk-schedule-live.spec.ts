import {test,expect} from './authenticated-test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Page} from '@playwright/test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {emptyCenter} from '../lib/center-registry';
import {missionReservation} from '../lib/plan-reservation-sync';
import {ordinaryLaborAvailability,emptyLaborOps,type LaborJob} from '../lib/labor-operations';
import {missionResourceUse} from '../lib/scheduling-constraints';
import {crewCapacityLimits} from '../lib/operating-capacity';
import {dateSlot,verifySchedule} from '../lib/scheduling-engine';
import type {State,Machine} from '../lib/types';
import type {WorkMission} from '../lib/replan-work-split';
import type {SharingOffer} from '../lib/equipment-sharing-offers';
import {resourceView} from '../lib/center-resources';
import {planningState,readExecutionHistory} from '../lib/replan-history';
import {makeContract} from '../lib/annual-replanning';
import {readShortForecast} from '../lib/kma-forecast';

test.use({authRole:'CENTER_STAFF'});
const json=(x:unknown)=>JSON.parse(JSON.stringify(x));
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const offset=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
type Scenario='vacancies-30'|'vacancies-240'|'preferred-120'|'related-240'|'loan-120';
type TestMission=WorkMission&{planningLocked?:boolean;executionStartedAt?:string};
const counts:Record<Scenario,number>={'vacancies-30':30,'vacancies-240':240,'preferred-120':120,'related-240':240,'loan-120':120};
const equipment=(id:string,ownerCenterId='demo'):Machine=>({id,ownerCenterId,type:'드론',name:'다건 검증 드론',status:'AVAILABLE',safetyLock:false,capacityHaHour:1,compatibleCrops:['rice']});

/** Only synthetic input changes. No API interception or prepared solver results.
 * Existing bookings and attendance are present BEFORE the operator clicks.
 * 15-minute jobs are explicit test workloads, not agronomic productivity claims. */
async function seedCase(kind:Scenario){
 const fixture=await laborCapacityFixture();
 try{
  const d=today(),source=offset(d,1),prefix='bulk-'+randomUUID(),count=counts[kind],loan=kind==='loan-120';
  const s=emptyCenter('demo'),lender=emptyCenter('janggye');
  const manualCount=loan?0:Math.floor(count/4),machineCount=count-manualCount;
  const activeMachines=loan?1:Math.ceil(machineCount/24),workers=loan?0:Math.ceil(manualCount/24);
  s.machines=Array.from({length:activeMachines+(loan?0:1)},(_,i)=>equipment('JB23DR'+String(i+1).padStart(2,'0')));
  s.staffCount=s.machines.length+workers;s.transportCount=s.machines.length;s.crewCapacity={operators:s.machines.length,workers};
  const add=(id:string,date:string,resourceId:string|null,start:number,duration=1,from=source,to=offset(d,6),ownerIndex?:number):TestMission=>{
   const fieldId=id+'-field';s.fields.push({id:fieldId,farmerId:prefix+'-owner-'+(ownerIndex??id),name:'홍가상',address:'계북면 격리 검증 필지 '+id,area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'bulk',source:'DEMO_ASSUMPTION'});
   const task:WorkMission={id,fieldId,crop:'쌀',label:resourceId?'농작업 다건 검증':'수작업 다건 검증',owner:resourceId?'장비':'센터 인력',resourceId,status:'PLANNED',scheduledDate:date,month:Number(date.slice(5,7)),start,duration,deadline:32,priority:1,batchKey:prefix,staff:1,transport:resourceId?1:0,machineOperators:resourceId?1:0,ordinaryWorkers:resourceId?0:1,compatibilityCrop:'rice',predecessorMissionIds:[],planningWindow:{from,to,duration,windLimitMs:12,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'},...(resourceId?{}:{executionMethod:'MANUAL' as const})};
   s.missions.push(task);return task;
  };
  const targets:WorkMission[]=[];
  for(let i=0;i<count;i++){
   const manual=i>=machineCount,index=manual?i-machineCount:i;
   const date=loan?offset(d,1+Math.floor(i/24)):source;
   targets.push(add(prefix+'-target-'+i,date,manual?null:s.machines[index%activeMachines].id,loan?2+i%24:Math.floor(index/(manual?workers:activeMachines)),1,loan?date:source,loan?date:kind==='related-240'?offset(d,2):offset(d,6),Math.floor(i/2)));
  }
  const blockers:WorkMission[]=[];
  if(kind==='preferred-120'||kind==='related-240'){
   const at=offset(d,kind==='preferred-120'?4:2);
   for(const resource of [...s.machines.map(m=>m.id),...Array<string|null>(workers).fill(null)]){
    const m=add(prefix+'-block-'+blockers.length,at,resource,0,32,at,offset(d,6));
    if(kind==='preferred-120')m.planningLocked=true;
    blockers.push(m);
   }
  }
  const completed=add(prefix+'-completed',offset(d,-1),s.machines[0].id,0);completed.status='COMPLETED';
  const cancelled=add(prefix+'-cancelled',offset(d,-1),null,0);cancelled.status='CANCELLED';
  const locked=add(prefix+'-locked',offset(d,10),s.machines[0].id,0);locked.planningLocked=true;
  const started=add(prefix+'-started',d,s.machines[0].id,0);started.executionStartedAt=d+'T08:00:00+09:00';
  lender.staffCount=1;lender.crewCapacity={operators:1,workers:0};lender.transportCount=1;lender.machines=[equipment('JSJGDR01','janggye')];
  lender.fields=[{...s.fields[0],id:prefix+'-lender-field',farmerId:prefix+'-lender-owner'}];
  lender.missions=[{...targets[0],id:prefix+'-lender-task',fieldId:lender.fields[0].id,resourceId:'JSJGDR01',scheduledDate:offset(d,9),planningWindow:{...targets[0].planningWindow!,from:offset(d,9),to:offset(d,9)}}];
  for(const state of [s,lender]){
   const tasks=state.missions.filter(m=>!['COMPLETED','CANCELLED'].includes(m.status)).map(m=>({...missionResourceUse(state,m),id:m.id,original:dateSlot(m.scheduledDate!)+m.start,allowed:[dateSlot(m.scheduledDate!)+m.start],duration:m.duration,selected:false,preferred:null,predecessor:null,locked:true}));
   verifySchedule({tasks,freezeBefore:0,daily:false,staffCapacity:state.staffCount,transportCapacity:state.transportCount,capacityLimits:crewCapacityLimits(state)},tasks.map(t=>({id:t.id,start:t.original,resource:t.resource})),'GAPS_ONLY');
  }
  const labor=emptyLaborOps();
  labor.people=Array.from({length:Math.max(1,workers)},()=>({...fixture.worker,...ordinaryLaborAvailability(),id:randomUUID()}));
  const laborTasks=targets.filter(m=>!m.resourceId);
  for(const [i,m] of laborTasks.entries()){
   const f=s.fields.find(f=>f.id===m.fieldId)!;
   const value={id:m.id,missionId:m.id,task:m.label,address:f.address,date:m.scheduledDate!,startMinute:480+m.start*15,durationMinutes:15,count:1,workCode:'general',held:false};
   const worker=labor.people[i%labor.people.length].id;
   const job:LaborJob={...value,id:randomUUID(),sourceHash:hash(value),pay:'격리 검증',status:'OPEN',invited:[worker],responses:{[worker]:'PHONE'},distances:{[worker]:100},assigned:[worker],manual:null,worked:[]};
   labor.jobs.push(job);
  }
  await db.$transaction(async tx=>{
   for(const [id,state] of [['demo',s],['janggye',lender]] as const)await tx.center.update({where:{id},data:{state:json(state)}});
   await tx.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}},data:{payload:json(labor)}});
   const reservations=[...s.missions.flatMap(m=>{const r=missionReservation('demo',m);return r?[r]:[]}),...lender.missions.flatMap(m=>{const r=missionReservation('janggye',m);return r?[r]:[]})];
   await tx.workRecord.createMany({data:reservations.map(r=>({workspace:'shared',kind:'resourceReservation',id:r.id,payload:json(r)}))});
   if(laborTasks.length)await tx.workRecord.createMany({data:laborTasks.map(m=>({workspace:'sandbox',kind:'laborDemand',id:m.id,payload:json({missionId:m.id,date:m.scheduledDate,startMinute:480+m.start*15,durationMinutes:15,people:1,source:'SYNTHETIC_INPUT',status:'ASSIGNED'})}))});
   if(loan){const offer:SharingOffer={id:randomUUID(),version:1,machineId:'JSJGDR01',ownerCenterId:'janggye',borrowerCenterId:'demo',from:source,to:offset(d,5),compatibleMachineIds:['JB23DR01'],outboundSlots:2,returnSlots:2,agreementRef:'격리 검증용 사전 공유 입력',conditions:'합성 자원·운송 확인',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};await tx.workRecord.create({data:{workspace:'shared',kind:'equipmentSharingOffer',id:offer.id,payload:json(offer)}});}
  },{timeout:30000});
  return {kind,count,d,source,prefix,targets,blockers,labor,laborTasks,before:structuredClone(s),protected:[completed,cancelled,locked,started],lenderBefore:await db.center.findUniqueOrThrow({where:{id:'janggye'}}),calls:await db.aiCall.count(),cleanup:fixture.cleanup};
 }catch(e){await fixture.cleanup();throw e}
}

async function openSchedule(page:Page,date:string){
 await page.goto('/?tab=schedule');
 await page.getByLabel('일정 연도',{exact:true}).selectOption(date.slice(0,4));
 await page.getByRole('button',{name:Number(date.slice(5,7))+'월',exact:true}).click();
 const day=page.getByTestId('schedule-day-'+date);
 if(await day.getAttribute('open')===null)await day.locator('summary').click();
 await day.getByRole('button',{name:'전체 선택',exact:true}).click();
 await day.getByRole('button',{name:'일정변경',exact:true}).click();
 return page.getByRole('dialog');
}

for(const kind of Object.keys(counts) as Scenario[])test(`${kind}: real screen to persisted reservations, attendance and notices`,async({page},info)=>{
 const f=await seedCase(kind),errors:string[]=[],externalRequests:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith('https://127.0.0.1:3443/')&&!r.url().startsWith('data:'))externalRequests.push(new URL(r.url()).origin)});
 try{
  // Fail before clicking if this browser is not reading the isolated DB.
  const check=await page.request.get('/api/workspace?workspace=sandbox');expect(check.status()).toBe(200);
  expect((await check.json()).state.missions.map((m:WorkMission)=>m.id)).toEqual(f.before.missions.map(m=>m.id));
  const calculationState=planningState(await resourceView(db,f.before,'demo'),await readExecutionHistory());
  const durableSnapshot=async()=>({
   centers:await db.center.findMany({orderBy:{id:'asc'}}),
   records:await db.workRecord.findMany({where:{kind:{in:['resourceReservation','laborOperations','laborDemand','taskPlanChange','equipmentLoan','centerResourceNotice']}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),
   outbox:await db.outbox.findMany({orderBy:{id:'asc'}}),
  });
  const durableBefore=await durableSnapshot();
  const modal=await openSchedule(page,f.source);
  if(kind==='preferred-120')await modal.getByLabel('변경 희망일 (선택)',{exact:true}).fill(offset(f.d,4));
  if(kind==='related-240')await modal.getByLabel('변경 희망일 (선택)',{exact:true}).fill(offset(f.d,2));
  if(kind==='loan-120'){
   await modal.getByLabel('변경 사유',{exact:true}).selectOption('장비 문제');
   await modal.getByLabel('입고일',{exact:true}).fill(f.source);
   await modal.getByLabel('출고 예정일',{exact:true}).fill(offset(f.d,6));
  }
  await expect(modal.getByRole('button',{name:'인력 대체 기준 입력',exact:true})).toHaveCount(0);
  await page.screenshot({path:`test-results/bulk-${kind}-before.png`});
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().method()==='POST',{timeout:150000});
  const at=performance.now();await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();
  const response=await responsePromise,body=response.request().postDataJSON(),result=await response.json();
  const diagnosticsDir='.data/validation/20261012-bulk-ui-fixed';mkdirSync(diagnosticsDir,{recursive:true});
  const decisions=await db.workRecord.findMany({where:{workspace:'sandbox',kind:'planningDecision'}});
  const proposals=await db.workRecord.findMany({where:{workspace:'sandbox',kind:'replanning'}});
  const diagnostic:any={case:kind,at:new Date().toISOString(),elapsedMs:Math.round(performance.now()-at),request:body,result,decisions:decisions.map(r=>r.payload),proposals:proposals.map(r=>r.payload)};
  if(result.status!=='APPLIED')diagnostic.rejectedRequestPreservedData=hash(await durableSnapshot())===hash(durableBefore);
  if(kind==='preferred-120'||kind==='related-240'){
   // Prove the test case is feasible with the SAME constraints, independently
   // of the optimizer. This witness is NEVER injected into the app or solver.
   const scope=kind==='preferred-120'?'PRESERVE':'EXPAND';
   const contract=makeContract(calculationState,{...body,scope,allowBorrowing:false},await readShortForecast({}),f.d).contract;
   const selected=new Set(f.targets.map(m=>m.id)),blockers=new Set(f.blockers.map(m=>m.id));
   const witness=contract.tasks.map(t=>({id:t.id,resource:t.resource,start:selected.has(t.id)?dateSlot(offset(f.d,kind==='preferred-120'?3:2))+t.original%32:kind==='related-240'&&blockers.has(t.id)?dateSlot(offset(f.d,3))+t.original%32:t.original}));
   try{verifySchedule(contract,witness,scope==='PRESERVE'?'GAPS_ONLY':'REBUILD_APPROVED');diagnostic.feasibleWitnessVerified=true}catch(e){diagnostic.feasibleWitnessVerified=false;diagnostic.witnessError=e instanceof Error?e.message:String(e)}
   diagnostic.contract=contract;diagnostic.witness=witness;
  }
  writeFileSync(`${diagnosticsDir}/${kind}-diagnostic-${Date.now()}.json`,JSON.stringify(diagnostic,null,2));
  if(result.status!=='APPLIED')expect(diagnostic.rejectedRequestPreservedData,'A failed search must not partially modify plans, reservations, labor or notices').toBe(true);
  expect(response.status(),JSON.stringify({status:result.status,message:result.message,error:result.error})).toBe(200);
  expect(result.status,JSON.stringify({status:result.status,witness:diagnostic.feasibleWitnessVerified,results:diagnostic.decisions.map((d:any)=>d.comparison.results.map((r:any)=>({id:r.id,status:r.status,reason:r.reason})))})).toBe('APPLIED');
  expect(new Set(body.ids)).toEqual(new Set(f.targets.map(m=>m.id)));
  await expect(modal.getByTestId('automatic-replan-applied')).toContainText(`${result.changes}건 변경`);
  const elapsedMs=Math.round(performance.now()-at);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  const receipt=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'automaticReplan',id:body.requestId}}});
  expect(receipt.payload).toMatchObject({status:'APPLIED',policy:'equipment-only-v1'});
  const proposalId=(receipt.payload as any).proposalId;
  const proposal=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'replanning',id:proposalId}}})).payload as any;
  const changed=await db.workRecord.findMany({where:{workspace:'sandbox',kind:'taskPlanChange',id:{startsWith:proposalId+':'}}});
  expect(changed).toHaveLength(result.changes);expect(result.changes).toBeGreaterThanOrEqual(f.count);
  expect(saved.missions.length).toBe(f.before.missions.length);
  for(const m of f.protected)expect(saved.missions.find(x=>x.id===m.id)).toEqual(m);
  expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(f.lenderBefore);
  for(const m of f.targets){
   const next=saved.missions.find(x=>x.id===m.id)!;
   expect(next.scheduledDate!>=m.planningWindow!.from&&next.scheduledDate!<=m.planningWindow!.to).toBe(true);
   expect(Boolean(next.resourceId)).toBe(Boolean(m.resourceId));
   if(kind==='loan-120')expect(next).toMatchObject({scheduledDate:m.scheduledDate,resourceId:'JSJGDR01'});
   else expect(next.scheduledDate).not.toBe(m.scheduledDate);
   if(kind==='related-240')expect(next.scheduledDate).toBe(offset(f.d,2));
  }
  if(kind==='preferred-120')for(const m of f.blockers)expect(saved.missions.find(x=>x.id===m.id)).toEqual(m);
  if(kind==='related-240'){
   expect(proposal.result.phase).toBe('REBUILD_APPROVED');
   // Only conflicting bookings need to move. An unused spare's booking may
   // stay put; requiring every blocker to move rewards unnecessary disruption.
   expect(f.blockers.some(m=>saved.missions.find(x=>x.id===m.id)!.scheduledDate!==m.scheduledDate)).toBe(true);
   for(const m of f.blockers){const date=saved.missions.find(x=>x.id===m.id)!.scheduledDate!;expect(date>=m.planningWindow!.from&&date<=m.planningWindow!.to).toBe(true)}
  }
  const reservations=await db.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
  for(const m of saved.missions.filter(m=>m.resourceId&&m.status!=='CANCELLED')){
   const rows=reservations.filter(r=>(r.payload as any).centerId==='demo'&&(r.payload as any).taskId===m.id);
   expect(rows).toHaveLength(1);expect(rows[0].payload).toEqual(missionReservation('demo',m,rows[0].id));
  }
  const noticeRows=await db.outbox.findMany({where:{id:{startsWith:`replan:${proposalId}:`}}});
  const changedFields=new Set(changed.map(r=>(r.payload as any).after.fieldId));
  const owners=new Set(saved.fields.filter(x=>changedFields.has(x.id)).map(x=>x.farmerId));
  expect(new Set(noticeRows.map(n=>n.farmerId))).toEqual(owners);expect(noticeRows).toHaveLength(owners.size);
  expect(noticeRows.every(n=>n.status==='PENDING'&&n.attempts===0&&n.sentAt===null)).toBe(true);
  const labor=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}})).payload as any;
  for(const old of f.labor.jobs){
   expect(labor.jobs.find((j:LaborJob)=>j.id===old.id)).toMatchObject({status:'STALE',assigned:[]});
   const next=labor.jobs.filter((j:any)=>j.replacesJobId===old.id);expect(next).toHaveLength(1);
   const task=saved.missions.find(m=>m.id===old.missionId)!;
   expect(next[0]).toMatchObject({status:'OPEN',date:task.scheduledDate,responses:{},assigned:[]});
   expect(labor.notices.some((n:any)=>n.jobId===next[0].id&&n.type==='RECONFIRM')).toBe(true);
   const demand=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborDemand',id:task.id}}})).payload as any;
   expect(demand).toMatchObject({date:task.scheduledDate,status:'UNASSIGNED',people:1});
  }
  const loans=await db.workRecord.findMany({where:{kind:'equipmentLoan'}});
  if(kind==='loan-120'){
   expect(loans).toHaveLength(5);expect(loans.every(l=>(l.payload as any).status==='CONFIRMED')).toBe(true);
   expect(await db.workRecord.count({where:{kind:'centerResourceNotice'}})).toBe(10);
  }else expect(loans).toHaveLength(0);
  await page.screenshot({path:`test-results/bulk-${kind}-saved.png`});
  await modal.getByRole('button',{name:'완료',exact:true}).click();await expect(modal).toHaveCount(0);
  await page.reload();
  const reloaded=await page.request.get('/api/workspace?workspace=sandbox');expect(reloaded.ok()).toBe(true);
  expect((await reloaded.json()).state.missions).toEqual(saved.missions);
  // Network replay must not duplicate a single booking, message or change log.
  const replay=await page.request.post('/api/replanning',{data:body});expect(replay.ok()).toBe(true);expect(await replay.json()).toEqual(result);
  expect(await db.workRecord.count({where:{kind:'taskPlanChange',id:{startsWith:proposalId+':'}}})).toBe(result.changes);
  expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBe(reservations.length);
  expect(await db.outbox.count({where:{id:{startsWith:`replan:${proposalId}:`}}})).toBe(noticeRows.length);
  expect(await db.aiCall.count()).toBe(f.calls);expect(errors).toEqual([]);expect(externalRequests).toEqual([]);
  const preferredDistanceDays=kind==='preferred-120'?f.targets.map(m=>Math.abs(Date.parse(saved.missions.find(x=>x.id===m.id)!.scheduledDate!)-Date.parse(offset(f.d,4)))/86400000):[];
  const evidence={checkedAt:new Date().toISOString(),case:kind,selectedTasks:f.count,changedTasks:result.changes,phase:proposal.result.phase,optimal:proposal.result.optimal,elapsedMs,preferredDistanceDays,changedEquipmentReservations:changed.filter(r=>(r.payload as any).after.resourceId).length,farmerNoticeRecords:noticeRows.length,laborJobsReconfirmed:f.labor.jobs.length,loanDays:loans.length,protectedTasksUnchanged:f.protected.length,lenderUnchanged:true,reloadVerified:true,duplicateRequestSafe:true,paidAiCalls:0,actualSmsSent:0,deviceCommands:0,source:'SYNTHETIC_INPUT_REAL_PRODUCTION_UI_AND_API_ISOLATED_DB'};
  mkdirSync('.data/validation/20261012-bulk-ui-fixed',{recursive:true});writeFileSync(`.data/validation/20261012-bulk-ui-fixed/${kind}.json`,JSON.stringify(evidence,null,2));
  await info.attach('bulk-durable-result',{body:JSON.stringify(evidence),contentType:'application/json'});
  if(kind==='preferred-120')expect(preferredDistanceDays.every(n=>n===1),JSON.stringify({preferredDistanceDays,feasibleWitnessVerified:diagnostic.feasibleWitnessVerified})).toBe(true);
 }finally{await f.cleanup()}
});
