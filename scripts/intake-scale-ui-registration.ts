import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';

// One of the scale inputs goes through the visible form. Only the external
// cadastral lookup is replayed from its real provider snapshot; all business
// requests and AI/approval endpoints remain untouched.
export async function registerScaleFieldInBrowser(input:any,parcel:any,token:string,folder:string){
 const origin='http://127.0.0.1:3100',browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  await context.addCookies([{name:'kfarm_session',value:token,url:origin}]);
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/parcels?*',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('pnu')?{status:'READY',pnu:parcel.pnu,geometry:parcel.geometry}:{status:'READY',items:[{pnu:parcel.pnu,address:parcel.address}]}}));
  const c=input.command,f=c.consultation.fields[0];
  await page.goto(origin+'/register');const form=page.getByTestId('field-registration');
  await form.getByLabel('이름',{exact:true}).fill(c.consultation.farmer.name);
  await form.getByLabel('생년월일',{exact:true}).fill(c.consultation.farmer.birth.replaceAll('-',''));
  await form.getByLabel('주소',{exact:true}).fill(c.consultation.application.residence);
  await form.getByLabel('연락처',{exact:true}).fill(c.consultation.farmer.phone.replaceAll('-',''));
  await form.getByRole('button',{name:'다음',exact:true}).click();
  await form.getByRole('button',{name:'소유농지 조회',exact:true}).click();
  await form.getByRole('button',{name:'지번으로 농지 추가',exact:true}).click();
  await form.getByLabel('지번 검색어').fill(parcel.address);
  await form.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();
  await form.getByRole('button',{name:'필지 선택',exact:true}).click();
  await form.getByRole('button',{name:'필지 초안에 추가',exact:true}).click();
  await form.getByLabel(parcel.address+' 작업면적',{exact:true}).fill(f.area);
  await form.getByLabel(parcel.address+' 토지형태',{exact:true}).selectOption(f.conditions.landUse);
  await page.screenshot({path:folder+'/registration-selected-parcel.png'});
  await form.getByRole('button',{name:'선택 농지 저장',exact:true}).click();
  await form.getByRole('button',{name:'다음',exact:true}).click();
  await form.getByText('농지·기후 확인값',{exact:true}).click();
  await form.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
  for(const label of ['용수 확보','작업 장비 진입','필수 인력 확보'])await form.getByLabel(label,{exact:true}).selectOption('yes');
  await form.getByLabel('배수',{exact:true}).selectOption('good');
  await form.getByLabel('검토 지역',{exact:true}).fill(f.conditions.region);
  for(const [key,label] of [['rice','쌀'],['potato','감자'],['pepper','고추']])await form.getByLabel(label+' · 지역·품종 적합성 검토',{exact:true}).selectOption(f.conditions.climate[key]);
  await form.getByLabel('확인일',{exact:true}).fill(f.conditions.checkedOn);
  await form.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill(f.conditions.evidence);
  await form.getByRole('checkbox',{name:/정보 이용 및/}).check();
  const received=page.waitForResponse(r=>r.url().endsWith('/api/registrations')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'다음',exact:true}).click();
  const response=await received,result=await response.json();
  assert.equal(response.status(),200,JSON.stringify(result));
  await expect(page.getByRole('heading',{name:'신청완료',exact:true})).toBeVisible();
  await page.screenshot({path:folder+'/registration-saved.png'});
  assert.deepEqual(errors,[]);
  return {command:response.request().postDataJSON(),result,browserErrors:errors};
 }finally{await browser.close()}
}

export async function approveScalePlanInBrowser(token:string,pnus:string[],folder:string){
 const origin='http://127.0.0.1:3100',browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  await context.addCookies([{name:'kfarm_session',value:token,url:origin}]);const page=await context.newPage();
  await page.goto(origin+'/?tab=fields');
  await page.getByRole('button',{name:'AI 계획·일괄 확정',exact:true}).click();
  const panel=page.getByTestId('continuous-production');await expect(panel).toContainText('AI 통합계획 검토안');
  const boxes=panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true});await expect(boxes).toHaveCount(pnus.length);
  for(const box of await boxes.all())await box.check();
  await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
  const button=panel.getByRole('button',{name:`선택 ${pnus.length}필지 계획 일괄 확정`,exact:true});
  await button.scrollIntoViewIfNeeded();await page.screenshot({path:folder+'/approval-before.png'});
  const received=page.waitForResponse(r=>r.url().endsWith('/api/continuous-production')&&r.request().postDataJSON()?.action==='approve');
  await button.click();const response=await received,result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));
  const command=response.request().postDataJSON();assert.deepEqual([...command.pnus].sort(),[...pnus].sort());
  await expect(panel).toContainText('새 계획');await page.screenshot({path:folder+'/approval-saved.png'});
  return {command,result};
 }finally{await browser.close()}
}
