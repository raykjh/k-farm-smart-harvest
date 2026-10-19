import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {chromium,expect} from '@playwright/test';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {VALIDATION_BUDGET_ID} from '../lib/ai-budget';
import {fourCenterDatabaseUrl} from './disposable-test-db';

assert.equal(process.env.DATABASE_URL,fourCenterDatabaseUrl('kfarm_centers_e2e_scale_20261017'));
assert(process.argv.includes('--live'),'Explicit bounded real-AI incident check required');
const original='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
assert.equal(process.env.AI_BUDGET_DATABASE_URL,original);
const operating=new PrismaClient({datasourceUrl:original}),folder='.data/intake-scale-20261017',origin='http://127.0.0.1:3100';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const next=(s:string,n=1)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function protectedHash(){return hash({records:await operating.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers:await operating.center.findMany({orderBy:{id:'asc'}}),outbox:await operating.outbox.findMany({orderBy:{id:'asc'}}),receipts:await operating.receipt.findMany({orderBy:{id:'asc'}}),audit:await operating.audit.findMany({orderBy:{id:'asc'}})})}
const budget=async()=>({calls:await operating.aiCall.count(),reserved:(await operating.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,estimated:(await operating.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0});
const evidence:any={startedAt:new Date().toISOString(),operatingBefore:await protectedHash(),budgetBefore:await budget(),actualSms:false,hardwareCommands:false,steps:[]};
const id=randomUUID(),token=randomBytes(32).toString('hex'),browser=await chromium.launch({headless:true});
const api=async(path:string,body?:unknown)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie:'kfarm_session='+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v};
try{
 assert.equal(evidence.operatingBefore,JSON.parse(await readFile(folder+'/prepared.json','utf8')).before.hash);
 await db.workRecord.createMany({data:[{...authKey('user',id),payload:{id,username:'scale-change-'+id,name:'계북면 화면 검증 담당자',role:'CENTER_ADMIN',centerId:'demo',enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}},{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.now()+3600000}}]});
 assert.equal((await api('/api/workspace')).state.ruleVersion,'INTAKE_SCALE_ISOLATED_V1');
 const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.addCookies([{name:'kfarm_session',value:token,url:origin}]);const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const kind of ['daily','breakdown']){
  const before=(await api('/api/workspace')).state,other=hash(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}}));
  const harvest=before.missions.filter((m:any)=>m.operationCode==='harvest'&&m.resourceId?.includes('CB'));
  assert(harvest.length);const counts:Record<string,number>={};for(const m of harvest)counts[m.scheduledDate]=(counts[m.scheduledDate]??0)+1;
  const day=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
  const task=harvest.find((m:any)=>m.scheduledDate===day);
  await page.goto(origin+'/?tab=schedule');await page.getByLabel('일정 연도',{exact:true}).selectOption(day.slice(0,4));
  await page.getByLabel('월별 일정',{exact:true}).getByRole('button',{name:Number(day.slice(5,7))+'월',exact:true}).click();
  const daily=page.getByTestId('schedule-day-'+day);await daily.locator('summary').click();
  if(kind==='daily'){await daily.getByRole('button',{name:'전체 선택',exact:true}).click();await daily.getByRole('button',{name:'일정변경',exact:true}).click()}
  else await page.getByTestId('schedule-task-'+task.id).getByRole('button',{name:'관리',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.getByLabel('변경 사유를 선택해주세요',{exact:true}).selectOption(kind==='daily'?'기타 변경':'장비 문제');
  await modal.getByLabel('변경 희망일 (선택)',{exact:true}).fill(kind==='daily'?next(day):day);
  if(kind==='breakdown'){await modal.getByLabel('입고일',{exact:true}).fill(day);await modal.getByLabel('출고 예정일',{exact:true}).fill(next(day,7))}
  await page.screenshot({path:folder+`/incident-${kind}-before.png`});
  const received=page.waitForResponse(r=>r.url().endsWith('/api/replanning')&&r.request().postDataJSON()?.action==='automatic',{timeout:240000});
  const at=Date.now();await modal.getByRole('button',{name:'일정변경 적용하기',exact:true}).click();const response=await received,result=await response.json();
  evidence.steps.push({kind,result,ms:Date.now()-at});assert.equal(response.status(),200,JSON.stringify(result));assert.equal(result.status,'APPLIED',JSON.stringify(result));
  await expect(modal.getByTestId('automatic-replan-applied')).toBeVisible();
  await page.screenshot({path:folder+`/incident-${kind}-saved.png`});
  const calls=(await budget()).calls;assert.deepEqual(await api('/api/replanning',response.request().postDataJSON()),result);assert.equal((await budget()).calls,calls);
  const after=(await api('/api/workspace')).state,changed=after.missions.filter((m:any)=>hash(m)!==hash(before.missions.find((p:any)=>p.id===m.id)));
  assert(changed.length,'A successful change must actually update the saved plan');assert.equal(after.missions.length,before.missions.length);
  assert.equal(hash(await db.center.findMany({where:{id:{not:'demo'}},orderBy:{id:'asc'}})),other,'Another center plan was modified');
  if(kind==='daily')assert(changed.some((m:any)=>m.scheduledDate!==before.missions.find((p:any)=>p.id===m.id).scheduledDate));
  else assert(!after.missions.some((m:any)=>m.resourceId===task.resourceId&&m.scheduledDate>=day&&m.scheduledDate<next(day,7)),'Task remains on broken equipment');
  const receipt:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'automaticReplan',id:result.requestId}}})).payload;
  const plan:any=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'replanning',id:receipt.proposalId}}})).payload;
  assert.equal(plan.status,'APPLIED');assert.equal(plan.decision.recommendation.source,'NEBIUS');assert.equal(plan.decision.recommendation.rationaleCheck.status,'VERIFIED');
  evidence.steps.at(-1).verified={changed:changed.length,source:plan.decision.recommendation.source,idempotent:true,otherCentersPreserved:true,proposalId:receipt.proposalId};
  await modal.getByRole('button',{name:'완료',exact:true}).click();
 }
 assert.deepEqual(errors,[]);evidence.browserErrors=errors;evidence.completedAt=new Date().toISOString();
}catch(e){evidence.error=e instanceof Error?e.message:String(e);process.exitCode=1}
finally{
 await browser.close();await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'session',id:digest(token)}]}});
 evidence.operatingAfter=await protectedHash();evidence.operatingPreserved=evidence.operatingBefore===evidence.operatingAfter;evidence.budgetAfter=await budget();
 if(!evidence.operatingPreserved)process.exitCode=1;
 await writeFile(folder+`/incident-${Date.now()}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await db.$disconnect();await operating.$disconnect();
}
