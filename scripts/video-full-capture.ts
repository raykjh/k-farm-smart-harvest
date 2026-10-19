import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {fourCenterDatabaseUrl} from './disposable-test-db';

const parent=resolve('.data/video-capture-20261018'),folder=resolve(parent,'full-take-01');
const target='kfarm_centers_e2e_video_20261018',origin='https://127.0.0.1:3101';
process.env.DATABASE_URL=fourCenterDatabaseUrl(target);
process.env.AI_BUDGET_DATABASE_URL='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
process.env.AI_MODE='nebius';process.env.AI_CALL_SCOPE='decisions';process.env.KFARM_PRODUCTION_AI='1';
process.env.KFARM_SMS_WORKER='0';process.env.KFARM_APP_ORIGIN=origin;
const [{db},{centerRegistry},{recordSpace,inCenter},{registrationCommand},{refreshProduction},{reviewProductionAutomatically},{VALIDATION_BUDGET_ID}]=await Promise.all([
 import('../lib/db'),import('../lib/center-registry'),import('../lib/workspace'),import('../lib/registration-service'),import('../lib/production-service'),import('../lib/production-auto-review'),import('../lib/ai-budget')]);
const operating=new PrismaClient({datasourceUrl:process.env.AI_BUDGET_DATABASE_URL});
const originalScale=new PrismaClient({datasourceUrl:fourCenterDatabaseUrl('kfarm_centers_e2e_scale_20261017')});
const hash=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function business(client:PrismaClient){return {centers:await client.center.findMany({orderBy:{id:'asc'}}),records:await client.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),outbox:await client.outbox.findMany({orderBy:{id:'asc'}}),receipts:await client.receipt.findMany({orderBy:{id:'asc'}}),audit:await client.audit.findMany({orderBy:{id:'asc'}})};}
async function budget(){return {calls:await operating.aiCall.count(),reserved:(await operating.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,estimated:(await operating.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0};}
const credentials=JSON.parse(await readFile(resolve(parent,'credentials.json'),'utf8'));
assert.equal(credentials.database,target);assert.equal(credentials.origin,origin);
const parcels=JSON.parse(await readFile(resolve(parent,'cadastre.json'),'utf8')).parcels;
const browser=await chromium.launch({headless:true});
const contexts=new Map<string,BrowserContext>();
const viewport={width:1920,height:1080};
const stage=process.argv.find(x=>x.startsWith('--stage='))?.slice(8);assert(stage&&['prepare','first','bulk','incident','screens','centers'].includes(stage));
const reviewedFailure=process.argv.find(x=>x.startsWith('--review-failed='))?.slice(16);let recoveryUsed=false;
const startWave=Number(process.argv.find(x=>x.startsWith('--start-wave='))?.slice(13)??0);assert(Number.isInteger(startWave)&&startWave>=0&&startWave<300&&startWave%24===0);
const evidence:any={stage,startedAt:new Date().toISOString(),events:[],errors:[],externalSms:false,deviceCommands:false};
let film:BrowserContext|undefined,page:Page|undefined,clock=0;
async function mark(name:string,extra:any={}){const item={name,at:Date.now(),seconds:clock?(Date.now()-clock)/1000:0,...extra};evidence.events.push(item);await writeFile(resolve(folder,stage+'-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(item));}
async function api(center:string,path:string,data?:any){const context=contexts.get(center)!;const r=await context.request.fetch(origin+path,{method:data?'POST':'GET',headers:{Origin:origin},data,timeout:240000});let body:any;try{body=await r.json()}catch{throw Error(path+' non-JSON HTTP '+r.status())}assert.equal(r.status(),200,path+' '+JSON.stringify(body).slice(0,1500));return body;}
async function startFilm(center:string){clock=Date.now();film=await browser.newContext({viewport,deviceScaleFactor:1,ignoreHTTPSErrors:true,storageState:await contexts.get(center)!.storageState(),recordVideo:{dir:resolve(folder,'raw'),size:viewport}});page=await film.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));return page;}
async function shot(name:string){await page!.screenshot({path:resolve(folder,stage+'-'+name+'.png')});await mark(name);}
async function approvedUi(p:Page,pnus:string[]){
 const panel=p.getByTestId('continuous-production');await expect(panel).toContainText('AI 통합계획 검토안',{timeout:30000});
 const boxes=panel.getByRole('checkbox',{name:'이 계획을 확정 목록에 포함',exact:true});await expect(boxes).toHaveCount(pnus.length);
 for(const box of await boxes.all())await box.check();await panel.getByRole('checkbox',{name:/작물·작업기간·자원 수요/}).check();
 const button=panel.getByRole('button',{name:`선택 ${pnus.length}필지 계획 일괄 확정`,exact:true});await button.scrollIntoViewIfNeeded();await p.waitForTimeout(1500);await shot('approval-ready');
 const received=p.waitForResponse(r=>r.url().endsWith('/api/continuous-production')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='approve',{timeout:240000});await button.click();const r=await received,v=await r.json();assert.equal(r.status(),200,JSON.stringify(v));
 await expect(panel).toContainText('새 계획');await p.waitForTimeout(2000);await shot('approved');return v;
}
try{
 await mkdir(folder,{recursive:true});await mkdir(resolve(folder,'raw'),{recursive:true});
 const before=await business(operating),oldScale=await business(originalScale);evidence.protectedBefore={operating:hash(before),scale:hash(oldScale)};evidence.budgetBefore=await budget();
 if(stage==='prepare'){const prior=await readFile(resolve(folder,'baseline.json'),'utf8').then(JSON.parse,()=>null);if(prior)assert.deepEqual(prior.businessHashes,evidence.protectedBefore);else await writeFile(resolve(folder,'baseline.json'),JSON.stringify({businessHashes:evidence.protectedBefore,budget:evidence.budgetBefore}),{flag:'wx'});}
 for(const account of credentials.accounts.filter((a:any)=>a.centerId)){
  const c=await browser.newContext({viewport,ignoreHTTPSErrors:true});const p=await c.newPage();
  await p.goto(origin+'/login');await p.getByRole('textbox',{name:'아이디',exact:true}).fill(account.username);await p.getByLabel('비밀번호',{exact:true}).fill(account.password);await p.getByRole('button',{name:'로그인',exact:true}).click();await p.waitForURL(u=>u.pathname==='/');
  contexts.set(account.centerId,c);await p.close();assert.equal((await api(account.centerId,'/api/workspace')).state.ruleVersion,'VIDEO_RECORDING_20261018');
 }
 if(stage==='prepare'){
  assert.equal(await db.workRecord.count({where:{kind:'cultivation'}}),0);
  for(const center of centerRegistry){const v=await api(center.id,'/api/continuous-production');const criteria={...v.criteria,profiles:v.criteria.profiles.map((p:any)=>({...p,sourceBatchId:'video-resources-20261018'}))};await api(center.id,'/api/continuous-production',{action:'criteria',version:v.criteriaVersion,criteria});}
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),inputs:any[]=[];
  for(const center of centerRegistry){for(const [i,p] of parcels.filter((p:any)=>p.centerId===center.id).entries()){
   const given=['민','영','정','성','지','수','경','선','현','기'],end=['수','희','호','자','숙','민','영','준'];const name=i===0&&center.id==='demo'?'홍길동':'홍'+given[Math.floor(i/8)]+end[i%8];const landUse=p.landCategory==='답'?'paddy':p.landCategory==='과'?'orchard':'upland';
   const command=registrationCommand.parse({requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:0,testDataOnly:true,continuousService:{from:today,until:null,continuousConsent:true},consultation:{application:{policy:'OWNER_SERVICE_V1',residence:center.township,cultivationHistory:'가상 소유주',supportReason:'위탁 신청',exceptionReason:'',review:'pending'},farmer:{name,birth:'1960-01-01',phone:'000-0000-'+String(i+1).padStart(4,'0'),contact:'phone'},fields:[{id:randomUUID(),pnu:p.pnu,address:p.address,area:String(p.areaM2),crop:'',mode:'delegated',tenure:'owned',ownerName:name,ownerPhone:'',evidence:'ownership',end:'',callAt:'',operator:'',callResult:'pending',scope:'작물 선택 및 연속 위탁 관리',verified:'pending',conditions:{landUse,water:'yes',drainage:'good',machineAccess:'yes',laborAvailable:'yes',region:center.township,climate:{rice:landUse==='paddy'?'suitable':'unsuitable',potato:landUse==='upland'?'suitable':'unsuitable',pepper:landUse==='upland'?'suitable':'unsuitable'},evidence:'촬영용 가상 소유주·농지 조건. 지번·경계·지목은 실제 지적도 자료. 과수 작물 미확인.',checkedOn:today}}],consent:true,step:3}});
   inputs.push({index:i,centerId:center.id,landCategory:p.landCategory,command});
  }}
  const order=['demo','janggye','cheoncheon','gyenam'];inputs.sort((a,b)=>a.index-b.index||order.indexOf(a.centerId)-order.indexOf(b.centerId));
  assert.equal(inputs.length,300);assert.equal(inputs[0].centerId,'demo');await writeFile(resolve(folder,'inputs.json'),JSON.stringify(inputs),{flag:'wx'});await mark('prepared',{inputCount:inputs.length,criteriaSourceLinked:true});
 }else if(stage==='first'){
  const inputs=JSON.parse(await readFile(resolve(folder,'inputs.json'),'utf8')),x=inputs[0],f=x.command.consultation.fields[0],parcel=parcels.find((p:any)=>p.pnu===f.pnu);
  assert.equal(await db.workRecord.count({where:{kind:'cultivation'}}),0,'First capture must not repeat saved registration');
  const p=await startFilm('demo');await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();await p.waitForTimeout(2000);await shot('fields-empty');
  await p.getByRole('button',{name:/신규 농지 등록/}).click();const form=p.getByTestId('field-registration');
  await form.getByLabel('이름',{exact:true}).fill(x.command.consultation.farmer.name);await p.waitForTimeout(350);
  await form.getByLabel('생년월일',{exact:true}).fill('19600101');await form.getByLabel('주소',{exact:true}).fill(x.command.consultation.application.residence);await form.getByLabel('연락처',{exact:true}).fill('00000000001');await p.waitForTimeout(1500);await shot('applicant');
  await form.getByRole('button',{name:'다음',exact:true}).click();await form.getByRole('button',{name:'소유농지 조회',exact:true}).click();await form.getByRole('button',{name:'지번으로 농지 추가',exact:true}).click();
  await form.getByLabel('지번 검색어').fill(parcel.address);await form.getByRole('button',{name:'브이월드 지번 검색',exact:true}).click();
  await expect(form.getByRole('button',{name:'필지 선택',exact:true}).first()).toBeVisible({timeout:45000});
  // Choose the verified cadastral address, never an arbitrary search result.
  const result=form.locator('li').filter({hasText:parcel.address});
  if(await result.count())await result.getByRole('button',{name:'필지 선택',exact:true}).click();else {assert.equal(await form.getByRole('button',{name:'필지 선택',exact:true}).count(),1);await form.getByRole('button',{name:'필지 선택',exact:true}).click();}
  await form.getByRole('button',{name:'필지 초안에 추가',exact:true}).click();await form.getByLabel(parcel.address+' 작업면적',{exact:true}).fill(f.area);await form.getByLabel(parcel.address+' 토지형태',{exact:true}).selectOption(f.conditions.landUse);await p.waitForTimeout(2000);await shot('parcel-selected');
  await form.getByRole('button',{name:'선택 농지 저장',exact:true}).click();await form.getByRole('button',{name:'다음',exact:true}).click();await form.getByText('농지·기후 확인값',{exact:true}).click();await form.getByText('농지·지역 조건 확인 및 추천 근거',{exact:true}).click();
  for(const label of ['용수 확보','작업 장비 진입','필수 인력 확보'])await form.getByLabel(label,{exact:true}).selectOption('yes');await form.getByLabel('배수',{exact:true}).selectOption('good');await form.getByLabel('검토 지역',{exact:true}).fill(f.conditions.region);
  for(const [key,label] of [['rice','쌀'],['potato','감자'],['pepper','고추']])await form.getByLabel(label+' · 지역·품종 적합성 검토',{exact:true}).selectOption(f.conditions.climate[key]);await form.getByLabel('확인일',{exact:true}).fill(f.conditions.checkedOn);await form.getByLabel('출처·품종·현장 확인자 및 근거',{exact:true}).fill(f.conditions.evidence);await form.getByRole('checkbox',{name:/정보 이용 및/}).check();
  const submit=p.waitForResponse(r=>r.url().endsWith('/api/registrations')&&r.request().method()==='POST',{timeout:120000});await form.getByRole('button',{name:'다음',exact:true}).click();const r=await submit,v=await r.json();assert.equal(r.status(),200,JSON.stringify(v));x.command=r.request().postDataJSON();assert.equal(x.command.consultation.fields[0].pnu,parcel.pnu);await writeFile(resolve(folder,'inputs.json'),JSON.stringify(inputs));await expect(p.getByRole('heading',{name:'신청완료',exact:true})).toBeVisible();await shot('registration-saved');
  // The running production timer, not this recording script, performs the first review.
  let view:any;for(let i=0;i<60;i++){view=(await api('demo','/api/continuous-production')).view;if(view?.aiReviewError)throw Error(view.aiReviewError.message);if(view?.integratedPlan)break;await p.waitForTimeout(5000);}
  assert.equal(view?.integratedPlan?.source,'NEBIUS');await mark('timer-generated-real-ai-plan',{source:view.integratedPlan.source,choices:view.integratedPlan.choices});
  await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();await p.getByRole('button',{name:'AI 계획·일괄 확정',exact:true}).click();await approvedUi(p,view.integratedPlan.choices.map((c:any)=>c.pnu));
  await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();await p.waitForTimeout(3000);await shot('first-plan-saved');
 }else if(stage==='bulk'){
  const inputs=JSON.parse(await readFile(resolve(folder,'inputs.json'),'utf8'));const baseline=JSON.parse(await readFile(resolve(folder,'baseline.json'),'utf8'));
  const p=await startFilm('demo');await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();await shot('bulk-start');
  if(startWave){const existing=await db.workRecord.findMany({where:{kind:'fields',id:'current'}});assert.equal(existing.reduce((n,r)=>n+(r.payload as any[]).length,0),startWave);await p.waitForTimeout(2500);await shot('wave-'+startWave);}
  for(let start=startWave;start<300;start+=24){const wave=inputs.slice(start,start+24);
   for(const x of wave){const space=recordSpace(x.centerId);if(await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:space,kind:'registrationReceipt',id:x.command.requestId}}}))continue;
    x.command.fieldVersion=(await api(x.centerId,'/api/fields')).version;await api(x.centerId,'/api/registrations',x.command);await mark('registered',{center:x.centerId,pnu:x.command.consultation.fields[0].pnu});
   }
   for(const c of centerRegistry){for(let batch=0;batch<4;batch++){
    await inCenter(c.id,()=>db.$transaction(tx=>refreshProduction(tx),{timeout:60000}));let view=(await api(c.id,'/api/continuous-production')).view;
    const targets=wave.filter((x:any)=>x.centerId===c.id&&x.landCategory!=='과').map((x:any)=>x.command.consultation.fields[0].pnu);if(!targets.length||targets.every((p:string)=>view?.items.find((i:any)=>i.pnu===p)?.status==='SCHEDULED'))break;
    if(view?.aiReviewError){
     if(reviewedFailure!==c.id||recoveryUsed)throw Error(view.aiReviewError.message);recoveryUsed=true;
     await mark('reviewed-response-format-recovery',{center:c.id,previousError:view.aiReviewError.message,change:'Explicit concise evidence instruction; all schema and numerical checks retained'});
     const {createJointDraft,stageJointDraft}=await import('../lib/integrated-plan-service');
     await inCenter(c.id,async()=>{const requestId=randomUUID(),draft=await createJointDraft({requestId,mode:'AI',audience:c.id},'촬영 담당자 오류 검토');await db.$transaction(tx=>stageJointDraft(tx,{requestId,audience:c.id,fingerprint:draft.fingerprint},'촬영 담당자 오류 검토'),{timeout:60000});});
     view=(await api(c.id,'/api/continuous-production')).view;
    }
    const used=await budget();assert(used.reserved-baseline.budget.reserved<3_000_000,'Recording reservation guard $3 reached');assert(used.calls-baseline.budget.calls<400,'Recording call guard reached');
    if(!view?.integratedPlan){await inCenter(c.id,()=>reviewProductionAutomatically());view=(await api(c.id,'/api/continuous-production')).view;}
    if(view?.aiReviewError)throw Error(view.aiReviewError.message);assert.equal(view?.integratedPlan?.source,'NEBIUS');
    const pnus=view.integratedPlan.choices.map((c:any)=>c.pnu);assert(pnus.length);const prior=(await api(c.id,'/api/workspace')).state;
    const result=await api(c.id,'/api/continuous-production',{action:'approve',requestId:randomUUID(),fingerprint:view.fingerprint,pnus,provisionalAcknowledged:true});const after=(await api(c.id,'/api/workspace')).state;
    for(const m of prior.missions)assert.equal(hash(after.missions.find((n:any)=>n.id===m.id)),hash(m),'Earlier confirmed task changed');
    await mark('approved',{center:c.id,fields:pnus.length,crops:pnus.map((p:string)=>view.items.find((i:any)=>i.pnu===p).proposal.cultivation.crop),assigned:result.assigned,source:'NEBIUS',earlierTasksPreserved:true});
   }}
   await p.reload();await p.getByTestId('workspace-status').waitFor();await p.waitForTimeout(1200);await shot('wave-'+Math.min(start+24,300));
  }
  const centers=await db.center.findMany(),cultivations=await db.workRecord.findMany({where:{kind:'cultivation'}}),inventories=await db.workRecord.findMany({where:{kind:'fields',id:'current'}});
  evidence.summary={registered:inventories.reduce((n,r)=>n+(r.payload as any[]).length,0),planned:cultivations.length,missions:centers.reduce((n,r)=>n+(r.state as any).missions.length,0),reservations:await db.workRecord.count({where:{kind:'resourceReservation'}}),laborDemands:await db.workRecord.count({where:{kind:'laborDemand'}}),crops:cultivations.reduce((a,r)=>{const crop=(r.payload as any).crop;a[crop]=(a[crop]??0)+1;return a},{} as Record<string,number>),centers:centers.map(c=>({id:c.id,planned:(c.state as any).fields.length,tasks:(c.state as any).missions.length})),pending:[] as any[]};
  for(const c of centerRegistry){const view=(await api(c.id,'/api/continuous-production')).view;for(const i of view?.items??[])if(i.status!=='SCHEDULED')evidence.summary.pending.push({center:c.id,pnu:i.pnu,status:i.status,reason:i.reason});}
  assert.equal(evidence.summary.registered,300);await writeFile(resolve(folder,'before-incident.json'),JSON.stringify(await business(db)));await mark('bulk-complete',evidence.summary);
 }else if(stage==='incident'){
  const p=await startFilm('demo'),before=(await api('demo','/api/workspace')).state,others=hash(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}}));
  const harvest=before.missions.filter((m:any)=>m.operationCode==='harvest'&&m.resourceId?.includes('CB'));const counts:Record<string,number>={};for(const m of harvest)counts[m.scheduledDate]=(counts[m.scheduledDate]??0)+1;const day=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0],task=harvest.find((m:any)=>m.scheduledDate===day),until=new Date(Date.parse(day+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
  await p.goto(origin+'/?tab=schedule');await p.getByLabel('일정 연도',{exact:true}).selectOption(day.slice(0,4));await p.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:Number(day.slice(5,7))+'월',exact:true}).click();const daily=p.getByTestId('schedule-day-'+day);await daily.locator('summary').click();await daily.scrollIntoViewIfNeeded();await p.waitForTimeout(2000);await shot('schedule-before');
  await p.getByTestId('schedule-task-'+task.id).getByRole('button',{name:'관리',exact:true}).click();const modal=p.getByRole('dialog');await modal.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption('장비 문제');await modal.getByLabel('변경 희망일 (선택)',{exact:true}).fill(day);await modal.getByLabel('입고일',{exact:true}).fill(day);await modal.getByLabel('출고 예정일',{exact:true}).fill(until);await p.waitForTimeout(2500);await shot('breakdown-input');
  const response=p.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='automatic',{timeout:240000});await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();await mark('replanning-started',{day,until,resource:task.resourceId});const r=await response,v=await r.json();assert.equal(r.status(),200,JSON.stringify(v));assert.equal(v.status,'APPLIED',JSON.stringify(v));await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();await p.waitForTimeout(3500);await shot('replanned-result');
  const after=(await api('demo','/api/workspace')).state,changed=after.missions.filter((m:any)=>hash(m)!==hash(before.missions.find((o:any)=>o.id===m.id)));assert(changed.length);assert.equal(before.missions.length,after.missions.length);assert(!after.missions.some((m:any)=>m.resourceId===task.resourceId&&m.scheduledDate>=day&&m.scheduledDate<until));assert.equal(hash(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})),others);
  const receipt:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'automaticReplan',id:v.requestId}}})).payload;
  const plan:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'replanning',id:receipt.proposalId}}})).payload;assert.equal(plan.status,'APPLIED');assert.equal(plan.decision.recommendation.source,'NEBIUS');assert.equal(plan.decision.recommendation.rationaleCheck.status,'VERIFIED');
  const ownedIds=new Set(before.machines.filter((m:any)=>!m.ownerCenterId||m.ownerCenterId==='demo').map((m:any)=>m.id));
  const borrowedResources=[...new Set(changed.map((m:any)=>m.resourceId).filter((id:string|null)=>id&&!ownedIds.has(id)))];
  evidence.result={requestId:v.requestId,proposalId:receipt.proposalId,changed:changed.length,source:'NEBIUS',day,until,resource:task.resourceId,borrowedResources,otherCentersPreserved:true,changes:changed.map((m:any)=>{const prior=before.missions.find((a:any)=>a.id===m.id);return {id:m.id,before:{day:prior.scheduledDate,equipment:prior.resourceId},after:{day:m.scheduledDate,equipment:m.resourceId}}}),decision:plan.decision.recommendation};await writeFile(resolve(folder,'after-incident.json'),JSON.stringify(await business(db)));await mark('incident-complete',{changed:changed.length,source:'NEBIUS',day,until,borrowedResources,otherCentersPreserved:true});
  await modal.getByRole('button',{name:'완료',exact:true}).click();await p.reload();const savedTask=after.missions.find((m:any)=>m.id===task.id),savedDate=savedTask.scheduledDate;
  await p.getByLabel('일정 연도',{exact:true}).selectOption(savedDate.slice(0,4));await p.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:Number(savedDate.slice(5,7))+'월',exact:true}).click();await p.getByTestId('schedule-day-'+savedDate).locator('summary').click();await p.getByTestId('schedule-task-'+task.id).scrollIntoViewIfNeeded();await p.waitForTimeout(2000);await shot('persisted-after-refresh');await p.waitForTimeout(4000);
  await p.getByTestId('schedule-task-'+task.id).getByRole('button',{name:'관리',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'작업 이력',exact:true}).click();await p.waitForTimeout(1800);await shot('task-history');await p.waitForTimeout(5000);
 }else if(stage==='centers'){
  const p=await startFilm('demo');for(const center of ['demo','janggye','cheoncheon','gyenam']){
   await film!.clearCookies();await film!.addCookies(await contexts.get(center)!.cookies());await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();await p.waitForTimeout(4000);
   await p.getByTestId('field-map').evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-125}));
   await p.waitForTimeout(1200);await shot(center+'-map');await p.waitForTimeout(7000);
   await p.getByRole('heading',{name:'관리 농지',exact:true}).scrollIntoViewIfNeeded();await p.waitForTimeout(1500);await shot(center+'-fields');await p.waitForTimeout(5000);
  }
 }else if(stage==='screens'){
  const p=await startFilm('demo');for(const tab of ['fields','equipment','schedule','labor','reports']){
   await p.goto(origin+'/?tab='+tab);await p.getByTestId('workspace-status').waitFor();await p.waitForTimeout(2500);
   if(tab==='schedule'){await p.getByLabel('일정 연도',{exact:true}).selectOption('2027');await p.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:'10월',exact:true}).click();const daily=p.locator('.schedule-day').first();await daily.locator('summary').click();}
   if(tab==='labor'){for(let i=0;i<6;i++)await p.getByRole('button',{name:'다음 달 보기',exact:true}).click();}
   await shot(tab);await p.waitForTimeout(10000);
  }
  await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();await p.getByLabel('언어 / Language',{exact:true}).selectOption('en');
  const firstInput=JSON.parse(await readFile(resolve(folder,'inputs.json'),'utf8'))[0];await p.getByTestId('managed-field-'+firstInput.command.consultation.fields[0].pnu).getByRole('button',{name:'Manage',exact:true}).click();await p.getByRole('tab',{name:'Work history',exact:true}).click();await p.waitForTimeout(1800);await shot('field-history');await p.waitForTimeout(10000);
  await p.goto(origin+'/?tab=fields');await p.getByTestId('workspace-status').waitFor();
  await p.getByRole('button',{name:'AI planning / batch approval',exact:true}).click();
  await p.getByRole('tab',{name:'Resource proposal',exact:true}).click();await p.waitForTimeout(1800);await shot('ai-resources');await p.waitForTimeout(10000);
  await p.getByRole('tab',{name:'Comparison',exact:true}).click();await p.waitForTimeout(1800);await shot('ai-comparison');await p.waitForTimeout(12000);
 }
 evidence.complete=true;
}catch(error){evidence.error=error instanceof Error?error.message:String(error);console.error(evidence.error);if(page)await page.screenshot({path:resolve(folder,stage+'-error.png')}).catch(()=>{});process.exitCode=1;}
finally{
 if(page){evidence.rawVideo=await page.video()!.path();await film!.close();}for(const c of contexts.values())await c.close();await browser.close();
 evidence.protectedAfter={operating:hash(await business(operating)),scale:hash(await business(originalScale))};evidence.preserved=hash(evidence.protectedBefore)===hash(evidence.protectedAfter);evidence.budgetAfter=await budget();if(!evidence.preserved)process.exitCode=1;
 await writeFile(resolve(folder,stage+'-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({stage,complete:evidence.complete,error:evidence.error,preserved:evidence.preserved,budgetBefore:evidence.budgetBefore,budgetAfter:evidence.budgetAfter,rawVideo:evidence.rawVideo}));await Promise.all([db.$disconnect(),operating.$disconnect(),originalScale.$disconnect()]);
}
