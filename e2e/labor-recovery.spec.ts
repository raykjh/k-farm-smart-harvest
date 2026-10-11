import {test,expect} from './authenticated-test';
import {randomUUID} from 'node:crypto';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';
import {seedMission} from '../tests/labor-recovery-fixture';
import {testSession} from '../tests/auth-fixture';
test('registers reserve duty, records absence in the real UI, and fills the gap without a fabricated attendance reply',async({page})=>{
 const fixture=await laborCapacityFixture();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const {m}=await seedMission('demo');
  await page.goto('/?tab=labor');await page.getByRole('button',{name:'＋ 인력 등록',exact:true}).click();
  const form=page.getByRole('dialog');await form.getByRole('combobox',{name:'인력 구분',exact:true}).selectOption('CENTER_RESERVE');
  await form.getByLabel('출근 확인된 대기근무일').fill(fixture.window.date);await form.getByLabel('이름',{exact:true}).fill('홍예비');await form.getByLabel('생년월일',{exact:true}).fill('1960-01-01');await form.getByLabel('전화번호',{exact:true}).fill('000-0000-0000');await form.getByLabel('주소',{exact:true}).fill('검증용 가상 주소');
  await form.getByRole('checkbox',{name:'실제 개인정보가 포함되지 않았음을 확인합니다.'}).check();await form.getByRole('button',{name:'희망자 저장'}).click();await expect(form).toHaveCount(0);
  let data=await (await page.request.get('/api/labor-operations')).json();const reserve=data.payload.people.find((p:any)=>p.name==='홍예비');expect(reserve.employment).toBe('CENTER_RESERVE');expect(reserve.standbyDates).toEqual([fixture.window.date]);
  async function apply(body:object){const r=await page.request.post('/api/labor-operations',{data:{...body,version:data.version,requestId:randomUUID()}});expect(r.status(),await r.text()).toBe(200);data=await (await page.request.get('/api/labor-operations')).json()}
  await apply({action:'open',demandId:m.id,pay:'조건 확인',simpleWorkConfirmed:true});const j=data.payload.jobs[0];expect(j.invited).not.toContain(reserve.id);
  await apply({action:'response',jobId:j.id,workerId:fixture.worker.id,response:'PHONE'});
  await page.reload();await page.getByText('전체 모집·과거 배정',{exact:true}).click();await page.getByRole('button',{name:/2032-09-01 · 수확/}).click();
  const job=page.getByRole('dialog');await job.getByLabel('변경 사유',{exact:true}).fill('당일 무통보 불참 확인');await job.getByRole('button',{name:'홍가상 불참 기록',exact:true}).click();
  await expect(job.getByLabel('홍예비 참석',{exact:true})).toHaveValue('STANDBY');await expect(job).toContainText('부족: 0');
  await expect(job.getByLabel('홍가상 수정 선택',{exact:true})).not.toBeChecked();await expect(job.getByLabel('홍예비 수정 선택',{exact:true})).toBeChecked();
  await page.screenshot({path:'.data/validation/20261003-labor-recovery/reserve-assigned.png',fullPage:true});
  await job.getByRole('button',{name:'닫기',exact:true}).click();
  const recovery=page.getByTestId('labor-recovery');await recovery.locator('summary').first().click();await expect(recovery).toContainText('현재 미해결 인력 대응 건이 없습니다.');await recovery.getByText('처리 이력',{exact:true}).click();await expect(recovery).toContainText('참석 확인 인력으로 충원');
  await page.screenshot({path:'.data/validation/20261003-labor-recovery/reserve-recovery.png',fullPage:true});
  await page.getByLabel('언어 / Language').selectOption('en');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(recovery).toContainText('confirmed reserve employees');
  expect(errors).toEqual([]);
 }finally{await fixture.cleanup()}
});

test('records a booked-window withdrawal from the owning center and shows recovery only to the receiving center',async({page,browser})=>{
 const fixture=await laborCapacityFixture(),session=await testSession('CENTER_ADMIN','janggye');
 const context=await browser.newContext({storageState:{cookies:[{name:'kfarm_session',value:session.token,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]}});
 try{
  const id=randomUUID();let r=await page.request.post('/api/labor-capacity',{data:{action:'offer',requestId:id,rosterVersion:1,window:fixture.window}});expect(r.status(),await r.text()).toBe(200);
  const receiver=await context.newPage();await receiver.goto('http://127.0.0.1:3100/?tab=labor');r=await receiver.request.post('/api/labor-capacity',{headers:{origin:'http://127.0.0.1:3100'},data:{action:'confirm',requestId:randomUUID(),id,version:1,reason:'지원시간 확정'}});expect(r.status(),await r.text()).toBe(200);
  await seedMission('janggye',[id]);await page.goto('/?tab=labor');const panel=page.getByTestId('labor-capacity');await panel.locator('summary').first().click();await panel.getByLabel('제안·확정·취소 사유').fill('지원 근무 철회 확인');await expect(panel.getByRole('button',{name:'예약 취소',exact:true})).toBeDisabled();
  page.once('dialog',d=>d.accept());await panel.getByRole('button',{name:'지원 철회 기록',exact:true}).click();await expect(panel.locator('tbody')).toContainText('지원 철회 · 재계획 대상');
  await receiver.reload();const recovery=receiver.getByTestId('labor-recovery');await recovery.locator('summary').first().click();await expect(recovery).toContainText('지원 근무 철회 확인');await recovery.getByRole('button',{name:/대체 인력·일정 비교/}).click();
  const modal=receiver.getByRole('dialog');await expect(modal).toContainText('센터 내 가용 인원');await expect(modal.getByText('고장 장비 대체',{exact:true})).toHaveCount(0);await modal.getByLabel('변경 사유',{exact:true}).fill('지원 철회 대체 일정 검토');await modal.getByRole('button',{name:'변경 대안 비교',exact:true}).click();await expect(modal.getByRole('region',{name:'변경 대안 비교 결과'})).toBeVisible();await expect(modal.getByTestId('replan-option-preserve')).toContainText('배치 불가');
  await receiver.screenshot({path:'.data/validation/20261003-labor-recovery/withdrawal-no-invented-staff.png',fullPage:true});
  const state=(await (await receiver.request.get('/api/workspace')).json()).state;expect(state.missions.find((m:any)=>m.id==='recovery-harvest')).toMatchObject({scheduledDate:fixture.window.date,laborSupportIds:[id],laborRecoveryRequired:true});
 }finally{await context.close();await session.cleanup();await fixture.cleanup()}
});
