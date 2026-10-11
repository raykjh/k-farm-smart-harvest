import {test,expect} from './authenticated-test';
test('reports retain the shared sidebar, language selector and download when opened from the menu',async({page})=>{
 await page.goto('/');const nav=page.getByRole('navigation');
 await nav.getByRole('button',{name:'실적·통계',exact:true}).click();
 await expect(page).toHaveURL(/\?tab=reports$/);
 await expect(nav.getByRole('button',{name:'실적·통계',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('heading',{name:'실적·통계',exact:true})).toHaveCount(1);
 await expect(page.getByRole('main')).toHaveCount(1);await expect(page.locator('.language-selector select')).toHaveCount(1);
 await expect(page.getByTestId('workspace-status')).toBeVisible();
 await expect(page.getByRole('button',{name:'내부 공통양식 내려받기 (JSON)'})).toBeVisible();
 await page.getByRole('combobox',{name:'자료 구분',exact:true}).selectOption('SIMULATED');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'내부 공통양식 내려받기 (JSON)'}).click();expect((await download).suggestedFilename()).toBe('kfarm-work-report.json');
 await page.locator('.language-selector select').selectOption('en');await expect(page.getByRole('heading',{name:'Results and statistics',exact:true})).toBeVisible();
 await expect(nav.getByRole('button',{name:'Results and statistics',exact:true})).toHaveAttribute('aria-current','page');
 await page.locator('.language-selector select').selectOption('ko');
 await nav.getByRole('button',{name:'일정표',exact:true}).click();await expect(page.getByRole('heading',{name:'일정표',exact:true})).toBeVisible();await expect(page).not.toHaveURL(/tab=reports/);
 await nav.getByRole('button',{name:'실적·통계',exact:true}).click();await page.reload();await expect(page.getByTestId('work-reports')).toBeVisible();await expect(nav.getByRole('button',{name:'실적·통계',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('button',{name:'내부 공통양식 내려받기 (JSON)'})).toBeVisible();
 await page.screenshot({path:'test-results/reports-sidebar.png',fullPage:true});
});
test('the former standalone report URL opens within the dashboard and can return to the main tab',async({page})=>{
 await page.goto('/reports');await expect(page).toHaveURL(/\?tab=reports$/);
 const nav=page.getByRole('navigation');await expect(nav.getByRole('button',{name:'실적·통계',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('heading',{name:'실적·통계',exact:true})).toBeVisible();
 await expect(page.getByText('작업 완료·정정 기록',{exact:true})).toBeVisible();
 await nav.getByRole('button',{name:'메인',exact:true}).click();await expect(page.getByRole('heading',{name:'지원현황',exact:true})).toBeVisible();
 await expect(page.getByTestId('work-reports')).toHaveCount(0);
});
