import {test,expect} from './authenticated-test';
import type {Page,APIRequestContext} from '@playwright/test';
import {db} from '../lib/db';
import type {State} from '../lib/types';
import {syntheticDemoParcels as parcels} from '../tests/registered-demo-fixture';
import {randomUUID} from 'node:crypto';

const testUrl='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_intake_e2e';
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const year=Number(today.slice(0,4))+1;
const date=(md:string)=>`${year}-${md}`;
const parcelsUsed=parcels.slice(0,2);
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
async function post(request:APIRequestContext,url:string,data:unknown){
 const r=await request.post(url,{data}),body=await r.json();expect(r.ok(),JSON.stringify(body)).toBe(true);return body;
}
async function clickResponse(page:Page,url:string,action:string|undefined,click:()=>Promise<unknown>){
 const pending=page.waitForResponse(r=>r.url().includes(url)&&r.request().method()==='POST'&&(!action||r.request().postDataJSON().action===action));
 await click();const r=await pending,body=await r.json();expect(r.ok(),JSON.stringify(body)).toBe(true);return body;
}
test.skip(process.env.KFARM_INTAKE_E2E!=='1','Requires explicit isolated intake DB run');
test.beforeAll(()=>{if(process.env.DATABASE_URL!==testUrl)throw Error('Dedicated intake DB required');});
test.beforeEach(async()=>{
 // Only the explicit disposable DB. Leave auth fixtures and unrelated records untouched.
 const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;state.fields=[];state.missions=[];state.events=[];state.revisions=[];state.planVersion=1;
 await db.$transaction(async tx=>{
  await tx.outbox.deleteMany({where:{centerId:'demo'}});
  await tx.workRecord.deleteMany({where:{workspace:'sandbox'}});
  await tx.workRecord.deleteMany({where:{workspace:'shared',kind:{in:['resourceReservation','reservationReceipt']}}});
  await tx.center.update({where:{id:'demo'},data:{state:json(state)}});
  // Realistic order/separate seasonal windows, synthetic rates, NOT certified agronomy.
  const windows:Record<string,[string,string]>={seed:['04-08','04-12'],nursery:['04-13','05-14'],soil:['05-15','05-24'],plant:['05-25','05-31'],harvest:['10-01','10-12'],finish:['10-01','10-14']};
  const operations=Object.fromEntries(Object.entries(windows).map(([code,[from,to]])=>[code,{from:date(from),to:date(to),laborMinutesPer1000m2:30,windLimitMs:8,rainSensitive:false}]));
  await tx.workRecord.create({data:{workspace:'sandbox',kind:'productionCriteria',id:'current',payload:{profiles:[{id:'rice-season',name:'검증용 지역 작기 · 현장 미검증',context:{region:'계북면',operations:{rice:operations}}}]}}});
  await tx.workRecord.create({data:{workspace:'sandbox',kind:'preservationSentinel',id:'existing',payload:{untouched:true}}});
 });
});
test('real intake, sequential approval, labor attendance, replanning and final notices persist in PostgreSQL',async({page,request},info)=>{
 test.setTimeout(240000);
 page.setDefaultTimeout(20000);
 page.setDefaultNavigationTimeout(20000);
 const beforeCalls=await db.aiCall.count();
 const auth=await (await request.get('/api/auth')).json();expect(auth.user.centerId).toBe('demo');
 // Only external cadastral/imagery responses are isolated; EVERY business API is real.
 // Parcel identities and outline are synthetic UI fixtures, not ownership/geography evidence.
 await page.route('**/api/parcels?*',route=>{
  const url=new URL(route.request().url()),p=parcelsUsed.find(p=>p.pnu===url.searchParams.get('pnu'));
  return route.fulfill({json:p?{status:'READY',geometry:{type:'Polygon',coordinates:[[[127.62,35.78],[127.6202,35.78],[127.6202,35.7802],[127.62,35.78]]]}}:{status:'READY',items:parcelsUsed.filter(p=>url.searchParams.get('q')?.includes(p.address.split(' ').at(-1)!))}});
 });
 await page.route('**/api/map-tile?*',r=>r.abort());
 const names=['홍가람','홍나래'];
 let firstMissions:unknown,firstPlan:unknown;
 for(let index=0;index<2;index++){
  const parcel=parcelsUsed[index];await page.goto('/register');
  const form=page.getByTestId('field-registration');
  await form.getByLabel('이름',{exact:true}).fill(names[index]);await form.getByLabel('생년월일',{exact:true}).fill('19600101');
  await form.getByLabel('주소',{exact:true}).fill('전북특별자치도 장수군 계북면 검증용 주소');await form.getByLabel('연락처',{exact:true}).fill('00000000000');
  await form.getByRole('button',{name:'다음',exact:true}).click();await form.getByRole('button',{name:'소유농지 조회',exact:true}).click();
  await form.getByRole('button',{name:'지번으로 농지 추가',exact:true}).click();await form.getByLabel('지번 검색어').fill(parcel.address);
  await form.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();await form.getByRole('button',{name:'필지 선택',exact:true}).click();await form.getByRole('button',{name:'필지 초안에 추가',exact:true}).click();
  await form.getByLabel(parcel.address+' 작업면적',{exact:true}).fill('1000');await form.getByLabel(parcel.address+' 토지형태',{exact:true}).selectOption('paddy');
  await form.getByRole('button',{name:'선택 농지 저장',exact:true}).click();await form.getByRole('button',{name:'다음',exact:true}).click();
  await form.getByRole('radio',{name:/완전위탁형/}).check();await form.getByText('농지·기후 확인값',{exact:true}).click();await form.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
  await form.getByLabel('용수 확보',{exact:true}).selectOption('yes');await form.getByLabel('작업 장비 진입',{exact:true}).selectOption('yes');await form.getByLabel('필수 인력 확보',{exact:true}).selectOption('yes');
  await form.getByLabel('검토 지역',{exact:true}).fill('계북면');await form.getByRole('combobox',{name:/쌀 · 지역·품종 적합성 검토/}).selectOption('suitable');
  await form.getByLabel('확인일',{exact:true}).fill(today);await form.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill('격리 통합검증 입력 · 실제 소유 및 영농 적합성을 확인한 자료가 아님');
  await form.getByRole('checkbox',{name:/정보 이용 및 작물 선택 위임/}).check();
  const submitted=page.waitForRequest(r=>r.url().includes('/api/registrations')&&r.method()==='POST');
  const receipt=await clickResponse(page,'/api/registrations',undefined,()=>form.getByRole('button',{name:'다음',exact:true}).click());
  expect(receipt.production.items[0].status,JSON.stringify(receipt)).toBe('REVIEW');expect(receipt.rights).toBe('pending');
  // Retry a lost response with the same identity. It must return the original receipt.
  expect((await post(request,'/api/registrations',(await submitted).postDataJSON())).consultationId).toBe(receipt.consultationId);
  const panel=page.getByTestId('continuous-production');await expect(panel).toContainText(parcel.address);
  await panel.getByText('작업·장비·인력 계획 보기',{exact:false}).click();await expect(panel.locator('tbody tr')).toHaveCount(6);
  await panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
  const approved=await clickResponse(page,'/api/continuous-production','approve',()=>panel.getByRole('button',{name:'선택 1필지 계획 일괄 확정',exact:true}).click());
  expect(approved.assigned).toBe(6);await expect(panel).toContainText('다음 재배 연결됨');
  const live=await (await request.get('/api/workspace')).json();expect(live.state.fields).toHaveLength(index+1);expect(live.state.missions).toHaveLength((index+1)*6);
  if(index===0){firstMissions=live.state.missions;firstPlan=(await db.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'cultivationPlan'}})).payload}
  else{expect(live.state.missions.slice(0,6)).toEqual(firstMissions);expect((await db.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'cultivationPlan',payload:{path:['plots','0','pnu'],equals:parcelsUsed[0].pnu}}})).payload).toEqual(firstPlan)}
 }
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}})).toBe(2);
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'annualReservation'}})).toBe(12);
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'laborDemand'}})).toBe(12);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBe(6);
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();
 await page.getByRole('combobox',{name:'일정 연도',exact:true}).selectOption(String(year));
 await page.getByRole('button',{name:'4월',exact:true}).click();
 await expect(page.getByTestId('ops-schedule')).toContainText(date('04-08'));
 await page.goto('/?tab=labor');
 for(const name of ['홍먼길','홍가까']){
  await page.getByRole('button',{name:'＋ 인력 등록',exact:true}).click();const modal=page.getByRole('dialog');
  await modal.getByLabel('이름',{exact:true}).fill(name);await modal.getByLabel('생년월일',{exact:true}).fill('1965-01-01');await modal.getByLabel('전화번호',{exact:true}).fill('000-0000-0000');await modal.getByLabel('주소',{exact:true}).fill('계북면 검증용 거주지');
  await modal.getByLabel('일',{exact:true}).check();await modal.getByLabel('토',{exact:true}).check();
  await modal.getByLabel('실제 개인정보가 포함되지 않았음을 확인합니다.',{exact:true}).check();await clickResponse(page,'/api/labor-operations','person',()=>modal.getByRole('button',{name:'희망자 저장',exact:true}).click());
 }
 const initialLabor=await (await request.get('/api/labor-operations')).json();const demand=initialLabor.demands.find((d:any)=>d.address===parcelsUsed[0].address&&d.task.includes('종자'));
 expect(demand).toBeTruthy();
 const months=(Number(demand.date.slice(0,4))-Number(today.slice(0,4)))*12+Number(demand.date.slice(5,7))-Number(today.slice(5,7));
 for(let n=0;n<months;n++)await page.getByRole('button',{name:'다음 달 보기',exact:true}).click();
 await page.getByRole('button',{name:new RegExp('^'+demand.date+' ')}).click();
 await page.getByRole('dialog').locator('.task-row').filter({hasText:parcelsUsed[0].address}).getByRole('button').click();
 const invite=page.getByRole('dialog');await invite.getByLabel('보수·근무 조건',{exact:true}).fill('검증용 조건 · 실제 임금 지급 없음');await invite.getByLabel('전문 장비 운전이 아닌 단순 작업임을 확인',{exact:true}).check();
 await clickResponse(page,'/api/labor-operations','open',()=>invite.getByRole('button',{name:'모집 안내 기록',exact:true}).click());
 await page.getByRole('button',{name:new RegExp('^'+demand.date+' ')}).click();await page.getByRole('dialog').locator('.task-row').filter({hasText:parcelsUsed[0].address}).getByRole('button').click();
 const assignment=page.getByRole('dialog');
 for(const [name,distance,response] of [['홍먼길','2','APP'],['홍가까','0.4','PHONE']]){
  const input=assignment.getByLabel(name+' 거리',{exact:true});await input.fill(distance);await clickResponse(page,'/api/labor-operations','distance',()=>input.press('Tab'));
  await clickResponse(page,'/api/labor-operations','response',()=>assignment.getByLabel(name+' 참석',{exact:true}).selectOption(response));
 }
 const allocated=await (await request.get('/api/labor-operations')).json(),job=allocated.payload.jobs.find((j:any)=>j.missionId===demand.id);
 const nearby=allocated.payload.people.find((p:any)=>p.name==='홍가까');expect(job.assigned).toEqual([nearby.id]);expect(job.invited).toHaveLength(2);
 await assignment.getByRole('button',{name:'닫기',exact:true}).click();
 // Same UI comparison and approval, real solver via HTTP and real persisted reservations.
 await page.getByRole('navigation').getByRole('button',{name:'메인',exact:true}).click();await page.getByRole('button',{name:'일정재조정',exact:true}).click();
 const select=page.getByRole('dialog');await select.getByLabel('작업일',{exact:true}).fill(demand.date);
 const chosen=select.getByRole('checkbox');await expect(chosen).not.toHaveCount(0);for(const c of await chosen.all())await c.uncheck();
 await select.getByRole('checkbox',{name:new RegExp(parcelsUsed[0].address+' · '+demand.task)}).check();await select.getByRole('button',{name:'선택 작업 일정변경',exact:true}).click();
 const change=page.getByRole('dialog');const preferred=new Date(Date.parse(demand.date)+86400000).toISOString().slice(0,10);
 await change.getByLabel('변경 희망일 (비우면 자동 지정)',{exact:true}).fill(preferred);await change.getByLabel('변경 사유',{exact:true}).fill('참석 확정 후 일정 변경 통합검증');
 await clickResponse(page,'/api/replanning','compare',()=>change.getByRole('button',{name:'변경 대안 비교',exact:true}).click());
 await expect(change.locator('.replan-option')).toHaveCount(2);
  await expect(change.getByTestId('planning-recommendation')).toContainText('계산 기준 추천');
  await change.getByTestId('planning-recommendation').getByText('판단 근거',{exact:true}).click();
  await expect(change.getByTestId('planning-recommendation')).toContainText('유료 AI를 호출하지 않았습니다');
  await page.screenshot({path:info.outputPath('planning-recommendation.png'),fullPage:true});
 const preview=await clickResponse(page,'/api/replanning','preview',()=>change.getByRole('button',{name:'충돌 관련 일정 재배치 · 선택',exact:true}).click());expect(preview.status).toBe('FEASIBLE');
 await clickResponse(page,'/api/replanning','approve',()=>change.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click());
 const afterLabor=await (await request.get('/api/labor-operations')).json();const stale=afterLabor.payload.jobs.find((j:any)=>j.id===job.id),renewed=afterLabor.payload.jobs.find((j:any)=>j.replacesJobId===job.id);
 expect(stale.status).toBe('STALE');expect(renewed.date).toBe(preferred);expect(renewed.assigned).toEqual([]);expect(renewed.responses).toEqual({});
 expect(afterLabor.payload.notices.filter((n:any)=>n.jobId===renewed.id&&n.type==='RECONFIRM')).toHaveLength(2);
 await page.getByRole('navigation').getByRole('button',{name:'인력관리',exact:true}).click();
 for(let n=0;n<months;n++)await page.getByRole('button',{name:'다음 달 보기',exact:true}).click();
 await page.getByRole('button',{name:new RegExp('^'+preferred+' ')}).click();
 await page.getByRole('dialog').locator('.task-row').filter({hasText:parcelsUsed[0].address}).getByRole('button').click();
 await clickResponse(page,'/api/labor-operations','response',()=>page.getByRole('dialog').getByLabel('홍가까 참석',{exact:true}).selectOption('PHONE'));
 const reconfirmed=await (await request.get('/api/labor-operations')).json();expect(reconfirmed.payload.jobs.find((j:any)=>j.id===renewed.id).assigned).toEqual([nearby.id]);
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'데모',exact:true}).click();await page.getByText('일정 변경·모의 알림 이력',{exact:true}).click();
 await clickResponse(page,'/api/operations','deliver',()=>page.getByRole('button',{name:'대기 알림 모의 수신 처리',exact:true}).click());
 await expect(page.getByRole('status')).toContainText('수신 처리됨');
 await page.getByRole('navigation').getByRole('button',{name:'농부 화면',exact:true}).click();await expect(page.locator('.phone')).toContainText('홍가람');await expect(page.locator('.phone article')).toContainText(preferred);
 await page.screenshot({path:'test-results/intake-live-db-final.png',fullPage:true});
 const final=await (await request.get('/api/workspace')).json();expect(final.state.fields).toHaveLength(2);expect(final.state.missions).toHaveLength(12);expect(final.notices.some((n:any)=>n.status==='DELIVERED'&&n.body.includes(preferred))).toBe(true);
 expect((await post(request,'/api/operations',{action:'deliver',key:randomUUID()})).result.delivered).toBe(0);
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'preservationSentinel',id:'existing'}}})).payload).toEqual({untouched:true});
 expect(await db.aiCall.count()).toBe(beforeCalls);
 await page.goto('/regions');
 const scope=page.locator('section').filter({has:page.getByRole('heading',{name:'개발 대상 지역 · 장수군 4개 면'})});
 await expect(scope.locator('tbody tr')).toHaveCount(4);
 await expect(scope).toContainText('장계농협 천천지점');await expect(scope).toContainText('장계농협 계북지점');await expect(scope).toContainText('장계농협 계남지점');
 await info.attach('verified-flow',{body:JSON.stringify({database:'kfarm_intake_e2e',registrations:2,tasks:12,sharedBookings:6,laborReconfirmed:true,businessApiMocks:false,externalCadastreFixture:true,paidInference:false,actualSms:false}),contentType:'application/json'});
});
