import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry} from '../lib/center-registry';
import {fixtureDay as day} from '../tests/four-center-fixture';
import {resetModelFreeOperationsFixture,modelFreeRegistration,spareHarvester} from '../tests/model-free-operations-fixture';
import type {State,Mission} from '../lib/types';
import {aiBudgetDb} from '../lib/ai-budget-ledger';
const slotDate=(slot:number)=>new Date(Date.UTC(2026,0,1+Math.floor(slot/32))).toISOString().slice(0,10);
const comparisonRun=process.env.KFARM_COMPARISON_E2E==='1';
const live=process.env.KFARM_LIVE_AI_E2E==='1';
if(live&&(!comparisonRun||process.env.AI_BUDGET_DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'))throw Error('Live comparison requires the existing shared cost ledger');

// Input fixtures only: no substitute business responses, direct mission seeding,
// post-incident capacity increase, paid inference, SMS or equipment commands.
test.skip(process.env.KFARM_CENTERS_E2E!=='1','Explicit disposable four-center DB run required');
test.use({actionTimeout:15000});
test.beforeAll(async()=>{
 if(live){
  const run=process.env.KFARM_LIVE_RUN_ID;
  if(!run||!/^[a-z0-9-]{1,60}$/.test(run))throw Error('Explicit unique live run ID required');
  const folder='.data/validation/20261011-submission-run';await mkdir(folder,{recursive:true});
  await writeFile(`${folder}/four-center-${run}.started`,new Date().toISOString(),{flag:'wx'});
 }
 await resetModelFreeOperationsFixture();
});

test('new four-center intakes survive combined failure and absence through approval, reconfirmation and local delivery',async({playwright,browser},info)=>{
 test.setTimeout(600000);
 const clients:Record<string,APIRequestContext>={},tokens:Record<string,string>={},pages:BrowserContext[]=[];
 const errors:string[]=[];
 const calls=await db.aiCall.count();
 const ledgerBefore=live?await aiBudgetDb().aiCall.count():0;
 const comparisons:any[]=[];
 for(const c of centerRegistry){
  const id=randomUUID(),token=randomBytes(32).toString('hex');tokens[c.id]=token;
  await db.workRecord.create({data:{...authKey('user',id),payload:{id,username:'acceptance-'+id,name:c.township+' 검증 담당자',role:'CENTER_ADMIN',centerId:c.id,enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
  await db.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}});
  clients[c.id]=await playwright.request.newContext({baseURL:'http://127.0.0.1:3100',extraHTTPHeaders:{cookie:'kfarm_session='+token,origin:'http://127.0.0.1:3100'}});
 }
 const post=async(c:string,path:string,data:unknown,code=200)=>{const r=await clients[c].post(path,{data}),body=await r.json();expect(r.status(),JSON.stringify(body)).toBe(code);return body};
 const get=async(c:string,path:string)=>{const r=await clients[c].get(path);expect(r.ok(),await r.text()).toBe(true);return r.json()};
 const labor=async(c:string,data:object,code=200)=>post(c,'/api/labor-operations',{...data,version:(await get(c,'/api/labor-operations')).version,requestId:randomUUID()},code);
 const open=async(c:string,path:string)=>{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});pages.push(ctx);
  await ctx.addCookies([{name:'kfarm_session',value:tokens[c],domain:'127.0.0.1',path:'/'}]);
  // Prevent browser-side external calls. All localhost business responses are real.
  await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:3100'+path);return page;
 };
 const evidence:Record<string,unknown>={database:'kfarm_centers_e2e',businessApiResponsesReplaced:false,paidInference:live,actualSms:false,hardwareCommands:false,comparisons};
 const capture=async(label:string,data:any,state:State)=>{
  expect(data.recommendation.source).toBe(live?'NEBIUS':'RULES');
  expect(data.recommendation.approval).toBe('REQUIRED');expect(data.reserved).toBe(false);
  expect(data.recommendation.rationaleCheck.status).toBe('VERIFIED');
  expect(data.recommendation.rationaleCheck.source).toBe(live?'MODEL':'RULES');
  const measure=(id:string)=>{const r=data.results.find((r:any)=>r.id===id);expect(r,JSON.stringify(data.results.map((v:any)=>({id:v.id,status:v.status,reason:v.reason})))).toBeTruthy();expect(r.status).toBe('FEASIBLE');
   const assignments=r.result.assignments,ids=new Set(r.previewRequest.ids);
   const selected=assignments.filter((a:any)=>ids.has(a.id));
   const windowViolations=selected.filter((a:any)=>{const w=(state.missions.find(m=>m.id===a.id) as any)?.planningWindow;return w&&(slotDate(a.start)<w.from||slotDate(a.start)>w.to)}).length;
   expect(windowViolations).toBe(0);expect(selected.length).toBe(ids.size);
   const loans=r.result.diff.filter((d:any)=>{const owner=state.machines.find(m=>m.id===d.afterResource)?.ownerCenterId;return owner&&owner!==(label.startsWith('compound')?'demo':label==='normal-intake'?'cheoncheon':'gyenam')});
   return {...r.metrics,workWindowViolations:windowViolations,unassigned:ids.size-selected.length,borrowedEquipmentTasks:loans.length};};
  comparisons.push({case:label,snapshot:data.snapshot,operatorPriority:data.results.find((r:any)=>r.previewRequest)?.previewRequest.decisionPriority,baseline:data.baseline,ai:data.recommendation,ruleMetrics:measure(data.baseline.alternativeId),aiMetrics:measure(data.recommendation.alternativeId),alternatives:data.results.map((r:any)=>({id:r.id,status:r.status,metrics:r.metrics}))});
  await writeFile(info.outputPath('comparison-progress.json'),JSON.stringify(comparisons,null,2));
  await info.attach(label+'-comparison',{body:JSON.stringify(comparisons.at(-1),null,2),contentType:'application/json'});
 };
 const selectAndSave=async(page:any,region:any,data:any,label:string)=>{
  const id=data.recommendation.alternativeId,option=region.getByTestId('replan-option-'+id);
  const preview=page.waitForResponse((r:any)=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='preview');
  await option.getByRole('button').click();const proposal=await (await preview).json();expect(proposal.status).toBe('FEASIBLE');
  expect(proposal.decision.recommendation.source).toBe(live?'NEBIUS':'RULES');
  expect(proposal.decision.selectionBasis).toBe(live?'VERIFIED_AI':'RULE_BASELINE');
  await page.screenshot({path:info.outputPath(label+'-review.png'),fullPage:true});
  const approved=page.waitForResponse((r:any)=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='approve');
  await region.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();const saved=await approved;expect(saved.status(),await saved.text()).toBe(200);
  return proposal;
 };
 const taskReview=async(center:string,mission:Mission,preferred:string,label:string)=>{
  const page=await open(center,'/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
  await page.getByLabel('일정 연도',{exact:true}).selectOption(mission.scheduledDate!.slice(0,4));
  await page.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:Number(mission.scheduledDate!.slice(5,7))+'월',exact:true}).click();
  const daily=page.getByTestId('schedule-day-'+mission.scheduledDate);if(!await daily.getAttribute('open').then((v:any)=>v!==null))await daily.locator('summary').click();
  await daily.locator('tbody tr').filter({has:page.getByLabel('일괄 선택 '+mission.id,{exact:true})}).getByRole('button',{name:'관리',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유',{exact:true}).fill(label+' · 동일 조건 비교');
  await modal.getByLabel('변경 희망일 (비우면 자동 지정)').fill(preferred);await modal.getByLabel('판단 우선순위',{exact:true}).selectOption('MIN_DISRUPTION');
  if(label==='equipment-failure'){
   const s=(await get(center,'/api/workspace')).state as State,spare=spareHarvester(s,preferred);
   await modal.getByText('고장 장비 대체',{exact:true}).click();
   await modal.getByLabel(/^고장 장비/).selectOption(mission.resourceId!);await modal.getByLabel(/^대체 장비/).selectOption(spare);
   await modal.getByLabel('사용 시작일',{exact:true}).fill(preferred);await modal.getByLabel('대여 종료일 (선택)',{exact:true}).fill(preferred);
   await modal.getByLabel('도착·점검 일정 확정',{exact:true}).check();await modal.getByLabel('작업기·진입·인력·운송 조건 확인',{exact:true}).check();
   await modal.getByLabel('확인 근거',{exact:true}).fill('격리된 기존 자체 장비의 호환·운송·운영 확인 입력');
  }
  if(live)await modal.getByLabel('AI 판단 함께 비교',{exact:true}).check();
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='compare');
  await modal.getByRole('button',{name:'변경 대안 비교',exact:true}).click();const res=await pending,data=await res.json();expect(res.status(),JSON.stringify(data)).toBe(200);
  const state=(await get(center,'/api/workspace')).state;await capture(label,data,state);
  const proposal=await selectAndSave(page,modal,data,label);
  const final=(await get(center,'/api/workspace')).state as State;
  expect(final.planVersion).toBe(state.planVersion+1);
  expect((await post(center,'/api/operations',{action:'deliver',key:randomUUID()})).result).toMatchObject({delivered:1,provider:'MOCK_SMS'});
  const stored:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:center==='demo'?'sandbox':'center:'+center,kind:'replanning',id:proposal.proposalId}}})).payload;
  expect(stored.status).toBe('APPLIED');await page.close();return {state,final,proposal};
 };
 try{
  // Prove the HTTP server uses the disposable DB before its first business write.
  for(const c of centerRegistry){
   expect((await get(c.id,'/api/auth')).user.centerId).toBe(c.id);
   expect((await get(c.id,'/api/workspace')).aiMode).toBe(live?'NEBIUS':'DEMO_RULES');
  }
  const before=await db.center.findMany(),farmers:Record<string,string>={};
  const initialLoan={id:randomUUID(),version:0,machineId:'JB23TR01',ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:day('05-01'),usableUntil:day('05-31'),status:'REQUESTED',transportConfirmed:false,operatorConfirmed:false};
  await post('janggye','/api/center-resources',initialLoan);
  await post('demo','/api/center-resources',{...initialLoan,version:1,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true});
  for(const [index,c] of centerRegistry.entries()){
   const input=modelFreeRegistration(index),field=input.consultation.fields[0];
   const intake=await open(c.id,'/register'),dialog=intake.getByRole('dialog');
   // External parcel lookup is controlled input; registration/planning writes
   // and every subsequent business response come from the real server and DB.
   await intake.route('**/api/parcels?*',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('pnu')?{status:'READY',pnu:field.pnu,geometry:{type:'Polygon',coordinates:[[[127,35],[127.001,35],[127.001,35.001],[127,35.001],[127,35]]]}}:{status:'READY',items:[{pnu:field.pnu,address:field.address}]}}));
   await dialog.getByLabel('이름',{exact:true}).fill(input.consultation.farmer.name);
   await dialog.getByLabel('생년월일',{exact:true}).pressSequentially('19600101');
   await dialog.getByLabel('주소',{exact:true}).fill('격리 검증 신청인 주소');
   await dialog.getByLabel('연락처',{exact:true}).pressSequentially('00000000000');
   await dialog.getByRole('button',{name:'다음',exact:true}).click();
   await dialog.getByRole('button',{name:'소유농지 조회'}).click();
   await dialog.getByRole('button',{name:'지번으로 농지 추가'}).click();
   await dialog.getByLabel('지번 검색어').fill(field.address);
   await dialog.getByRole('button',{name:'브이월드 지번 검색'}).click();
   await dialog.getByRole('button',{name:'필지 선택',exact:true}).click();
   await dialog.getByRole('button',{name:'필지 초안에 추가'}).click();
   await dialog.getByLabel(field.address+' 작업면적',{exact:true}).fill(field.area);
   await dialog.getByLabel(field.address+' 토지형태',{exact:true}).selectOption('paddy');
   await dialog.getByRole('button',{name:'선택 농지 저장'}).click();
   await dialog.getByRole('button',{name:'다음',exact:true}).click();
   await dialog.getByRole('radio',{name:/완전위탁형/}).check();
   await dialog.getByText('농지·기후 확인값',{exact:true}).click();
   await dialog.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
   for(const label of ['용수 확보','작업 장비 진입','필수 인력 확보'])await dialog.getByLabel(label,{exact:true}).selectOption('yes');
   await dialog.getByLabel('검토 지역',{exact:true}).fill(c.township);
   for(const crop of ['쌀','감자','고추'])await dialog.getByLabel(crop+' · 지역·품종 적합성 검토',{exact:true}).selectOption(crop==='쌀'?'suitable':'unsuitable');
   await dialog.getByLabel('확인일',{exact:true}).fill(new Date(Date.now()+9*3600000).toISOString().slice(0,10));
   await dialog.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill('격리 검증 입력: 현장 영농 적합성 주장이 아님');
   await dialog.getByRole('checkbox',{name:/정보 이용 및/}).check();
   const received=intake.waitForResponse(r=>r.url().endsWith('/api/registrations')&&r.request().method()==='POST');
   await dialog.getByRole('button',{name:'다음',exact:true}).click();
   const response=await received,registered=await response.json();expect(response.status(),JSON.stringify(registered)).toBe(200);
   farmers[c.id]=registered.consultationId;
   expect((await post(c.id,'/api/registrations',response.request().postDataJSON())).consultationId).toBe(registered.consultationId);
   await expect(dialog.getByRole('heading',{name:'신청완료',exact:true})).toBeVisible();
   await intake.screenshot({path:info.outputPath('intake-'+c.id+'.png'),fullPage:true});
   await intake.close();
   const view=(await post(c.id,'/api/continuous-production',{action:'refresh'})).view;
   expect(view.items[0].status,JSON.stringify(view.items)).toBe('REVIEW');
   const page=await open(c.id,'/?tab=production'),panel=page.getByTestId('continuous-production');
   await panel.getByText('작업·장비·인력 계획 보기',{exact:false}).click();
   await panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();
   await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
   await panel.getByRole('button',{name:'선택 1필지 계획 일괄 확정',exact:true}).click();
   await expect(panel).toContainText('다음 재배 연결됨');
   expect((await get(c.id,'/api/workspace')).state.missions).toHaveLength(9);
   const delivered=await post(c.id,'/api/operations',{action:'deliver',key:randomUUID()});
   expect(delivered.result).toMatchObject({delivered:1,provider:'MOCK_SMS'});
   expect((await post(c.id,'/api/operations',{action:'deliver',key:randomUUID()})).result.delivered).toBe(0);
   await page.close();
  }
  evidence.normalIntakes=4;evidence.intakesEnteredThroughUI=true;evidence.externalParcelLookupControlled=true;evidence.normalTasks=32;evidence.normalLocalDeliveries=4;
  if(comparisonRun){
   const normalState=(await get('cheoncheon','/api/workspace')).state as State;
   const soil=normalState.missions.find(m=>(m as any).operationCode==='soil')!;
   await taskReview('cheoncheon',soil,day('05-16'),'normal-intake');
   const failedState=(await get('gyenam','/api/workspace')).state as State;
   const task=failedState.missions.find(m=>(m as any).operationCode==='harvest')!;
   await post('gyenam','/api/center-resources',{action:'failure',machineId:task.resourceId,from:task.scheduledDate,expectedRepairOn:day('10-08')});
   const r=await taskReview('gyenam',task,task.scheduledDate!,'equipment-failure');
   expect(r.final.missions.find(m=>m.id===task.id)).toMatchObject({scheduledDate:task.scheduledDate});
   expect(r.final.missions.find(m=>m.id===task.id)?.resourceId).not.toBe(task.resourceId);
  }
  const normal=(await get('demo','/api/workspace')).state as State;
  const harvest=normal.missions.find(m=>(m as Mission&{operationCode?:string}).operationCode==='harvest')!;
  expect(harvest).toMatchObject({resourceId:'JB23CB01',scheduledDate:day('10-01'),ordinaryWorkers:1,machineOperators:1});
  const others=await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}});
  const ownerState=others.find(c=>c.id==='janggye')!.state as unknown as State;
  const replacement=spareHarvester(ownerState,harvest.scheduledDate!);
  const person=(id:string,name:string)=>({id,name,birth:'1965-01-01',phone:'000-0000-0000',address:'격리 검증용 주소',registeredFarmer:false,usesApp:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['harvest'],active:true});
  const absent=person(randomUUID(),'홍가상'),helper=person(randomUUID(),'홍지원');
  await labor('demo',{action:'person',testDataOnly:true,person:absent});
  await labor('janggye',{action:'person',testDataOnly:true,person:helper});
  await labor('demo',{action:'open',demandId:harvest.id,pay:'격리 검증용 근무 조건',simpleWorkConfirmed:true});
  const job=(await get('demo','/api/labor-operations')).payload.jobs.find((j:any)=>j.missionId===harvest.id&&j.status==='OPEN');
  await labor('demo',{action:'response',jobId:job.id,workerId:absent.id,response:'PHONE'});
  await labor('demo',{action:'absence',jobId:job.id,workerId:absent.id,reason:'같은 접수 건에서 수확 당일 불참 대응 검증'});
  await post('demo','/api/center-resources',{action:'failure',machineId:harvest.resourceId,from:day('10-01'),expectedRepairOn:day('10-08')});
  const offer={id:randomUUID(),version:0,machineId:replacement,borrowerCenterId:'demo',from:day('10-01'),to:day('10-01'),compatibleMachineIds:['JB23CB01'],outboundSlots:2,returnSlots:2,agreementRef:'ISOLATED_ACCEPTANCE_ONLY',conditions:'격리된 호환성·운영자·운송 입력',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true};
  await post('janggye','/api/center-resources',{action:'sharingOffer',offer});
  const drone=normal.missions.find(m=>(m as any).operationCode==='fertilize')!;
  const compareRequest={action:'compare',ids:comparisonRun?[drone.id]:[harvest.id],preferred:day('10-01'),decisionPriority:'MIN_DISRUPTION',...(comparisonRun?{simulation:{kind:'WIND',from:day('09-30'),to:day('09-30')}}:{}),reason:'수확기 고장과 참석자 불참 복합 대응',alternatives:[{id:'preserve',label:'빈자리와 확인된 차용',scope:'PRESERVE'},{id:'expand',label:'관련 일정 재배치',scope:'EXPAND'}]};
  const callsBeforeInfeasible=live?await aiBudgetDb().aiCall.count():0;
  const shortage=await post('demo','/api/replanning',{...compareRequest,useAi:live});
  expect(shortage.recommendation).toMatchObject({alternativeId:null,inferenceCalled:false});
  expect(shortage.results.every((r:any)=>r.status==='NO_FEASIBLE_PLAN')).toBe(true);
  const supportId=randomUUID();
  await post('janggye','/api/labor-capacity',{action:'offer',requestId:supportId,rosterVersion:(await get('janggye','/api/labor-capacity')).rosterVersion,window:{workerId:helper.id,borrowerCenterId:'demo',date:day('10-01'),startMinute:480,endMinute:960,travelMinutes:30,workCodes:['harvest'],response:'PHONE',consent:true,reason:'격리된 본인 지원 의사 확인'}});
  expect((await post('demo','/api/replanning',{...compareRequest,useAi:live})).recommendation.alternativeId).toBeNull();
  if(live)expect(await aiBudgetDb().aiCall.count()).toBe(callsBeforeInfeasible);
  evidence.infeasible={withoutConfirmedLabor:true,offeredButUnconfirmedLabor:true,source:'Constraint engine, model skipped because no feasible alternative',modelCalls:0};
  await post('demo','/api/labor-capacity',{action:'confirm',id:supportId,version:1,requestId:randomUUID(),reason:'운송과 작업시간 확인'});
  const confirmed=await post('demo','/api/replanning',compareRequest);
  expect(confirmed.recommendation).toMatchObject({source:'RULES',inferenceCalled:false,approval:'REQUIRED',reserved:false});
  expect(confirmed.results.some((r:any)=>r.status==='FEASIBLE')).toBe(true);
  // Invalid assistant/model requests cannot invent resources or bypass saved review.
  await post('demo','/api/replanning',{...compareRequest,alternatives:[{id:'invented',label:'추가 인력',staff:999}]},409);
  const candidate=confirmed.results.find((r:any)=>r.id===confirmed.recommendation.alternativeId);
  await post('demo','/api/replanning',{...candidate.previewRequest,alternativeId:'invented'},409);
  await post('gyenam','/api/replanning',candidate.previewRequest,409);
  // Expired real authorization invalidates this exact comparison, without writes.
  const beforeStale=await db.center.findUniqueOrThrow({where:{id:'demo'}}),loanCount=await db.workRecord.count({where:{kind:'equipmentLoan'}});
  await post('janggye','/api/center-resources',{action:'sharingOffer',offer:{...offer,version:1,enabled:false}});
  await post('demo','/api/replanning',candidate.previewRequest,409);
  expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(beforeStale);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(loanCount);
  await post('janggye','/api/center-resources',{action:'sharingOffer',offer:{...offer,version:2}});
  const page=await open('demo',comparisonRun?'/?tab=demo':'/?tab=labor');
  if(comparisonRun){const incident=page.getByTestId('incident-console');await incident.locator('summary').first().click();await incident.getByLabel('대상 날짜',{exact:true}).fill(day('09-30'));await incident.getByRole('button',{name:'상황 발생 · 대응 계산',exact:true}).click();await expect(incident.getByRole('region',{name:'작업 관리'})).toBeVisible();}
  else{const recovery=page.getByTestId('labor-recovery');await recovery.locator('summary').first().click();await recovery.getByRole('button',{name:/대체 인력·일정 비교/}).click();}
  const modal=comparisonRun?page.getByRole('region',{name:'작업 관리'}):page.getByRole('dialog');await modal.getByLabel('변경 사유',{exact:true}).fill(compareRequest.reason);
  if(comparisonRun){await modal.getByLabel('변경 희망일 (비우면 자동 지정)').fill(day('10-01'));await modal.getByLabel('판단 우선순위',{exact:true}).selectOption('MIN_DISRUPTION');}
  if(live)await modal.getByLabel('AI 판단 함께 비교',{exact:true}).check();
  const compared=page.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='compare');
  await modal.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
  const comparedResponse=await compared,comparedData=await comparedResponse.json();
  await writeFile(info.outputPath('compound-comparison-response.json'),JSON.stringify({status:comparedResponse.status(),request:comparedResponse.request().postDataJSON(),response:comparedData},null,2));
  expect(comparedResponse.status(),JSON.stringify(comparedData)).toBe(200);
  const chosen=comparisonRun?comparedData.recommendation.alternativeId:'preserve';
  if(comparisonRun)await capture('compound-wind-failure-absence',comparedData,(await get('demo','/api/workspace')).state);
  await expect(modal.getByTestId('replan-option-'+chosen)).toContainText('배치 가능');
  await expect(modal.getByTestId('planning-recommendation')).toContainText(live?'AI 추천':'계산 기준 추천');
  const previewResponse=page.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='preview');
  await modal.getByTestId('replan-option-'+chosen).getByRole('button').click();
  const proposal=await (await previewResponse).json(),detail=modal.getByRole('region',{name:'선택안 상세 변경'});
  await expect(detail).toContainText('JB23CB01 → '+replacement);
  await expect(detail).toContainText('인접센터 지원 배정 변경 · 참석 재확인');
  await page.screenshot({path:info.outputPath('compound-review-ko.png'),fullPage:true});
  await detail.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(modal).toHaveCount(0);
  expect((await post('demo','/api/replanning',{action:'approve',proposalId:proposal.proposalId})).alreadyApplied).toBe(true);
  const final=(await get('demo','/api/workspace')).state as State,changed=final.missions.find(m=>m.id===harvest.id)!;
  expect(changed).toMatchObject({scheduledDate:harvest.scheduledDate,resourceId:replacement,laborSupportIds:[supportId],status:'PLANNED'});
  if(comparisonRun)expect(final.missions.find(m=>m.id===drone.id)?.scheduledDate).toBe(day('10-01'));
  const changedIds=new Set(proposal.diff.map((d:any)=>d.id));
  for(const m of normal.missions.filter(m=>!changedIds.has(m.id)))expect(final.missions.find(n=>n.id===m.id)).toEqual(m);
  expect(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})).toEqual(others);
  expect(final.machines.find(m=>m.id===harvest.resourceId)?.status).toBe('MAINTENANCE');
  const reservation=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:'plan:demo:'+harvest.id}}});
  expect(reservation.payload).toMatchObject({resourceId:replacement});
  const roster=(await get('demo','/api/labor-operations')).payload,renewed=roster.jobs.find((j:any)=>j.replacesJobId===job.id);
  expect(roster.jobs.find((j:any)=>j.id===job.id).status).toBe('STALE');expect(renewed.responses).toEqual({});expect(renewed.borrowedNames).toEqual([]);
  await labor('demo',{action:'response',jobId:job.id,workerId:absent.id,response:'APP'},409);
  await post('janggye','/api/labor-sharing',{action:'offer',requestId:randomUUID(),version:(await get('janggye','/api/labor-operations')).version,borrowerCenterId:'demo',jobId:renewed.id,sourceHash:renewed.sourceHash,workerId:helper.id,response:'APP',travelMinutes:30,distanceKm:5,consent:true});
  expect((await get('demo','/api/labor-operations')).payload.jobs.find((j:any)=>j.id===renewed.id).borrowedNames).toEqual([helper.name]);
  for(const center of ['demo','janggye']){
   expect((await get(center,'/api/labor-capacity')).notices.some((n:any)=>n.event==='PLAN_CHANGED')).toBe(true);
   expect((await get(center,'/api/center-resources')).notices.some((n:any)=>n.event==='CONFIRMED')).toBe(true);
  }
  const notice=await db.outbox.findFirstOrThrow({where:{id:{startsWith:'replan:'+proposal.proposalId+':'},farmerId:farmers.demo}});
  expect(notice.status).toBe('PENDING');
  expect((await post('demo','/api/operations',{action:'deliver',key:randomUUID()})).result).toMatchObject({delivered:1,provider:'MOCK_SMS'});
  expect((await post('demo','/api/operations',{action:'deliver',key:randomUUID()})).result.delivered).toBe(0);
  expect(await db.outbox.count({where:{id:notice.id,status:'DELIVERED',attempts:1}})).toBe(1);
  await page.goto('http://127.0.0.1:3100/?tab=labor');const shares=page.getByTestId('labor-sharing');await shares.locator('summary').first().click();await expect(shares.locator('tbody')).toContainText(helper.name);
  await page.setViewportSize({width:390,height:844});await page.getByLabel('언어 / Language').selectOption('en');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('reconfirmed-mobile-en.png'),fullPage:true});
  for(const c of before)expect(((await get(c.id,'/api/workspace')).state.missions as Mission[]).find(m=>m.id==='past-record')).toEqual((c.state as unknown as State).missions[0]);
  expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
  const paidAiCalls=live?(await aiBudgetDb().aiCall.count())-ledgerBefore:0;expect(paidAiCalls).toBe(live?3:0);
  Object.assign(evidence,{sameRegisteredCultivation:true,compoundEquipmentAndLaborFailure:true,equipmentAloneInsufficient:true,offeredLaborInsufficient:true,confirmedResourcesFeasible:true,oldComparisonRejected:true,inventedResourcesRejected:true,foreignCenterRejected:true,duplicateApprovalDeduplicated:true,changedTasks:changedIds.size,otherCenterPlansPreserved:true,completedWorkPreserved:true,attendanceReconfirmed:true,bothCenterNotices:true,finalLocalDelivery:true,duplicateDeliveryPrevented:true,paidAiCalls,scope:'Normal intake followed by plan review, equipment failure, compound wind + failure + absence. Initial crop choice remains rules-based. Synthetic parcels, operation windows, adjacency and resources; not agronomic/field validation.'});
  await info.attach('model-free-acceptance',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
  await writeFile(info.outputPath('comparison-evidence.json'),JSON.stringify(evidence,null,2));
 }finally{for(const ctx of pages)await ctx.close();for(const client of Object.values(clients))await client.dispose()}
});
