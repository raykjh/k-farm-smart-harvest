import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {aiBudgetDb} from '../lib/ai-budget-ledger';
import {VALIDATION_BUDGET_ID} from '../lib/ai-budget';
import {resetSubmissionJourney,journeyParcels} from '../tests/submission-journey-fixture';
import {fourCenterTestUrl,fixtureDay as day} from '../tests/four-center-fixture';
import type {State,Mission} from '../lib/types';

const enabled=process.env.KFARM_SUBMISSION_E2E==='1',live=process.env.KFARM_LIVE_AI_E2E==='1';
const operatingUrl='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
const origin='http://127.0.0.1:3100',folder='.data/verification/submission-journey';
const runId=process.env.KFARM_LIVE_RUN_ID??'offline';
test.skip(!enabled,'Explicit isolated submission journey required');
test.use({actionTimeout:15000});
test.beforeAll(async()=>{
 if(process.env.DATABASE_URL!==fourCenterTestUrl||process.env.AI_BUDGET_DATABASE_URL!==operatingUrl)throw Error('Disposable business DB and unchanged operating cost ledger required');
 if(!/^[a-z0-9-]{1,60}$/.test(runId)||live&&runId==='offline')throw Error('Unique paid run ID required');
 await mkdir(folder,{recursive:true});
 if(live)await writeFile(`${folder}/${runId}.started`,new Date().toISOString(),{flag:'wx'});
 await resetSubmissionJourney();
});

async function fingerprint(client:PrismaClient){
 const records=await client.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await client.center.findMany({orderBy:{id:'asc'}}),outbox=await client.outbox.findMany({orderBy:{id:'asc'}}),receipts=await client.receipt.findMany({orderBy:{id:'asc'}}),audit=await client.audit.findMany({orderBy:{id:'asc'}});
 return {hash:createHash('sha256').update(JSON.stringify({records,centers,outbox,receipts,audit})).digest('hex'),records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length};
}
async function ledger(){const d=aiBudgetDb();return {reserved:(await d.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,calls:await d.aiCall.count(),estimated:(await d.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0};}

test('UI intake -> joint plan -> staff approval -> incident reconsideration -> reservations and notices',async({page,context,playwright},info)=>{
 test.setTimeout(600000);
 const operating=new PrismaClient({datasourceUrl:operatingUrl}),errors:string[]=[],clients:APIRequestContext[]=[];
 const evidence:any={runId,live,startedAt:new Date().toISOString(),database:new URL(fourCenterTestUrl).pathname.slice(1),businessResponsesReplaced:false,externalParcelLookupControlled:true,syntheticCriteriaResourcesAndBorders:true,actualSms:false,physicalEquipmentCommands:false,steps:[]};
 evidence.before=await fingerprint(operating);evidence.budgetBefore=await ledger();
 async function session(centerId:string){const id=randomUUID(),token=randomBytes(32).toString('hex');
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'journey-'+id,name:centerId+' 검증 담당자',role:'CENTER_ADMIN',centerId,enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});return token;
 }
 const token=await session('demo'),ownerToken=await session('janggye');
 await context.addCookies([{name:'kfarm_session',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'}]);
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const owner=await playwright.request.newContext({baseURL:origin,extraHTTPHeaders:{origin,cookie:'kfarm_session='+ownerToken}});clients.push(owner);
 const post=async(path:string,data:unknown,client=page.request,code=200)=>{const r=await client.post(path,{data,headers:{origin}}),body=await r.json();expect(r.status(),JSON.stringify(body)).toBe(code);return body};
 const get=async(path:string,client=page.request)=>{const r=await client.get(path);expect(r.ok(),await r.text()).toBe(true);return r.json()};
 const labor=async(data:object,client=page.request)=>post('/api/labor-operations',{...data,version:(await get('/api/labor-operations',client)).version,requestId:randomUUID()},client);
 page.on('pageerror',e=>errors.push(e.message));
 try{
  // A session stored only in the disposable DB proves the HTTP target before writes.
  expect((await get('/api/workspace')).state.ruleVersion).toBe('SUBMISSION_JOURNEY_ISOLATED_V1');
  expect((await get('/api/workspace')).aiMode).toBe(live?'NEBIUS':'DEMO_RULES');
  const otherCentersBefore=await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}});
  await page.setViewportSize({width:1440,height:1050});await page.goto('/register');
  const form=page.getByTestId('field-registration');
  await form.getByLabel('이름',{exact:true}).fill('홍검증');await form.getByLabel('생년월일',{exact:true}).pressSequentially('19600101');
  await form.getByLabel('주소',{exact:true}).fill('계북면 격리 검증 주소');await form.getByLabel('연락처',{exact:true}).pressSequentially('00000000000');
  await form.getByRole('button',{name:'다음',exact:true}).click();await form.getByRole('button',{name:'소유농지 조회'}).click();
  // Only the external parcel lookup is fixture input; no business response is replaced.
  let parcel:typeof journeyParcels[number]=journeyParcels[0];
  await page.route('**/api/parcels?*',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('pnu')?{status:'READY',pnu:parcel.pnu,geometry:{type:'Polygon',coordinates:[[[127,35],[127.001,35],[127.001,35.001],[127,35.001],[127,35]]]}}:{status:'READY',items:[{pnu:parcel.pnu,address:parcel.address}]}}));
  for(const p of journeyParcels){parcel=p;await form.getByRole('button',{name:'지번으로 농지 추가'}).click();await form.getByLabel('지번 검색어').fill(p.address);
   await form.getByRole('button',{name:'브이월드 지번 검색'}).click();await form.getByRole('button',{name:'필지 선택',exact:true}).click();await form.getByRole('button',{name:'필지 초안에 추가'}).click();
   await form.getByLabel(p.address+' 작업면적',{exact:true}).fill(p.area);await form.getByLabel(p.address+' 토지형태',{exact:true}).selectOption(p.land);
  }
  await form.getByRole('button',{name:'선택 농지 저장'}).click();await form.getByRole('button',{name:'다음',exact:true}).click();
  await form.getByText('농지·기후 확인값',{exact:true}).click();
  for(const p of journeyParcels){const field=form.locator('article').filter({has:page.getByRole('heading',{name:p.address,exact:true})});
   await field.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
   await field.getByLabel('공부상 지목',{exact:true}).selectOption(p.land);
   await field.getByLabel('재배 환경',{exact:true}).selectOption('open_field');
   for(const label of ['용수 확보','작업 장비 진입','필수 인력 확보'])await field.getByLabel(label,{exact:true}).selectOption('yes');
   await field.getByLabel('배수',{exact:true}).selectOption('good');
   await field.getByLabel('검토 지역',{exact:true}).fill('계북면');
   for(const crop of ['쌀','감자','고추'])await field.getByLabel(crop+' · 지역·품종 적합성 검토',{exact:true}).selectOption((crop==='쌀')===(p.land==='paddy')?'suitable':'unsuitable');
   await field.getByLabel('확인일',{exact:true}).fill(new Date(Date.now()+9*3600000).toISOString().slice(0,10));
   await field.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill('격리 검증 가정. 실제 소유·토질·영농 적합성 확인이 아님.');
  }
  await form.getByRole('checkbox',{name:/정보 이용 및/}).check();
  const received=page.waitForResponse(r=>r.url().endsWith('/api/registrations')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'다음',exact:true}).click();const registration=await received,registered=await registration.json();
  expect(registration.status(),JSON.stringify(registered)).toBe(200);evidence.steps.push('Two fields entered through registration UI');
  await expect(page.getByRole('heading',{name:'신청완료',exact:true})).toBeVisible();
  expect((await post('/api/registrations',registration.request().postDataJSON())).consultationId).toBe(registered.consultationId);
  await page.goto('/?tab=fields&section=production');
  const panel=page.getByTestId('continuous-production'),joint=panel.getByRole('region',{name:'작물·자원 통합계획',exact:true});
  await expect(joint.getByRole('button',{name:'AI 통합계획',exact:true})).toBeVisible();
  expect((await ledger()).calls).toBe(evidence.budgetBefore.calls);
  const planned=page.waitForResponse(r=>r.url().endsWith('/api/integrated-planning')&&r.request().postDataJSON()?.action==='plan',{timeout:240000});
  await joint.getByRole('button',{name:live?'AI 통합계획':'계산 기준 확인',exact:true}).click();const planResponse=await planned,planBody=await planResponse.json();
  expect(planResponse.status(),JSON.stringify(planBody)).toBe(200);const draft=planBody.item;
  expect(draft.source).toBe(live?'NEBIUS':'RULES');expect(draft.selected.metrics.fields).toBe(2);expect(draft.selected.metrics.missingTasks).toBe(0);
  expect(draft.selected.status).toBe('REVIEW_READY');
  if(live){expect(draft.decision.contract).toBe('joint-crop-resources-v4');expect(draft.decision.evidenceOrigin).toBe('SERVER_METRIC_REFERENCES_V1');expect(draft.decision.usage.length).toBeGreaterThan(0)}
  expect(draft.selected.metrics.unassessedMarketFields).toBe(2);
  evidence.normal={source:draft.source,baseline:draft.baseline.metrics,selected:draft.selected.metrics,mix:draft.selected.mix,staffing:draft.selected.staffing,equipment:draft.selected.equipment,decision:draft.decision,tiedWithBaseline:JSON.stringify(draft.baseline.metrics)===JSON.stringify(draft.selected.metrics)};
  const callsAfterPlan=(await ledger()).calls;
  expect((await post('/api/integrated-planning',planResponse.request().postDataJSON())).item.requestId).toBe(draft.requestId);expect((await ledger()).calls).toBe(callsAfterPlan);
  expect(await db.workRecord.count({where:{kind:'cultivation'}})).toBe(0);expect(await db.outbox.count()).toBe(0);
  await joint.getByRole('tab',{name:'비교 결과',exact:true}).click();await page.screenshot({path:`${folder}/${runId}-normal-comparison.png`,fullPage:true});
  const staged=page.waitForResponse(r=>r.url().endsWith('/api/integrated-planning')&&r.request().postDataJSON()?.action==='stage');
  await joint.getByRole('button',{name:'센터 계획 검토 목록에 반영',exact:true}).click();const stageResponse=await staged;expect(stageResponse.status(),await stageResponse.text()).toBe(200);
  await expect(panel).toContainText(live?'AI 통합계획 검토안':'통합계획 계산 기준안');
  const boxes=panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true});await expect(boxes).toHaveCount(2);
  for(const b of await boxes.all())await b.check();await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
  const approved=page.waitForResponse(r=>r.url().endsWith('/api/continuous-production')&&r.request().postDataJSON()?.action==='approve');
  await panel.getByRole('button',{name:'선택 2필지 계획 일괄 확정',exact:true}).click();const approvalResponse=await approved,approval=await approvalResponse.json();expect(approvalResponse.status(),JSON.stringify(approval)).toBe(200);
  await expect(panel).toContainText('다음 재배 연결됨');expect((await post('/api/continuous-production',approvalResponse.request().postDataJSON())).alreadyApplied).toBe(true);
  await page.reload();await expect(page.getByTestId('continuous-production')).toContainText('누적 재배기록');
  expect((await ledger()).calls).toBe(callsAfterPlan);
  const normalRecords=await db.workRecord.groupBy({by:['kind'],where:{kind:{in:['cultivation','annualReservation','laborDemand','resourceReservation','productionApproval']}},_count:true});
  for(const kind of ['cultivation','annualReservation','laborDemand','resourceReservation','productionApproval'])expect(normalRecords.find(r=>r.kind===kind)?._count??0).toBeGreaterThan(0);
  expect(await db.workRecord.count({where:{kind:'cultivation'}})).toBe(2);expect(await db.outbox.count({where:{status:'RECORDED_ONLY'}})).toBeGreaterThan(0);expect(await db.outbox.count({where:{status:{in:['PENDING','DELIVERED']}}})).toBe(0);
  evidence.normal.persisted=normalRecords;evidence.normal.internalOwnerRecords=await db.outbox.count();evidence.steps.push('Joint plan staged and staff approved; cultivation, reservations, labor demand and internal records persisted; owner SMS disabled');
  await page.screenshot({path:`${folder}/${runId}-normal-approved.png`,fullPage:true});

  // Apply the incident to work created above, not a separately seeded mission.
  const normal=(await get('/api/workspace')).state as State;
  const harvest=normal.missions.find(m=>m.fieldId===journeyParcels[0].pnu&&(m as any).operationCode==='harvest')!;
  expect(harvest).toMatchObject({scheduledDate:day('10-01'),resourceId:'JB23CB01',ordinaryWorkers:1});
  const person=(name:string)=>({id:randomUUID(),name,birth:'1965-01-01',phone:'000-0000-0000',address:'격리 검증 주소',registeredFarmer:false,usesApp:false,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['harvest'],active:true});
  const absent=person('홍결석'),helper=person('홍지원');await labor({action:'person',testDataOnly:true,person:absent});await labor({action:'person',testDataOnly:true,person:helper},owner);
  await labor({action:'open',demandId:harvest.id,pay:'격리된 근무 조건',simpleWorkConfirmed:true});
  const job=(await get('/api/labor-operations')).payload.jobs.find((j:any)=>j.missionId===harvest.id&&j.status==='OPEN');
  await labor({action:'response',jobId:job.id,workerId:absent.id,response:'PHONE'});await labor({action:'absence',jobId:job.id,workerId:absent.id,reason:'참석 불가 확인'});
  const ownerState=(await get('/api/workspace',owner)).state as State,replacement=ownerState.machines.find(m=>m.id.includes('CB'))!.id;
  const offer={id:randomUUID(),version:0,machineId:replacement,borrowerCenterId:'demo',from:day('10-01'),to:day('10-01'),compatibleMachineIds:['JB23CB01'],outboundSlots:2,returnSlots:2,agreementRef:'ISOLATED_ACCEPTANCE_ONLY',conditions:'검증용 사전 공유 협약과 운송·운영자 확인',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};
  await post('/api/center-resources',{action:'sharingOffer',offer},owner);
  const supportId=randomUUID();await post('/api/labor-capacity',{action:'offer',requestId:supportId,rosterVersion:(await get('/api/labor-capacity',owner)).rosterVersion,window:{workerId:helper.id,borrowerCenterId:'demo',date:day('10-01'),startMinute:480,endMinute:960,travelMinutes:30,workCodes:['harvest'],response:'PHONE',consent:true,reason:'참석 의사 확인'}},owner);
  await post('/api/labor-capacity',{action:'confirm',id:supportId,version:1,requestId:randomUUID(),reason:'작업 및 이동시간 확인'});
  const beforeIncident=(await get('/api/workspace')).state as State;
  await openTask(page,harvest);
  const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('장비 문제');
  await modal.getByLabel('변경 희망일 (선택)',{exact:true}).fill(day('10-01'));
  await modal.getByLabel('입고일',{exact:true}).fill(day('10-01'));await modal.getByLabel('출고 예정일',{exact:true}).fill(day('10-08'));
  const changed=page.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='automatic',{timeout:180000});
  await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();const changeResponse=await changed,result=await changeResponse.json();
  expect(changeResponse.status(),JSON.stringify(result)).toBe(200);expect(result.status,JSON.stringify(result)).toBe('APPLIED');
  await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
  expect(await post('/api/replanning',changeResponse.request().postDataJSON())).toEqual(result);
  const receipt:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'automaticReplan',id:result.requestId}}})).payload;
  const stored:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'replanning',id:receipt.proposalId}}})).payload;
  expect(stored.status).toBe('APPLIED');expect(stored.decision.recommendation.source).toBe(live?'NEBIUS':'RULES');
  expect(stored.decision.recommendation.rationaleCheck.status).toBe('VERIFIED');
  const review:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'planningDecision',id:stored.decision.decisionId}}})).payload;
  const final=(await get('/api/workspace')).state as State,changedTask=final.missions.find(m=>m.id===harvest.id)!;
  expect(changedTask).toMatchObject({scheduledDate:harvest.scheduledDate,resourceId:replacement,laborSupportIds:[supportId]});
  expect(final.machines.find(m=>m.id===harvest.resourceId)?.downtimes).toContainEqual({machineId:harvest.resourceId,from:day('10-01'),returnOn:day('10-08')});
  expect(final.missions.some(m=>m.resourceId===harvest.resourceId&&m.scheduledDate!>=day('10-01')&&m.scheduledDate!<day('10-08'))).toBe(false);
  const changedIds=new Set(stored.result.diff.map((d:any)=>d.id));for(const m of beforeIncident.missions.filter(m=>!changedIds.has(m.id)))expect(final.missions.find(n=>n.id===m.id)).toEqual(m);
  expect(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})).toEqual(otherCentersBefore);
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:'plan:demo:'+harvest.id}}})).payload).toMatchObject({resourceId:replacement});
  const roster=(await get('/api/labor-operations')).payload,renewed=roster.jobs.find((j:any)=>j.replacesJobId===job.id);
  expect(roster.jobs.find((j:any)=>j.id===job.id).status).toBe('STALE');expect(renewed.responses).toEqual({});
  await post('/api/labor-sharing',{action:'offer',requestId:randomUUID(),version:(await get('/api/labor-operations',owner)).version,borrowerCenterId:'demo',jobId:renewed.id,sourceHash:renewed.sourceHash,workerId:helper.id,response:'PHONE',travelMinutes:30,distanceKm:5,consent:true},owner);
  expect((await get('/api/labor-operations')).payload.jobs.find((j:any)=>j.id===renewed.id).borrowedNames).toEqual([helper.name]);
  for(const client of [page.request,owner]){
   expect((await get('/api/labor-capacity',client)).notices.some((n:any)=>n.event==='PLAN_CHANGED')).toBe(true);
   expect((await get('/api/center-resources',client)).notices.some((n:any)=>n.event==='CONFIRMED')).toBe(true);
  }
  expect(await db.outbox.count({where:{id:{startsWith:'replan:'+receipt.proposalId+':'},status:'RECORDED_ONLY'}})).toBeGreaterThan(0);
  expect(await db.outbox.count({where:{status:'DELIVERED'}})).toBe(0);
  const sms=(await db.workRecord.findMany({where:{kind:'smsMessage'}})).map(r=>r.payload as any);
  expect(sms.length).toBeGreaterThan(0);expect(sms.every(m=>m.recipient.type==='WORKER'&&m.attempts===0)).toBe(true);
  evidence.incident={source:stored.decision.recommendation.source,baseline:review.baseline,recommendation:review.recommendation,alternatives:review.comparison.results.map((r:any)=>({id:r.id,status:r.status,metrics:r.metrics})),changes:result.changeRows,bothCenterNotices:true,attendanceReconfirmed:true,otherCenterPlansPreserved:true,unaffectedTasksPreserved:true,internalOwnerRecords:await db.outbox.count({where:{status:'RECORDED_ONLY'}}),workerSms:sms.map(m=>({status:m.status,attempts:m.attempts,category:m.category,recipientType:m.recipient.type}))};
  evidence.steps.push('Same registered crop: equipment breakdown and absence -> authorized adjacent machine and worker -> saved change -> attendance reconfirmed -> both-center notices and outbox');
  await page.screenshot({path:`${folder}/${runId}-incident-saved.png`,fullPage:true});
  await modal.getByRole('button',{name:'완료',exact:true}).click();await expect(modal).toHaveCount(0);
  await page.getByLabel('언어 / Language').selectOption('en');await page.setViewportSize({width:430,height:932});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:`${folder}/${runId}-schedule-mobile-en.png`,fullPage:true});
  expect(errors).toEqual([]);evidence.status='PASS';
 }catch(e){evidence.status='FAIL';evidence.error=e instanceof Error?e.message:String(e);throw e}
 finally{
  evidence.after=await fingerprint(operating);evidence.businessPreserved=evidence.before.hash===evidence.after.hash;
  evidence.budgetAfter=await ledger();evidence.newCalls=evidence.budgetAfter.calls-evidence.budgetBefore.calls;evidence.estimatedMicroUsd=evidence.budgetAfter.estimated-evidence.budgetBefore.estimated;evidence.reservedMicroUsd=evidence.budgetAfter.reserved-evidence.budgetBefore.reserved;evidence.pageErrors=errors;
  await writeFile(`${folder}/${runId}.json`,JSON.stringify(evidence,null,2),live?{flag:'wx'}:undefined);await info.attach('journey-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
  for(const client of clients)await client.dispose();await operating.$disconnect();
  expect(evidence.businessPreserved).toBe(true);expect(evidence.newCalls).toBeLessThanOrEqual(live?5:0);
  if(process.env.KFARM_JOURNEY_REQUIRE_EMPTY==='1')expect(evidence.budgetAfter.reserved).toBeLessThanOrEqual(4171458);
 }
});

async function openTask(page:Page,mission:Mission){
 await page.goto('/?tab=schedule');await page.getByLabel('일정 연도',{exact:true}).selectOption(mission.scheduledDate!.slice(0,4));
 await page.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:Number(mission.scheduledDate!.slice(5,7))+'월',exact:true}).click();
 const daily=page.getByTestId('schedule-day-'+mission.scheduledDate);if(await daily.getAttribute('open')===null)await daily.locator('summary').click();
 await daily.locator('tbody tr').filter({has:page.getByLabel('일괄 선택 '+mission.id,{exact:true})}).getByRole('button',{name:'관리',exact:true}).click();
}
