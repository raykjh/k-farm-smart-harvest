import {it,expect,beforeAll,vi} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {resetFourCenterFixture,fourCenterRegistration,fixtureDay as day} from './four-center-fixture';
import {refreshAllCenters} from '../lib/production-sweep';
// Isolate only external forecasts. Business handlers, PostgreSQL and solver are real.
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'TEST'})}));
import {POST as register} from '../app/api/registrations/route';
import {GET as fields} from '../app/api/fields/route';
import {GET as consultation} from '../app/api/consultations/route';
import {GET as workspace} from '../app/api/workspace/route';
import {POST as production} from '../app/api/continuous-production/route';
import {POST as resources} from '../app/api/center-resources/route';
import {GET as readResources} from '../app/api/center-resources/route';
import {POST as replan} from '../app/api/replanning/route';
import {POST as incident} from '../app/api/incidents/route';
import {GET as readLabor,POST as labor} from '../app/api/labor-operations/route';
import {POST as operations} from '../app/api/operations/route';

const sessions:Record<string,string>={};
type Handler=(request:NextRequest)=>Promise<Response>;
const call=(center:string,handler:Handler,data?:unknown,query='')=>handler(new NextRequest('http://127.0.0.1:3100/api/verification'+query,{method:data===undefined?'GET':'POST',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+sessions[center],'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}));
async function ok(center:string,handler:Handler,data?:unknown,query=''){
 const response=await call(center,handler,data,query),body=await response.json();
 expect(response.status,JSON.stringify(body)).toBe(200);return body;
}
async function laborAction(data:unknown){
 const current=await ok('gyenam',readLabor);return ok('gyenam',labor,{...data as object,version:current.version,requestId:randomUUID()});
}
beforeAll(async()=>{
 await resetFourCenterFixture();
 for(const c of centerRegistry){
  const id=randomUUID(),token=randomBytes(32).toString('hex');sessions[c.id]=token;
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'integration-'+id,name:c.township+' 검증 담당자',centerId:c.id,role:'CENTER_ADMIN',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
 }
});

it('four centers use the shared engine through intake, approval, loans, weather/fault changes, attendance and final outbox',async()=>{
 const initialAiCalls=await db.aiCall.count(),consultationId=randomUUID();
 for(const [index,c] of centerRegistry.entries()){
  const input=fourCenterRegistration(index,consultationId);
  const receipt=await ok(c.id,register,input);
  expect((await ok(c.id,register,input)).consultationId).toBe(receipt.consultationId);
  const listed=await ok(c.id,fields,undefined,'?workspace=operations&centerId=demo');
  expect(listed.payload).toHaveLength(1);expect(listed.payload[0].pnu).toBe(input.consultation.fields[0].pnu);
  expect((await ok(c.id,consultation,undefined,'?id='+consultationId)).payload.farmer.name).toBe(input.consultation.farmer.name);
 }
 expect((await ok('janggye',production,{action:'refresh'})).view.items[0].status).not.toBe('REVIEW');
 const loan={id:randomUUID(),version:0,machineId:'JB23TR01',ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:day('05-01'),usableUntil:day('05-31'),status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
 await ok('janggye',resources,loan);
 expect((await call('janggye',resources,{...loan,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true})).status).toBe(409);
 expect((await call('demo',resources,{...loan,version:1,status:'CONFIRMED'})).status).toBe(409);
 await ok('demo',resources,{...loan,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true});
 const conflict={...loan,id:randomUUID(),borrowerCenterId:'cheoncheon'};await ok('cheoncheon',resources,conflict);
 expect((await call('demo',resources,{...conflict,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true})).status).toBe(409);
 expect((await refreshAllCenters()).every(c=>c.status==='REFRESHED')).toBe(true);
 const pending=await db.workRecord.findMany({where:{kind:'continuousProduction'},orderBy:{workspace:'asc'}});
 await refreshAllCenters();expect(await db.workRecord.findMany({where:{kind:'continuousProduction'},orderBy:{workspace:'asc'}})).toEqual(pending);
 for(const c of centerRegistry){
  const view=(await ok(c.id,production,{action:'refresh'})).view;expect(view.items[0].status,JSON.stringify(view.items)).toBe('REVIEW');
  expect(view.items[0].proposal.dispatch.engineVersion).toBe('shared-schedule-v1');
  const request={action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[view.items[0].pnu],provisionalAcknowledged:true};
  expect((await ok(c.id,production,request)).assigned).toBe(8);
  expect((await ok(c.id,production,request)).alreadyApplied).toBe(true);
  const state=(await ok(c.id,workspace)).state;expect(state.fields).toHaveLength(1);expect(state.missions).toHaveLength(9);
  expect(await db.workRecord.count({where:{workspace:recordSpace(c.id),kind:'cultivation'}})).toBe(1);
 }
 const beforeWind=(await ok('cheoncheon',workspace)).state,windDay=day('07-01');
 const wind=await ok('cheoncheon',incident,{id:randomUUID(),kind:'WIND',day:windDay});expect(wind.status,JSON.stringify(wind)).toBe('FEASIBLE');expect(wind.ids).toHaveLength(1);
 const compared=await ok('cheoncheon',replan,{action:'compare',ids:wind.ids,day:windDay,reason:'강풍 드론 작업 이동',simulation:{kind:'WIND',from:windDay,to:windDay},alternatives:[{id:'preserve',label:'빈자리',scope:'PRESERVE'},{id:'expand',label:'관련 일정',scope:'EXPAND'}]});
 expect(compared.recommendation).toMatchObject({source:'RULES',inferenceCalled:false,approval:'REQUIRED',reserved:false});
 const candidate=compared.results.find((r:any)=>r.id===compared.recommendation.alternativeId);
 expect((await call('gyenam',replan,candidate.previewRequest)).status).toBe(409);
 const selected=await ok('cheoncheon',replan,candidate.previewRequest);expect(selected.contractVersion).toBe('shared-schedule-v1');
 await ok('cheoncheon',replan,{action:'approve',proposalId:selected.proposalId});
 const afterWind=(await ok('cheoncheon',workspace)).state;
 expect(afterWind.missions.find((m:any)=>m.id===wind.ids[0]).scheduledDate>windDay).toBe(true);
 for(const id of wind.unchanged)expect(afterWind.missions.find((m:any)=>m.id===id)).toEqual(beforeWind.missions.find((m:any)=>m.id===id));

 // Only confirmed named people can fill the demand; a change invalidates attendance.
 const people=[{id:randomUUID(),name:'홍먼길',distance:2},{id:randomUUID(),name:'홍가까',distance:0.4}];
 for(const p of people)await laborAction({action:'person',testDataOnly:true,person:{id:p.id,name:p.name,birth:'1965-01-01',phone:'000-0000-0000',address:'계남면 검증용',registeredFarmer:false,usesApp:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['*'],active:true}});
 const demand=(await ok('gyenam',readLabor)).demands.find((d:any)=>d.task.includes('종자'));
 await laborAction({action:'open',demandId:demand.id,pay:'검증용 조건',simpleWorkConfirmed:true});
 const job=(await ok('gyenam',readLabor)).payload.jobs.find((j:any)=>j.missionId===demand.id);
 for(const p of people){await laborAction({action:'distance',jobId:job.id,workerId:p.id,distanceKm:p.distance});await laborAction({action:'response',jobId:job.id,workerId:p.id,response:'PHONE'});}
 expect((await ok('gyenam',readLabor)).payload.jobs.find((j:any)=>j.id===job.id).assigned).toEqual([people[1].id]);
 const next=new Date(Date.parse(demand.date)+86400000).toISOString().slice(0,10);
 const move=await ok('gyenam',replan,{action:'compare',ids:[demand.id],preferred:next,reason:'참석 재확인',alternatives:[{id:'preserve',label:'빈자리',scope:'PRESERVE'}]});
 const change=await ok('gyenam',replan,move.results[0].previewRequest);await ok('gyenam',replan,{action:'approve',proposalId:change.proposalId});
 const changed=(await ok('gyenam',readLabor)).payload,renewed=changed.jobs.find((j:any)=>j.replacesJobId===job.id);
 expect(renewed.date).toBe(next);expect(renewed.assigned).toEqual([]);expect(changed.notices.filter((n:any)=>n.jobId===renewed.id&&n.type==='RECONFIRM')).toHaveLength(2);
 expect((await call('gyenam',labor,{action:'response',jobId:job.id,workerId:people[1].id,response:'APP',version:(await ok('gyenam',readLabor)).version,requestId:randomUUID()})).status).toBe(409);
 await laborAction({action:'response',jobId:renewed.id,workerId:people[1].id,response:'APP'});
 expect((await ok('gyenam',readLabor)).payload.jobs.find((j:any)=>j.id===renewed.id).assigned).toEqual([people[1].id]);

 // Keep admitting owners after approvals and an earlier weather/personnel change.
 // Later registrations must never overwrite the first owner's plan or attendance.
 for(let n=0;n<2;n++){
  const before=(await ok('gyenam',workspace)).state,inventory=await ok('gyenam',fields);
  const input=fourCenterRegistration(3,randomUUID());input.fieldVersion=inventory.version;
  input.consultation.farmer.name=n?'홍누나':'홍누가';input.consultation.fields[0].pnu='527403602311098000'+n;
  input.consultation.fields[0].address='계남면 순차 검증 '+n;
  const registered=await ok('gyenam',register,input);expect(registered.fields).toBe(1);
  const view=(await ok('gyenam',production,{action:'refresh'})).view,item=view.items.find((i:any)=>i.pnu===input.consultation.fields[0].pnu);
  expect(item.status,JSON.stringify(item)).toBe('REVIEW');
  const batch=await ok('gyenam',production,{action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[item.pnu],provisionalAcknowledged:true});expect(batch.assigned).toBe(8);
  const after=(await ok('gyenam',workspace)).state;expect(after.fields).toHaveLength(n+2);
  for(const mission of before.missions)expect(after.missions.find((m:any)=>m.id===mission.id)).toEqual(mission);
  expect(after.missions.filter((m:any)=>m.resourceId).every((m:any)=>m.operatorIds?.length===1)).toBe(true);
 }
 const remoteBefore=await db.center.findUniqueOrThrow({where:{id:'gyenam'}});
 const fault=await ok('demo',resources,{action:'failure',machineId:'JB23TR01',from:day('05-01'),expectedRepairOn:day('05-08')});expect(fault.impacts.map((c:any)=>c.centerId)).toContain('janggye');
 const held=(await ok('janggye',workspace)).state.missions.find((m:any)=>m.resourceId==='JB23TR01');expect(held.status).toBe('HELD');
 const replacement={...loan,id:randomUUID(),machineId:'JSCCTR02',ownerCenterId:'cheoncheon',usableFrom:day('05-18')};
 await ok('janggye',resources,replacement);await ok('cheoncheon',resources,{...replacement,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true});
 const choices=await ok('janggye',replan,{action:'compare',ids:[held.id],preferred:day('05-18'),reason:'대체 장비 도착 후 재배정',replacement:{failedId:'JB23TR01',replacementId:'JSCCTR02',availableFrom:day('05-18'),availableUntil:day('05-31'),arrivalConfirmed:true,compatibilityConfirmed:true,note:'격리 검증 확인값'},alternatives:[{id:'existing',label:'현재 장비',replacement:'NONE'},{id:'replacement',label:'확인된 대체 장비',replacement:'REQUESTED'}]});
 expect(choices.results[0].status).toBe('NO_FEASIBLE_PLAN');expect(choices.recommendation.alternativeId).toBe('replacement');
 const revised=await ok('janggye',replan,choices.results[1].previewRequest);await ok('janggye',replan,{action:'approve',proposalId:revised.proposalId});
 const restored=(await ok('janggye',workspace)).state.missions.find((m:any)=>m.id===held.id);
 expect(restored.resourceId).toBe('JSCCTR02');expect(restored.scheduledDate>=day('05-18')).toBe(true);expect(restored.status).toBe('PLANNED');
 expect(restored.operatorIds).toEqual(held.operatorIds);
 expect(await db.center.findUniqueOrThrow({where:{id:'gyenam'}})).toEqual(remoteBefore);
 // The old loan may close only after its job and booking move to the replacement.
 const closing={id:loan.id,version:2,operation:'CANCEL',reason:'대체 장비로 재배정하여 기존 대여 종료'};
 const loanReview=await ok('janggye',resources,{action:'previewLoan',...closing});expect(loanReview.blockers).toEqual([]);
 const closeCommand={action:'manageLoan',...closing,reviewToken:loanReview.token,requestId:randomUUID()};
 expect((await ok('janggye',resources,closeCommand)).loan.status).toBe('CANCELLED');
 expect((await ok('janggye',resources,closeCommand)).alreadyApplied).toBe(true);
 for(const id of ['demo','janggye'])expect((await ok(id,readResources)).notices.some((n:any)=>n.loanId===loan.id&&n.event==='CANCELLED')).toBe(true);
 const noticeId=`loan:${loan.id}:3`;
 expect((await call('gyenam',resources,{action:'ackNotice',id:noticeId})).status).toBe(409);
 await ok('demo',resources,{action:'ackNotice',id:noticeId});
 expect((await ok('janggye',readResources)).notices.find((n:any)=>n.id===noticeId).acknowledgedAt).toBeNull();
 for(const c of centerRegistry){
  await ok(c.id,operations,{action:'deliver',key:randomUUID()});
  const live=await ok(c.id,workspace);expect(live.notices.some((n:any)=>n.status==='DELIVERED')).toBe(true);expect(live.notices.every((n:any)=>['DELIVERED','SUPERSEDED'].includes(n.status))).toBe(true);
  expect(live.state.missions.find((m:any)=>m.id==='past-record')).toMatchObject({status:'COMPLETED',scheduledDate:'2026-01-02'});
  expect((await ok(c.id,operations,{action:'deliver',key:randomUUID()})).result.delivered).toBe(0);
 }
 expect(await db.aiCall.count()).toBe(initialAiCalls);
});
