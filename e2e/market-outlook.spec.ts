import {test,expect} from './authenticated-test';
test.use({authRole:'SUPER_ADMIN'});
test('market evidence edits replace the original period and preserve English labels',async({page})=>{
 let version=1,policy:any={yields:[],targets:[],specialties:[],marketOutlooks:[{crop:'potato',commodity:'TEST_POTATO',from:'2027-04-01',to:'2027-08-31',pressure:'OVERSUPPLY_RISK',sourceUrl:'https://example.com/synthetic',method:'Synthetic UI fixture',checkedOn:'2026-10-01',validUntil:'2027-12-31'}]};
 const writes:any[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/production-coordination',async route=>{
  if(route.request().method()==='POST'){const b=route.request().postDataJSON();writes.push(b);policy=b.policy;return route.fulfill({json:{ok:true,version:++version}});}
  return route.fulfill({json:{policy,version,totals:[],unquantified:0,contributionCount:0,centerId:'global',centers:[{id:'demo',name:'계북면 농업지원센터'}],canManage:true,global:true}});
 });
 await page.goto('/crop-info?tab=references');const panel=page.getByTestId('production-coordination');await panel.locator('summary').first().click();
 await panel.getByText('기준자료 확인·입력',{exact:true}).click();
 await panel.getByRole('button',{name:'수정',exact:true}).click();
 await expect(panel.getByRole('combobox',{name:'기준 종류',exact:true})).toHaveValue('marketOutlooks');
 await panel.getByLabel('전망 적용 수확 종료일',{exact:true}).fill('2027-09-30');
 await panel.getByRole('button',{name:'기준 저장',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].policy.marketOutlooks).toHaveLength(1);expect(writes[0].policy.marketOutlooks[0].to).toBe('2027-09-30');
 await expect(panel).toContainText('과잉 공급 우려');await page.getByLabel('언어 / Language').selectOption('en');
 await expect(panel).toContainText('Oversupply risk');await expect(panel.getByRole('combobox',{name:'Source outlook',exact:true})).toBeVisible();
 await panel.screenshot({path:'.data/verification/market-outlook-edit.png'});expect(errors).toEqual([]);
});
