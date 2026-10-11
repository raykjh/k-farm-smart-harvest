import {test,expect} from './authenticated-test';
test('same-crop parcels group without merging identities',async({page})=>{
 await page.route('**/api/parcels?**',route=>{const u=new URL(route.request().url());const id=u.searchParams.get('pnu');return route.fulfill({json:id?{status:'READY',geometry:{type:'Polygon',coordinates:[[[127.61,35.78],[127.611,35.78],[127.611,35.781],[127.61,35.78]]]}}:{status:'READY',items:[{pnu:'111',address:'Test parcel A'},{pnu:'222',address:'Test parcel B'}]}})});
 await page.goto('/');
 await page.getByRole('button',{name:'농지',exact:true}).click();
 const area=page.locator('section').filter({has:page.getByRole('heading',{name:'필지별 작물·공동작업 그룹',exact:true})}).last();
 await area.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();
 await area.getByRole('button',{name:'필지 선택',exact:true}).nth(0).click();
 await area.getByRole('button',{name:'필지 초안에 추가'}).click();
 await area.getByRole('button',{name:'필지 초안에 추가'}).click();
 await expect(area.getByRole('alert')).toContainText('이미 추가');
 await area.getByRole('button',{name:'필지 선택',exact:true}).nth(1).click();
 await area.getByRole('button',{name:'필지 초안에 추가'}).click();
 for(const id of ['111','222']){await page.getByLabel(`Crop ${id}`).selectOption('rice');await page.getByLabel(`Group ${id}`).check()}
 await area.getByRole('button',{name:'같은 작물 공동작업 그룹 만들기'}).click();
 await expect(page.getByLabel('Crop 111')).toBeDisabled();
 await expect(page.getByLabel('Crop 222')).toBeDisabled();
 await expect(area.getByRole('row')).toHaveCount(3);
 await area.getByRole('button',{name:'그룹 해제',exact:true}).first().click();
 await expect(page.getByLabel('Crop 111')).toBeEnabled();
});
