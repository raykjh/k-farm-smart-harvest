import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {chromium} from '@playwright/test';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry,emptyCenter} from '../lib/center-registry';
import {centerDemoCriteria} from '../lib/center-demo-fixture';
import {cadastreSnapshotSchema} from '../lib/four-center-cadastre';
import {demoResourceState} from '../lib/registered-demo';
import {registrationCommand} from '../lib/registration-service';
import {recordSpace,inCenter} from '../lib/workspace';
import {reviewProductionAutomatically} from '../lib/production-auto-review';
import {refreshProduction} from '../lib/production-service';
import {emptyLaborOps} from '../lib/labor-operations';
import {VALIDATION_BUDGET_ID} from '../lib/ai-budget';
import {fourCenterDatabaseUrl} from './disposable-test-db';
import {registerScaleFieldInBrowser,approveScalePlanInBrowser} from './intake-scale-ui-registration';

const database='kfarm_centers_e2e_scale_20261017';
const operatingUrl='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
assert.equal(process.env.DATABASE_URL,fourCenterDatabaseUrl(database),'Exact isolated scale DB required');
const live=process.argv.includes('--live'),prepare=process.argv.includes('--prepare');
const limit=Number(process.argv.find(a=>a.startsWith('--count='))?.slice(8)??30);
const reviewedFailure=process.argv.find(a=>a.startsWith('--review-failed='))?.slice(16);
let recoveryUsed=false;
const waveSize=limit===300?24:12;
assert([1,4,12,30,100,300].includes(limit),'Explicit count required');
if(live){assert.equal(process.env.AI_BUDGET_DATABASE_URL,operatingUrl);assert.equal(process.env.AI_MODE,'nebius');assert(process.env.NEBIUS_API_KEY);}
const origin='http://127.0.0.1:3100',folder='.data/intake-scale-20261017';
await mkdir(folder,{recursive:true});
const json=(x:unknown)=>JSON.parse(JSON.stringify(x)),hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),year=Number(today.slice(0,4))+1;
const operating=new PrismaClient({datasourceUrl:operatingUrl});
const budget=async()=>({calls:await operating.aiCall.count(),reserved:(await operating.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,estimated:(await operating.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0});
async function protectedState(){
 const records=await operating.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await operating.center.findMany({orderBy:{id:'asc'}}),outbox=await operating.outbox.findMany({orderBy:{id:'asc'}}),receipts=await operating.receipt.findMany({orderBy:{id:'asc'}}),audit=await operating.audit.findMany({orderBy:{id:'asc'}});
 return {hash:hash({records,centers,outbox,receipts,audit}),records:records.length,fields:centers.reduce((n,c)=>n+((c.state as any).fields?.length??0),0),missions:centers.reduce((n,c)=>n+((c.state as any).missions?.length??0),0)};
}
const before=await protectedState(),budgetBefore=await budget();
const snapshot=cadastreSnapshotSchema.parse(JSON.parse(await readFile(folder+'/cadastre.json','utf8')));
const geography=JSON.parse(await readFile(folder+'/geography.json','utf8'));
const evidence:any={startedAt:new Date().toISOString(),database,mode:live?'REAL_AI':'RULES_PREFLIGHT',requested:limit,operatingBefore:before,budgetBefore,steps:[],errors:[],actualMessages:0,physicalCommands:0};
const evidenceFile=folder+`/evidence-${limit}-${live?'live':'rules'}-${Date.now()}.json`;
const sessions:{id:string;token:string}[]=[];
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const save=()=>writeFile(evidenceFile,JSON.stringify(evidence,null,2));
const progress=(v:object)=>console.log(JSON.stringify(v));
try{
 if(prepare){
  assert.equal(await db.center.count(),0,'Preparation requires an empty new DB; no reset is performed');
  assert.equal(await db.workRecord.count(),0,'Preparation requires empty records');
  const inputs:any[]=[];
  for(const c of centerRegistry){
   const s=emptyCenter(c.id);s.ruleVersion='INTAKE_SCALE_ISOLATED_V1';s.demoResourceBatchId='intake-scale-20261017';
   s.machines=demoResourceState().machines.map(m=>({...m,id:m.id.replace('JB23',c.prefix),ownerCenterId:c.id}));
   s.crewCapacity={operators:2,workers:8};s.staffCount=10;s.transportCount=2;
   s.operatorRoster=Array.from({length:2},(_,i)=>({id:randomUUID(),name:'홍운영'+(i+1),active:true,kinds:['TR','DR','RP','PS','CB','PD','SP','TV'],weekdays:[0,1,2,3,4,5,6],from:today,until:`${year}-12-31`,excludedDates:[],startMinute:480,endMinute:960,evidence:'DEMO resource input, not actual employment'}));
   await db.center.create({data:{id:c.id,state:json(s)}});
   const criteria=centerDemoCriteria(c.id);criteria.profiles=criteria.profiles.filter(p=>p.id.endsWith(String(year))).map(p=>({...p,sourceBatchId:s.demoResourceBatchId}));
   assert(criteria.profiles.length,'Reviewed demo input year unavailable');
   await db.workRecord.createMany({data:[
    {workspace:recordSpace(c.id),kind:'centerGeography',id:'current',payload:json(geography[c.id])},
    {workspace:recordSpace(c.id),kind:'centerSettings',id:'current',payload:{location:{longitude:geography[c.id].longitude,latitude:geography[c.id].latitude,nx:null,ny:null}}},
    {workspace:recordSpace(c.id),kind:'productionCriteria',id:'current',payload:json(criteria)},
    {workspace:recordSpace(c.id),kind:'laborOperations',id:'current',payload:json({...emptyLaborOps(),people:Array.from({length:8},(_,i)=>({id:randomUUID(),name:'홍인력'+(i+1),birth:'1960-01-01',phone:'000-0000-'+String(i+1).padStart(4,'0'),address:c.township,registeredFarmer:false,usesApp:false,active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:[]}))})},
   ]});
   const batchId=randomUUID();
   for(const [i,p] of snapshot.parcels.filter(p=>p.centerId===c.id).entries()){
    const name='홍'+String(i+1).padStart(3,'0'),landUse=p.landCategory==='답'?'paddy':p.landCategory==='과'?'orchard':'upland';
    const command=registrationCommand.parse({requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:0,testDataOnly:true,demoInputBatchId:batchId,continuousService:{from:today,until:null,continuousConsent:true},consultation:{application:{policy:'OWNER_SERVICE_V1',residence:c.township,cultivationHistory:'가상 소유주 입력',supportReason:'위탁 신청',exceptionReason:'',review:'pending'},farmer:{name,birth:'1960-01-01',phone:'000-0000-'+String(i+1).padStart(4,'0'),contact:'phone'},fields:[{id:randomUUID(),pnu:p.pnu,address:p.address,area:String(p.areaM2),crop:'',mode:'delegated',tenure:'owned',ownerName:name,ownerPhone:'',evidence:'ownership',end:'',callAt:'',operator:'',callResult:'pending',scope:'작물 선택 및 연속 위탁 관리',verified:'pending',conditions:{landUse,water:'yes',drainage:'good',machineAccess:'yes',laborAvailable:'yes',region:c.township,climate:{rice:landUse==='paddy'?'suitable':'unsuitable',potato:landUse==='upland'?'suitable':'unsuitable',pepper:landUse==='upland'?'suitable':'unsuitable'},evidence:'DEMO: actual cadastral address/category; ownership, cultivation conditions and resources are fictional. Orchard crop not assumed.',checkedOn:today}}],consent:true,step:3}});
    inputs.push({index:i,centerId:c.id,landCategory:p.landCategory,command});
   }
   await db.workRecord.create({data:{workspace:recordSpace(c.id),kind:'demoInputBatch',id:batchId,payload:json({version:'demo-registration-inputs-v1',id:batchId,centerId:c.id,status:'READY',registrations:inputs.filter(x=>x.centerId===c.id).map(x=>({requestId:x.command.requestId,inputHash:hash(x.command)}))})}});
  }
  inputs.sort((a,b)=>a.index-b.index||centerRegistry.findIndex(c=>c.id===a.centerId)-centerRegistry.findIndex(c=>c.id===b.centerId));
  await writeFile(folder+'/inputs.json',JSON.stringify(inputs),{flag:'wx'});
  await writeFile(folder+'/prepared.json',JSON.stringify({before,budgetBefore,year,resourceInput:{equipmentEach:2,operators:2,workers:8,transport:2},orchard:'NO_UNVERIFIED_CROP_ASSUMED'}),{flag:'wx'});
  progress({prepared:true,registrations:inputs.length,year,operatingPreserved:hash(before)===hash(await protectedState())});
 }else{
  const inputs=JSON.parse(await readFile(folder+'/inputs.json','utf8')) as any[],prepared=JSON.parse(await readFile(folder+'/prepared.json','utf8'));
  const clients=new Map<string,(path:string,data?:unknown)=>Promise<any>>();
  for(const c of centerRegistry){
   const id=randomUUID(),token=randomBytes(32).toString('hex');sessions.push({id,token});
   await db.workRecord.createMany({data:[{...authKey('user',id),payload:{id,username:'scale-'+id,name:c.township+' 검증 담당자',role:'CENTER_ADMIN',centerId:c.id,enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}},{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+12*3600000}}]});
   const api=async(path:string,data?:unknown)=>{const r=await fetch(origin+path,{method:data?'POST':'GET',headers:{origin,cookie:'kfarm_session='+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(240000)});let body:any;try{body=await r.json()}catch{throw Error(`${path}: non-JSON HTTP ${r.status}`)}if(!r.ok)throw Error(`${path}: ${r.status} ${JSON.stringify(body).slice(0,800)}`);return body};
   assert.equal((await api('/api/workspace')).state.ruleVersion,'INTAKE_SCALE_ISOLATED_V1','HTTP server is not connected to scale DB');
   clients.set(c.id,api);
  }
  // Resume only completed registrations; failures are retained, never reset/retried blindly.
  evidence.waveSize=waveSize;
  for(let start=0;!process.argv.includes('--screens-only')&&start<limit;start+=waveSize){
   const wave=inputs.slice(start,Math.min(start+waveSize,limit));
   for(const x of wave){
    const api=clients.get(x.centerId)!,space=recordSpace(x.centerId),c=x.command;
    if(await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:space,kind:'registrationReceipt',id:c.requestId}}}))continue;
    if(inputs.indexOf(x)===299){
     const at=Date.now(),token=sessions[centerRegistry.findIndex(center=>center.id===x.centerId)].token;
     const received=await registerScaleFieldInBrowser(x,snapshot.parcels.find(p=>p.pnu===c.consultation.fields[0].pnu),token,folder);
     x.command=registrationCommand.parse(received.command);await writeFile(folder+'/inputs.json',JSON.stringify(inputs));
     evidence.steps.push({stage:'registered-through-ui',center:x.centerId,pnu:x.command.consultation.fields[0].pnu,ms:Date.now()-at,externalLookup:'REAL_CADASTRAL_SNAPSHOT',businessResponsesReplaced:false});
     continue;
    }
    c.fieldVersion=(await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:space,kind:'fields',id:'current'}}}))?.version??0;
    const key={workspace:space,kind:'demoInputBatch',id:c.demoInputBatchId},row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),batch=row.payload as any;
    batch.registrations.find((r:any)=>r.requestId===c.requestId).inputHash=hash(c);
    await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:batch,version:{increment:1}}});
    await writeFile(folder+'/inputs.json',JSON.stringify(inputs));
    const at=Date.now();await api('/api/registrations',c);evidence.steps.push({stage:'registered',center:x.centerId,pnu:c.consultation.fields[0].pnu,ms:Date.now()-at});
   }
   for(const center of centerRegistry){
    const api=clients.get(center.id)!,space=recordSpace(center.id);
    for(let batch=0;batch<4;batch++){
     // The real timer calls refreshProduction before automatic review. An earlier
     // center's approval changes shared occupancy and invalidates stale previews.
     await inCenter(center.id,()=>db.$transaction(tx=>refreshProduction(tx),{timeout:60000}));
     let view=(await api('/api/continuous-production')).view;
     const targets=wave.filter(x=>x.centerId===center.id&&x.landCategory!=='과').map(x=>x.command.consultation.fields[0].pnu);
     if(!targets.length||targets.every(p=>view?.items.find((i:any)=>i.pnu===p)?.status==='SCHEDULED'))break;
     if(view?.aiReviewError){
      if(reviewedFailure!==center.id||recoveryUsed)throw Error('Stored AI failure requires explicit review: '+view.aiReviewError.message);
      recoveryUsed=true;
      evidence.steps.push({stage:'explicit-recovery-after-contract-fix',center:center.id,previousError:view.aiReviewError.message,contract:'joint-crop-resources-v2'});
      const draft=(await api('/api/integrated-planning',{action:'plan',requestId:randomUUID(),mode:'AI'})).item;
      await api('/api/integrated-planning',{action:'stage',requestId:draft.requestId,fingerprint:draft.fingerprint});
      view=(await api('/api/continuous-production')).view;
     }
     const usage=await budget();assert(usage.reserved-prepared.budgetBefore.reserved<5_000_000,'Campaign reservation guard reached; no more calls');assert(usage.calls-prepared.budgetBefore.calls<600,'Campaign call guard reached');
     const at=Date.now();
     if(live&&!view?.integratedPlan){
      process.env.KFARM_PRODUCTION_AI='1';
      const status=await inCenter(center.id,()=>reviewProductionAutomatically());
      progress({stage:'automatic-review',center:center.id,status,ms:Date.now()-at});
     }else if(!live&&!view?.integratedPlan){
      const draft=(await api('/api/integrated-planning',{action:'plan',requestId:randomUUID(),mode:'RULES'})).item;
      await api('/api/integrated-planning',{action:'stage',requestId:draft.requestId,fingerprint:draft.fingerprint});
     }
     view=(await api('/api/continuous-production')).view;
     if(view?.aiReviewError)throw Error(view.aiReviewError.message);
     assert.equal(view?.integratedPlan?.source,live?'NEBIUS':'RULES','No verified joint plan');
     const pnus=view.integratedPlan.choices.map((c:any)=>c.pnu);
     assert(pnus.length&&pnus.every((p:string)=>view.items.find((i:any)=>i.pnu===p)?.status==='REVIEW'),'No complete feasible draft');
     const prior=(await api('/api/workspace')).state,priorMissions=hash(prior.missions);
     let command={action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus,provisionalAcknowledged:true},result:any;
     const throughUi=limit===300&&start===288&&center.id==='gyenam';
     if(throughUi){const approved=await approveScalePlanInBrowser(sessions[centerRegistry.findIndex(c=>c.id===center.id)].token,pnus,folder);command=approved.command;result=approved.result}
     else result=await api('/api/continuous-production',command);
     const after=(await api('/api/workspace')).state;
     for(const m of prior.missions)assert.equal(hash(after.missions.find((n:any)=>n.id===m.id)),hash(m),'Intake changed an earlier task');
     if(start===0){const calls=(await budget()).calls;assert.equal((await api('/api/continuous-production',command)).alreadyApplied,true);assert.equal((await budget()).calls,calls);assert.equal(hash((await api('/api/workspace')).state.missions),hash(after.missions));}
     const step={stage:'approved',center:center.id,fields:pnus.length,crops:pnus.map((p:string)=>view.items.find((i:any)=>i.pnu===p).proposal.cultivation.crop),assigned:result.assigned,ms:Date.now()-at,priorMissions,priorPreserved:true,source:view.integratedPlan.source,throughUi};
     evidence.steps.push(step);progress(step);await save();
    }
   }
   progress({stage:'wave-complete',registered:Math.min(start+waveSize,limit),cultivations:await db.workRecord.count({where:{kind:'cultivation'}})});
  }
  const centers=await db.center.findMany({orderBy:{id:'asc'}}),cultivations=await db.workRecord.findMany({where:{kind:'cultivation'}});
  const inventories=await db.workRecord.findMany({where:{kind:'fields',id:'current'}});
  evidence.summary={registered:inventories.reduce((n,r)=>n+(r.payload as any[]).length,0),planned:cultivations.length,missions:centers.reduce((n,r)=>n+(r.state as any).missions.length,0),reservations:await db.workRecord.count({where:{kind:'resourceReservation'}}),laborDemands:await db.workRecord.count({where:{kind:'laborDemand'}}),crops:cultivations.reduce((a,r)=>{const c=(r.payload as any).crop;a[c]=(a[c]??0)+1;return a},{} as Record<string,number>),pending:[] as any[]};
  for(const c of centerRegistry){const view=(await clients.get(c.id)!('/api/continuous-production')).view;for(const i of view?.items??[])if(i.status!=='SCHEDULED')evidence.summary.pending.push({center:c.id,pnu:i.pnu,status:i.status,reason:i.reason});}
  assert.equal(evidence.summary.registered,limit);assert.equal(new Set(centers.flatMap(c=>(c.state as any).missions.map((m:any)=>m.id))).size,evidence.summary.missions,'Duplicate tasks');
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/api/parcels?*',r=>{const p=snapshot.parcels.find(p=>p.pnu===new URL(r.request().url()).searchParams.get('pnu'));return p?r.fulfill({json:{status:'READY',pnu:p.pnu,geometry:p.geometry}}):r.continue()});
  evidence.mapBoundarySource='REPLAY_OF_REAL_PROVIDER_SNAPSHOT_FETCHED_THIS_RUN';
  await context.addCookies([{name:'kfarm_session',value:sessions[0].token,url:origin}]);const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
  const views=[];for(const tab of ['overview','fields','schedule','labor','equipment']){
   await page.goto(origin+'/?tab='+tab);await page.getByTestId('workspace-status').waitFor();assert(!page.url().includes('/login'));
   if(tab==='fields'){
    await page.getByText('관리 농지 경계를 불러오는 중입니다.',{exact:true}).waitFor({state:'hidden',timeout:30000});
    await page.waitForFunction(()=>{const tiles=[...document.querySelectorAll<SVGImageElement>('[data-testid="field-map"] image')];return tiles.length>0&&tiles.every(tile=>['visible','hidden'].includes(tile.style.visibility))},{},{timeout:15000});
   }
   if(tab==='schedule'){
    await page.getByLabel('일정 연도',{exact:true}).selectOption(String(year));
    await page.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:'전체',exact:true}).click();
    const first=page.locator('.schedule-day').first();await first.locator('summary').click();
    await first.locator('tbody tr').first().waitFor();
   }
   if(tab==='labor'){for(let i=0;i<7;i++)await page.getByRole('button',{name:'다음 달 보기',exact:true}).click()}
   await page.waitForTimeout(400);await page.screenshot({path:folder+`/${limit}-${tab}.png`,fullPage:false});views.push({tab,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),text:(await page.locator('body').innerText()).slice(0,1500)});
  }evidence.screens=views;assert.equal(evidence.errors.length,0,'Browser runtime error');
  evidence.completedAt=new Date().toISOString();progress({stage:'complete',...evidence.summary});
 }
}catch(e){evidence.error=e instanceof Error?e.message:String(e);progress({stage:'failed',error:evidence.error});process.exitCode=1}
finally{
 await browser?.close();for(const s of sessions){await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id:s.id},{kind:'session',id:digest(s.token)}]}})}
 evidence.operatingAfter=await protectedState();evidence.operatingPreserved=before.hash===evidence.operatingAfter.hash;evidence.budgetAfter=await budget();
 if(!evidence.operatingPreserved){process.exitCode=1;progress({error:'Operating business records changed'})}
 await save();await db.$disconnect();await operating.$disconnect();
}
