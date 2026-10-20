import {test,expect} from './authenticated-test';
import {jointPublicView} from '../lib/integrated-plan-service';

// Mocked presentation fixtures. No inference, scheduling or approval DB proof.
const ownPnu='5274036023910000001',otherPnu='5274031023910000002';
const reference=(other=false)=>({version:other?'PRIVATE_OTHER_VERSION':'ui-synthetic-v1',sourceUrl:other?`https://example.com/PRIVATE_OTHER/${otherPnu}`:'https://example.com/synthetic-ui-only',asOf:'2026-10-19',checkedOn:'2026-10-19',validUntil:'2027-12-31',sourceDataKind:'SYNTHETIC_FIXTURE',priceBasis:'HISTORICAL_SCENARIO',priceStage:'FARM_GATE',harvestPeriod:{from:'2027-01-01',to:'2027-12-31'},costMode:'ITEMIZED'});
const assessment=(other=false)=>({status:'PARTIAL',comparable:false,revenue:{low:1000,base:2000,high:3000},knownCost:{low:500,base:800,high:1200},balanceAfterKnownCosts:{low:-200,base:1200,high:2500},reference:reference(other),missingComponents:['OTHER_COSTS_INCOMPLETE','REGISTERED_EQUIPMENT_RATE_REQUIRED']});
const evaluation=(id:string,crop='pepper')=>({
 id,status:'REVIEW_READY',metrics:{fields:2,readyFields:2,requiredTasks:4,missingTasks:0,borrowedTasks:0,personHours:8,meanSuitability:80,largestCropShare:.5,contractWorkers:0,dailyPersonShifts:2,reserveWorkers:1,supplyRiskFields:1,unassessedMarketFields:1,establishedSpecialtyFields:0,neighborCompatibleFields:1,specialtyTrialFields:1,assessedEconomicsFields:0,unassessedEconomicsFields:2,unfavorableBalanceWon:null,baseBalanceWon:null},
 mix:[{crop,areaM2:1000,share:.5},{crop:'rice',areaM2:1000,share:.5}],totals:{},staffing:[],equipment:[],requests:[],unknowns:['ECONOMIC_REFERENCE_OR_COSTS_INCOMPLETE'],
 economics:[{field:'F1',centerId:'demo',pnu:ownPnu,crop,areaM2:1000,assessment:assessment()},{field:'F2',centerId:'janggye',pnu:otherPnu,crop:'rice',areaM2:1000,assessment:assessment(true)}],
 views:[{centerId:'demo',view:{items:[{pnu:ownPnu,address:'검증 농지 A',farmer:'PRIVATE_FARMER'}]}},{centerId:'janggye',view:{items:[{pnu:otherPnu,address:'PRIVATE_OTHER_ADDRESS',farmer:'PRIVATE_OTHER_FARMER'}]}}],
 decisionContext:{fields:[{field:'F1',crop,nationalOutlook:'OVERSUPPLY_RISK',specialty:'DEVELOPMENT_CANDIDATE',participantSupply:'CONCENTRATION',neighborCompatible:true},{field:'F2',crop:'rice',nationalOutlook:'UNKNOWN',specialty:'NOT_REVIEWED',participantSupply:'INSUFFICIENT_DATA',neighborCompatible:null}]},
});
const draft=(same=false)=>({input:{requestId:'10000000-0000-4000-8000-000000000019',audience:'network'},status:'READY',source:'NEBIUS',fingerprint:'synthetic-ui-fingerprint',selected:evaluation('selected',same?'potato':'pepper'),baseline:evaluation('baseline','potato'),remaining:0,excluded:[],decision:{model:'UI_FIXTURE_NOT_INFERENCE',usage:[],evidence:{tradeoffs:[]}}});

test('field comparison shows changes, partial cost limits and downside scenarios in both languages without cross-center details',async({page},testInfo)=>{
 const raw=draft(),item=jointPublicView(raw,raw.fingerprint),encoded=JSON.stringify(item),mutations:string[]=[];
 expect(encoded).toContain('검증 농지 A');expect(encoded).not.toContain(otherPnu);expect(encoded).not.toContain('PRIVATE_OTHER');expect(encoded).not.toContain('PRIVATE_FARMER');expect(encoded).not.toContain('"pnu"');
 const unverified=JSON.stringify(jointPublicView(raw));expect(unverified).not.toContain('검증 농지 A');expect(unverified).not.toContain(ownPnu);
 await page.route('**/api/integrated-planning',route=>{if(route.request().method()!=='GET')mutations.push(route.request().method());return route.fulfill({json:{canPlan:true,canStage:true,items:[item]}})});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/crop-info?tab=capacity');await page.getByLabel('언어 / Language').selectOption('ko');
 const panel=page.getByRole('region',{name:'작물·자원 통합계획',exact:true});
 await expect(panel.getByRole('tab')).toHaveCount(3);
 const fields=panel.getByRole('table',{name:'농지별 작물 비교',exact:true}),own=fields.locator(':scope > tbody > tr').first();
 await expect(own.getByRole('cell').nth(1)).toHaveText('감자');await expect(own.getByRole('cell').nth(2)).toContainText('고추');await expect(own).toContainText('변경');
 await expect(fields.locator(':scope > tbody > tr').nth(1)).toContainText('F2');await expect(fields.locator(':scope > tbody > tr').nth(1)).toContainText('기준안과 동일');
 await expect(own).toContainText('수확기 공급과잉 주의');await expect(own).toContainText('특화 시험재배 후보');await expect(own).toContainText('경제성 미확인 · 금액 비교 불가');
 await own.locator('summary').click();
 const scenarios=own.getByRole('table',{name:'F1 경제성 시나리오',exact:true});
 await expect(scenarios.getByRole('row').filter({hasText:'확인 비용 차감 잔액'}).getByRole('cell').first()).toHaveText('-200 원');
 await expect(scenarios.getByRole('row').filter({hasText:'확인 비용'}).filter({hasNotText:'차감'}).getByRole('cell').first()).toHaveText('1,200 원');
 await expect(own).toContainText('순이익이 아니며');await expect(own).toContainText('가상 입력 검증자료');
 await panel.screenshot({path:testInfo.outputPath('integrated-economics-desktop.png')});
 await panel.getByRole('tab',{name:'비교 결과',exact:true}).click();
 await expect(panel.getByRole('row').filter({hasText:'불리한 조건 잔액 (원)'}).getByRole('cell').nth(1)).toHaveText('—');
 await expect(panel.getByRole('row').filter({hasText:'기본 적합도'})).toBeVisible();
 await page.getByLabel('언어 / Language').selectOption('en');
 const english=page.getByRole('region',{name:'Integrated crop and resource plan',exact:true});
 await expect(english).toContainText('Economically unassessed fields');
 await english.getByRole('tab',{name:'Crop mix',exact:true}).click();await expect(english).toContainText('Economics incomplete · amounts not comparable');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await english.screenshot({path:testInfo.outputPath('integrated-economics-mobile.png')});
 expect(errors).toEqual([]);expect(mutations).toEqual([]);
});

test('same baseline stays unchanged and absent scenario values render as unknown rather than zero',async({page})=>{
 const raw=draft(true);
 for(const part of [raw.selected,raw.baseline])for(const row of part.economics){Object.assign(row.assessment,{status:'UNKNOWN',revenue:null,knownCost:null,balanceAfterKnownCosts:null,reference:null,missingComponents:['CURRENT_MATCHING_ECONOMIC_REFERENCE_REQUIRED']});}
 const item=jointPublicView(raw,raw.fingerprint);
 await page.route('**/api/integrated-planning',route=>route.fulfill({json:{canPlan:false,canStage:false,items:[item]}}));
 await page.goto('/crop-info?tab=capacity');await page.getByLabel('언어 / Language').selectOption('en');
 const panel=page.getByRole('region',{name:'Integrated crop and resource plan',exact:true});
 const own=panel.getByRole('table',{name:'Field crop comparison',exact:true}).locator(':scope > tbody > tr').first();
 await expect(own).toContainText('Same as baseline');await own.locator('summary').click();
 const scenarios=own.getByRole('table',{name:'F1 economic scenarios',exact:true});await expect(scenarios.getByRole('cell')).toHaveText(Array(9).fill('—'));
 await panel.getByRole('tab',{name:'Comparison',exact:true}).click();await expect(panel).toContainText('Compared metrics equal the baseline.');
 await expect(panel.getByRole('row').filter({hasText:'Base balance (KRW)'}).getByRole('cell').nth(2)).toHaveText('—');
});
