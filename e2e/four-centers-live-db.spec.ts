import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry} from '../lib/center-registry';
import {refreshAllCenters} from '../lib/production-sweep';
import {resetFourCenterFixture,fourCenterRegistration,fixtureDay as day} from '../tests/four-center-fixture';
test.skip(process.env.KFARM_CENTERS_E2E!=='1','Explicit isolated DB run required');
test.beforeAll(resetFourCenterFixture);
test('four desks: isolated intake, owner-approved loan, continuous planning, conflict, fault and notices',async({playwright,browser},info)=>{
 test.setTimeout(240000);const contexts:APIRequestContext[]=[];const tokens:Record<string,string>={},clients:Record<string,APIRequestContext>={};
 for(const c of centerRegistry){const id=randomUUID(),token=randomBytes(32).toString('hex');tokens[c.id]=token;await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'e2e-'+id,name:c.township+' 검증 담당자',centerId:c.id,role:'CENTER_ADMIN',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});const r=await playwright.request.newContext({baseURL:'http://127.0.0.1:3100',extraHTTPHeaders:{cookie:'kfarm_session='+token,origin:'http://127.0.0.1:3100'}});contexts.push(r);clients[c.id]=r;}
 const post=async(center:string,path:string,data:any)=>{const r=await clients[center].post(path,{data}),b=await r.json();expect(r.ok(),JSON.stringify(b)).toBe(true);return b};
 const get=async(center:string,path:string)=>{const r=await clients[center].get(path);expect(r.ok()).toBe(true);return r.json()};
 const calls=await db.aiCall.count();
 const consultationId=randomUUID(); // Identical key intentionally tests tenant-scoped storage.
 try{
  for(const [i,c] of centerRegistry.entries()){
   const input=fourCenterRegistration(i,consultationId),pnu=input.consultation.fields[0].pnu;
   await post(c.id,'/api/registrations',input);
   const listed=await get(c.id,'/api/fields?workspace=operations&centerId=demo');expect(listed.payload).toHaveLength(1);expect(listed.payload[0].pnu).toBe(pnu);
   const own=await get(c.id,`/api/consultations?id=${consultationId}`);expect(own.payload.farmer.name).toBe(`홍검${['가','나','다','라'][i]}`);
  }
  const initial=(await post('janggye','/api/continuous-production',{action:'refresh'})).view;expect(initial.items[0].status).not.toBe('REVIEW');
  const loan={id:randomUUID(),version:0,machineId:'JB23TR01',ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:day('05-01'),usableUntil:day('05-31'),status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
  await post('janggye','/api/center-resources',loan);
  expect((await clients.janggye.post('/api/center-resources',{data:{...loan,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true}})).status()).toBe(409);
  expect((await clients.demo.post('/api/center-resources',{data:{...loan,version:1,status:'CONFIRMED'}})).status()).toBe(409);
  // Ownership checks and confirmation are exercised through the actual web form.
  const bc=await browser.newContext({extraHTTPHeaders:{origin:'http://127.0.0.1:3100'}});await bc.addCookies([{name:'kfarm_session',value:tokens.demo,domain:'127.0.0.1',path:'/'}]);const page=await bc.newPage();await page.goto('http://127.0.0.1:3100/reservations');
  const sharing=page.getByTestId('center-sharing');await sharing.getByLabel('운영담당자 확보',{exact:true}).check();await sharing.getByLabel('운송·복귀 확인',{exact:true}).check();await sharing.getByRole('button',{name:'대여 승인',exact:true}).click();await expect(sharing).toContainText('저장했습니다');
  await page.screenshot({path:info.outputPath('four-center-sharing.png'),fullPage:true});await bc.close();
  const conflict={...loan,id:randomUUID(),borrowerCenterId:'cheoncheon'};await post('cheoncheon','/api/center-resources',conflict);
  expect((await clients.demo.post('/api/center-resources',{data:{...conflict,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true}})).status()).toBe(409);
  expect((await refreshAllCenters()).every(c=>c.status==='REFRESHED')).toBe(true);
  const draftRows=await db.workRecord.findMany({where:{kind:'continuousProduction'}});expect(draftRows).toHaveLength(4);
  await refreshAllCenters();expect(await db.workRecord.findMany({where:{kind:'continuousProduction'}})).toEqual(draftRows);
  for(const c of centerRegistry){const p=(await post(c.id,'/api/continuous-production',{action:'refresh'})).view;expect(p.items[0].status,JSON.stringify(p.items)).toBe('REVIEW');const applied=await post(c.id,'/api/continuous-production',{action:'approve',requestId:randomUUID(),fingerprint:p.fingerprint,pnus:[p.items[0].pnu],provisionalAcknowledged:true});expect(applied.assigned).toBe(8);}
  const borrower=await get('janggye','/api/workspace');expect(borrower.state.missions.some((m:any)=>m.resourceId==='JB23TR01')).toBe(true);expect(borrower.state.fields).toHaveLength(1);
  const otherBefore=await db.center.findUniqueOrThrow({where:{id:'gyenam'}});
  expect((await clients.demo.post('/api/center-resources',{data:{...loan,version:2,status:'CANCELLED'}})).status()).toBe(409);
  const fault=await post('demo','/api/center-resources',{action:'failure',machineId:'JB23TR01',from:day('05-01')});expect(fault.impacts.map((x:any)=>x.centerId)).toContain('janggye');
  const after=await get('janggye','/api/workspace');expect(after.state.missions.filter((m:any)=>m.resourceId==='JB23TR01').every((m:any)=>m.status==='HELD')).toBe(true);
  expect(await db.center.findUniqueOrThrow({where:{id:'gyenam'}})).toEqual(otherBefore);
  // A newly registered center (not the legacy DEMO_BATCH) receives the same
  // weather-event / comparison / approval path. Ground work must stay in place.
  const beforeWind=await get('cheoncheon','/api/workspace'),windDay=day('07-01');
  const wind=await post('cheoncheon','/api/incidents',{id:randomUUID(),kind:'WIND',day:windDay});
  expect(wind.status,JSON.stringify(wind)).toBe('FEASIBLE');expect(wind.ids).toHaveLength(1);expect(wind.unchanged.length).toBeGreaterThan(0);
  const comparison=await post('cheoncheon','/api/replanning',{action:'compare',ids:wind.ids,day:windDay,reason:'강풍으로 드론 작업 이동',simulation:{kind:'WIND',from:windDay,to:windDay},alternatives:[{id:'preserve',label:'유지',scope:'PRESERVE'},{id:'balanced',label:'일정 조정'}]});
  expect(comparison.recommendation).toMatchObject({source:'RULES',inferenceCalled:false,approval:'REQUIRED',reserved:false});
  const option=comparison.results.find((r:any)=>r.id===comparison.recommendation.alternativeId);
  expect((await clients.gyenam.post('/api/replanning',{data:option.previewRequest})).status()).toBe(409);
  expect((await clients.cheoncheon.post('/api/replanning',{data:{...option.previewRequest,preferred:day('07-04')}})).status()).toBe(409);
  const selected=await post('cheoncheon','/api/replanning',option.previewRequest);await post('cheoncheon','/api/replanning',{action:'approve',proposalId:selected.proposalId});
  const afterWind=await get('cheoncheon','/api/workspace');
  for(const id of wind.unchanged)expect(afterWind.state.missions.find((m:any)=>m.id===id)).toEqual(beforeWind.state.missions.find((m:any)=>m.id===id));
  expect(afterWind.state.missions.find((m:any)=>m.id===wind.ids[0]).scheduledDate>windDay).toBe(true);
  const audit=await db.audit.findFirstOrThrow({where:{centerId:'cheoncheon',action:'annualReplan.approve'},orderBy:{createdAt:'desc'}});
  expect((audit.detail as any).decision.decisionId).toBe(comparison.decisionId);
  const rainBefore=await get('demo','/api/workspace');
  const rain=await post('demo','/api/incidents',{id:randomUUID(),kind:'RAIN',day:windDay});
  expect(rain.status,JSON.stringify(rain)).toBe('FEASIBLE');expect(rain.ids).toHaveLength(1);
  await post('demo','/api/replanning',{action:'approve',proposalId:rain.proposalId});
  const rainAfter=await get('demo','/api/workspace');
  expect(rainAfter.state.missions.find((m:any)=>m.id===rain.ids[0]).scheduledDate>windDay).toBe(true);
  for(const id of rain.unchanged)expect(rainAfter.state.missions.find((m:any)=>m.id===id)).toEqual(rainBefore.state.missions.find((m:any)=>m.id===id));
  const droughtBefore=await db.center.findUniqueOrThrow({where:{id:'gyenam'}});
  expect((await post('gyenam','/api/incidents',{id:randomUUID(),kind:'DROUGHT',day:windDay})).status).toBe('REVIEW_REQUIRED');
  expect(await db.center.findUniqueOrThrow({where:{id:'gyenam'}})).toEqual(droughtBefore);
  // Named attendance (not pooled capacity) is required before personnel are assigned.
  const labor=async(data:any)=>{const current=await get('gyenam','/api/labor-operations');return post('gyenam','/api/labor-operations',{...data,version:current.version,requestId:randomUUID()})};
  const people=[{id:randomUUID(),name:'홍먼길',distance:2},{id:randomUUID(),name:'홍가까',distance:0.4}];
  for(const p of people)await labor({action:'person',testDataOnly:true,person:{id:p.id,name:p.name,birth:'1965-01-01',phone:'000-0000-0000',address:'계남면 격리 입력',registeredFarmer:false,usesApp:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['*'],active:true}});
  const demand=(await get('gyenam','/api/labor-operations')).demands.find((d:any)=>d.task.includes('종자'));
  await labor({action:'open',demandId:demand.id,pay:'검증용 조건',simpleWorkConfirmed:true});
  const job=(await get('gyenam','/api/labor-operations')).payload.jobs.find((j:any)=>j.missionId===demand.id);
  for(const p of people){await labor({action:'distance',jobId:job.id,workerId:p.id,distanceKm:p.distance});await labor({action:'response',jobId:job.id,workerId:p.id,response:'PHONE'})}
  expect((await get('gyenam','/api/labor-operations')).payload.jobs.find((j:any)=>j.id===job.id).assigned).toEqual([people[1].id]);
  const next=new Date(Date.parse(demand.date)+86400000).toISOString().slice(0,10);
  const move=await post('gyenam','/api/replanning',{action:'compare',ids:[demand.id],preferred:next,reason:'일정 변경 참석 재확인',alternatives:[{id:'preserve',label:'보존',scope:'PRESERVE'}]});
  const laborReview=await post('gyenam','/api/replanning',move.results[0].previewRequest);await post('gyenam','/api/replanning',{action:'approve',proposalId:laborReview.proposalId});
  const changedLabor=(await get('gyenam','/api/labor-operations')).payload,renewed=changedLabor.jobs.find((j:any)=>j.replacesJobId===job.id);
  expect(renewed.date).toBe(next);expect(renewed.assigned).toEqual([]);expect(changedLabor.notices.filter((n:any)=>n.jobId===renewed.id&&n.type==='RECONFIRM')).toHaveLength(2);
  await labor({action:'response',jobId:renewed.id,workerId:people[1].id,response:'APP'});
  expect((await get('gyenam','/api/labor-operations')).payload.jobs.find((j:any)=>j.id===renewed.id).assigned).toEqual([people[1].id]);
  for(const c of centerRegistry)expect((await get(c.id,'/api/workspace')).state.missions.find((m:any)=>m.id==='past-record')).toMatchObject({scheduledDate:'2026-01-02',status:'COMPLETED'});
  const otherBeforeReplacement=await db.center.findUniqueOrThrow({where:{id:'gyenam'}});
  const replacement={...loan,id:randomUUID(),machineId:'JSCCTR02',ownerCenterId:'cheoncheon',usableFrom:day('05-18')};
  await post('janggye','/api/center-resources',replacement);await post('cheoncheon','/api/center-resources',{...replacement,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true});
  const task=after.state.missions.find((m:any)=>m.resourceId==='JB23TR01');
  const choices=await post('janggye','/api/replanning',{action:'compare',ids:[task.id],preferred:day('05-18'),reason:'대체 장비 도착 후 재배정',replacement:{failedId:'JB23TR01',replacementId:'JSCCTR02',availableFrom:day('05-18'),availableUntil:day('05-31'),arrivalConfirmed:true,compatibilityConfirmed:true,note:'격리 검증의 확인 입력'},alternatives:[{id:'existing',label:'현재 장비',replacement:'NONE'},{id:'replacement',label:'확인된 대체 장비',replacement:'REQUESTED'}]});
  expect(choices.results[0].status).toBe('NO_FEASIBLE_PLAN');expect(choices.recommendation.alternativeId).toBe('replacement');
  const revised=await post('janggye','/api/replanning',choices.results[1].previewRequest);
  expect(revised.status,JSON.stringify(revised)).toBe('FEASIBLE');await post('janggye','/api/replanning',{action:'approve',proposalId:revised.proposalId});
  const resumed=(await get('janggye','/api/workspace')).state.missions.find((m:any)=>m.id===task.id);expect(resumed.resourceId).toBe('JSCCTR02');expect(resumed.scheduledDate>=day('05-18')).toBe(true);expect(resumed.status).toBe('PLANNED');
  expect(await db.center.findUniqueOrThrow({where:{id:'gyenam'}})).toEqual(otherBeforeReplacement);
  // Close the old loan through the actual review dialog after replacement moved its booking.
  const loanBrowser=await browser.newContext({extraHTTPHeaders:{origin:'http://127.0.0.1:3100'}});
  try{
   await loanBrowser.addCookies([{name:'kfarm_session',value:tokens.janggye,domain:'127.0.0.1',path:'/'}]);
   const loanPage=await loanBrowser.newPage();await loanPage.goto('http://127.0.0.1:3100/reservations');
   const panel=loanPage.getByTestId('center-sharing'),row=panel.locator('tbody tr').filter({hasText:'JB23TR01'});
   await row.getByRole('button',{name:'대여 관리',exact:true}).click();
   const dialog=loanPage.getByRole('dialog',{name:'대여 관리'});await dialog.getByLabel('처리 사유',{exact:true}).fill('대체 장비 배차 완료 후 기존 대여 취소');
   await dialog.getByRole('button',{name:'연결 작업·예약 확인',exact:true}).click();
   await expect(dialog.getByTestId('loan-impact')).toContainText('조정이 필요한 작업 0');
   await dialog.getByRole('button',{name:'확인한 내용 저장',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(row).toContainText('취소');
   await panel.getByTestId('center-resource-notices').locator('summary').click();
   const notice=panel.getByTestId('center-resource-notices').locator('article').filter({hasText:'대여 취소 · JB23TR01'});
   await notice.getByRole('button',{name:'안내 확인',exact:true}).click();await expect(notice).toContainText('센터 확인 완료');
   const ownerInbox=await get('demo','/api/center-resources');expect(ownerInbox.notices.find((n:any)=>n.loanId===loan.id&&n.event==='CANCELLED').acknowledgedAt).toBeNull();
   await loanPage.screenshot({path:info.outputPath('loan-cancel-and-center-notices.png'),fullPage:true});
  }finally{await loanBrowser.close()}
  // Delivery uses the same persisted outbox. No external SMS or paid inference.
  for(const c of centerRegistry){await post(c.id,'/api/operations',{action:'deliver',key:randomUUID()});const live=await get(c.id,'/api/workspace');expect(live.notices.length).toBeGreaterThan(0);expect(live.notices.every((n:any)=>['DELIVERED','SUPERSEDED'].includes(n.status))).toBe(true);expect(live.notices.some((n:any)=>n.status==='DELIVERED')).toBe(true);expect(live.state.fields).toHaveLength(1);}
  expect(await db.aiCall.count()).toBe(calls);
  await info.attach('four-center-evidence',{body:JSON.stringify({database:'kfarm_centers_e2e',centers:4,newCultivations:4,plannedTasks:32,priorCompletedPreserved:4,sharedLoanAndReplacement:true,newCenterWindAndGroundIsolation:true,laborReconfirmation:true,decisionAuditLinked:true,paidInference:false,externalSms:false}),contentType:'application/json'});
 }finally{for(const c of contexts)await c.dispose()}
});
