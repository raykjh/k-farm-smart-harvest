import {test,expect} from './authenticated-test';
test('legacy workflow redirects to the shared registration and refuses mutations',async({page,request})=>{
 await page.goto('/workflow');await expect(page).toHaveURL(/\/register$/);
 await expect(page.getByRole('heading',{name:'신규 농지 등록 신청서'})).toBeVisible();
 const before=await(await request.get('/api/workflow-experience')).json();
 const result=await request.post('/api/workflow-experience',{data:{version:before.version,command:{action:'reset'}}});
 expect(result.status()).toBe(410);
 expect(await(await request.get('/api/workflow-experience')).json()).toEqual(before);
 await expect(page.getByText('실제 영농 적기 대신 작업별 8일 간격의 임시 기간을 적용합니다.')).toHaveCount(0);
});
