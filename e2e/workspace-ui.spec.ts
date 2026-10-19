import {test,expect} from './authenticated-test';
import type {State} from '../lib/types';
import {emptyLaborOps,type Worker,type LaborJob} from '../lib/labor-operations';
import {comparedPlans} from './replan-responses';
import {checkRationale,ruleRationale} from '../lib/planning-rationale';
import type {Page} from '@playwright/test';
const today='2026-10-15',year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
const move=(n:number)=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
test.beforeEach(async({page},info)=>{
 // Avoid month-boundary drift; the midnight test installs its own advancing clock.
 if(!info.title.includes('KST midnight'))await page.clock.setFixedTime(new Date(today+'T03:00:00Z'));
 const s:State={name:'계북면',planVersion:1,fields:[{id:'4574039026106160004',farmerId:'farmer',name:'홍화면',address:'계북면 농소리 616-4',area:1000,crop:'고추',mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'',source:'DEMO_ASSUMPTION'}],machines:[{id:'JB23TR01',name:'트랙터',type:'트랙터',status:'AVAILABLE',safetyLock:false,capacityHaHour:1}],missions:[],events:[],revisions:[],registered:true,planned:true,ruleVersion:'UI_TEST',transportCount:2,staffCount:2};s.missions=[0,1,2].map(i=>({id:'ui-'+i,fieldId:s.fields[0].id,label:'고추 작업',crop:'고추',scheduledDate:move(i-1),month,status:'PLANNED',resourceId:'JB23TR01',owner:'장비',start:0,duration:4,deadline:32,priority:1,batchKey:'test',staff:1,transport:1}));
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:s,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'READY',temperatureC:22.5,windMs:2,humidityPercent:60,precipitationMm:0,observedAt:new Date().toISOString()}}));
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'READY',points:[]}}}));
 await page.route('**/api/incidents',r=>r.fulfill({json:{events:[],jobs:[]}}));
 await page.route('**/api/continuous-production',r=>r.fulfill({json:{view:{items:[],asOf:today,fingerprint:'a'.repeat(64)},criteria:{profiles:[]},criteriaVersion:0,canManage:true}}));
 await page.route('**/api/parcels?*',r=>r.fulfill({json:{status:'READY',geometry:{type:'Polygon',coordinates:[[[127.6,35.78],[127.601,35.78],[127.601,35.781],[127.6,35.78]]]}}}));
 await page.route('**/api/map-tile?*',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf2e8"/></svg>'}));
});
test('main chrome, translation, schedule month and expanded today, demos isolated',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'지원현황',exact:true})).toBeVisible();
 await expect(page.locator('.account-bar')).not.toContainText('장비 예약');await expect(page.locator('.account-bar')).not.toContainText('비밀번호');
 await expect(page.getByRole('link',{name:/신규 농지 등록/})).toHaveCount(0);await expect(page.getByTestId('incident-console')).toHaveCount(0);
 await expect(page.getByTestId('today-weather')).not.toContainText('등록');await page.screenshot({path:'test-results/ui-main.png',fullPage:true});
 await expect(page.getByTestId('workspace-status')).toContainText(today);
 await expect(page.getByTestId('calendar-day-'+move(-1))).toContainText('예정작업 0');
 await expect(page.getByTestId('calendar-day-'+move(-1))).not.toContainText('확인 필요');await expect(page.getByTestId('task-attention')).toHaveCount(0);await expect(page.locator('.home-quick-actions button')).toHaveCount(5);
 await expect(page.getByTestId('calendar-day-'+today)).toContainText('예정작업 1');
 await page.locator('.language-selector select').selectOption('en');await expect(page.getByRole('heading',{name:'Operations overview'})).toBeVisible();
 await page.locator('.language-selector select').selectOption('ko');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
 await expect(page.getByRole('button',{name:month+'월',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('schedule-day-'+today)).toHaveAttribute('open','');await expect(page.getByTestId('schedule-day-'+move(1))).not.toHaveAttribute('open','');await expect(page.getByTestId('schedule-day-'+move(-1))).toHaveCount(0);
 await expect(page.getByTestId('ops-schedule')).not.toContainText('기한 경과');
 await page.getByTestId('schedule-day-'+today).getByRole('button',{name:'일정변경',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'일정변경 진행',exact:true}).click();await expect(page.getByRole('button',{name:'자동 재배치 계산',exact:true})).toBeDisabled();await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).first().click();
 await page.getByRole('navigation').getByRole('button',{name:'데모',exact:true}).click();await expect(page.getByTestId('incident-console')).toBeVisible();
});
test('equipment popup saves through API with immutable identity',async({page})=>{
 let writes:any[]=[];await page.route('**/api/equipment',async r=>{writes.push(r.request().postDataJSON());await r.fulfill({json:{ok:true}})});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'장비현황'}).click();
 await page.getByRole('button',{name:'상세정보',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'수정',exact:true}).click();
 await expect(page.getByLabel('장비코드',{exact:true})).toBeDisabled();await page.getByLabel('모델명',{exact:true}).fill('Ledger model');await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes[0].existingId).toBe('JB23TR01');expect(writes[0].equipment.model).toBe('Ledger model');
 await page.getByRole('button',{name:/장비등록/}).click();await expect(page.getByLabel('장비코드',{exact:true})).toHaveValue('JB23DR01');await expect(page.getByLabel('장비코드',{exact:true})).toHaveAttribute('readonly','');await page.getByLabel('장비 종류',{exact:true}).selectOption('TR');await expect(page.getByLabel('장비코드',{exact:true})).toHaveValue('JB23TR02');await page.getByLabel('장비 종류',{exact:true}).selectOption('TV');await expect(page.getByLabel('장비코드',{exact:true})).toHaveValue('JB23TV01');await expect(page.getByLabel('시간당 작업면적 (ha/시간)',{exact:true})).toHaveCount(0);await page.getByLabel('장비 종류',{exact:true}).selectOption('DR');await page.getByLabel('시간당 작업면적 (ha/시간)',{exact:true}).fill('2');await expect(page.getByRole('dialog')).toContainText('시간당 20,000 m²');await page.screenshot({path:'test-results/ui-equipment-code.png',fullPage:true});await expect(page.getByLabel('장비명',{exact:true})).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes[1].equipment.id).toBe('JB23DR01');expect(writes[1].autoCode).toBe(true);expect(writes[1].equipment.name).toBe('방제 드론');
});

test('calendar date opens that day, and the schedule menu resets to today even in the same tab',async({page})=>{
 await page.goto('/');
 const nav=page.getByRole('navigation');
 await page.getByTestId('calendar-day-'+move(1)).click();
 await expect(page.getByTestId('schedule-day-'+move(1))).toHaveAttribute('open','');
 await expect(page.getByTestId('schedule-day-'+today)).not.toHaveAttribute('open','');
 await nav.getByRole('button',{name:'일정표',exact:true}).click();
 await expect(page.getByTestId('schedule-day-'+today)).toHaveAttribute('open','');
 await expect(page.getByTestId('schedule-day-'+move(1))).not.toHaveAttribute('open','');
 await page.getByTestId('schedule-day-'+today).locator('summary').click();
 await expect(page.getByTestId('schedule-day-'+today)).not.toHaveAttribute('open','');
 await nav.getByRole('button',{name:'일정표',exact:true}).click();
 await expect(page.getByTestId('schedule-day-'+today)).toHaveAttribute('open','');
 await nav.getByRole('button',{name:'메인',exact:true}).click();
 const targetMonth=month===12?1:month+1,date=`${year}-${String(targetMonth).padStart(2,'0')}-15`;
 await page.getByLabel('Calendar month',{exact:true}).selectOption(String(targetMonth));
 await page.getByTestId('calendar-day-'+date).click();
 await expect(page.getByRole('button',{name:targetMonth+'월',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('schedule-day-'+date)).toHaveAttribute('open','');
 await expect(page.getByTestId('schedule-day-'+date)).toContainText('이 날짜에 표시할 작업이 없습니다.');
 await nav.getByRole('button',{name:'일정표',exact:true}).click();
 await expect(page.getByRole('button',{name:month+'월',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('schedule-day-'+today)).toHaveAttribute('open','');
});

test('an open calendar advances past plans after KST midnight without business writes',async({page})=>{
 await page.clock.install({time:new Date(today+'T23:59:58+09:00')});
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 await page.goto('/');await expect(page.getByTestId('calendar-day-'+today)).toContainText('예정작업 1');
 await page.clock.fastForward(4000);
 await expect(page.getByTestId('workspace-status').locator('time')).toHaveText(move(1));
 await expect(page.getByTestId('calendar-day-'+today)).toContainText('예정작업 0');
 await expect(page.getByTestId('calendar-day-'+today)).not.toContainText('확인 필요');await expect(page.getByTestId('task-attention')).toHaveCount(0);await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();await expect(page.getByTestId('task-attention')).toContainText('작업결과 미입력 2건');
 expect(writes).toEqual([]);
});
test('field map supports drag and wheel and shared crop information retains navigation',async({page})=>{
 await page.route('**/api/delegated-planning',r=>r.fulfill({json:{items:[],fields:[],proposals:[]}}));
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'농지',exact:true}).click();const map=page.getByTestId('field-map'),parcel=map.locator('path:not([stroke-dasharray])');await expect(map).toBeVisible();await expect(parcel).toHaveCount(1);
 await map.scrollIntoViewIfNeeded();const box=(await map.boundingBox())!,before=await parcel.getAttribute('d');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+30,{steps:5});await page.mouse.up();await expect(parcel).not.toHaveAttribute('d',before!);
 const tile=await map.locator('image').first().getAttribute('href');await page.mouse.wheel(0,-200);await expect(map.locator('image').first()).not.toHaveAttribute('href',tile!);
 await expect(page.getByRole('tab',{name:'생산현황',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'AI 계획·일괄 확정',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('link',{name:'작물정보',exact:true}).click();await expect(page.getByRole('tab',{name:'작물 기준자료',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation')).toBeVisible();await expect(page.getByRole('navigation').getByText('농부 화면',{exact:true})).toHaveCount(0);
});
test('labor calendars open ranked attendance roster and record an override',async({page})=>{
 const payload=emptyLaborOps(),ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 payload.people=ids.map((id,i)=>({id,name:i?'홍가까':'홍먼길',birth:'1960-01-01',phone:'000-0000-0000',address:'가상주소',registeredFarmer:false,usesApp:false,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:1080,workCodes:['*'],active:true} as Worker));
 const job:LaborJob={id:'job',missionId:'work',task:'고추 수확',address:'계북면',date:today,startMinute:540,durationMinutes:120,count:1,workCode:'harvest',sourceHash:'x',pay:'조건 확인',status:'OPEN',invited:ids,responses:Object.fromEntries(ids.map(id=>[id,'PHONE'])),distances:{[ids[0]]:5,[ids[1]]:1},assigned:[ids[1]],manual:null,worked:[]};payload.jobs=[job];let writes:any[]=[];
 await page.route('**/api/labor-operations',async r=>{if(r.request().method()==='POST'){writes.push(r.request().postDataJSON());await r.fulfill({json:{ok:true}})}else await r.fulfill({json:{version:1,payload,demands:[{id:'work',task:'고추 수확',date:today,count:1,completed:false}],scores:Object.fromEntries(ids.map(id=>[id,100]))}})});
 await page.goto('/?tab=labor');await expect(page.locator('.labor-calendars>.card')).toHaveCount(2);await page.getByRole('button',{name:today+' 1명',exact:true}).click();await page.getByRole('button',{name:'1명 · 명단 선택'}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('tbody tr').first()).toContainText('홍가까');
 await dialog.getByLabel('홍가까 수정 선택').uncheck();await dialog.getByLabel('홍먼길 수정 선택').check();await dialog.getByLabel('변경 사유',{exact:true}).fill('담당자 조정');await dialog.getByRole('button',{name:'선택 명단으로 수정'}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].ids).toEqual([ids[0]]);await page.screenshot({path:'test-results/ui-labor.png',fullPage:true});
});
test('preferred conflict requires expansion request then batch approval',async({page})=>{
 const calls:any[]=[];let compared:any;await page.route('**/api/replanning',async r=>{const b=r.request().postDataJSON();calls.push(b);if(b.action==='compare')compared=comparedPlans(b);await r.fulfill({json:b.action==='compare'?compared:b.action==='approve'?{ok:true}:{...compared.results.find((x:any)=>x.previewRequest.scope===b.scope).result,proposalId:'proposal'}})});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();await page.getByTestId('schedule-day-'+today).getByRole('button',{name:'관리',exact:true}).click();await page.getByLabel('변경 사유',{exact:true}).fill('장비 일정 조정');await page.getByLabel('변경 희망일 (비우면 자동 지정)').fill(move(1));await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await expect(page.locator('.replan-option')).toHaveCount(2);await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toHaveCount(0);expect(calls.map(x=>x.action)).toEqual(['compare']);
 await page.getByRole('button',{name:'충돌 관련 일정 재배치 · 선택',exact:true}).click();await expect(page.getByRole('region',{name:'선택안 상세 변경'})).toContainText('함께 조정');await page.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls.map(x=>x.action)).toEqual(['compare','preview','approve']);expect(calls[1]).toMatchObject({scope:'EXPAND',decisionSource:'DEVELOPMENT_REVIEW',comparisonSnapshot:'a'.repeat(64)});expect(calls[0].reason).toBe('장비 일정 조정');
});

async function openComparison(page:Page){
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
 await page.getByTestId('schedule-day-'+today).getByRole('button',{name:'관리',exact:true}).click();
 await page.getByLabel('변경 사유',{exact:true}).fill('장비 일정 조정');
 await page.getByLabel('변경 희망일 (비우면 자동 지정)').fill(move(1));
}
async function mockReplan(page:Page,options:{blocked?:boolean;stale?:'preview'|'approve';empty?:boolean}={}){
 const calls:any[]=[];let comparison:any;
 await page.route('**/api/replanning',async r=>{
  const b=r.request().postDataJSON();calls.push(b);
  if(b.action===options.stale){await r.fulfill({status:409,json:{error:'계획·기상자료가 변경되었습니다. 대안을 다시 비교하세요.'}});return}
  if(b.action==='compare'){
   comparison=comparedPlans(b);
   if(options.blocked)comparison.results[0]={...comparison.results[0],status:'NO_FEASIBLE_PLAN',metrics:null,result:null,previewRequest:null,reason:'작업 가능 기간에 빈자리가 없습니다.'};
   await r.fulfill({json:comparison});return;
  }
  if(b.action==='preview'){
   const item=comparison.results.find((c:any)=>c.previewRequest&&c.previewRequest.scope===b.scope);
   await r.fulfill({json:{...item.result,...(options.empty?{diff:[]}:{}),proposalId:'proposal-'+item.id}});return;
  }
  await r.fulfill({json:{ok:true}});
 });
 return calls;
}

test('explicit AI comparison shows the rule baseline and never auto-applies the choice',async({page},info)=>{
 const calls:any[]=[];
 await page.route('**/api/replanning',async route=>{
  const input=route.request().postDataJSON();calls.push(input);
  const comparison=comparedPlans(input);
  const base={source:'RULES',inferenceCalled:false,alternativeId:'expand',approval:'REQUIRED',reserved:false,snapshotId:'a'.repeat(64),evidence:[{alternativeId:'expand',metric:'preferredDistanceDays',value:0}],trace:[]};
  await route.fulfill({json:{...comparison,baseline:base,recommendation:input.useAi?{...base,source:'NEBIUS',inferenceCalled:true,model:'isolated-ui-response',alternativeId:'preserve',evidence:[{alternativeId:'preserve',metric:'otherChangedTasks',value:0}],usage:{reservedMicroUsd:5000,estimatedMicroUsd:73}}:base}});
 });
 await openComparison(page);const checkbox=page.getByLabel('AI 판단 함께 비교',{exact:true});
 await expect(checkbox).not.toBeChecked();await checkbox.check();await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 const panel=page.getByTestId('planning-recommendation');await expect(panel).toContainText('AI 제안');await expect(panel).toContainText('계산 기준');await expect(page.getByTestId('planning-rationale-invalid')).toContainText('선택·제외 사유가 없거나');
 await panel.getByText('판단 근거',{exact:true}).click();await expect(panel).toContainText('$0.000073');
 expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({action:'compare',useAi:true});
 await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('ai-comparison-ko.png'),fullPage:true});
 await checkbox.uncheck();await expect(panel).toHaveCount(0);
 expect(calls).toHaveLength(1);
});

for(const valid of [true,false])test(`controlled AI rationale ${valid?'verified':'invalid'} is explained and selection provenance remains visible`,async({page},info)=>{
 const calls:any[]=[];let comparison:any;
 await page.route('**/api/replanning',async route=>{
  const b=route.request().postDataJSON();calls.push(b);
  if(b.action==='compare'){
   comparison=comparedPlans(b);const generated=ruleRationale(comparison,'expand');
   if(!valid)generated.rationale.rejections[0].metric='resourceChanges';
   const recommendation={source:'NEBIUS',inferenceCalled:true,alternativeId:'expand',model:'controlled-ui-response-not-real-inference',approval:'REQUIRED',reserved:false,snapshotId:comparison.snapshot.id,
    evidence:generated.evidence.map(e=>({...e,value:comparison.results.find((r:any)=>r.id===e.alternativeId).metrics[e.metric]})),rationale:generated.rationale,
    rationaleCheck:checkRationale(comparison,'expand',generated.evidence,generated.rationale,'MODEL'),trace:[]};
   await route.fulfill({json:{...comparison,recommendation}});return;
  }
  if(b.action==='preview'){
   await route.fulfill({json:{...comparison.results.find((r:any)=>r.id==='expand').result,proposalId:'controlled-proposal',decision:{selectionBasis:valid?'VERIFIED_AI':'OPERATOR_REVIEW'}}});return;
  }
  await route.fulfill({json:{ok:true}});
 });
 await openComparison(page);await page.getByLabel('AI 판단 함께 비교',{exact:true}).check();await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 const panel=page.getByTestId('planning-recommendation');
 await expect(panel).toContainText(valid?'AI 추천 · 근거 검증 통과':'AI 제안 · 근거 검증 필요');
 if(valid)await expect(page.getByTestId('planning-rationale-invalid')).toHaveCount(0);
 else await expect(page.getByTestId('planning-rationale-invalid')).toContainText('처음 차이가 나는 우선 지표');
 await panel.getByText('판단 근거',{exact:true}).click();
 const details=page.getByTestId('planning-rationale-details');await expect(details).toContainText('선택안 0일 / 제외 후보 1일');
 await expect(details).toContainText(valid?'검증 통과':'검증 실패');
 expect(calls.map(c=>c.action)).toEqual(['compare']);
 await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toHaveCount(0);
 await details.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('rationale-'+(valid?'verified':'invalid')+'-ko.png'),fullPage:true});
 await page.getByRole('button',{name:'충돌 관련 일정 재배치 · 선택',exact:true}).click();
 await expect(page.getByTestId('planning-selection-basis')).toContainText(valid?'근거가 검증된 AI 제안 선택':'담당자 직접 선택');
 await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toBeEnabled();
 // Language changes do not trigger another comparison or paid call.
 await page.locator('.language-selector select').selectOption('en');
 await expect(details).toContainText('Selected 0 days / Rejected 1 days');
 await expect(page.getByTestId('planning-selection-basis')).toContainText(valid?'Verified AI recommendation':'Operator decision');
 await details.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('rationale-'+(valid?'verified':'invalid')+'-en.png'),fullPage:true});
 expect(calls.map(c=>c.action)).toEqual(['compare','preview']);
});

test('comparison excludes infeasible options and approves the reviewed related-scope proposal',async({page})=>{
 const calls=await mockReplan(page,{blocked:true});await openComparison(page);await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 const blocked=page.getByTestId('replan-option-preserve');
 await expect(blocked).toContainText('작업 가능 기간에 빈자리가 없습니다.');await expect(blocked.getByRole('button')).toBeDisabled();
 await page.getByRole('button',{name:'충돌 관련 일정 재배치 · 선택',exact:true}).click();
 await expect(page.getByTestId('replan-option-expand').getByRole('button')).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('region',{name:'선택안 상세 변경'})).toContainText('함께 조정');
 await page.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(calls.map(c=>c.action)).toEqual(['compare','preview','approve']);expect(calls.at(-1).proposalId).toBe('proposal-expand');
});
test('resource comparison shows machine minutes and person-minutes and retains restrictions on selection',async({page},info)=>{
 const calls=await mockReplan(page);await openComparison(page);
 await page.getByLabel('현재 자원·차용·인력 지원 대안도 비교',{exact:true}).check();
 await page.getByLabel('판단 우선순위',{exact:true}).selectOption('MIN_EXTERNAL');
 await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await expect(page.locator('.replan-option')).toHaveCount(5);
 await expect(page.getByTestId('replan-option-equipment')).toContainText('240분');
 await expect(page.getByTestId('replan-option-labor')).toContainText('240인·분');
 expect(calls[0].alternatives.find((a:any)=>a.id==='local')).toMatchObject({replacement:'NONE',newLaborSupport:false});
 await page.getByTestId('replan-option-labor').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('resource-tradeoff-ui.png'),fullPage:true});
 await page.getByRole('button',{name:'현재 자원 유지 · 선택',exact:true}).click();
 expect(calls[1]).toMatchObject({newLaborSupport:false,automaticReplacement:false,decisionPriority:'MIN_EXTERNAL'});
});
test('priority-violating AI suggestion is visibly flagged and never auto-applied',async({page},info)=>{
 const calls:any[]=[];
 await page.route('**/api/replanning',async route=>{
  const b=route.request().postDataJSON();calls.push(b);const c=comparedPlans(b);
  await route.fulfill({json:{...c,recommendation:{source:'NEBIUS',inferenceCalled:true,alternativeId:'preserve',approval:'REQUIRED',reserved:false,snapshotId:c.snapshot.id,evidence:[{alternativeId:'preserve',metric:'preferredDistanceDays',value:1}],trace:[],priorityCheck:{status:'MISMATCH',ruleAlternativeId:'expand',metric:'preferredDistanceDays',selectedValue:1,ruleValue:0}}}});
 });
 await openComparison(page);await page.getByLabel('AI 판단 함께 비교',{exact:true}).check();
 await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await expect(page.getByTestId('planning-recommendation')).toContainText('우선순위 재검토 필요');
 await expect(page.getByTestId('planning-priority-mismatch')).toContainText('1일 → 계산 기준 0일');
 await page.getByTestId('planning-priority-mismatch').scrollIntoViewIfNeeded();
 await expect(page.getByTestId('planning-priority-mismatch')).toBeVisible();
 await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toHaveCount(0);
 expect(calls.map(c=>c.action)).toEqual(['compare']);
 await page.screenshot({path:info.outputPath('priority-mismatch-ui.png'),fullPage:true});
});

for(const field of ['reason','preferred','priority'] as const)test('editing '+field+' invalidates the comparison and saved proposal',async({page})=>{
 const calls=await mockReplan(page);await openComparison(page);await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await page.getByRole('button',{name:'빈자리만 사용 · 선택',exact:true}).click();await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toBeEnabled();
 if(field==='reason')await page.getByLabel('변경 사유',{exact:true}).fill('변경된 사유');
 else if(field==='priority')await page.getByLabel('판단 우선순위',{exact:true}).selectOption('MIN_DISRUPTION');
 else await page.getByLabel('변경 희망일 (비우면 자동 지정)').fill('');
 await expect(page.locator('.replan-option')).toHaveCount(0);await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toHaveCount(0);
 await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();await expect(page.locator('.replan-option')).toHaveCount(2);
 if(field==='reason')expect(calls.at(-1).reason).toBe('변경된 사유');else if(field==='priority')expect(calls.at(-1).decisionPriority).toBe('MIN_DISRUPTION');else {expect(calls.at(-1)).not.toHaveProperty('preferred');await expect(page.getByTestId('replan-option-preserve')).toContainText('자동 배치')}
 expect(calls.every(c=>c.action!=='approve')).toBe(true);
});

for(const phase of ['preview','approve'] as const)test('stale '+phase+' discards comparison and cannot approve again',async({page})=>{
 const calls=await mockReplan(page,{stale:phase});await openComparison(page);await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await page.getByRole('button',{name:'빈자리만 사용 · 선택',exact:true}).click();
 if(phase==='approve')await page.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();
 await expect(page.getByRole('region',{name:'작업 관리',exact:true}).getByRole('alert')).toContainText('대안을 다시 비교하세요');
 await expect(page.locator('.replan-option')).toHaveCount(0);await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'변경 대안 비교',exact:true})).toBeEnabled();
 expect(calls.filter(c=>c.action==='approve')).toHaveLength(phase==='approve'?1:0);
});

test('a no-change option needs no approval',async({page})=>{
 await mockReplan(page,{empty:true});await openComparison(page);await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await page.getByRole('button',{name:'빈자리만 사용 · 선택',exact:true}).click();
 await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toBeDisabled();await expect(page.getByRole('region',{name:'선택안 상세 변경'})).toContainText('현재 일정이 이미 조건을 충족합니다.');
});

test('comparison is readable in the work area and English on a narrow screen',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await mockReplan(page);await openComparison(page);await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(page.locator('.replan-option')).toHaveCount(2);
 await page.locator('.replan-options').evaluate(el=>el.scrollIntoView({block:'center'}));
 await page.screenshot({path:'test-results/ui-replan-comparison-ko.png'});
 const panel=(await dialog.boundingBox())!,content=(await page.locator('.shell > .content').boundingBox())!;
 expect(panel.x).toBeGreaterThanOrEqual(content.x);expect(panel.x+panel.width).toBeLessThanOrEqual(1440);
 await dialog.getByRole('button',{name:'닫기',exact:true}).first().click();
 await page.locator('.language-selector select').selectOption('en');
 await page.getByTestId('schedule-day-'+today).getByRole('button',{name:'Manage',exact:true}).click();
 await page.getByLabel('Change reason',{exact:true}).fill('Change equipment schedule');await page.getByRole('button',{name:'Compare alternatives',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Schedule alternatives',exact:true})).toBeVisible();
 await page.setViewportSize({width:480,height:900});
 await page.getByTestId('replan-option-preserve').evaluate(el=>el.scrollIntoView({block:'center'}));
 await expect(page.getByTestId('replan-option-preserve')).toContainText('Use available gaps');
 // Modal positioning follows ResizeObserver/requestAnimationFrame, not synchronously.
 await expect.poll(()=>page.locator('.replan-option').evaluateAll(nodes=>nodes.every(n=>{
  const r=n.getBoundingClientRect();return r.left>=0&&r.right<=480;
 }))).toBe(true);
 const boxes=await page.locator('.replan-option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}));
 expect(boxes.every(b=>b.left>=0&&b.right<=480)).toBe(true);expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
 await page.screenshot({path:'test-results/ui-replan-comparison-en-mobile.png'});
});

test('closing during comparison discards late results and does not save a proposal',async({page})=>{
 let release!:()=>void;const responseReady=new Promise<void>(resolve=>{release=resolve});const calls:string[]=[];
 await page.route('**/api/replanning',async r=>{const b=r.request().postDataJSON();calls.push(b.action);await responseReady;await r.fulfill({json:comparedPlans(b)}).catch(()=>{})});
 await openComparison(page);await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await expect(page.getByRole('button',{name:'대안 계산 중…',exact:true})).toBeDisabled();await expect(page.getByLabel('변경 사유',{exact:true})).toBeDisabled();
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).first().click();release();
 await page.getByTestId('schedule-day-'+today).getByRole('button',{name:'관리',exact:true}).click();await expect(page.locator('.replan-option')).toHaveCount(0);expect(calls).toEqual(['compare']);
});

test('a previously saved batch proposal still opens for approval without recalculating',async({page})=>{
 const result={status:'FEASIBLE',phase:'GAPS_ONLY',proposalId:'saved-proposal',warnings:[],diff:[{id:'ui-1',before:8096,after:8128,date:move(1)}]};
 await page.route('**/api/work-history',r=>r.fulfill({json:{items:[],approvals:[{id:'saved-proposal',missionIds:['ui-1'],day:today,result}]}}));
 const calls:any[]=[];await page.route('**/api/replanning',r=>{calls.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}})});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
 await page.getByRole('button',{name:'변경계획 승인 대기 1건',exact:true}).click();await page.getByRole('button',{name:'변경계획 검토',exact:true}).click();
 await expect(page.getByRole('button',{name:/변경계획 일괄 승인·저장/})).toBeEnabled();await expect(page.locator('.replan-option')).toHaveCount(0);
 await page.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(calls).toEqual([{action:'approve',proposalId:'saved-proposal'}]);
});

test('individual task popup uses the same comparison with its preferred date',async({page})=>{
 const calls=await mockReplan(page);await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
 await page.getByTestId('schedule-day-'+today).getByRole('button',{name:'관리',exact:true}).click();
 await expect(page.getByLabel('변경 희망일 (비우면 자동 지정)')).toHaveValue(today);
 await page.getByLabel('변경 사유',{exact:true}).fill('개별 변경');await page.getByRole('button',{name:'변경 대안 비교',exact:true}).click();
 await expect(page.locator('.replan-option')).toHaveCount(2);expect(calls[0]).toMatchObject({action:'compare',ids:['ui-1'],preferred:today});expect(calls[0]).not.toHaveProperty('day');
});
