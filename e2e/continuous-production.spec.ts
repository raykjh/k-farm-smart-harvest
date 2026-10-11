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
 return {state,criteria,view:{...await planContinuousProduction({fields:[f],participations:[p],cycles:[],state,criteria,version:1,today,names:{[f.consultationId!]:'홍가상'},consentedPnus:[pnu]}),fingerprint:'a'.repeat(64),calculatedAt:new Date().toISOString()}};
}
test.beforeEach(async({page})=>{
 await page.route('**/api/weather',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));await page.route('**/api/weather/forecast',r=>r.fulfill({json:{short:{status:'NOT_CONFIGURED'}}}));await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
});
test('production opens continuous field history, then confirms a chosen new plan through the same endpoint',async({page})=>{
 const f=await fixture(),calls:any[]=[];let view=f.view;
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:f.state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/continuous-production',async r=>{const b=r.request().method()==='POST'?r.request().postDataJSON():null;if(b)calls.push(b);if(b?.action==='approve'){const item=view.items[0];view={...view,fingerprint:'b'.repeat(64),items:[{...item,status:'SCHEDULED',reason:'다음 재배가 이미 연결되어 있습니다.',history:[item.proposal!.cultivation],proposal:null}]};return r.fulfill({json:{ok:true,fields:1,assigned:6,notifications:1}})}return r.fulfill({json:{view,criteria:f.criteria,criteriaVersion:1,canManage:true}})});
 await page.setViewportSize({width:1440,height:1050});await page.goto('/?tab=production');await expect(page.getByRole('heading',{name:'농지별 생산현황'})).toBeVisible();await expect(page.getByRole('button',{name:'위탁 작물·계획'})).toHaveCount(0);
 await expect(page.getByTestId('continuous-production')).toContainText('새 계획 확인');expect(calls.every(c=>c.action==='refresh')).toBe(true);
 await page.getByText('작업·장비·인력 계획 보기',{exact:false}).click();await expect(page.locator('.production-field table tbody tr')).toHaveCount(6);
 await page.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true}).check();const approve=page.getByRole('button',{name:'선택 1필지 계획 일괄 확정'});await expect(approve).toBeDisabled();await page.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();await expect(approve).toBeEnabled();
 await page.screenshot({path:'test-results/continuous-production-review.png',fullPage:true});await approve.click();await expect(page.getByRole('status')).toContainText('1필지 · 6작업');await expect(page.getByTestId('continuous-production')).toContainText('다음 재배 연결됨');expect(calls.filter(c=>c.action==='approve')).toHaveLength(1);expect(calls.find(c=>c.action==='approve').pnus).toEqual([pnu]);
 await page.locator('.production-field summary').filter({hasText:'누적 재배기록'}).click();await expect(page.getByTestId('continuous-production')).toContainText('2032-01-02 – 2032-02-28');
 await page.locator('.language-selector select').selectOption('en');await expect(page.getByRole('heading',{name:'Production by field'})).toBeVisible();await page.setViewportSize({width:430,height:932});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:'test-results/continuous-production-mobile.png',fullPage:true});
});
test('participation pause records a reason and the expected consent revision; criteria are not an enrollment window',async({page})=>{
 const f=await fixture(),calls:any[]=[];await page.route('**/api/workspace*',r=>r.fulfill({json:{state:f.state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/continuous-production',r=>{const b=r.request().method()==='POST'?r.request().postDataJSON():null;if(b)calls.push(b);return r.fulfill({json:{view:f.view,criteria:f.criteria,criteriaVersion:1,canManage:true}})});
 await page.goto('/?tab=production');await page.getByText('참여 기간·연속 관리',{exact:true}).click();await page.getByRole('combobox',{name:'참여 상태',exact:true}).selectOption('PAUSED');await page.getByLabel('확인·변경 사유',{exact:true}).fill('농부 요청에 따른 신규 배치 중지');await page.getByRole('checkbox',{name:/이 기간의 작물 선택/}).check();await page.getByRole('button',{name:'참여 조건 저장'}).click();await expect.poll(()=>calls.filter(c=>c.action==='participation').length).toBe(1);expect(calls.find(c=>c.action==='participation')).toMatchObject({status:'PAUSED',pnu,expectedChangedAt:f.view.items[0].participation!.changedAt});
 await page.getByRole('navigation').getByRole('button',{name:'설정',exact:true}).click();await expect(page.getByRole('heading',{name:'연속 생산 작업 기준'})).toBeVisible();await expect(page.getByLabel('기준 이름',{exact:true})).toHaveValue('격리 검증 기준');await expect(page.getByLabel('배치 대상 시작일')).toHaveCount(0);await expect(page.getByLabel('배치 대상 종료일')).toHaveCount(0);
});
