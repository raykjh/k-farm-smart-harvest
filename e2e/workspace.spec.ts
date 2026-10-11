import {test,expect} from './authenticated-test';
test('legacy workspace URLs read the same dataset without a selector',async({page,request})=>{
 const a=await (await request.get('/api/workspace?workspace=sandbox')).json();
 const b=await (await request.get('/api/workspace?workspace=operations')).json();
 expect(b.state).toEqual(a.state);
 await page.goto('/');await expect(page.getByLabel('작업 공간',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'설정',exact:true})).toBeVisible();
});
