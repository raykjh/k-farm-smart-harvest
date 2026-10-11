import {test,expect} from './authenticated-test';
import type {Page} from '@playwright/test';
import type {State} from '../lib/types';
import {emptyLaborOps} from '../lib/labor-operations';
import {intakeField} from '../lib/registration-intake';
const first='5274036023106160004',second='5274036023106160005';
const addresses=['전북특별자치도 장수군 계북면 농소리 616-4','전북특별자치도 장수군 계북면 농소리 616-5'];
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const geometry=(x:number)=>({type:'Polygon',coordinates:[[[x,35.78],[x+.001,35.78],[x+.001,35.781],[x,35.781],[x,35.78]]]});
test.beforeEach(async({page})=>{
 const state:State={name:'계북면',planVersion:1,fields:[],machines:[],missions:[],events:[],revisions:[],registered:false,planned:false,ruleVersion:'TEST',transportCount:2,staffCount:2};
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));
 await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'NOT_CONFIGURED'}}}));
 await page.route('**/api/fields',r=>r.fulfill({json:{version:7,payload:[]}}));
 await page.route('**/api/continuous-production',r=>r.fulfill({json:{view:{items:[],asOf:today,fingerprint:'a'.repeat(64)},criteria:{profiles:[]},criteriaVersion:0,canManage:true}}));
 await page.route('**/api/labor-operations',r=>r.fulfill({json:{version:1,payload:emptyLaborOps(),demands:[],scores:{}}}));
 await page.route('**/api/parcels?*',r=>{const p=new URL(r.request().url()).searchParams;return r.fulfill({json:p.has('pnu')?{status:'READY',pnu:p.get('pnu'),geometry:geometry(p.get('pnu')===first?127.60:127.601)}:{status:'READY',items:[first,second].map((pnu,i)=>({pnu,address:addresses[i]}))}})});
 await page.route('**/api/map-tile?*',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef4e9"/></svg>'}));
 // No browser test is allowed to submit business data outside its explicit mock.
 await page.route('**/api/registrations',r=>r.fulfill({status:500,json:{error:'Test write handler required'}}));
});
async function farmer(page:Page){
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('이름',{exact:true}).fill('홍가상');await dialog.getByLabel('생년월일',{exact:true}).pressSequentially('19600229');await expect(dialog.getByLabel('생년월일',{exact:true})).toHaveValue('1960-02-29');
 await dialog.getByLabel('주소',{exact:true}).fill('가상 신청인 주소');await dialog.getByLabel('연락처',{exact:true}).pressSequentially('00000000000');await expect(dialog.getByLabel('연락처',{exact:true})).toHaveValue('000-0000-0000');
 await dialog.getByRole('button',{name:'다음',exact:true}).click();await dialog.getByRole('button',{name:'소유농지 조회'}).click();await expect(dialog).toContainText('소유정보 조회 미연결');
}
async function addField(page:Page,index:number){
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'지번으로 농지 추가'}).click();await dialog.getByLabel('지번 검색어').fill('계북면 농소리');await dialog.getByRole('button',{name:'브이월드 지번 검색'}).click();await dialog.locator('.field-mini').filter({hasText:addresses[index]}).getByRole('button',{name:'필지 선택'}).click();await dialog.getByRole('button',{name:'필지 초안에 추가'}).click();
 await dialog.getByLabel(addresses[index]+' 작업면적',{exact:true}).fill('1000');await dialog.getByLabel(addresses[index]+' 토지형태',{exact:true}).selectOption('upland');
}
async function insideWorkArea(page:Page){
 const result=await page.evaluate(()=>{const m=document.querySelector('dialog')!.getBoundingClientRect(),side=document.querySelector('.sidebar')!.getBoundingClientRect(),header=document.querySelector('.topbar')!.getBoundingClientRect();return {x:m.x,y:m.y,right:m.right,bottom:m.bottom,side:side.right,header:header.bottom,w:innerWidth,h:innerHeight}});
 expect(result.x).toBeGreaterThanOrEqual(result.side);expect(result.y).toBeGreaterThanOrEqual(result.header);expect(result.right).toBeLessThanOrEqual(result.w);expect(result.bottom).toBeLessThanOrEqual(result.h);
}
test('four main actions open shared work-area dialogs, with no main attention queue',async({page})=>{
 await page.goto('/');await expect(page.locator('.home-quick-actions button')).toHaveText(['농지 등록','장비 등록','인력 등록','일정재조정']);await expect(page.getByTestId('task-attention')).toHaveCount(0);
 const thirds=page.getByTestId('calendar-day-'+today).locator('.calendar-task-count');await expect(thirds).toHaveCount(3);const boxes=await thirds.evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));expect(Math.max(...boxes)-Math.min(...boxes)).toBeLessThan(1);
 for(const action of ['농지 등록','장비 등록','인력 등록','일정재조정']){
  await page.locator('.home-quick-actions').getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await insideWorkArea(page);if(action==='장비 등록')await expect(page.getByLabel('장비명',{exact:true})).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 await page.screenshot({path:'test-results/intake-main.png',fullPage:true});
 await page.getByRole('navigation').getByRole('button',{name:'농지',exact:true}).click();await page.getByRole('button',{name:/신규 농지 등록/}).click();await expect(page.getByTestId('field-registration')).toBeVisible();await expect(page).toHaveURL(/\/$/);await insideWorkArea(page);
 await expect(page.getByRole('dialog')).not.toContainText('인쇄 / PDF');await expect(page.getByRole('dialog')).not.toContainText('상담 DB 저장');await page.screenshot({path:'test-results/intake-form.png',fullPage:true});
});
test('full delegation submits once through the common atomic registration endpoint with pending rights',async({page})=>{
 const writes:any[]=[];await page.route('**/api/registrations',r=>{const b=r.request().postDataJSON();writes.push(b);return r.fulfill({json:{consultationId:b.consultationId,fields:b.consultation.fields.length,rights:'pending',approvalRequired:true}})});
 await page.goto('/register');await farmer(page);await addField(page,0);const d=page.getByRole('dialog');await expect(d.getByRole('button',{name:'다음',exact:true})).toBeDisabled();await d.getByRole('button',{name:'선택 농지 저장'}).click();expect(writes).toHaveLength(0);await d.getByRole('button',{name:'다음',exact:true}).click();await d.getByRole('radio',{name:/완전위탁형/}).check();await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d.getByRole('alert')).toContainText('동의');expect(writes).toHaveLength(0);
 await d.getByRole('checkbox',{name:/정보 이용 및/}).check();await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d.getByRole('heading',{name:'신청완료'})).toBeVisible();expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({fieldVersion:7,cultivations:[],consultation:{farmer:{name:'홍가상',birth:'1960-02-29',phone:'000-0000-0000'},consent:true,fields:[{pnu:first,crop:'',mode:'delegated',tenure:'owned',verified:'pending',evidence:'none',area:'1000'}]}});
 expect(writes[0].consultation.fields[0]).not.toHaveProperty('geometry');expect(writes[0].continuousService).toMatchObject({from:today,until:null,continuousConsent:true});await expect(d).toContainText('농지별 생산현황');await d.getByRole('button',{name:'닫기',exact:true}).click();await expect(page).toHaveURL(/\/$/);
});
test('joint application orders crop choices by live boundary bonus and keeps explicit selections',async({page})=>{
 const writes:any[]=[];await page.route('**/api/registrations',r=>{const b=r.request().postDataJSON();writes.push(b);return r.fulfill({json:{consultationId:b.consultationId,fields:2}})});
 await page.goto('/register');await farmer(page);await addField(page,0);await addField(page,1);const d=page.getByRole('dialog');await d.getByRole('button',{name:'선택 농지 저장'}).click();await d.getByRole('button',{name:'다음',exact:true}).click();await d.getByRole('radio',{name:/공동참여형/}).check();await expect(d).toContainText('장비지원은 있으나 인력위탁은 없습니다.');await d.getByRole('checkbox',{name:/정보 이용 및/}).check();await d.getByRole('button',{name:'다음',exact:true}).click();
 const a=page.getByTestId('intake-crops-0'),b=page.getByTestId('intake-crops-1');await expect(b).toContainText('산정 대기');await b.locator('summary').click();
 await b.getByLabel('용수 확보',{exact:true}).selectOption('yes');await b.getByLabel('배수',{exact:true}).selectOption('good');await b.getByLabel('작업 장비 진입',{exact:true}).selectOption('yes');await b.getByLabel('필수 인력 확보',{exact:true}).selectOption('yes');await b.getByLabel('검토 지역',{exact:true}).fill('계북면');
 for(const crop of ['쌀','봄감자','노지고추'])await b.getByRole('combobox',{name:crop+' · 지역·품종 적합성 검토',exact:true}).selectOption('suitable');await b.getByLabel('확인일',{exact:true}).fill('2026-01-01');await b.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill('화면 검증용 근거');await b.locator('summary').click();
 await a.locator('input[value="pepper"]').check();await expect(b.locator('.intake-crop-options>label').first()).toContainText('고추');await expect(b.locator('.intake-crop-options>label').first()).toContainText('100점');await b.locator('input[value="pepper"]').check();
 await a.locator('input[value="potato"]').check();await expect(b.locator('.intake-crop-options>label').first()).toContainText('감자');await expect(b.locator('input[value="pepper"]')).toBeChecked();await expect(b.getByRole('radio',{name:/^고추/}).locator('..')).toContainText('95점');await b.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/intake-crop-ranking.png',fullPage:true});
 await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d).toContainText('신청완료');expect(writes).toHaveLength(1);expect(writes[0].consultation.fields.map((f:any)=>[f.pnu,f.crop,f.mode])).toEqual([[first,'potato','joint'],[second,'pepper','joint']]);
});
test('uncertain submission retries the same request, and mobile form stays within the viewport',async({page})=>{
 const writes:any[]=[];await page.route('**/api/registrations',r=>{const b=r.request().postDataJSON();writes.push(b);return r.fulfill(writes.length===1?{status:503,json:{error:'일시 연결 실패'}}:{json:{consultationId:b.consultationId,fields:1}})});
 await page.goto('/register');await farmer(page);await addField(page,0);const d=page.getByRole('dialog');await d.getByRole('button',{name:'선택 농지 저장'}).click();await d.getByRole('button',{name:'다음',exact:true}).click();await d.getByRole('radio',{name:/완전위탁형/}).check();await d.getByRole('checkbox',{name:/정보 이용 및/}).check();await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d.getByRole('alert')).toHaveText('일시 연결 실패');await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d).toContainText('신청완료');expect(writes[1]).toEqual(writes[0]);
 await d.getByRole('button',{name:'닫기',exact:true}).click();await page.setViewportSize({width:430,height:932});await page.goto('/register');await expect(page.getByRole('dialog')).toBeVisible();const box=await page.getByRole('dialog').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(431);await expect(page.getByLabel('이름',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/intake-mobile.png',fullPage:true});
});

test('existing consultation deep links retain saved farmer and parcel records without writes',async({page})=>{
 const id='33333333-3333-4333-8333-333333333333',writes:string[]=[];
 const {geometry,selected,...field}=intakeField(first,addresses[0]);
 const payload={farmer:{name:'홍기존',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},fields:[{...field,area:'1000',crop:'rice'}],consent:true,step:3};
 await page.route('**/api/consultations?*',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('id')?{id,version:3,payload}:{items:[{id,version:3,updatedAt:new Date().toISOString()}]}}));
 page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 await page.goto('/register?consultation='+id);await expect(page.getByTestId('registration')).toBeVisible();await expect(page.getByLabel('이름',{exact:true})).toHaveValue('홍기존');await page.getByRole('button',{name:'다음',exact:true}).click();await expect(page.getByLabel('지번 주소',{exact:true})).toHaveValue(addresses[0]);expect(writes).toEqual([]);
});

test('a rejected inventory version can be refreshed explicitly without discarding the form',async({page})=>{
 const writes:any[]=[];let reads=0;
 await page.route('**/api/fields',r=>r.fulfill({json:{version:++reads===1?7:8,payload:[]}}));
 await page.route('**/api/registrations',r=>{const b=r.request().postDataJSON();writes.push(b);return r.fulfill(writes.length===1?{status:409,json:{error:'상담 또는 농지가 변경되었습니다. 다시 불러오세요.'}}:{json:{consultationId:b.consultationId,fields:1}})});
 await page.goto('/register');await farmer(page);await addField(page,0);const d=page.getByRole('dialog');await d.getByRole('button',{name:'선택 농지 저장'}).click();await d.getByRole('button',{name:'다음',exact:true}).click();await d.getByRole('radio',{name:/완전위탁형/}).check();await d.getByRole('checkbox',{name:/정보 이용 및/}).check();await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d.getByRole('alert')).toContainText('다시 불러오세요');expect(writes).toHaveLength(1);await d.getByRole('button',{name:'다음',exact:true}).click();await expect(d).toContainText('신청완료');expect(writes.map(w=>w.fieldVersion)).toEqual([7,8]);expect(writes[1].consultation).toEqual(writes[0].consultation);
});
