import {test,expect} from './authenticated-test';
import {emptyCenter} from '../lib/center-registry';

test('failed map tiles do not show enlarged broken-image icons or hide parcel overlays',async({page},info)=>{
 const state=emptyCenter('demo'),pnu='5274036023106160004';
 state.fields=[{id:pnu,farmerId:'test',name:'홍가상',address:'계북면 경계 표시 검증',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'test',source:'DEMO_ASSUMPTION'}];
 await page.route('**/api/workspace*',r=>r.fulfill({json:{state,notices:[],aiMode:'DEMO_RULES'}}));
 await page.route('**/api/work-history',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/continuous-production',r=>r.fulfill({json:{view:{items:[]}}}));
 await page.route('**/api/center-settings',r=>r.fulfill({json:{center:{id:'demo',township:'계북면'},settings:{location:{longitude:127.61,latitude:35.78}}}}));
 await page.route('**/api/parcels?*',r=>r.fulfill({json:{status:'READY',pnu,geometry:{type:'Polygon',coordinates:[[[127.61,35.78],[127.611,35.78],[127.611,35.781],[127.61,35.781],[127.61,35.78]]]}}}));
 await page.route('**/api/map-tile?*',r=>r.fulfill({status:503,body:''}));
 await page.goto('/?tab=fields');const map=page.getByTestId('field-map');
 await expect(page.getByText('배경지도 일부 수신 실패',{exact:true})).toBeVisible();
 await expect(map.locator('path')).toHaveCount(1);await expect(map.locator('text')).toContainText('쌀');
 for(let i=0;i<2;i++)await page.getByRole('button',{name:'축소',exact:true}).click();
 await expect(map.locator('text')).toHaveCount(0);
 await page.getByRole('button',{name:'확대',exact:true}).click();
 await expect(map.locator('text')).toContainText('쌀');
 await expect.poll(()=>map.locator('image').evaluateAll(images=>images.every(image=>getComputedStyle(image).visibility==='hidden'))).toBe(true);
 await expect(page.getByTestId('managed-field-'+pnu)).toContainText('계북면 경계 표시 검증');
 await map.screenshot({path:info.outputPath('missing-map-overlay.png')});
});
