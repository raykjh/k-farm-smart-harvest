import {test,expect} from './authenticated-test';
import type {State} from '../lib/types';
import {emptyConditions} from '../lib/field-conditions';
import {planContinuousProduction,type Participation} from '../lib/continuous-production';
import type {FieldEntry} from '../lib/field-record';
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),pnu='5274036023106160004';
async function fixture(){
 const state:State={name:'계북면',planVersion:1,fields:[],missions:[],machines:['TR','RP','CB'].flatMap(code=>[1,2].map(n=>({id:`JB23${code}0${n}`,name:code,type:code,status:'AVAILABLE' as const,safetyLock:false,capacityHaHour:1}))),events:[],revisions:[],registered:true,planned:true,ruleVersion:'ISOLATED_UI',transportCount:2,staffCount:2};
 const f:FieldEntry={pnu,address:'계북면 농소리 616-4',area:1000,crop:'',mode:'full',group:'',rights:'pending',consultationId:'10000000-0000-4000-8000-000000000001',conditions:{...emptyConditions(),region:'계북면',landUse:'paddy',water:'yes',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'suitable',potato:'unsuitable',pepper:'unsuitable'},evidence:'격리 화면 검증',checkedOn:today}};
 const p:Participation={pnu,consultationId:f.consultationId!,receivedAt:today+'T01:00:00.000Z',status:'ACTIVE',term:{from:today,until:null,continuousConsent:true},changedAt:today+'T01:00:00.000Z',reason:'최초 동의'};
 const criteria={profiles:[{id:'test',name:'격리 검증 기준',context:{region:'계북면',operations:{rice:Object.fromEntries(['seed','nursery','soil','plant','harvest','finish'].map(code=>[code,{from:'2032-01-02',to:'2032-02-28',laborMinutesPer1000m2:30}]))}}}]};
 state.fields=[{id:pnu,farmerId:f.consultationId!,name:'홍가상',address:f.address,area:f.area!,crop:null,mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'',source:'REGISTERED'}];
 return {state,field:f,criteria,view:{...await planContinuousProduction({fields:[f],participations:[p],cycles:[],state,criteria,version:1,today,names:{[f.consultationId!]:'홍가상'},consentedPnus:[pnu]}),fingerprint:'a'.repeat(64),calculatedAt:new Date().toISOString()}};
}
test.beforeEach(async({page})=>{
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'NOT_CONFIGURED'}}}));await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/parcels?*',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));
 await page.route('**/api/map-tile?*',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'}));
 await page.route('**/api/integrated-planning',r=>r.fulfill({json:{canPlan:true,canStage:true,items:[]}}));
});
test('production opens continuous field history, then confirms a chosen new plan through the same endpoint',async({page})=>{
 const f=await fixture(),calls:any[]=[];let view=f.view;
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:f.state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/continuous-production',async r=>{const b=r.request().method()==='POST'?r.request().postDataJSON():null;if(b)calls.push(b);if(b?.action==='approve'){const item=view.items[0];view={...view,fingerprint:'b'.repeat(64),items:[{...item,status:'SCHEDULED',reason:'다음 재배가 이미 연결되어 있습니다.',history:[item.proposal!.cultivation],proposal:null}]};return r.fulfill({json:{ok:true,fields:1,assigned:6,notifications:1}})}return r.fulfill({json:{view,criteria:f.criteria,criteriaVersion:1,canManage:true}})});
 await page.setViewportSize({width:1440,height:1050});await page.goto('/?tab=production');await expect(page).toHaveURL(/tab=fields&section=planning/);await expect(page.getByRole('dialog',{name:'AI 계획·일괄 확정',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'농지별 생산현황'})).toBeVisible();await expect(page.getByRole('button',{name:'위탁 작물·계획'})).toHaveCount(0);
 await expect(page.getByTestId('continuous-production')).toContainText('새 계획 확인');expect(calls.every(c=>c.action==='refresh')).toBe(true);
 await page.getByText('작업·장비·인력 계획 보기',{exact:false}).click();await expect(page.locator('.production-field table tbody tr')).toHaveCount(6);
 await page.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();const approve=page.getByRole('button',{name:'선택 1필지 계획 일괄 확정'});await expect(approve).toBeDisabled();await page.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();await expect(approve).toBeEnabled();
 await page.screenshot({path:'test-results/continuous-production-review.png',fullPage:true});await approve.click();await expect(page.getByTestId('continuous-production').getByRole('status')).toContainText('1필지 · 6작업');await expect(page.getByTestId('continuous-production')).toContainText('다음 재배 연결됨');expect(calls.filter(c=>c.action==='approve')).toHaveLength(1);expect(calls.find(c=>c.action==='approve').pnus).toEqual([pnu]);
 await page.locator('.production-field summary').filter({hasText:'누적 재배기록'}).click();await expect(page.getByTestId('continuous-production')).toContainText('2032-01-02 – 2032-02-28');
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();await page.locator('.language-selector select').selectOption('en');await page.getByRole('button',{name:'AI planning / batch approval',exact:true}).click();await expect(page.getByRole('heading',{name:'Production by field'})).toBeVisible();await page.setViewportSize({width:430,height:932});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:'test-results/continuous-production-mobile.png',fullPage:true});
});
test('participation pause records a reason and the expected consent revision; criteria are not an enrollment window',async({page})=>{
 const f=await fixture(),calls:any[]=[];await page.route('**/api/workspace*',r=>r.fulfill({json:{state:f.state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/continuous-production',r=>{const b=r.request().method()==='POST'?r.request().postDataJSON():null;if(b)calls.push(b);return r.fulfill({json:{view:f.view,criteria:f.criteria,criteriaVersion:1,canManage:true}})});
 await page.goto('/?tab=production');await page.getByText('참여 기간·연속 관리',{exact:true}).click();await page.getByRole('combobox',{name:'참여 상태',exact:true}).selectOption('PAUSED');await page.getByLabel('확인·변경 사유',{exact:true}).fill('농부 요청에 따른 신규 배치 중지');await page.getByRole('checkbox',{name:/이 기간의 작물 선택/}).check();await page.getByRole('button',{name:'참여 조건 저장'}).click();await expect.poll(()=>calls.filter(c=>c.action==='participation').length).toBe(1);expect(calls.find(c=>c.action==='participation')).toMatchObject({status:'PAUSED',pnu,expectedChangedAt:f.view.items[0].participation!.changedAt});
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();await expect(page.getByRole('tab',{name:'생산현황',exact:true})).toHaveCount(0);await expect(page.getByTestId('managed-field-'+pnu)).toBeVisible();await expect(page.getByLabel('배치 대상 시작일')).toHaveCount(0);await expect(page.getByLabel('배치 대상 종료일')).toHaveCount(0);
});

test('each managed field retains its own production, crop editor and history without implicit planning',async({page})=>{
 const f=await fixture(),other='5274036023106160005',calls:any[]=[],inference:string[]=[];
 const past={...f.view.items[0].proposal!.cultivation,id:'20000000-0000-4000-8000-000000000001',start:'2025-03-01',end:'2025-10-31'};
 const view={...f.view,items:[{...f.view.items[0],history:[past]},{...f.view.items[0],pnu:other,address:'다른 농지 주소',farmer:'다른 소유주'}]};
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:f.state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/fields',r=>r.fulfill({json:{payload:[f.field]}}));
 await page.route('**/api/consultations?*',r=>r.fulfill({status:404,json:{error:'No consultation'}}));
 await page.route('**/api/cultivations',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/continuous-production',r=>{if(r.request().method()==='POST')calls.push(r.request().postDataJSON());return r.fulfill({json:{view,canManage:true}})});
 await page.route('**/api/integrated-planning',r=>{if(r.request().method()==='POST')inference.push(r.request().postData()!);return r.fulfill({json:{canPlan:true,canStage:true,items:[]}})});
 await page.setViewportSize({width:1440,height:1050});await page.goto('/?tab=fields');
 await expect(page.getByRole('tab',{name:'생산현황',exact:true})).toHaveCount(0);
 const row=page.getByTestId('managed-field-'+pnu);await expect(row).toContainText('새 계획 확인');
 await row.getByRole('button',{name:'관리',exact:true}).click();const dialog=page.getByRole('dialog',{name:'농지 관리',exact:true});
 await dialog.getByRole('tab',{name:'작물·생산',exact:true}).click();
 const panel=dialog.getByTestId('continuous-production');await expect(panel.locator('.production-field')).toHaveCount(1);
 await expect(dialog.getByRole('button',{name:'작물 선택하기',exact:true})).toBeVisible();
 await expect(panel).not.toContainText('다른 농지');await expect(panel.getByRole('region',{name:'작물·자원 통합계획',exact:true})).toHaveCount(0);
 await panel.getByText('누적 재배기록',{exact:false}).click();await expect(panel).toContainText('2025-03-01 – 2025-10-31');
 expect(calls).toEqual([]);expect(inference).toEqual([]);
 await dialog.screenshot({path:'test-results/field-production-ko.png'});
 await panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
 await panel.getByRole('button',{name:'선택 1필지 계획 일괄 확정',exact:true}).click();
 await expect.poll(()=>calls.filter(c=>c.action==='approve').length).toBe(1);expect(calls.find(c=>c.action==='approve').pnus).toEqual([pnu]);
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.locator('.language-selector select').selectOption('en');
 await row.getByRole('button',{name:'Manage',exact:true}).click();const english=page.getByRole('dialog',{name:'Field management',exact:true});
 await english.getByRole('tab',{name:'Crop / production',exact:true}).click();await expect(english.getByRole('heading',{name:'Production status',exact:true})).toBeVisible();
 await page.setViewportSize({width:430,height:932});await expect.poll(()=>english.evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await english.screenshot({path:'test-results/field-production-en-mobile.png'});
});

test('the previous production-section link opens preserved batch review; stale approval cannot be saved',async({page})=>{
 const f=await fixture(),calls:any[]=[];
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:f.state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/continuous-production',r=>{const b=r.request().method()==='POST'?r.request().postDataJSON():null;if(b)calls.push(b);return b?.action==='approve'?r.fulfill({status:409,json:{error:'계획이 변경되었습니다. 다시 확인하세요.'}}):r.fulfill({json:{view:f.view,canManage:true}})});
 await page.goto('/?tab=fields&section=production');const dialog=page.getByRole('dialog',{name:'AI 계획·일괄 확정',exact:true});
 await expect(dialog).toBeVisible();await expect(page).toHaveURL(/section=planning/);
 await dialog.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();await dialog.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();await dialog.getByRole('button',{name:'선택 1필지 계획 일괄 확정',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('계획이 변경되었습니다');expect(calls.filter(c=>c.action==='approve')).toHaveLength(1);await expect(dialog).not.toContainText('작업이 확정되었습니다');
});
