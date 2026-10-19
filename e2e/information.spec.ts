import {test,expect} from './authenticated-test';

test('crop library, equipment cross-links, history, bilingual display and A4 printing',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/crop-info?crop=pepper');
 const detail=page.getByRole('article',{name:'작물 상세정보'});
 await expect(detail.getByRole('heading',{name:'고추',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'주 메뉴'})).toBeVisible();
 await expect(detail).toContainText('227–278 kg / 1,000 m²');
 await page.getByRole('button',{name:'생육·지역 기준',exact:true}).click();
 await expect(detail.getByRole('heading',{name:'저장된 공통·지역 기준'})).toBeVisible();
 await page.getByRole('button',{name:'작업·자원',exact:true}).click();
 await detail.getByRole('link',{name:'지상 방제기 ↗',exact:true}).click();
 await expect(page).toHaveURL(/equipment-info\?kind=SP/);
 await expect(page.getByRole('heading',{name:'지상 방제기',exact:true})).toBeVisible();
 await page.getByRole('complementary',{name:'장비 종류 목록'}).getByRole('button',{name:'방제 드론',exact:false}).click();
 await page.getByRole('button',{name:'모델 제원',exact:true}).click();
 await expect(page.getByRole('heading',{name:'DJI · AGRAS T50'})).toBeVisible();
 await expect(page.getByRole('article')).toContainText('6 m/s · 방제 허용 풍속 아님');
 await page.screenshot({path:'.data/validation/20261003-information-pages/equipment-ko.png',fullPage:true});
 await page.goBack();await expect(page).toHaveURL(/kind=SP/);
 await expect(page.getByRole('heading',{name:'지상 방제기',exact:true})).toBeVisible();
 await page.goto('/crop-info?crop=barley');
 await expect(page.getByRole('article')).toContainText('다음 해 05-20 ~ 06-20');
 await page.getByLabel('작물 검색').fill('고추');
 await page.getByRole('complementary',{name:'작물 목록'}).getByRole('button',{name:'고추',exact:false}).click();
 await expect(page).toHaveURL(/crop=pepper/);
 await page.screenshot({path:'.data/validation/20261003-information-pages/crop-ko.png',fullPage:true});
 await page.getByLabel('언어 / Language').selectOption('en');
 await expect(page.getByRole('heading',{name:'Crop information',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Pepper',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.data/validation/20261003-information-pages/crop-en-mobile.png',fullPage:true});
 await page.emulateMedia({media:'print'});
 await expect(page.getByRole('navigation')).toBeHidden();
 await expect(page.getByRole('heading',{name:'Saved common / regional standards'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Evidence / version'})).toBeVisible();
 await page.pdf({path:'.data/validation/20261003-information-pages/crop-pepper.pdf',preferCSSPageSize:true,printBackground:true});
 expect(errors).toEqual([]);
});

test('empty / error / invalid states and retry do not fabricate reference standards',async({page})=>{
 await page.route('**/api/regional-crop-standards',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));
 await page.goto('/crop-info?crop=potato');await page.getByRole('button',{name:'생육·지역 기준',exact:true}).click();
 await expect(page.locator('main').getByRole('alert')).toContainText('자료를 불러오지 못했습니다.');
 await page.unroute('**/api/regional-crop-standards');
 await page.route('**/api/regional-crop-standards',route=>route.fulfill({json:{items:[]}}));
 await page.getByRole('button',{name:'다시 불러오기'}).click();
 await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
 await expect(page.getByRole('article')).toContainText('이 작형에 저장된 지역 기준이 없습니다.');
 await page.goto('/equipment-info?kind=PS');await page.getByRole('button',{name:'모델 제원',exact:true}).click();
 await expect(page.getByRole('article')).toContainText('제조사 모델 제원은 아직 등록되지 않았습니다.');
 await expect(page.getByRole('button',{name:'센터 보유장비',exact:true})).toHaveCount(0);
 await page.goto('/crop-info?crop=not-a-crop');await expect(page.locator('main').getByRole('alert')).toContainText('해당 작물정보가 없습니다.');
 await page.goto('/equipment-info?kind=not-a-type');await expect(page.locator('main').getByRole('alert')).toContainText('해당 장비정보가 없습니다.');
});

test('center inventory retains model identity and links to the existing detail dialog',async({page})=>{
 const machine={id:'JB23DR99',name:'드론',type:'농업용 드론',ownerCenterId:'demo',status:'AVAILABLE',capacityHaHour:1,safetyLock:false,compatibleCrops:['rice'],ledger:{kind:'DR',manufacturer:'Example',model:'Field 1',product:'Local model',purchasedOn:'2026-01-01',servicePhone:'',notes:''}};
 await page.route('**/api/equipment-information',route=>route.fulfill({json:{centerId:'demo',machines:[machine]}}));
 await page.route('**/api/workspace**',route=>route.fulfill({json:{state:{name:'계북면 농업지원센터',fields:[],missions:[],machines:[machine],events:[],revisions:[],planVersion:1,centerSharing:{centerId:'demo',neighborCenterIds:[],loans:[]},staffCount:0,transportCount:0},notices:[],aiMode:'DEMO_RULES'}}));
 await page.goto('/equipment-info');await expect(page.getByRole('article')).not.toContainText('Field 1');
 await page.getByRole('link',{name:'장비현황으로',exact:true}).click();
 await page.getByRole('row').filter({hasText:'JB23DR99'}).getByRole('button',{name:'상세정보',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog')).toContainText('Field 1');
 await page.getByRole('link',{name:'장비 기능·모델 제원 보기 ↗'}).click();
 await expect(page).toHaveURL(/equipment-info\?kind=DR/);
});

test.describe('shared reference administration',()=>{
 test.use({authRole:'SUPER_ADMIN'});
 test('public crop facts are bilingual and remain inactive until reviewed and saved',async({page})=>{
  await page.goto('/crop-info?crop=garlic');
  await expect(page.getByRole('article')).toContainText('1,295–1,351 kg / 1,000 m²');
  await expect(page.getByRole('article')).toContainText('2025–2026');
  const before=await (await page.request.get('/api/production-coordination')).json();
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.getByRole('tab',{name:'Crop references',exact:true}).click();
  const panel=page.getByTestId('production-coordination');await panel.locator('summary').first().click();
  await panel.getByTestId('public-criteria').locator('summary').click();
  await expect(panel.getByTestId('public-criteria')).toContainText('12 / 30');
  await expect(panel.getByTestId('public-criteria')).toContainText('No national appropriate-supply target');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const table=page.getByRole('region',{name:'Public yield reference table'});
  expect(await table.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await page.getByTestId('public-criteria').screenshot({path:'.data/validation/20261003-public-criteria/public-criteria-en-mobile.png'});
  await panel.getByRole('button',{name:'Garlic load reference',exact:true}).click();
  await expect(panel.getByLabel('Valid until',{exact:true})).toHaveValue('');
  await expect(panel.getByLabel('Lower kg / 1,000m²',{exact:true})).toHaveValue('1295');
  const after=await (await page.request.get('/api/production-coordination')).json();expect(after.policy).toEqual(before.policy);expect(after.version).toBe(before.version);
 });
 test('global account can view both spaces and open crop-scoped standards without gaining inventory access',async({page})=>{
  await page.goto('/crop-info?crop=potato');await page.getByRole('button',{name:'생육·지역 기준',exact:true}).click();
  await page.getByRole('link',{name:'기준 작성·편집',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'작물·작형',exact:true})).toHaveValue('nongsaro:210005:감자');
  await page.goto('/equipment-info');await expect(page.getByRole('button',{name:'센터 보유장비',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'장비 이해·운용 조건',exact:true})).toBeVisible();
 });
});
