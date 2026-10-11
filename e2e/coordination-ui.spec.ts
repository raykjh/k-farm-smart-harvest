import {test,expect} from './authenticated-test';
import {emptyCenter} from '../lib/center-registry';

test('regional policy is editable in crop information and missing totals are not shown as zero production',async({page})=>{
 let saved:any=null;let version=0;
 await page.route('**/api/production-coordination',async route=>{
  if(route.request().method()==='POST'){saved=route.request().postDataJSON();version++;return route.fulfill({json:{ok:true,version}})}
  return route.fulfill({json:{policy:saved?.policy??{yields:[],targets:[],specialties:[]},version,totals:[],unquantified:3,contributionCount:3,centerId:'demo',centers:[{id:'demo',name:'계북면 농업지원센터'}],canManage:true,global:false}});
 });
 await page.goto('/crop-info');const panel=page.getByTestId('production-coordination');
 await panel.locator('summary').first().click();await expect(panel).toContainText('생산량 0 또는 수급 안정으로 해석하지 않습니다.');
 await panel.getByText('기준자료 확인·입력',{exact:true}).click();
 await panel.getByLabel('출처 URL',{exact:true}).fill('https://example.com/test-only');
 await panel.getByLabel('산출·검토 근거').fill('격리 화면 검증용 기준');await panel.getByLabel('유효 종료일').fill('2032-12-31');
 await panel.getByRole('button',{name:'기준 저장',exact:true}).click();
 await expect.poll(()=>saved?.policy.specialties.length).toBe(1);expect(saved.policy.specialties[0]).toMatchObject({centerId:'demo',crop:'rice',status:'ESTABLISHED'});
 await page.getByLabel('언어 / Language').selectOption('en');await expect(panel).toContainText('Registered production outlook');
 await page.screenshot({path:'.data/validation/20261003-ai-coordination/production.png',fullPage:true});
});

test('adjacent labor confirmation includes explicit consent, travel and attendance without sending SMS',async({page})=>{
 const submitted:any[]=[];
 await page.route('**/api/workspace**',r=>r.fulfill({json:{state:emptyCenter('demo'),notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/labor-sharing',async route=>{
  if(route.request().method()==='POST'){submitted.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}})}
  return route.fulfill({json:{centerId:'demo',canManage:true,version:1,workers:[{id:'10000000-0000-4000-8000-000000000001',name:'홍검증'}],jobs:[{centerId:'janggye',centerName:'장계면 농업지원센터',jobId:'job',sourceHash:'hash',date:'2032-09-01',startMinute:540,durationMinutes:60,task:'수확',address:'검증 농지',pay:'검증 입력',shortage:1}],offers:[],notices:[]}});
 });
 await page.goto('/?tab=labor');const panel=page.getByTestId('labor-sharing');await panel.locator('summary').first().click();
 await panel.getByLabel('지원할 인접센터 작업').selectOption('janggye:job');await panel.getByLabel('우리 센터 희망자').selectOption('10000000-0000-4000-8000-000000000001');
 await panel.getByLabel('편도 이동시간 (분)').fill('30');await panel.getByLabel('확인 거리 (km)').fill('5');
 const submit=panel.getByRole('button',{name:'지원 참석 등록·배정'});await expect(submit).toBeDisabled();
 await panel.getByRole('checkbox').check();await submit.click();await expect.poll(()=>submitted.length).toBe(1);expect(submitted[0]).toMatchObject({action:'offer',response:'PHONE',travelMinutes:30,distanceKm:5,consent:true});
 await page.screenshot({path:'.data/validation/20261003-ai-coordination/labor.png',fullPage:true});
});

test('equipment packet screen blocks missing work-area evidence and shows local-only execution boundary',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/workspace**',r=>r.fulfill({json:{state:emptyCenter('demo'),notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/equipment-missions',r=>r.fulfill({json:{canManage:true,fields:[{id:'5274036023106160004',address:'계북면 검증 농지'}],areas:[],tasks:[{id:'task',fieldId:'5274036023106160004',label:'방제',date:'2032-06-01',equipmentId:'JB23DR01',fingerprint:'a'.repeat(64),ready:false,status:'NOT_PREPARED',blockers:['OPERATOR_REVIEWED_WORK_AREA_REQUIRED'],data:{executionAuthorized:false,transport:'LOCAL_ADAPTER_ONLY'}}]}}));
 await page.goto('/?tab=equipment');const panel=page.getByTestId('equipment-missions');await panel.locator('summary').first().click();
 await panel.getByText('2032-06-01 · 방제 · JB23DR01',{exact:true}).click();
 await expect(panel).toContainText('현장 작업구역 확인 필요');await expect(panel.getByRole('button',{name:'전달자료 생성',exact:true})).toBeDisabled();await expect(panel).toContainText('실제 장비 전송·작동 승인은 하지 않습니다.');
 await panel.getByText('현장 확인 작업구역 저장',{exact:true}).click();await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.data/validation/20261003-ai-coordination/equipment-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
