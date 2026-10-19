import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {centerRegistry} from '../lib/center-registry';
import type {Mission,State} from '../lib/types';
import {recordSpace} from '../lib/workspace';
import {prepareChronologicalFixture,chronologyCriteria,sealChronologicalInput} from './chronological-demo-fixture';
import * as engine from '../lib/scheduling-engine';
import {calculateCurrentSchedule} from './current-solver';

vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_CHRONOLOGY_NO_WEATHER_CLAIM'})}));
import {POST as register} from '../app/api/registrations/route';
import {POST as production} from '../app/api/continuous-production/route';
import {GET as workspace} from '../app/api/workspace/route';
import {GET as report} from '../app/api/work-reports/route';
import {POST as execution} from '../app/api/execution-records/route';
import {POST as cancel} from '../app/api/task-cancellations/route';
import {POST as replan} from '../app/api/replanning/route';
import {POST as operations} from '../app/api/operations/route';
type Handler=(req:NextRequest)=>Promise<Response>;

it('replays 30 sequential applicants, explicit work results, a postponed task and an autumn intake using ordinary APIs',async()=>{
 const solver=vi.spyOn(engine,'solveSchedule').mockImplementation(calculateCurrentSchedule);
 const f=await prepareChronologicalFixture(),paidBefore=await db.aiCall.count(),budgetBefore=await db.aiBudget.findMany(),events:object[]=[];
 // Fixed observation point makes this replay reproducible, not an automatic
 // completion cutoff. Every completed record below still uses the public API.
 const asOf='2026-10-11';
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-01-01T18:00:00+09:00'));
 const call=async(center:string,handler:Handler,body?:object,status=200)=>{
  const r=await handler(new NextRequest('http://127.0.0.1:3100/api/chronology',{method:body?'POST':'GET',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+f.tokens[center],'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  const data=await r.json();expect(r.status,JSON.stringify(data)).toBe(status);return data;
 };
 const state=async(center:string)=>(await call(center,workspace)).state as State;
 const at=(date:string)=>vi.setSystemTime(new Date(date+'T18:00:00+09:00'));
 let completed=0,cancelled=0,postponed=0,elapsedDateChecked=false;
 const admit=async(entry:typeof f.entries[number])=>{
  at(entry.on);await sealChronologicalInput(entry);
  const before=await state(entry.centerId);
  if(events.length===0){
   const invalid={...entry.command,consultation:{...entry.command.consultation,farmer:{...entry.command.consultation.farmer,name:'변조 입력'}}};
   await call(entry.centerId,register,invalid,409);expect(await state(entry.centerId)).toEqual(before);
  }
  const receipt=await call(entry.centerId,register,entry.command);
  expect((await call(entry.centerId,register,entry.command)).alreadyApplied).toBe(true);
  const view=(await call(entry.centerId,production,{action:'refresh'})).view,pnu=entry.command.consultation.fields[0].pnu,item=view.items.find((p:any)=>p.pnu===pnu);
  expect(item?.status,JSON.stringify(item?.comparisons??view)).toBe('REVIEW');expect(item.proposal.cultivation.crop).toBe(entry.crop);
  const approval={action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[pnu],provisionalAcknowledged:true};
  const saved=await call(entry.centerId,production,approval);expect(saved.assigned).toBeGreaterThan(0);
  expect((await call(entry.centerId,production,approval)).alreadyApplied).toBe(true);
  const after=await state(entry.centerId);
  for(const m of before.missions)expect(after.missions.find(n=>n.id===m.id)).toEqual(m);
  expect(after.fields.find(p=>p.id===pnu)).toMatchObject({source:'DEMO_ASSUMPTION',demoBatchId:entry.command.demoInputBatchId});
  expect(after.missions.filter(m=>m.fieldId===pnu).every(m=>m.status==='PLANNED')).toBe(true);
  expect(receipt.consultationId).toBe(entry.command.consultationId);
  events.push({type:'REGISTER_AND_APPROVE',center:entry.centerId,on:entry.on,crop:entry.crop,assigned:saved.assigned});
 };
 try{
  for(const c of centerRegistry)await call(c.id,production,{action:'criteria',version:0,criteria:chronologyCriteria(c.id,f.batches[c.id])});
  for(const entry of f.entries.slice(0,30))await admit(entry);
  const late=f.entries[30];let lateDone=false;
  for(let iteration=0;iteration<1000;iteration++){
   const all=(await Promise.all(centerRegistry.map(async c=>(await state(c.id)).missions.map(m=>({center:c.id,m}))))).flat();
   const pending=all.filter(({m})=>!['COMPLETED','CANCELLED'].includes(m.status)&&m.scheduledDate&&m.scheduledDate<=asOf).sort((a,b)=>a.m.scheduledDate!.localeCompare(b.m.scheduledDate!)||a.m.start-b.m.start||a.m.id.localeCompare(b.m.id));
   const next=pending[0];
   if(!lateDone&&(!next||late.on<=next.m.scheduledDate!)){await admit(late);lateDone=true;continue;}
   if(!next)break;
   const date=next.m.scheduledDate!;
   // This is only the isolated test clock, not a production date override.
   const now=new Date(Date.now()+9*3600000).toISOString().slice(0,10);at(date>now?date:now);
   if(!elapsedDateChecked){
    at(new Date(Date.parse(date)+86400000).toISOString().slice(0,10));
    const passed=await call(next.center,report);expect(passed.rows.find((r:any)=>r.missionId===next.m.id)).toMatchObject({status:'PLANNED',overdue:true,confirmed:false});
    elapsedDateChecked=true;
   }
   const current=await state(next.center),m=current.missions.find(m=>m.id===next.m.id)!;
   if(!postponed&&m.resourceId){
    const evidence=await call(next.center,report),row=evidence.rows.find((r:any)=>r.missionId===m.id);
    await call(next.center,execution,{kind:'execution',input:{id:randomUUID(),missionId:m.id,expectedPlanVersion:current.planVersion,expectedEvidenceId:row.evidenceId,status:'HELD',startedAt:null,finishedAt:null,actor:'ignored-client-label',reason:'검증용 운송 지연으로 미실시'}});
    const automatic={action:'automatic',requestId:randomUUID(),ids:[m.id],deferAfter:m.scheduledDate,reason:'해당일 미실시 작업을 작업기간 안에서 재배치'};
    const moved=await call(next.center,replan,automatic);expect(moved.status,JSON.stringify(moved)).toBe('APPLIED');
    expect((await call(next.center,replan,automatic)).status).toBe('APPLIED');
    const changed=(await state(next.center)).missions.find(t=>t.id===m.id)!;expect(changed.scheduledDate!>date).toBe(true);
    events.push({type:'HELD_AND_RESCHEDULED',center:next.center,from:date,to:changed.scheduledDate});postponed++;continue;
   }
   if(!cancelled&&(m as any).operationCode==='scout'){
    await call(next.center,cancel,{requestId:randomUUID(),expectedPlanVersion:current.planVersion,missionIds:[m.id],category:'UNNECESSARY',reason:'가상 담당자 판단: 별도 예찰로 대체하여 이 작업은 생략',unperformedConfirmed:true});cancelled++;continue;
   }
   const evidence=await call(next.center,report),row=evidence.rows.find((r:any)=>r.missionId===m.id);
   const from=480+((m.start%32+32)%32)*15,to=from+m.duration*15,stamp=(minute:number)=>date+'T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')+':00+09:00';
   for(const id of (m as any).predecessorMissionIds??[]){const parent=current.missions.find(p=>p.id===id);expect(parent?.status,'predecessor '+id).toBe('COMPLETED');}
   const input={id:randomUUID(),missionId:m.id,expectedPlanVersion:current.planVersion,expectedEvidenceId:row.evidenceId,status:'COMPLETED',startedAt:stamp(from),finishedAt:stamp(to),actor:'ignored-client-label',reason:'가상 참여자의 작업 결과 입력'};
   const result=(await call(next.center,execution,{kind:'execution',input})).item;
   expect(result).toMatchObject({source:'DEMO_SIMULATION',actualStartedAt:null,actualFinishedAt:null,sourceBatchId:f.batches[next.center]});
   expect((await call(next.center,execution,{kind:'execution',input})).item).toEqual(result);completed++;
  }
  at(asOf);expect(lateDone).toBe(true);expect(elapsedDateChecked).toBe(true);expect(postponed).toBe(1);expect(cancelled).toBe(1);expect(completed).toBeGreaterThan(100);
  const summary=[];
  for(const c of centerRegistry){
   const r=await call(c.id,report);expect(r.rows.filter((r:any)=>r.overdue)).toEqual([]);expect(r.rows.every((r:any)=>r.source==='SIMULATED'&&r.sourceBatchId===f.batches[c.id])).toBe(true);
   expect(r.rows.filter((r:any)=>r.status==='COMPLETED').every((r:any)=>r.confirmed&&r.evidenceId&&r.finishedAt)).toBe(true);
   const saved=await call(c.id,execution,{kind:'snapshot',input:{id:randomUUID(),actor:'ignored',source:'SIMULATED',period:'2026',expectedHash:r.hash}});expect(saved.item.content.rows.every((r:any)=>r.source==='SIMULATED')).toBe(true);
   await call(c.id,operations,{action:'deliver',key:randomUUID()});
   summary.push({center:c.id,fields:(await state(c.id)).fields.length,tasks:r.rows.length,confirmed:r.rows.filter((r:any)=>r.confirmed).length,cancelled:r.rows.filter((r:any)=>r.status==='CANCELLED').length,future:r.rows.filter((r:any)=>r.plannedDate>asOf).length});
  }
  expect(summary.reduce((n,s)=>n+s.fields,0)).toBe(31);expect(summary.reduce((n,s)=>n+s.future,0)).toBeGreaterThan(0);
  expect(await db.workRecord.count({where:{kind:'registrationOrigin'}})).toBe(31);
  expect(await db.workRecord.count({where:{kind:'taskExecutionAssessment',payload:{path:['source'],equals:'ACTUAL'}}})).toBe(0);
  expect(await db.aiCall.count()).toBe(paidBefore);expect(await db.aiBudget.findMany()).toEqual(budgetBefore);
  const dir='.data/validation/20261011-chronological-demo';mkdirSync(dir,{recursive:true});
  writeFileSync(dir+'/result.json',JSON.stringify({asOf,applicants:31,initialApplicants:30,lateAutumnApplicant:true,centers:summary,completed,cancelled,postponed,dateAloneDidNotComplete:true,originPreserved:true,businessHandlersReplaced:false,solver:'CURRENT_CP_SAT_SOURCE_SUBPROCESS',forecast:'NOT_CONFIGURED_TEST_BOUNDARY',operatingDataTouched:false,actualCadastralInput:false,paidCalls:0,actualSms:false,deviceCommands:false,events},null,2));
 }finally{vi.useRealTimers();solver.mockRestore()}
},600000);
