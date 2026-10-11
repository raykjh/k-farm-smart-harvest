import {test,expect} from './authenticated-test';
import {db} from '../lib/db';
import {legacyCatalogProfile} from '../lib/crop-catalog';
test('stored field and reviewed standard use common planner without mutating operational data',async({page,request})=>{
 const id=crypto.randomUUID(),practice=`TEST-${id}`;
 const f=(await (await request.get('/api/environment-plan')).json()).fields.find((f:any)=>f.crop&&f.region);
 expect(f).toBeTruthy();const catalog=legacyCatalogProfile(f.crop)!;
 const before=await db.center.findUniqueOrThrow({where:{id:'demo'}});
 try{
 await db.workRecord.create({data:{workspace:'reference',kind:'regionalCropStandard',id,payload:{catalogProfileId:catalog.id,scope:'COMMON',region:'',practice,variety:'test',status:'REVIEWED',reviewer:'AUTOMATED TEST NOT AGRONOMIC REVIEW',orchardStage:null,yieldLowKgPer1000m2:null,yieldHighKgPer1000m2:null,sourceUrls:['https://example.org'],notes:'Temporary test only',operations:[{code:'seed',name:'test',timingMode:'ENVIRONMENT',environment:{metric:'meanTemperatureC',lowerC:15,upperC:null,consecutiveDays:1,minimumNightC:null},from:'',to:'',crossYear:false,minTemperatureC:null,maxTemperatureC:null,basis:'test',mode:'MANUAL',capability:'',workers:1,operators:0,minutesPer1000m2:60,sourceUrl:'https://example.org'}]}}});
 await page.goto('/references');await page.getByText('환경 기준 → 계획·배차 미리보기',{exact:true}).click();
 await page.getByRole('combobox',{name:'농지',exact:true}).selectOption(f.pnu);
 await page.getByRole('combobox',{name:'검토된 작형',exact:true}).selectOption(id);
 const datasets=(await (await request.get('/api/environment-windows')).json()).datasets;
 await page.getByRole('combobox',{name:'관측소 평년자료',exact:true}).selectOption(datasets[0].id);
 await page.getByLabel('재배 검토 시작',{exact:true}).fill('2028-01-01');await page.getByLabel('재배 검토 종료',{exact:true}).fill('2028-12-31');
 const wait=page.waitForResponse(r=>r.url().endsWith('/api/environment-plan')&&r.request().method()==='POST');await page.getByRole('button',{name:'계획 후보 계산',exact:true}).click();
 const response=await wait;expect(response.status()).toBe(200);const result=await response.json();expect(result.saved).toBe(false);expect(result.plan.plots[0].environmental.standardId).toBe(id);expect(result.plan.plots[0].tasks[0].allowedWindows.length).toBeGreaterThan(0);
 await expect(page.getByText('미리보기 · 일정 저장·예약·알림 없음',{exact:true})).toBeVisible();
 expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(before.state);
 }finally{await db.workRecord.deleteMany({where:{workspace:'reference',kind:'regionalCropStandard',id}});await db.$disconnect();}
});
