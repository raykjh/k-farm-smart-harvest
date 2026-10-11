import {test,expect} from './authenticated-test';
import {testSession} from '../tests/auth-fixture';
import {laborCapacityFixture} from '../tests/labor-capacity-fixture';

test('two centers offer, confirm and cancel support through real application APIs and PostgreSQL',async({page,browser})=>{
 const fixture=await laborCapacityFixture(),session=await testSession('CENTER_ADMIN','janggye');
 const receiverContext=await browser.newContext({storageState:{cookies:[{name:'kfarm_session',value:session.token,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]}});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  // No business API interception: synthetic DB inputs, real UI and persistence.
  await page.goto('/?tab=labor');const own=page.getByTestId('labor-capacity');await own.locator('summary').first().click();
  await expect(own.getByRole('option',{name:'홍가상'})).toHaveAttribute('value',fixture.worker.id);
  await own.getByRole('combobox',{name:'지원 희망자',exact:true}).selectOption(fixture.worker.id);
  await own.getByRole('combobox',{name:'지원받는 인접센터',exact:true}).selectOption('janggye');await own.getByLabel('지원일',{exact:true}).fill(fixture.window.date);
  await own.getByLabel('편도 이동시간').fill('30');await own.getByLabel('제안·확정·취소 사유').fill('화면 검증용 인력 지원');
  const offer=own.getByRole('button',{name:'지원시간 제안',exact:true});await expect(offer).toBeDisabled();await own.getByRole('checkbox').check();await offer.click();
  await expect(own.locator('tbody')).toContainText('수용 센터 확인 대기');
  const receiver=await receiverContext.newPage();receiver.on('pageerror',e=>errors.push(e.message));
  await receiver.goto('http://127.0.0.1:3100/?tab=labor');const incoming=receiver.getByTestId('labor-capacity');await incoming.locator('summary').first().click();
  await expect(incoming.locator('tbody')).toContainText('홍가상');await incoming.getByLabel('제안·확정·취소 사유').fill('수용 센터 지원 확정');
  await incoming.getByRole('button',{name:'지원시간 확정',exact:true}).click();await expect(incoming.locator('tbody')).toContainText('지원시간 확정');
  await own.getByRole('button',{name:'지원시간 새로고침'}).click();await expect(own.locator('tbody')).toContainText('지원시간 확정');
  await page.screenshot({path:'.data/validation/20261003-labor-capacity/confirmed-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByLabel('언어 / Language').selectOption('en');
  await expect(own).toContainText('Support window confirmed');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.data/validation/20261003-labor-capacity/confirmed-mobile.png',fullPage:true});
  await incoming.getByRole('button',{name:'예약 취소',exact:true}).click();await expect(incoming.locator('tbody')).toContainText('취소');
  await own.getByRole('button',{name:'Refresh capacity'}).click();await expect(own.locator('tbody')).toContainText('Cancelled');
  expect(errors).toEqual([]);
 }finally{await receiverContext.close();await session.cleanup();await fixture.cleanup()}
});
