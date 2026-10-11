import {test,expect} from './authenticated-test';
test('reservation screen shows migration and linked cancellation controls',async({page})=>{
 await page.route('**/api/shared-reservations',r=>r.fulfill({json:{reservations:[{id:'test',centerId:'demo',resourceId:'DR01',taskId:'task',version:1,from:'2099-05-01T08:00:00+09:00',to:'2099-05-01T09:00:00+09:00'}]}}));
 await page.goto('/reservations');await expect(page.getByRole('heading',{name:'장비 예약 관리'})).toBeVisible();await expect(page.getByRole('button',{name:'충돌 사전 검사'})).toBeVisible();await page.getByRole('button',{name:'관리',exact:true}).click();await expect(page.getByRole('button',{name:'연결 작업 예약 취소·보류'})).toBeDisabled();await page.getByLabel('취소 사유').fill('재배정');await expect(page.getByRole('button',{name:'연결 작업 예약 취소·보류'})).toBeEnabled();
});
