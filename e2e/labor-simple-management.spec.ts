import {test,expect} from './authenticated-test';
import {laborReviewFixture} from '../tests/labor-review-fixture';
import {readSms} from '../lib/sms-store';
import {db} from '../lib/db';
test.use({authRole:'CENTER_STAFF'});
test('calendar first, decline preview, cancel, save replacement SMS and confirmed attendance',async({page},info)=>{
 const f=await laborReviewFixture(),calls=await db.aiCall.count(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/?tab=labor');const panel=page.getByTestId('labor-workspace-panel');await expect(panel.getByRole('heading',{name:'비상시인력 3명'})).toBeVisible();
  expect(await panel.locator(':scope > section').first().getAttribute('class')).toContain('labor-calendar-section');
  for(const removed of ['개인정보·연결 상태','인명록','연도별 공통 보수','전체 모집·과거 배정','인접센터 지원·예외 처리'])await expect(panel.getByText(removed,{exact:true})).toHaveCount(0);
  const calendar=panel.getByRole('button',{name:f.date+' 필요인력 1 참석인력 0',exact:true});await expect(calendar).toHaveClass(/labor-shortage/);await calendar.click();
  let modal=page.getByRole('dialog',{name:f.date+' · 농지별 참석 명단'});await expect(modal).toContainText(f.s.fields[0].address);await expect(modal.getByLabel('홍문자 참석여부')).toHaveValue('');
  const before=await f.read(),sms=await readSms('demo');await modal.getByLabel('홍문자 참석여부').selectOption('DECLINED');await expect(modal.getByLabel('홍전화 참석여부')).toBeDisabled();await expect(modal).toContainText('추가 안내');
  expect(await f.read()).toEqual(before);expect(await readSms('demo')).toEqual(sms);await modal.getByRole('button',{name:'취소',exact:true}).click();await calendar.click();await expect(page.getByRole('dialog').getByLabel('홍문자 참석여부')).toHaveValue('');
  modal=page.getByRole('dialog');await modal.getByLabel('홍문자 참석여부').selectOption('DECLINED');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('저장했습니다.');
  await expect(modal.getByLabel('홍전화 참석여부')).toBeEnabled();await expect(modal.getByLabel('홍문자 참석여부')).toHaveValue('DECLINED');
  expect((await readSms('demo')).filter(m=>m.status==='QUEUED').map(m=>m.recipient.name)).toEqual(['홍전화']);
  await modal.getByLabel('홍전화 참석여부').selectOption('ATTENDING');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('저장했습니다.');
  await expect.poll(async()=>((await f.read()).payload as any).jobs[0].assigned).toEqual([f.labor.people[1].id]);await expect(modal.locator('.labor-day-summary')).toContainText('참석인력 1');
  await page.screenshot({path:info.outputPath('attendance-confirmed.png')});await modal.getByRole('button',{name:'취소',exact:true}).click();await expect(panel.getByRole('button',{name:f.date+' 필요인력 1 참석인력 1',exact:true})).toHaveClass(/labor-filled/);
  await page.reload();await expect(panel.getByRole('button',{name:f.date+' 필요인력 1 참석인력 1',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('labor-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('labor-mobile.png'),fullPage:true});
  expect((await readSms('demo')).every(m=>m.attempts===0)).toBe(true);expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
 }finally{await f.cleanup()}
});
test('four-field casual signup/edit and bulk employee roster with confirmed dispatch schedule',async({page},info)=>{
 const f=await laborReviewFixture(1);try{
  await page.goto('/?tab=labor');const casual=page.getByTestId('casual-workers'),regular=page.getByTestId('regular-workers');
  await casual.getByRole('button',{name:'＋ 추가',exact:true}).click();let modal=page.getByRole('dialog',{name:'비상시인력 등록'});await expect(modal.locator('input')).toHaveCount(4);await expect(modal.locator('select,textarea,input[type=checkbox]')).toHaveCount(0);
  await modal.getByLabel('이름',{exact:true}).fill('홍신규');await modal.getByLabel('생년월일',{exact:true}).fill('1960-03-21');await modal.getByLabel('연락처',{exact:true}).fill('010-0000-3333');await modal.getByLabel('주소',{exact:true}).fill('격리 테스트 주소');
  await modal.getByRole('button',{name:'취소',exact:true}).click();expect(((await f.read()).payload as any).people).toHaveLength(3);
  await casual.getByRole('button',{name:'＋ 추가',exact:true}).click();modal=page.getByRole('dialog');await modal.getByLabel('이름',{exact:true}).fill('홍신규');await modal.getByLabel('생년월일',{exact:true}).fill('1960-03-21');await modal.getByLabel('연락처',{exact:true}).fill('010-0000-3333');await modal.getByLabel('주소',{exact:true}).fill('격리 테스트 주소');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal).toHaveCount(0);
  await casual.locator('tbody tr').filter({hasText:'홍신규'}).getByRole('button',{name:'수정',exact:true}).click();modal=page.getByRole('dialog',{name:'비상시인력 수정'});await expect(modal.locator('input')).toHaveCount(4);await modal.getByLabel('이름',{exact:true}).fill('홍정정');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(casual).toContainText('홍정정');
  await regular.getByRole('button',{name:'관리',exact:true}).click();modal=page.getByRole('dialog',{name:'상시인력 관리'});for(let i=1;i<=3;i++){await modal.getByLabel('상시인력 '+i+' 이름',{exact:true}).fill('상시'+i);await modal.getByLabel('상시인력 '+i+' 전화번호',{exact:true}).fill('010-0000-100'+i)}await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal).toHaveCount(0);
  expect((await readSms('demo')).some(m=>m.recipient.name==='상시1'&&m.status==='QUEUED')).toBe(true);
  await page.getByRole('button',{name:f.date+' 필요인력 1 참석인력 0',exact:true}).click();modal=page.getByRole('dialog');await modal.getByLabel('상시1 참석여부').selectOption('ATTENDING');await modal.getByRole('button',{name:'저장',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('저장했습니다.');await modal.getByRole('button',{name:'취소',exact:true}).click();
  await regular.locator('tbody tr').filter({hasText:'상시1'}).getByRole('button',{name:'일정표 (1)',exact:true}).click();modal=page.getByRole('dialog',{name:'상시1 · 일정표'});await expect(modal).toContainText(f.date);await expect(modal).toContainText(f.s.fields[0].address);await page.screenshot({path:info.outputPath('employee-confirmed-schedule.png')});
 }finally{await f.cleanup()}
});
