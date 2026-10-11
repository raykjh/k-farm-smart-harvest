import {test,expect} from './authenticated-test';
test('shows candidate comparison and blocks incomplete approval without writing business data',async({page})=>{
 await page.route('**/api/delegated-planning',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{settings:{start:'2027-01-01',end:'2027-12-31',context:{region:'계북면'}}}});
  const body=route.request().postDataJSON();expect(body.action).toBe('preview');
  return route.fulfill({json:{plans:[],pending:[],demand:[],assigned:0,unassigned:2,approvalBlocked:true,comparisons:[{pnu:'test',address:'검증 필지',crop:'rice',score:95,status:'INCOMPLETE',assigned:2,reasons:['수확 장비 부족'],selected:false},{pnu:'test',address:'검증 필지',crop:'potato',score:70,status:'BLOCKED',assigned:0,reasons:['작업기간 확인 필요'],selected:false}]}});
 });
 await page.goto('/');await page.getByRole('button',{name:'농지',exact:true}).click();
 const panel=page.getByTestId('delegated-planning');
 await panel.getByRole('button',{name:'위탁 농지 배치안 계산',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'작물별 실행 가능성 비교'})).toBeVisible();
 await expect(panel.getByRole('cell',{name:'수확 장비 부족',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'작물·계획·배차 일괄 확정'})).toBeDisabled();
});
