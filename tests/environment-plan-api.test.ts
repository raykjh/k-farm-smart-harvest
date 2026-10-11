import {beforeAll,afterAll} from 'vitest';
import {testSession} from './auth-fixture';
let session:Awaited<ReturnType<typeof testSession>>;
beforeAll(async()=>{session=await testSession()});afterAll(async()=>{await session?.cleanup()});
import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {registeredDemo} from './registered-demo-fixture';
import {legacyCatalogProfile} from '../lib/crop-catalog';
import {buildAnnualPlan} from '../lib/annual-plan';
import {makeContract,slotDate} from '../lib/annual-replanning';
import {readShortForecast} from '../lib/kma-forecast';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'READY',kind:'short',sourceUrl:'https://example.org',issuedAt:'2026-09-20T02:00:00Z',fetchedAt:'2026-09-20T03:00:00Z',points:[21,22].flatMap(d=>Array.from({length:24},(_,i)=>({at:`2026-09-${d}T${String(i).padStart(2,'0')}:00:00+09:00`,temperatureC:20,windMs:2,precipitation:'강수없음'})))})}));
import {POST as save} from '../app/api/environment-plan/route';
import {GET as preview,POST as approve} from '../app/api/annual-dispatch/route';
it('isolated DB saves cultivation draft, rejects stale baseline and incomplete crop plan preserving history',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB only');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-20T03:00:00Z'));
 const id=crypto.randomUUID(),standardId=crypto.randomUUID(),datasetId=`TEST:${id}`,pnu='5274036023110930000';
 const field={pnu,address:'전북특별자치도 장수군 계북면 농소리 1093',crop:'rice' as const,area:1000,group:'',mode:'full' as const,rights:'pending' as const};
 const cultivation={id,pnu,crop:'rice' as const,start:'2026-09-20',end:'2026-09-23',source:'REGISTERED' as const};
 const state=registeredDemo().state;state.missions=[];
 const history={id:'retained-completion',fieldId:'past',crop:'쌀',label:'past',scheduledDate:'2026-09-01',status:'COMPLETED',start:0,duration:1,staff:0,transport:0};state.missions.push(history as any);
 const context={operations:{rice:{seed:{laborMinutesPer1000m2:60,staff:1,transport:0,windLimitMs:10,rainSensitive:true}}}};
 const seed=buildAnnualPlan([field],2026,1,context,cultivation);
 const upsert=async(workspace:string,kind:string,key:string,payload:any)=>db.workRecord.upsert({where:{workspace_kind_id:{workspace,kind,id:key}},create:{workspace,kind,id:key,payload,version:1},update:{payload,version:1}});
 try{
 await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:state as any},update:{state:state as any}});
 await upsert('sandbox','fields','current',[field]);await upsert('sandbox','cultivation',id,cultivation);await upsert('sandbox','cultivationPlan',id,seed);
 await upsert('shared','climateNormals',datasetId,{stationId:'TEST',stationName:'test',period:'test',sourceUrl:'https://example.org',values:[{monthDay:'09-21',meanC:20},{monthDay:'09-22',meanC:20}]});
 await upsert('reference','regionalCropStandard',standardId,{catalogProfileId:legacyCatalogProfile('rice')!.id,scope:'COMMON',region:'',practice:`test-${id}`,variety:'',status:'REVIEWED',reviewer:'fixture',orchardStage:null,yieldLowKgPer1000m2:null,yieldHighKgPer1000m2:null,sourceUrls:['https://example.org'],notes:'fixture',operations:[{code:'seed',name:'test',timingMode:'ENVIRONMENT',environment:{metric:'meanTemperatureC',lowerC:15,upperC:25,consecutiveDays:1,minimumNightC:null},from:'',to:'',crossYear:false,minTemperatureC:null,maxTemperatureC:null,basis:'test',mode:'MANUAL',capability:'',workers:1,operators:0,minutesPer1000m2:60,sourceUrl:'https://example.org'}]});
 const req=(path:string,b:any)=>new NextRequest(`http://127.0.0.1:3100/api/${path}`,{method:'POST',headers:{...session.headers,origin:'http://127.0.0.1:3100','Content-Type':'application/json'},body:JSON.stringify(b)});
 const body={pnu,selection:{datasetId,standardId,region:'전북특별자치도 장수군 계북면',practice:`test-${id}`,variety:'',from:'2026-09-20',to:'2026-09-23'},save:true,cultivationId:id,expectedVersion:1,growthReview:{reviewer:'fixture',checkedOn:'2026-09-20',validUntil:'2026-09-23',ready:true,note:'test only'},forecastRegionConfirmed:true};
 const saved=await save(req('environment-plan',body));expect(saved.status,JSON.stringify(await saved.clone().json())).toBe(200);expect((await saved.json()).version).toBe(2);
 expect((await save(req('environment-plan',body))).status).toBe(400);
 expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(state);
 const d=await(await preview(new NextRequest(`http://127.0.0.1:3100/api/annual-dispatch?cultivationId=${id}`,{headers:session.headers}))).json();expect(d.assignments.length).toBe(1);
 const approval={cultivationId:id,token:d.token,demoAcknowledged:true};
 await db.workRecord.update({where:{workspace_kind_id:{workspace:'reference',kind:'regionalCropStandard',id:standardId}},data:{version:2}});
 expect((await approve(req('annual-dispatch',approval))).status).toBe(409);
 await db.workRecord.update({where:{workspace_kind_id:{workspace:'reference',kind:'regionalCropStandard',id:standardId}},data:{version:1}});
 const rejected=await approve(req('annual-dispatch',approval));expect(rejected.status).toBe(409);
 expect((await rejected.json()).error).toContain('필수 작업');
 const after=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state;
 expect(after).toEqual(state);

 }finally{await db.workRecord.deleteMany({where:{OR:[{workspace:'reference',kind:'regionalCropStandard',id:standardId},{workspace:'shared',kind:'climateNormals',id:datasetId}]}});vi.useRealTimers();}
});
