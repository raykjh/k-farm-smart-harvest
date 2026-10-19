import {test,expect} from './authenticated-test';
test('draft change screen recalculates and refreshes dispatch without business writes',async({page})=>{
 const id='c1e5330b-13ac-4d38-975b-f7b511b98510',pnu='5274036023106160004';let area=1000,saved=false;
 await page.route('**/api/fields*',r=>r.fulfill({json:{version:1,payload:[{pnu,address:'농소리 616-4',area,crop:'rice',mode:'joint',rights:'pending'}]}}));
 await page.route('**/api/cultivations*',r=>r.fulfill({json:{items:[{payload:{id,pnu,crop:'rice',start:'2034-01-01',end:'2034-12-31',source:'REGISTERED'}}]}}));
 await page.route('**/api/cultivation-change',r=>{
  const b=r.request().postDataJSON();expect(b.id).toBe(id);expect(b.area).toBe(1200);
  if(b.action==='save'){expect(b.token).toBe('screen-token');area=b.area;saved=true;}
  return r.fulfill({json:{token:'screen-token',saved:b.action==='save',tasks:10,dispatch:{assignments:[],pending:[]}}});
 });
 await page.route('**/api/annual-dispatch*',r=>r.fulfill({json:{cultivationId:id,token:'dispatch',assignments:[],pending:[]}}));
 await page.goto('/register');await page.getByText('재배 건 관리',{exact:false}).click();
 await page.getByText('농지·작물 변경안',{exact:true}).click();await page.getByLabel('변경 면적 (㎡)').fill('1200');
 await page.getByRole('button',{name:'변경 영향·재계획 계산'}).click();await expect(page.getByText('작업 10건',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'변경 초안 저장'}).click();await expect(page.getByRole('status').filter({hasText:'변경 초안을 저장했습니다'})).toBeVisible();expect(saved).toBe(true);
 await page.getByRole('button',{name:'배차 검토',exact:true}).click();await expect(page.getByRole('button',{name:'잠정 배차 저장',exact:true})).toBeDisabled();
});
test('approved-plan change requires review evidence and confirms once in UI',async({page})=>{
 const id='c1e5330b-13ac-4d38-975b-f7b511b98510',pnu='5274036023106160004';let approvals=0;
 await page.route('**/api/fields*',r=>r.fulfill({json:{payload:[{pnu,address:'농소리 616-4',area:1000,crop:'rice',mode:'full',rights:'pending'}]}}));
 await page.route('**/api/cultivations*',r=>r.fulfill({json:{items:[{payload:{id,pnu,crop:'rice',start:'2034-01-01',end:'2034-12-31',source:'REGISTERED'}}]}}));
 await page.route('**/api/cultivation-change',r=>{
  const b=r.request().postDataJSON();if(b.action==='approve'){approvals++;expect(b.review).toEqual({cost:'추가 실비 검토',consent:'농부 변경 동의 확인'});expect(b.token).toBe('review-token');}
  return r.fulfill({json:{token:'review-token',saved:b.action==='approve',approvedPlan:true,blockers:[],tasks:4,dispatch:{assignments:[],pending:[]},impact:{preserved:[{id:'old',name:'파종',date:'2034-03-01'}],removed:[],reservations:[],labor:[]}}});
 });
 await page.goto('/register');await page.getByText('재배 건 관리',{exact:false}).click();await page.getByText('농지·작물 변경안',{exact:true}).click();
 await page.getByLabel('변경 면적 (㎡)').fill('1200');await page.getByRole('button',{name:'변경 영향·재계획 계산'}).click();
 const approve=page.getByRole('button',{name:'변경계획 일괄 승인',exact:true});await expect(approve).toBeDisabled();
 await page.getByLabel('비용 검토 기록').fill('추가 실비 검토');await expect(approve).toBeDisabled();await page.getByLabel('소유주 동의·위임 근거').fill('농부 변경 동의 확인');
 page.on('dialog',d=>d.accept());await approve.click();await expect(page.getByRole('status').filter({hasText:'변경계획을 승인했습니다'})).toBeVisible();expect(approvals).toBe(1);
});
