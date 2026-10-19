import {randomUUID} from 'node:crypto';
import type {Page} from '@playwright/test';
import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {automaticSearchSteps} from '../lib/automatic-replanning';
import {hash} from '../lib/annual-replanning';
import {AUTOMATIC_REPLAN_LEASE_MS,newAutomaticLease} from '../lib/automatic-replan-lease';
import type {State,Mission} from '../lib/types';

const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const offset=(d:string,n:number)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const receiptKey=(id:string)=>({workspace:'sandbox',kind:'automaticReplan',id});
async function setup(page:Page){
 const d=today(),s=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
 s.ruleVersion=`RECOVERY_ISOLATED_${randomUUID()}`;s.staffCount=2;s.crewCapacity={operators:1,workers:1};s.transportCount=1;
 s.fields=[{id:'recovery-field',farmerId:'synthetic-owner',name:'홍검증',address:'격리 복구 검증 농지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'DEMO_ASSUMPTION'}];
 s.machines=[{id:'JB23DR01',ownerCenterId:'demo',type:'DR',name:'검증 드론',status:'AVAILABLE',capacityHaHour:1,safetyLock:false,compatibleCrops:['rice']}];
 const task:Mission={id:'recovery-task',fieldId:s.fields[0].id,crop:'쌀',label:'복구 검증 작업',owner:'장비',resourceId:'JB23DR01',status:'PLANNED',start:0,duration:4,deadline:32,priority:1,batchKey:'isolated',staff:1,transport:1,scheduledDate:d,month:Number(d.slice(5,7)),planningWindow:{from:d,to:offset(d,7),duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
 s.missions=[task,{...task,id:'protected-history',status:'COMPLETED',scheduledDate:offset(d,-1)}];
 await db.center.update({where:{id:'demo'},data:{state:json(s)}});
 // Stop before any browser mutation if the server is using another database.
 const live=await page.request.get('/api/workspace');expect(live.status()).toBe(200);const state=(await live.json()).state;
 // The workspace view also joins stored parcel inventory and shared resources.
 // Compare the unique fixture marker and exact task set, not that enriched view.
 expect(state.ruleVersion).toBe(s.ruleVersion);expect(state.missions).toEqual(json(s.missions));
 return {d,task,s};
}
async function open(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'일정변경',exact:true}).click();
 return page.getByRole('dialog');
}
async function snapshot(){
 const center=await db.center.findUniqueOrThrow({where:{id:'demo'}});
 return {state:center.state,version:center.version,notices:await db.outbox.count(),reservations:await db.workRecord.count({where:{kind:'resourceReservation'}}),decisions:await db.workRecord.count({where:{kind:'planningDecision'}}),calls:await db.aiCall.count()};
}

test('a lost response after a real commit is recovered on screen without a second solve, save or model call',async({page},info)=>{
 test.setTimeout(90000);const fixture=await laborCapacityFixture();
 try{
  const {s,d}=await setup(page),before=await snapshot();let committed:any,automaticRequests=0;
  await page.route('**/api/replanning',async route=>{
   if(route.request().method()!=='POST'||route.request().postDataJSON()?.action!=='automatic'){await route.continue();return;}
   automaticRequests++;
   // The real handler commits into the disposable DB. Only delivery of its
   // response is interrupted; no fabricated business response is provided.
   const response=await route.fetch();expect(response.status(),await response.text()).toBe(200);committed=await response.json();await route.abort('failed');
  });
  const modal=await open(page);await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();
  await expect(modal.getByRole('button',{name:'처리 결과 확인',exact:true})).toBeEnabled();expect(committed.status).toBe('APPLIED');
  const saved=await snapshot();expect(saved.version).toBe(before.version+1);expect(saved.notices).toBe(before.notices+1);
  expect((saved.state as any).missions.find((m:any)=>m.id==='protected-history')).toEqual(s.missions[1]);
  expect((saved.state as any).missions[0].scheduledDate>d).toBe(true);
  await modal.getByRole('button',{name:'처리 결과 확인',exact:true}).click();await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
  expect(await snapshot()).toEqual(saved);expect(automaticRequests).toBe(1);expect(saved.calls).toBe(before.calls);
  await page.screenshot({path:'test-results/ui-recovered-lost-response.png'});
  await info.attach('lost-response-recovery',{body:JSON.stringify({requestId:committed.requestId,automaticRequests,planCommits:1,duplicateModelCalls:0,notificationsCreated:1,realResponseDeliveryInterrupted:true}),contentType:'application/json'});
  await modal.getByRole('button',{name:'완료',exact:true}).click();await expect(modal).toHaveCount(0);
 }finally{await fixture.cleanup()}
});

for(const prepared of [true,false])test(`an expired ${prepared?'saved proposal':'unprepared request'} is recovered explicitly without repeating inference`,async({page})=>{
 test.setTimeout(90000);const fixture=await laborCapacityFixture();
 try{
  const {task,d}=await setup(page),requestId=randomUUID(),input={ids:[task.id],day:d,deferAfter:d,reason:'연결 복구 검증'};
  let checkpoint={};
  if(prepared){
   const comparison=await page.request.post('/api/replanning',{data:{action:'compare',...input,alternatives:automaticSearchSteps,searchMode:'LOCAL_FIRST'}});expect(comparison.status(),await comparison.text()).toBe(200);
   const c=await comparison.json(),choice=c.results.find((r:any)=>r.id===c.recommendation.alternativeId);expect(choice.status).toBe('FEASIBLE');
   const response=await page.request.post('/api/replanning',{data:choice.previewRequest});expect(response.status(),await response.text()).toBe(200);const p=await response.json();
   const key={workspace:'sandbox',kind:'replanning',id:p.proposalId},row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}});
   await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:{...(row.payload as any),automaticRequestId:requestId}}});
   checkpoint={proposalId:p.proposalId,preparedResult:{status:'APPLIED',requestId,changes:p.diff.length,dates:p.diff.map((v:any)=>v.date),source:'RULES'}};
  }
  // Simulate a process exit at a durable checkpoint, not a mock API answer.
  const start=Date.now()-AUTOMATIC_REPLAN_LEASE_MS-1000;
  await db.workRecord.create({data:{...receiptKey(requestId),payload:json({status:'PROCESSING',input,inputHash:hash(input),startedAt:new Date(start).toISOString(),actor:'격리 검증',...newAutomaticLease(randomUUID(),start),...checkpoint})}});
  const before=await snapshot(),modal=await open(page);await modal.getByRole('button',{name:'처리 결과 확인',exact:true}).click();
  if(prepared){
   await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();const after=await snapshot();expect(after.version).toBe(before.version+1);expect(after.notices).toBe(before.notices+1);expect(after.decisions).toBe(before.decisions);expect(after.calls).toBe(before.calls);
   await page.screenshot({path:'test-results/ui-recovered-durable-checkpoint.png'});
  }else{
   await expect(modal.getByRole('alert')).toContainText('기존 일정은 유지');await expect(modal.getByRole('button',{name:'일정변경 적용하기',exact:true})).toBeEnabled();expect(await snapshot()).toEqual(before);
   expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:receiptKey(requestId)}})).payload).toMatchObject({status:'FAILED'});
   await page.screenshot({path:'test-results/ui-recovery-requires-new-request.png'});
  }
 }finally{await fixture.cleanup()}
});
