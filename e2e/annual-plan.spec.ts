import {test,expect} from './authenticated-test';
import {buildAnnualPlan} from '../lib/annual-plan';
test('saved fields produce annual draft while dispatch remains blocked',async({page})=>{
 let stored:any=null;
 await page.route('**/api/annual-plan**',async route=>{
  if(route.request().method()==='POST'){
   const b=route.request().postDataJSON();expect(b.workspace).toBe('sandbox');expect(b.fieldVersion).toBe(1);
   stored=buildAnnualPlan([{pnu:'5274036023106160004',address:'Test field',crop:'rice',group:'',area:3000,mode:'joint',rights:'pending'}],b.year,1);
  }
  return route.fulfill({json:{version:stored?1:0,plan:stored,fieldVersion:1,fieldCount:1,stale:false}});
 });
 await page.goto('/');await page.getByRole('button',{name:'일정표',exact:true}).first().click();
 const panel=page.getByTestId('saved-annual-plan');
 await panel.getByRole('button',{name:'저장 농지로 계획 초안 생성'}).click();
 await expect(panel).toContainText('작업 5');
 await expect(panel).toContainText('조건 확인 대기');
 await panel.locator('summary').click();await expect(panel).toContainText('모내기·직파');
 await page.reload();await page.getByRole('button',{name:'일정표',exact:true}).first().click();
 await expect(panel).toContainText('계획 버전 1');
 await expect(panel.locator('details')).not.toHaveAttribute('open','');
});
