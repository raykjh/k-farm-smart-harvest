import {test,expect} from './authenticated-test';
test('main has no workspace controls and settings previews deletion',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'지원현황',exact:true})).toBeVisible();
 await expect(page.getByLabel('작업 공간',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'빈 운영 공간 생성'})).toHaveCount(0);
 await page.getByRole('link',{name:'설정',exact:true}).click();
 await expect(page.getByRole('heading',{name:'설정 · 데이터 관리',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'데모 데이터 삭제',exact:true})).toBeEnabled();
 page.once('dialog',d=>d.dismiss());
 await page.getByRole('button',{name:'데모 데이터 삭제',exact:true}).click();
 await expect(page.getByRole('button',{name:'데모 데이터 삭제',exact:true})).toBeEnabled();
});
