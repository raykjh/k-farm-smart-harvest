import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {smsFixture,offset} from '../tests/sms-fixture';
test.use({authRole:'CENTER_STAFF'});
test('settings contain only personal account actions; temperature and SMS remain in their own workspaces',async({page},info)=>{
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),f=await smsFixture(offset(today,3));
 let userId='';const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const before=await db.center.findMany({orderBy:{id:'asc'}}),calls=await db.aiCall.count();
  await page.goto('/?tab=settings');
  await expect(page.locator('.personal-settings-menu button')).toHaveText([/비밀번호 변경/,/담당자 정보변경/,/비밀번호 복구신청/]);
  await expect(page.getByRole('navigation').getByRole('button',{name:'데모',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'지도 중심·기상 예보 격자',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'기후 평년자료',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('sms-management')).toHaveCount(0);
  await page.getByRole('button',{name:'비밀번호 변경',exact:true}).click();await expect(page.getByRole('dialog',{name:'비밀번호 변경',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'담당자 정보변경',exact:true}).click();let dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('아이디',{exact:true})).toHaveAttribute('readonly','');await expect(dialog.getByLabel('소속',{exact:true})).toHaveAttribute('readonly','');
  await dialog.getByLabel('이름',{exact:true}).fill('홍설정');await dialog.getByLabel('생년월일',{exact:true}).fill('1980-01-02');await dialog.getByLabel('연락처',{exact:true}).fill('010-0000-0000');
  await dialog.getByRole('button',{name:'변경 저장',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('저장했습니다.');await page.keyboard.press('Escape');
  const auth=await (await page.request.get('/api/auth')).json();userId=auth.user.id;expect(auth.user).toMatchObject({name:'홍설정',role:'CENTER_STAFF',centerId:'demo'});
  await page.getByRole('button',{name:'비밀번호 복구신청',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'복구신청 접수',exact:true}).click();await expect(dialog.getByRole('button',{name:'복구신청 접수',exact:true})).toBeDisabled();await expect(dialog).toContainText('처리 대기');await page.keyboard.press('Escape');
  await page.reload();await expect(page.locator('.personal-settings-menu button')).toHaveCount(3);await page.screenshot({path:info.outputPath('settings.png'),fullPage:true});
  await page.getByRole('link',{name:'기온정보',exact:true}).click();await expect(page.getByRole('heading',{name:'기온정보',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'지도 중심·기상 예보 격자',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'기후 평년자료',exact:true})).toBeVisible();await expect(page.getByLabel('예보 격자 X',{exact:true})).toHaveCount(0);await expect(page.getByText('기후 자료 설정',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('temperature.png'),fullPage:true});
  await page.goto('/?tab=settings&section=messages');await expect(page).toHaveURL(/tab=labor&section=messages/);await expect(page.getByRole('tab',{name:'문자 관리',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByTestId('sms-management')).toBeVisible();
  await page.getByRole('tab',{name:'인력·배정',exact:true}).click();await expect(page.getByTestId('sms-management')).toHaveCount(0);await page.getByRole('tab',{name:'문자 관리',exact:true}).click();await expect(page.getByTestId('sms-management')).toBeVisible();
  await page.goto('/?tab=demo');await expect(page).not.toHaveURL(/tab=demo/);await expect(page.getByRole('button',{name:'데모',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});await page.goto('/?tab=settings');await expect(page.locator('.personal-settings-menu button')).toHaveCount(3);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('settings-mobile.png'),fullPage:true});
  expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(before);expect(await db.aiCall.count()).toBe(calls);expect(errors).toEqual([]);
 }finally{if(userId)await db.workRecord.deleteMany({where:{workspace:'auth',kind:'recoveryRequest',id:userId}});await f.cleanup()}
});
