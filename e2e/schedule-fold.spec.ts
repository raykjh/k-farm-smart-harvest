import {test,expect} from './authenticated-test';
test('clean heading and collapsed daily schedule',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'지원현황',exact:true})).toBeVisible();
 await expect(page.locator('.stepper')).toHaveCount(0);
 await expect(page.getByText('NONGSO AGRICULTURE SUPPORT CENTER',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'일정표',exact:true}).first().click();
 const days=page.locator('[data-testid^="schedule-day-"]');
 expect(await days.count()).toBeGreaterThan(0);
 const first=days.first();
 await expect(first).not.toHaveAttribute('open','');
 await expect(first.locator('table')).not.toBeVisible();
 await first.locator('summary').click();
 await expect(first.locator('table')).toBeVisible();
 await first.locator('summary').click();
 await expect(first.locator('table')).not.toBeVisible();
});
