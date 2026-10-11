import {test,expect} from './authenticated-test';
test('registration prints entered values without navigation',async({page})=>{
 await page.goto('/register');
 await page.getByLabel('이름',{exact:true}).fill('홍서식');
 await page.getByLabel('거주 주소',{exact:true}).fill('계북면 가상 거주지');
 await expect(page.getByRole('button',{name:'인쇄 / PDF 저장'})).toBeEnabled();
 await page.emulateMedia({media:'print'});
 await expect(page.locator('.paper-print')).toBeVisible();
 await expect(page.locator('.paper-print')).toContainText('홍서식');
 await expect(page.locator('main')).toBeHidden();
 await page.emulateMedia({media:'screen'});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
