import {test,expect} from './authenticated-test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {db} from '../lib/db';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {seedReplacementDuration} from '../tests/replacement-duration-db-fixture';
import {replacementDay as day} from '../tests/replacement-duration-fixture';
import {testSession} from '../tests/auth-fixture';
import type {State} from '../lib/types';
const evidence='.data/validation/20261003-replacement-duration';
test.use({actionTimeout:15000});
test('reviews multi-day replacement duration, approves both reservations and reconfirms both days through screens',async({page,browser})=>{
 test.setTimeout(150000);
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated PostgreSQL required');
 const extraKinds=['equipmentFailure','resourceImpact','centerResourceNotice','planningDecision'];
 const extra=await db.workRecord.findMany({where:{kind:{in:extraKinds}}}),f=await laborCapacityFixture(),ownerSession=await testSession('CENTER_ADMIN','janggye');
 const ownerContext=await browser.newContext({storageState:{cookies:[{name:'kfarm_session',value:ownerSession.token,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]}});
 const owner=await ownerContext.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));owner.on('pageerror',e=>errors.push(e.message));
 const calls=await db.aiCall.count();mkdirSync(evidence,{recursive:true});
 try{
  await page.setViewportSize({width:1440,height:1000});
  const {m,closed}=await seedReplacementDuration(f.worker),lenderBefore=await db.center.findUniqueOrThrow({where:{id:'janggye'}});
  const edit=async(body:object)=>{const l=await (await page.request.get('/api/labor-operations')).json();const r=await page.request.post('/api/labor-operations',{data:{...body,version:l.version,requestId:randomUUID()}});expect(r.status(),await r.text()).toBe(200);};
  await edit({action:'open',demandId:m.id,pay:'격리된 근무 조건',simpleWorkConfirmed:true});
  const job=(await (await page.request.get('/api/labor-operations')).json()).payload.jobs[0];await edit({action:'response',jobId:job.id,workerId:f.worker.id,response:'PHONE'});
  await page.goto('/reservations');await page.getByText('장비 고장·수리 예정 기록',{exact:true}).click();await page.getByRole('combobox',{name:'고장 장비',exact:true}).selectOption('JB23TR01');await page.getByLabel('고장 발생일',{exact:true}).fill(day);await page.getByLabel('수리 예정일',{exact:true}).fill('2032-09-08');
  const failure=page.waitForResponse(r=>r.url().endsWith('/api/center-resources')&&r.request().method()==='POST');await page.getByRole('button',{name:'고장 기록·영향 조회',exact:true}).click();expect((await failure).status()).toBe(200);
  await owner.goto('http://127.0.0.1:3100/reservations');await owner.getByText('사전 허용 장비·공유 조건 관리',{exact:true}).click();await owner.getByRole('combobox',{name:'소유 장비',exact:true}).selectOption('JSJGTR01');await owner.getByRole('combobox',{name:'사용 센터',exact:true}).selectOption('demo');
  await owner.getByLabel('허용 시작일',{exact:true}).fill(day);await owner.getByLabel('허용 종료일',{exact:true}).fill('2032-09-03');await owner.getByLabel('협약·내부 승인 근거',{exact:true}).fill('격리 검증 사전 합의');await owner.getByLabel('작업기·진입·운영자·운송 조건',{exact:true}).fill('합성 운송·작업 조건 확인');await owner.getByRole('checkbox',{name:'JB23TR01',exact:true}).check();await owner.getByRole('checkbox',{name:/호환성·운영자·운송을 확인/}).check();
  const offer=owner.waitForResponse(r=>r.url().endsWith('/api/center-resources')&&r.request().method()==='POST');await owner.getByRole('button',{name:'사전 허용 저장',exact:true}).click();expect((await offer).status()).toBe(200);
  await page.goto('/?tab=schedule');await page.getByRole('combobox',{name:'일정 연도',exact:true}).selectOption('2032');await page.getByRole('button',{name:'9월',exact:true}).click();const daily=page.getByTestId('schedule-day-'+day);await daily.locator('summary').click();await daily.getByRole('button',{name:'관리',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유',{exact:true}).fill('느린 대체 장비의 소요시간을 반영한 분할');await modal.getByRole('button',{name:'변경 대안 비교',exact:true}).click();const option=modal.getByTestId('replan-option-preserve');await expect(option).toContainText('배치 가능');await expect(option).toContainText('여러 날로 나누는 작업: 2회');await expect(option.locator('.replan-option-dates')).toContainText('~');
  await option.getByRole('button',{name:'빈자리만 사용 · 선택',exact:true}).click();const review=modal.getByRole('region',{name:'선택안 상세 변경'});await expect(review).toContainText('분할 1/2');await expect(review).toContainText('분할 2/2');await expect(review).toContainText('추가 분할 작업');await expect(review).toContainText('360분 → 720분');expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);await review.getByRole('button',{name:/변경계획 일괄 승인·저장/}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/split-review-ko.png',fullPage:true});
  await review.getByRole('button',{name:/변경계획 일괄 승인·저장/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;expect(saved.missions).toHaveLength(3);expect(saved.missions.find(t=>t.id===closed.id)).toEqual(closed);expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(lenderBefore);expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(2);expect(await db.workRecord.count({where:{kind:'resourceReservation'}})).toBe(2);
  await page.goto('/?tab=labor');await page.getByText('전체 모집·과거 배정',{exact:true}).click();
  const labor=(await (await page.request.get('/api/labor-operations')).json()),renewed=labor.payload.jobs.filter((j:any)=>j.status==='OPEN');expect(renewed).toHaveLength(2);expect(labor.demands).toHaveLength(2);
  for(const j of renewed){expect(j.responses).toEqual({});await page.getByRole('button',{name:`${j.date} · ${j.task} · OPEN`,exact:true}).click();const assignment=page.getByRole('dialog');await assignment.getByRole('combobox',{name:'홍가상 참석',exact:true}).selectOption('PHONE');await expect(assignment).toContainText('부족: 0');await assignment.getByRole('button',{name:'닫기',exact:true}).click();}
  await page.getByText('안내·배정 변경·패널티 이력',{exact:true}).click();await expect(page.locator('.labor-panel')).toContainText('일정 변경 · 참석 재확인');await page.screenshot({path:evidence+'/split-attendance-ko.png',fullPage:true});
  await page.goto('/?tab=equipment');const packets=page.getByTestId('equipment-missions');await packets.locator('summary').first().click();const partSummary=packets.locator('summary').filter({hasText:'분할 1/2'});await partSummary.click();const partPacket=partSummary.locator('..');await expect(partPacket.getByText(/분할별 현장 작업구역 연결 필요/)).toBeVisible();await expect(partPacket.getByRole('button',{name:'전달자료 생성',exact:true})).toBeDisabled();
  await page.goto('/?tab=schedule');await page.getByLabel('언어 / Language').selectOption('en');await page.getByRole('combobox',{name:'Schedule year',exact:true}).selectOption('2032');await page.locator('.month-tabs').getByRole('button',{name:'9',exact:true}).click();
  await page.setViewportSize({width:390,height:844});const first=page.getByTestId('schedule-day-'+day);await first.locator('summary').click();await first.getByRole('button',{name:'Manage',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Reschedule');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:evidence+'/split-mobile-en.png',fullPage:true});
  expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
  writeFileSync(evidence+'/browser-result.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'kfarm_test',realBusinessApis:true,businessResponseInterception:false,slowerSharingOptionVisible:true,splitComparisonDatesAndDuration:true,parts:2,reservations:2,attendanceReconfirmedForBothDays:true,splitPacketBlockedWithoutWorkArea:true,completedAndOwnerRecordsPreserved:true,koreanDesktopEnglishMobile:true,paidAiCalls:0,actualSms:false,hardwareCommands:false},null,2));
 }finally{await ownerContext.close();await ownerSession.cleanup();await f.cleanup();await db.workRecord.deleteMany({where:{kind:{in:extraKinds}}});if(extra.length)await db.workRecord.createMany({data:extra as any});}
});
