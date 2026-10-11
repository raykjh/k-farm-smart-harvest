import {test,expect} from './authenticated-test';
test('catalog distinguishes source inventory from operational support',async({page,request})=>{
 const r=await request.get('/api/crop-catalog');expect(r.status()).toBe(200);
 const data=await r.json();expect(data.profiles).toHaveLength(106);
 // Catalog is read-only. Avoid unrelated live-weather and DB reads in this UI test.
 await page.route('**/api/weather**',route=>route.fulfill({status:503,body:'{}'}));
 await page.route('**/api/demo',route=>route.fulfill({status:503,body:'{}'}));
 await page.goto('/references');await page.getByText('전체 작물·작형 목록 (106개)',{exact:true}).click();const panel=page.getByTestId('crop-catalog');
 await expect(panel).toBeVisible();await panel.getByRole('combobox',{name:'분류',exact:true}).selectOption('ORCHARD');
 await expect(panel.getByRole('status')).toHaveText('19개 작물·작형');
 await panel.getByLabel('품목명 검색').fill('사과');await expect(panel.getByRole('status')).toHaveText('1개 작물·작형');
 await expect(panel).toContainText('목록 수록 · 작업 기준 검토 대기');
 await expect(panel).toContainText('과원 조성·수령·성목·다년 점유 확인 필요');
 await page.getByRole('combobox',{name:'언어 / Language'}).selectOption('en');
 await expect(panel.getByRole('status')).toHaveText('1 crop/practice entries');
 await expect(panel).toContainText('Catalog only; work profile pending');
});
