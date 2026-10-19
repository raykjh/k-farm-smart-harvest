import {test,expect} from './authenticated-test';
import {smsFixture,offset} from '../tests/sms-fixture';
import {db} from '../lib/db';
test.use({authRole:'CENTER_STAFF'});
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
test('labor messages support failure, retry, deduplication and cancellation without owner SMS',async({page},info)=>{
 const f=await smsFixture(offset(today(),3)),calls=await db.aiCall.count(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const base=await db.center.findUniqueOrThrow({where:{id:'demo'}}),labor=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}});
  await page.goto('/?tab=labor&section=messages');const panel=page.getByTestId('sms-management');
  await expect(panel).toContainText('발송업체 미연결');await expect(panel.getByRole('button',{name:'소유주',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'발송 예정 점검',exact:true}).click();await expect(panel.locator('tbody tr')).toHaveCount(1);
  await panel.locator('tbody tr').filter({hasText:f.labor.people[0].name}).getByRole('button',{name:'상세',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'문자 상세',exact:true});await expect(modal).toContainText(f.labor.people[0].name);
  await modal.getByRole('button',{name:'실패 검증',exact:true}).click();await expect(modal.getByRole('button',{name:'모의 재시도',exact:true})).toBeEnabled();
  await expect(modal.getByRole('region',{name:'처리 이력',exact:true})).toContainText('실패');await modal.getByRole('button',{name:'모의 재시도',exact:true}).click();
  await expect(modal.getByRole('button',{name:'모의 발송 확인',exact:true})).toBeDisabled();await expect(modal.getByRole('region',{name:'처리 이력',exact:true})).toContainText('모의 발송 완료');
  await page.screenshot({path:info.outputPath('labor-sms-retry.png')});await page.keyboard.press('Escape');
  await panel.getByRole('button',{name:'발송 예정 점검',exact:true}).click();await expect(panel.locator('tbody tr')).toHaveCount(1);
  expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(base);expect(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}})).toEqual(labor);
  f.s.missions[0].scheduledDate=offset(today(),4);await f.save();await panel.getByRole('button',{name:'발송 예정 점검',exact:true}).click();
  await expect(panel.locator('tbody tr')).toHaveCount(1);await panel.getByRole('button',{name:'변경·취소 이력',exact:true}).click();await expect(panel.locator('tbody tr')).toHaveCount(0);
  await page.reload();await expect(panel).toBeVisible();await panel.getByRole('button',{name:'발송 예정 점검',exact:true}).click();await expect(panel.locator('tbody tr')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('labor-sms-mobile.png'),fullPage:true});
  expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
 }finally{await f.cleanup()}
});
