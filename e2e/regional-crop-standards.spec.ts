import {test,expect} from './authenticated-test';
test.use({authRole:'SUPER_ADMIN'});
import {db} from '../lib/db';
test('regional standards persist, edit, retain revisions and reject stale writes',async({page,request})=>{
 const region=`TEST-REGIONAL-${crypto.randomUUID()}`;
 let id='';
 try{
 await page.route('**/api/weather**',r=>r.fulfill({status:503,body:'{}'}));
 await page.route('**/api/demo',r=>r.fulfill({status:503,body:'{}'}));
 await page.goto('/crop-standards');
 await page.getByRole('combobox',{name:'적용 범위',exact:true}).selectOption('REGIONAL_OVERRIDE');
 await page.getByRole('combobox',{name:'작물·작형',exact:true}).selectOption({label:'벼 기계이앙재배'});
 await page.getByLabel('대상 지역',{exact:true}).fill(region);
 await page.getByLabel('재배 방식·작형',{exact:true}).fill('통합 검증 전용');
 await page.getByRole('button',{name:'기준 저장',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('저장했습니다');
 const first=(await (await request.get('/api/regional-crop-standards')).json()).items.find((i:any)=>i.profile.region===region);expect(first.version).toBe(1);id=first.id;
 await page.reload();await page.getByRole('button',{name:new RegExp(region)}).click();
 await expect(page.getByLabel('재배 방식·작형',{exact:true})).toHaveValue('통합 검증 전용');
 await page.getByLabel('검토 메모·적용 한계').fill('두 번째 수정');
 await page.getByRole('button',{name:'작업 추가',exact:true}).click();
 await page.getByRole('combobox',{name:'일정 산출 방식',exact:true}).selectOption('CALENDAR_OVERRIDE');
 await page.getByLabel('작업 코드',{exact:true}).fill('plant');await page.getByLabel('작업명',{exact:true}).fill('검증용 이앙');
 await page.getByLabel('시작 월-일',{exact:true}).fill('05-01');await page.getByLabel('마지막 월-일',{exact:true}).fill('05-31');
 await page.getByLabel('소요시간 (분/1,000㎡)',{exact:true}).fill('100');await page.getByLabel('작업 근거 URL',{exact:true}).fill('https://example.org/test');
 await page.getByLabel('기간·기온 판단 근거 (평균/최저기온 등)',{exact:true}).fill('검증용 가상 기준');
 await page.getByRole('button',{name:'기준 저장',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('저장했습니다');
 const stale=await request.post('/api/regional-crop-standards',{headers:{origin:'http://127.0.0.1:3100'},data:{id,expectedVersion:1,profile:first.profile}});expect(stale.status()).toBe(409);
 const blocked=await request.post('/api/regional-crop-standards',{headers:{origin:'https://invalid.example'},data:{id,expectedVersion:2,profile:first.profile}});expect(blocked.status()).toBe(403);
 const second=(await (await request.get('/api/regional-crop-standards')).json()).items.find((i:any)=>i.id===id);expect(second.version).toBe(2);expect(second.profile.notes).toBe('두 번째 수정');
 const history=await db.workRecord.findMany({where:{workspace:'reference',kind:'regionalCropStandardRevision',id:{in:[`${id}:1`,`${id}:2`]}}});expect(history).toHaveLength(2);
 await page.goto('/references');await page.getByRole('combobox',{name:'대상 지역',exact:true}).selectOption(region);
 await expect(page.getByRole('cell',{name:'검증용 이앙',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'05-01 ~ 05-31',exact:true})).toBeVisible();
 await expect(page.getByText('시연 농지 면적 적용',{exact:false})).toHaveCount(0);
 await page.screenshot({path:'test-results/regional-standards.png',fullPage:true});
 await page.getByRole('combobox',{name:'언어 / Language'}).selectOption('en');await expect(page.getByRole('heading',{name:'Crop reference data',exact:true})).toBeVisible();
 }finally{
 // Remove only this test's UUID records; never reset the reference store.
 if(!id){const r=await db.workRecord.findMany({where:{workspace:'reference',kind:'regionalCropStandard'}});id=r.find(x=>(x.payload as any).region===region)?.id??'';}
 if(id)await db.workRecord.deleteMany({where:{workspace:'reference',OR:[{kind:'regionalCropStandard',id},{kind:'regionalCropStandardRevision',id:{in:[`${id}:1`,`${id}:2`]}}]}});
 await db.$disconnect();
 }
});
