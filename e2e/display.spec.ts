import {test,expect} from './authenticated-test';
test('calendar, equipment filters and large-text mobile farmer surface',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByTestId('ground-maintained')).toContainText('기존 일정 유지');await expect(page.getByTestId('ground-maintained')).toContainText('지상 파종');
 await page.getByTestId('weather-impact').screenshot({path:'test-results/weather-impact.png'});
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'일정표',exact:true}).click();await expect(page.getByRole('heading',{name:'2027년 6월'})).toBeVisible();
 await page.getByRole('button',{name:'장비',exact:true}).click();await page.getByRole('button',{name:/정비 필요/}).click();await expect(page.getByRole('heading',{name:'자동화 예정 수확기'})).toBeVisible();await expect(page.getByRole('heading',{name:'공동 방제드론 01'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'농부 화면',exact:true}).click();await expect(page.getByRole('button',{name:'올해 농사계획'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/farmer-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
