import {test,expect} from './authenticated-test';
test('installed registrations are linked to the same fields and calendar',async({page,request})=>{
 const inv=await (await request.get('/api/fields')).json();
 const fields=inv.payload.filter((f:any)=>f.consultationId?.startsWith('20260000-'));
 expect(fields).toHaveLength(30);
 const c=await (await request.get('/api/consultations?id='+fields[0].consultationId)).json();
 expect(c.payload.farmer.name).toBe('홍길동');expect(c.payload.farmer.phone).toBe('010-0000-0001');
 expect(c.payload.fields[0].pnu).toBe(fields[0].pnu);
 await page.goto('/');await expect(page.getByTestId('ops-home')).toContainText('460');
 await page.getByRole('button',{name:'일정표',exact:true}).first().click();
 await expect(page.getByTestId('schedule-day-2026-01-15')).toBeVisible();
 await page.getByTestId('schedule-day-2026-01-15').locator('summary').click();
 await expect(page.getByTestId('schedule-day-2026-01-15')).toContainText('영농 상담');
 await page.screenshot({path:'test-results/registered-demo-schedule.png'});
 await page.goto('/register?consultation='+fields[0].consultationId);
 await expect(page.locator('input[value="홍길동"]')).toBeVisible();
});
