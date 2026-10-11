import {test,expect} from './authenticated-test';
test('operations views show counts, undated work and honest map without mutations',async({page})=>{
 const before=await (await page.request.get('/api/demo')).json();
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'UNAVAILABLE'}}));
 await page.goto('/');await expect(page.getByTestId('ops-home')).toBeVisible();
 await expect(page.getByTestId('ops-home')).toContainText('2027-06-15');
 await page.locator('nav').getByRole('button',{name:'일정표'}).click();
 await expect(page.getByTestId('ops-schedule')).toContainText('일자 미정');
 await page.locator('nav').getByRole('button',{name:'장비',exact:true}).click();
 await expect(page.getByTestId('ops-equipment')).toContainText('JB23DR01');
 await page.locator('nav').getByRole('button',{name:'농지·농가'}).click();
 await expect(page.getByTestId('ops-fields')).toContainText('참고 지번 선택');
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByTestId('ops-fields')).toContainText('Reference parcel');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/operations-mobile.png',fullPage:true});
 expect((await (await page.request.get('/api/demo')).json()).state).toEqual(before.state);
});
