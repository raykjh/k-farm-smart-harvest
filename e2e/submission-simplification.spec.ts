import {test,expect} from './authenticated-test';
import {emptyCenter} from '../lib/center-registry';

const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),year=Number(today.slice(0,4));
test.beforeEach(async({page})=>{
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state:emptyCenter('demo'),notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/weather*',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));
 await page.route('**/api/parcels?*',r=>r.fulfill({json:{status:'NOT_CONFIGURED'}}));
 await page.route('**/api/map-tile?*',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'}));
});

test('field summary shows current, next and next task without candidate scores or repeated explanations',async({page},info)=>{
 const cycle={id:'onion',pnu:'field1',crop:'onion',start:`${year}-01-01`,end:`${year}-12-31`};
 const future={...cycle,id:'next',crop:'rice',start:`${year+1}-04-10`,end:`${year+1}-10-20`};
 const closed={...future,id:'closed',crop:'garlic',start:`${year+1}-01-01`,closedAt:today};
 const message='미확정 농지에 적용할 작기·위임·농지 조건을 먼저 확인하세요. 기존 확정 재배는 변경하지 않았습니다.';
 await page.route('**/api/continuous-production',r=>r.fulfill({json:{canManage:false,view:{fingerprint:'a'.repeat(64),asOf:today,error:message,items:[{pnu:'field1',address:'계북면 농소리 88',farmer:'홍정희',receivedAt:today,status:'BLOCKED',reason:Array(12).fill('추가 작물의 작업 기준 버전·입력 출처를 선택하세요.').join(' / '),current:cycle,history:[cycle,closed,future],nextTask:{id:'work',date:today,label:'토양 준비·경운'},proposal:null,comparisons:[{crop:'onion',score:100,status:'BLOCKED',reason:'기준 필요'},{crop:'garlic',score:100,status:'BLOCKED',reason:'기준 필요'}]}]}}}));
 await page.route('**/api/integrated-planning',r=>r.fulfill({json:{canPlan:false,canStage:false,items:[{requestId:'old',error:message,selected:null}]}}));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/?tab=fields&section=planning');
 const dialog=page.getByRole('dialog',{name:'AI 계획·일괄 확정',exact:true}),panel=dialog.getByTestId('continuous-production');
 await expect(panel.locator('.production-facts dt')).toHaveText(['현재 재배','다음 재배','다음 작업예정']);
 await expect(panel.locator('.production-facts dd')).toHaveText([`양파 · ${year}-01-01 – ${year}-12-31`,`쌀 · ${year+1}-04-10 – ${year+1}-10-20`,`${today} · 토양 준비·경운`]);
 await expect(panel.locator('.badge')).toHaveText('재배 중');
 await expect(panel.getByText(message,{exact:true})).toHaveCount(1);
 await expect(panel).not.toContainText('작물별 검토 근거');await expect(panel).not.toContainText('추가 작물의 작업 기준');await expect(panel).not.toContainText('다음 재배가 이미 연결');
 await panel.getByText('누적 재배기록 · 3',{exact:true}).click();await expect(panel).toContainText(`${year+1}-01-01 – ${year+1}-10-20 · 마늘`);
 await dialog.screenshot({path:info.outputPath('field-summary.png')});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('reports combine sources and preserve forecast/results tabs, corrections and unified snapshot input',async({page},info)=>{
 const date=`${year}-01-01`,base={cultivationId:'c1',fieldId:'f1',address:'농지 1',crop:'쌀',areaM2:1000,start:date,end:`${year}-12-01`,source:'SIMULATED',yieldRange:{low:500,high:600},yieldBasis:'저장 기준',commodity:'도정 쌀'};
 const entry={id:'e1',supersedesId:null,voided:false,kind:'SHIPMENT',cultivationId:'c1',fieldId:'f1',address:'농지 1',crop:'쌀',areaM2:1000,date,source:'SIMULATED',commodity:'도정 쌀',quantityKg:100,amountWon:10000,memo:'첫 출하',at:date+'T00:00:00Z',actor:'담당자'};
 const second={...entry,id:'e2',fieldId:'f2',address:'농지 2',source:'ACTUAL',memo:'두 번째 출하',quantityKg:50};
 const correction={...entry,id:'e3',supersedesId:'e1',memo:'출하 정정',quantityKg:90};
 await page.route('**/api/operating-ledger?*',r=>r.fulfill({json:{forecast:[base,{...base,fieldId:'f2',cultivationId:'c2',address:'농지 2',source:'ACTUAL'}],entries:[entry,second,correction],cycles:[],tasks:[],laborCosts:[]}}));
 const report={hash:'a'.repeat(64),schemaVersion:'work-report-v1',asOf:today,planVersion:1,rows:['SIMULATED','ACTUAL'].map((source,i)=>({missionId:'m'+i,fieldId:'f'+i,crop:'쌀',task:'수확',source,confirmed:true,status:'COMPLETED',plannedDate:date,originalPlannedDate:date,plannedMinutes:60,executionMinutes:60,finishedAt:date+'T01:00:00Z'}))};
 await page.route('**/api/work-reports',r=>r.fulfill({json:report}));let snapshot:any;
 await page.route('**/api/execution-records',r=>{if(r.request().method()==='POST')snapshot=r.request().postDataJSON();return r.fulfill({json:{history:[],snapshots:[]}})});
 await page.goto('/?tab=reports');const panel=page.getByTestId('annual-operating-reports');
 await expect(panel.getByRole('tab',{name:'예측',exact:true})).toBeVisible();await expect(panel).toContainText('1,000–1,200 kg');
 await expect(panel.getByLabel('자료 구분',{exact:true})).toHaveCount(0);
 await panel.getByRole('tab',{name:'실적',exact:true}).click();await expect(panel).toContainText('140 kg');
 await expect(panel.getByRole('row').filter({hasText:'두 번째 출하'})).toBeVisible();await expect(panel.getByRole('row').filter({hasText:'출하 정정'})).toBeVisible();await expect(panel.getByRole('row').filter({hasText:'첫 출하'})).toHaveCount(0);
 await panel.getByText('원본·정정 이력',{exact:true}).click();await expect(panel.getByText(/첫 출하/)).toBeVisible();
 await panel.getByText('작업 실적·보고서 확정본',{exact:true}).click();const work=panel.getByTestId('work-reports');await expect(work.locator('tbody tr')).toHaveCount(2);await expect(work.getByLabel('자료 구분')).toHaveCount(0);
 await panel.getByText('보고서 확정본 저장·조회',{exact:true}).click();await expect(panel.getByLabel('확정본 구분')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('unified-reports.png'),fullPage:true,timeout:15000});
 await Promise.all([page.waitForEvent('load'),panel.getByRole('button',{name:'보고서 확정본 저장',exact:true}).click()]);await expect.poll(()=>snapshot?.input.source).toBe('ALL');
 await expect(panel.getByRole('tab',{name:'예측',exact:true})).toBeVisible();
});

test('temperature page reuses saved center normals; climate edit does not send location changes',async({page},info)=>{
 const payload={center:{name:'계북면 농업지원센터',township:'계북면',office:'계북',prefix:'JB23'},version:1,settingsVersion:1,settings:{location:{longitude:127.6,latitude:35.8,nx:64,ny:89},climate:{datasetId:'jangsu',datasetVersion:2,evidence:{basis:'지역 검토',checkedOn:today}}},canManage:true,accounts:{admins:1,staff:1},resources:[],datasets:[{id:'jangsu',version:2,station:'장수',period:'1991–2020',days:122,sourceUrl:'https://data.kma.go.kr/'}]};
 const changes:any[]=[];await page.route('**/api/center-settings',r=>{if(r.request().method()==='POST')changes.push(r.request().postDataJSON());return r.fulfill({json:payload})});
 await page.goto('/temperature-info');await expect(page.getByRole('heading',{name:'기후 평년자료',exact:true})).toBeVisible();
 await expect(page.locator('.production-facts dd')).toHaveText(['장수','1991–2020','122일']);await expect(page.getByLabel('경도',{exact:true})).toHaveCount(0);await expect(page.getByLabel('예보 격자 X',{exact:true})).toHaveCount(0);
 expect(changes).toEqual([]);await page.screenshot({path:info.outputPath('saved-climate.png'),fullPage:true});
 await page.getByText('기후 자료 설정',{exact:true}).click();await page.getByLabel('확인 근거',{exact:true}).fill('저장 자료 재검토');await page.getByRole('button',{name:'평년자료 연결 저장',exact:true}).click();
 await expect.poll(()=>changes.length).toBe(1);expect(changes[0]).toMatchObject({action:'climate',climate:{datasetId:'jangsu',datasetVersion:2}});expect(changes[0]).not.toHaveProperty('location');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
