import {db} from '../lib/db';
import {createSession,createAccount,publicUser,AUTH_COOKIE,digest,type User} from '../lib/auth';
import {registrationCommand} from '../lib/registration-service';
import {productionCriteria} from '../lib/continuous-production';
import {centerDemoCriteria} from '../lib/center-demo-fixture';
import {WORKLOAD_CATALOG_VERSION} from '../lib/crop-workload-catalog';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';

// Deliberate sequential DEMO INPUT on the local operating DB. No mock planner,
// direct mission insertion, clock override, SMS provider or synthetic completion.
const base='http://127.0.0.1:3100',url=new URL(process.env.DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/kfarm'||!process.argv.includes('--apply-demo-inputs'))throw Error('Local operating demo inputs require explicit command');
const dir=resolve('.data/sequential-intake-20261016'),file=resolve(dir,'inputs.json');mkdirSync(dir,{recursive:true});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
if(today!=='2026-10-16')throw Error('Review dated autumn input assumptions before running on another day');
let token='',browser:any,temporaryUserId='';
const evidence:any=existsSync(resolve(dir,'evidence.json'))?JSON.parse(readFileSync(resolve(dir,'evidence.json'),'utf8')):{startedAt:new Date().toISOString(),mode:'REAL_SERVER_REAL_AI_DEMO_INPUT',steps:[]};
delete evidence.error;
const save=()=>writeFileSync(resolve(dir,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
async function api(path:string,body?:unknown){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie:`${AUTH_COOKIE}=${token}`,origin:base,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});const data=await r.json();if(!r.ok)throw Error(path+': '+(data.error??r.status));return data}
const readView=async()=>((await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'continuousProduction',id:'current'}}}))?.payload as any);
async function waitFor<T>(label:string,read:()=>Promise<T|undefined>,ms=360000){const end=Date.now()+ms;while(Date.now()<end){const v=await read();if(v!==undefined)return v;await new Promise(r=>setTimeout(r,2000));}throw Error(label+' timeout');}
try{
 const users=(await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}})).map(r=>r.payload as User);
 let user=users.find(u=>u.centerId==='demo'&&u.role==='CENTER_ADMIN'&&u.enabled&&!u.mustChangePassword);
 if(!user){
  const admin=users.find(u=>u.role==='SUPER_ADMIN'&&u.enabled&&!u.mustChangePassword);if(!admin)throw Error('Existing administrator required');
  const created=await createAccount({username:'validation.'+randomUUID(),name:'순차 입력 검증 담당자',password:randomBytes(24).toString('base64url')+'aA!9',role:'CENTER_ADMIN',centerId:'demo'},publicUser(admin),undefined,false);
  temporaryUserId=created.id;user={...created,passwordHash:''};
 }
 token=await createSession(user.id);
 evidence.initialCalls??=await db.aiCall.count();evidence.initialBudget??=await db.aiBudget.findMany({orderBy:{id:'asc'}});
 let inputs:any;
 if(existsSync(file))inputs=JSON.parse(readFileSync(file,'utf8'));
 else{
  const c=await db.center.findUniqueOrThrow({where:{id:'demo'}});if((c.state as any).fields.length||(c.state as any).missions.length)throw Error('Expected backed-up/reset empty operating center');
  const parcels=JSON.parse(readFileSync(resolve('lib/demo-parcels.json'),'utf8'));
  const selected=[parcels.find((p:any)=>p.land==='답'),...parcels.filter((p:any)=>p.land==='전').sort((a:any,b:any)=>a.area-b.area).slice(0,2)];
  if(selected.some(p=>!p||p.source!=='VWorld LP_PA_CBND_BUBUN'))throw Error('Actual cadastral parcel source required');
  const batchId=randomUUID();
  inputs={batchId,people:Array.from({length:6},(_,i)=>({id:randomUUID(),name:['홍민수','홍영자','홍순희','홍정수','홍경자','홍성호'][i],birth:`195${i}-03-15`,phone:`010-0000-91${String(i+1).padStart(2,'0')}`,address:'전북특별자치도 장수군 계북면',registeredFarmer:false,usesApp:false,active:true})),registrations:selected.map((p:any,i:number)=>registrationCommand.parse({requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:i,testDataOnly:true,demoInputBatchId:batchId,continuousService:{from:today,until:null,continuousConsent:true},consultation:{application:{policy:'OWNER_SERVICE_V1',residence:'전북특별자치도 장수군 계북면',cultivationHistory:'가상 소유주의 경작 이력',supportReason:'위탁 신청',exceptionReason:'',review:'pending'},farmer:{name:['홍길동','홍영희','홍성민'][i],birth:`195${i}-05-10`,phone:`010-0000-90${String(i+1).padStart(2,'0')}`,contact:'sms'},fields:[{id:randomUUID(),pnu:p.pnu,address:p.address,area:String(p.area),crop:'',mode:'delegated',tenure:'owned',ownerName:['홍길동','홍영희','홍성민'][i],ownerPhone:`010-0000-90${String(i+1).padStart(2,'0')}`,evidence:'ownership',end:'',callAt:'',operator:'',callResult:'pending',scope:'작물 선택 및 연속 위탁 관리',verified:'pending',conditions:{landUse:i===0?'paddy':'upland',water:'yes',drainage:'good',machineAccess:'yes',laborAvailable:'yes',region:'계북면',climate:{rice:i===0?'suitable':'unsuitable',potato:'marginal',pepper:'marginal',...(i?{garlic:'suitable',onion:'suitable'}:{})},evidence:'DEMO: 지번·지목은 VWorld, 소유주·재배조건은 가상 입력',checkedOn:today}}],consent:true,step:3}}))};
  writeFileSync(file,JSON.stringify(inputs,null,2),{flag:'wx',mode:0o600});
 }
 // Resource and calendar setup is input data through the ordinary authorized APIs.
 if(!existsSync(resolve(dir,'setup-complete.json'))){
  const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
  if(!state.machines.some((m:any)=>m.id.includes('RD'))){
   await api('/api/equipment',{version:state.planVersion,autoCode:true,equipment:{id:'JB23RD01',name:'뿌리작물 굴취기',kind:'RD',compatibleCrops:['garlic','onion','sweetpotato','peanut'],capacityHaHour:0.2,status:'AVAILABLE',manufacturer:'',model:'',product:'',purchasedOn:'',servicePhone:'',notes:'DEMO · 순차 접수용 자원 입력'}});
  }
  for(const person of inputs.people){const ops=await api('/api/labor-operations');if(!ops.payload.people.some((p:any)=>p.id===person.id))await api('/api/labor-operations',{action:'person',requestId:randomUUID(),version:ops.version,testDataOnly:true,person});}
  const current=await api('/api/continuous-production'),criteria=centerDemoCriteria('demo');
  criteria.profiles.push({id:'autumn-2026-sequential',name:'2026년 가을 파종·2027년 수확',dataOrigin:'DEMO',sourceBatchId:'sequential-autumn-20261016',context:{region:'계북면',catalog:{version:WORKLOAD_CATALOG_VERSION,year:2026,dataOrigin:'DEMO',sourceBatchId:'sequential-autumn-20261016'},operations:{garlic:{soil:{from:'2026-10-17',to:'2026-11-01'},plant:{from:'2026-10-20',to:'2026-11-10'}},onion:{soil:{from:'2026-10-17',to:'2026-11-01'},plant:{from:'2026-10-20',to:'2026-11-20'}}}}});
  await api('/api/continuous-production',{action:'criteria',version:current.criteriaVersion,criteria:productionCriteria.parse(criteria)});
  const batch={version:'demo-registration-inputs-v1',id:inputs.batchId,centerId:'demo',status:'READY',registrations:inputs.registrations.map((r:any)=>({requestId:r.requestId,inputHash:hash(registrationCommand.parse(r))}))};
  await db.workRecord.create({data:{workspace:'sandbox',kind:'demoInputBatch',id:inputs.batchId,payload:batch}});
  writeFileSync(resolve(dir,'setup-complete.json'),JSON.stringify({at:new Date().toISOString(),batchId:inputs.batchId}),{flag:'wx',mode:0o600});
 }
 for(const [i,registration] of inputs.registrations.entries()){
  const pnu=registration.consultation.fields[0].pnu;
  const before=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any,prior=hash(before.missions);
  const receipt=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'registrationReceipt',id:registration.requestId}}});
  if(!receipt){
   // Approval also updates the field inventory. Re-read its optimistic version,
   // exactly as the ordinary form does, before sealing this next demo input.
   const inventory=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}});
   registration.fieldVersion=inventory?.version??0;
   const key={workspace:'sandbox',kind:'demoInputBatch',id:inputs.batchId},row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),batch=row.payload as any;
   batch.registrations.find((r:any)=>r.requestId===registration.requestId).inputHash=hash(registrationCommand.parse(registration));
   await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:batch,version:{increment:1}}});
   writeFileSync(file,JSON.stringify(inputs,null,2),{mode:0o600});
  }else if((receipt.payload as any).hash!==hash(registrationCommand.parse(registration)))throw Error('Saved demo registration differs');
  const saved=receipt?{alreadyApplied:true}:await api('/api/registrations',registration);
  console.log(JSON.stringify({step:'REGISTERED',index:i+1,alreadyApplied:!!saved.alreadyApplied}));
  let view=await readView(),existing=(await db.workRecord.findMany({where:{workspace:'sandbox',kind:'productionApproval'}})).find(r=>(r.payload as any).input?.pnus?.includes(pnu));
  if(!existing){
   view=await waitFor('automatic AI review',async()=>{const v=await readView();if(v?.aiReviewError)throw Error('Automatic AI: '+v.aiReviewError.message);return v?.integratedPlan?.source==='NEBIUS'&&v.integratedPlan.choices?.some((c:any)=>c.pnu===pnu)?v:undefined});
   if(hash(((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any).missions)!==prior)throw Error('Automatic draft changed approved work before confirmation');
   const item=view.items.find((v:any)=>v.pnu===pnu);
   console.log(JSON.stringify({step:'AI_READY',index:i+1,crop:item.proposal.cultivation.crop,tasks:item.proposal.dispatch.assignments.length}));
   // Authorized demo operator confirmation, using the same public commit endpoint.
   const result=await api('/api/continuous-production',{action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus:[pnu],provisionalAcknowledged:true});
   const after=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
   for(const m of before.missions)if(hash(after.missions.find((x:any)=>x.id===m.id))!==hash(m))throw Error('Earlier accepted work changed during intake');
   evidence.steps.push({index:i+1,pnu,crop:item.proposal.cultivation.crop,aiRequestId:view.integratedPlan.requestId,assigned:result.assigned,fields:after.fields.length,missions:after.missions.length,priorPreserved:true,notificationCount:result.notifications});save();
   console.log(JSON.stringify({step:'APPROVED',...evidence.steps.at(-1)}));
  }
 }
 const due=await waitFor('background labor allocation',async()=>{const v=await api('/api/labor-operations');return v.payload.jobs.some((j:any)=>j.attendance?.startedAt&&j.invited.length)?v:undefined;});
 const jobs=due.payload.jobs.filter((j:any)=>j.attendance?.startedAt&&j.invited.length&&j.date>='2026-10-19'&&j.date<='2026-10-23');
 if(!jobs.length)throw Error('No current autumn recruitment to verify');
 for(const initial of jobs){
  let ops=await api('/api/labor-operations'),job=ops.payload.jobs.find((j:any)=>j.id===initial.id);
  for(const workerId of job.attendance.proposed.filter((id:string)=>!job.attendance.expired.includes(id))){
   if(job.responses[workerId]==='PHONE')continue;
   await api('/api/labor-operations',{action:'response',version:ops.version,requestId:randomUUID(),jobId:job.id,workerId,response:'PHONE'});
   ops=await api('/api/labor-operations');job=ops.payload.jobs.find((j:any)=>j.id===initial.id);
  }
 }
 const confirmed=await api('/api/labor-operations');
 evidence.labor={people:confirmed.payload.people.length,jobs:confirmed.payload.jobs.length,proposedJobs:confirmed.payload.jobs.filter((j:any)=>j.attendance?.startedAt).length,assigned:confirmed.payload.jobs.reduce((n:number,j:any)=>n+j.assigned.length,0),reserveSlots:confirmed.payload.jobs.reduce((n:number,j:any)=>n+(j.reserveSlots?.length??0),0),phoneResponsesAreDemoInputs:true};save();
 await waitFor('SMS queue',async()=>await db.workRecord.count({where:{workspace:'sandbox',kind:'smsMessage'}})>0?true:undefined,90000);
 const stable=async()=>({calls:await db.aiCall.count(),cycles:await db.workRecord.count({where:{workspace:'sandbox',kind:'cultivation'}}),missions:((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any).missions.length,reservations:await db.workRecord.count({where:{kind:'resourceReservation'}})});
 const first=await stable();console.log(JSON.stringify({step:'IDLE_DEDUP_CHECK',...first}));
 await new Promise(r=>setTimeout(r,65000));const second=await stable();if(hash(first)!==hash(second))throw Error('Unchanged worker tick duplicated a call or operating record');
 evidence.unchangedTick=second;
 const calls=await db.aiCall.findMany({where:{createdAt:{gte:new Date(evidence.startedAt)}},orderBy:{createdAt:'asc'}});
 evidence.ai={calls:calls.length,statuses:calls.map(c=>c.status),reservedMicroUsd:calls.reduce((n,c)=>n+c.reservedMicroUsd,0),estimatedMicroUsd:calls.reduce((n,c)=>n+(c.estimatedMicroUsd??0),0)};
 evidence.sms={queued:await db.workRecord.count({where:{workspace:'sandbox',kind:'smsMessage'}}),realMessages:0,provider:'NOT_CONNECTED'};
 evidence.finalBudget=await db.aiBudget.findMany({orderBy:{id:'asc'}});save();
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:AUTH_COOKIE,value:token,url:base}]);const page=await context.newPage();const uiErrors:string[]=[];page.on('pageerror',(e:any)=>uiErrors.push(e.message));
 const views=[];
 for(const tab of ['fields','schedule','labor']){await page.goto(base+'/?tab='+tab);await page.waitForTimeout(2500);if(page.url().includes('/login'))throw Error('Browser session failed');await page.screenshot({path:resolve(dir,tab+'.png'),fullPage:false});views.push({tab,title:await page.title(),text:(await page.locator('body').innerText()).slice(0,4000)});}
 evidence.browser={views,uiErrors};if(uiErrors.length)throw Error('Browser runtime errors');
 evidence.completedAt=new Date().toISOString();save();console.log(JSON.stringify({step:'COMPLETE',evidence:resolve(dir,'evidence.json'),labor:evidence.labor,ai:evidence.ai,sms:evidence.sms}));
}catch(e){evidence.error=e instanceof Error?e.message:String(e);save();console.error(evidence.error);process.exitCode=1}
finally{await browser?.close();if(token)await db.workRecord.deleteMany({where:{workspace:'auth',kind:'session',id:digest(token)}});if(temporaryUserId){await db.workRecord.deleteMany({where:{workspace:'auth',kind:'user',id:temporaryUserId}});await db.audit.create({data:{centerId:'demo',action:'account.validationCleanup',detail:{userId:temporaryUserId}}});}await db.$disconnect()}
