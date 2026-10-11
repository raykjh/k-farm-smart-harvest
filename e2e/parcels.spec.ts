import {test,expect} from './authenticated-test';
test('live field boundary lookup displays a polygon without persisting it',async({page})=>{
 test.skip(process.env.VWORLD_LIVE_VERIFY!=='1','Explicit real API opt-in');
 const before=await (await page.request.get('/api/demo')).json();
 await page.goto('/');await page.locator('nav').getByRole('button',{name:'농지·농가'}).click();
 await page.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();
 await page.getByRole('button',{name:'필지 선택',exact:true}).click();
 await expect(page.getByRole('img',{name:'조회한 필지 경계'})).toBeVisible();
 await expect(page.locator('[data-testid="parcel-search"] svg path')).not.toHaveCount(0);
 expect((await (await page.request.get('/api/demo')).json()).state).toEqual(before.state);
 await page.screenshot({path:'test-results/parcel-boundary.png',fullPage:true});
});
