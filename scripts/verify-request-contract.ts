// Explicitly approved $1/day; this diagnostic is capped at ten calls/$0.05
// reservation. No retry, business writes, model changes, or external actions.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {budgetedCompletion,reservationMicroUsd,APPROVED_MODEL,VALIDATION_BUDGET_ID} from '../lib/ai-budget';
import {requestDiagnosticFolder as folder,settings,ordered,compact,assess,chooseMethod,chooseEffort,digest,type Body,type Method,type Effort} from './fixtures/request-contract-diagnostic';

const stage=process.argv.find(a=>a.startsWith('--stage='))?.split('=')[1];
assert(stage&&['tools','reasoning','order','compact'].includes(stage),'Choose --stage=tools|reasoning|order|compact');
const live=process.argv.includes('--live');
const stages=['tools','reasoning','order','compact'];
const path=`${folder}/${stage}-${live?'live':'preflight'}.json`;
const report:any={startedAt:new Date().toISOString(),stage,mode:live?'LIVE_NEBIUS':'OFFLINE_PREFLIGHT',cases:[],
 authorization:{dailyUsd:1,batchMaxCalls:10,batchMaxReservedMicroUsd:50000},
 boundaries:['Synthetic inputs, real adviser semantic validator. No operational plan/reservation/labor/notification changes.',
  'One sample per cell is exploratory, not a reliability estimate. No retries.',
  'Reasoning parameter acceptance alone is not proof of thinking activation.'],status:'PREPARING'};
let ownsFile=false;
const read=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
async function fingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return {sha256:digest({records,centers,outbox,receipts,audit}),counts:{records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length}};
}
async function ledger(){
 const budgets=await db.aiBudget.findMany({where:{id:{in:[VALIDATION_BUDGET_ID,'nebius-primary']}}});
 const costs=await db.aiCall.aggregate({_sum:{estimatedMicroUsd:true}});
 return {calls:await db.aiCall.count(),validationReservedMicroUsd:budgets.find(b=>b.id===VALIDATION_BUDGET_ID)?.total??0,primaryReservedMicroUsd:budgets.find(b=>b.id==='nebius-primary')?.total??0,estimatedMicroUsd:costs._sum.estimatedMicroUsd??0};
}
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm','Use the existing paid-call ledger, business data read-only');
 assert(!process.env.AI_BUDGET_DATABASE_URL||process.env.AI_BUDGET_DATABASE_URL===process.env.DATABASE_URL,'Never create a test spending allowance');
 const prepared=await read('.data/validation/20261005-rationale-live/prepared.json'),priorLive=await read('.data/validation/20261005-rationale-live/live.json');
 assert.equal(digest(prepared),priorLive.preparedHash,'Historical inputs changed');
 const source=prepared.cases.find((c:any)=>c.id==='equipment-PREFERRED_DATE-ORIGINAL');assert(source);
 assert.equal(digest(source.request),source.requestHash);assert.equal(digest(source.comparison),source.comparisonHash);
 report.source={caseId:source.id,requestHash:source.requestHash,comparisonHash:source.comparisonHash,model:source.request.model};
 report.comparison=source.comparison;
 report.sourceHashes=Object.fromEntries(await Promise.all(['lib/ai-budget.ts','lib/planning-adviser.ts','lib/planning-rationale.ts','scripts/fixtures/request-contract-diagnostic.ts'].map(async f=>[f,digest(await readFile(f,'utf8'))])));
 const prior:any[]=[];
 for(const s of stages.slice(0,stages.indexOf(stage))){const r=await read(`${folder}/${s}-live.json`);assert.equal(r.status,'COMPLETED');assert(r.businessPreserved);prior.push(r);}
 const method:Method=prior.length?chooseMethod(prior[0].cases):'forced';
 const effort:Effort=prior.length>1?chooseEffort(prior[1].cases):'none';
 report.selectedSettings={method,effort,rule:'Higher full-contract score, then priority alignment; method tie -> auto. Thinking only if reported reasoning>0 and full pass improves; tie -> none.'};
 type Variant={id:string;method:Method;effort:Effort;body:Body;wire:'legacy'|'compact';factsReversed?:boolean;schemaReversed?:boolean};
 const variants:Variant[]=stage==='tools'?(['forced','auto'] as const).map(method=>({id:`tools-${method}`,method,effort:'none',body:settings(source.request,method,'none',650),wire:'legacy'})):
  stage==='reasoning'?(['none','low'] as const).map(effort=>({id:`reasoning-${effort}`,method,effort,body:settings(source.request,method,effort,2048),wire:'legacy'})):
  stage==='order'?[[false,false],[true,false],[false,true],[true,true]].map(([factsReversed,schemaReversed])=>({id:`order-f${Number(factsReversed)}-s${Number(schemaReversed)}`,method,effort,factsReversed,schemaReversed,body:ordered(settings(source.request,method,effort,2048),factsReversed,schemaReversed),wire:'legacy'})):
  [false,true].map(reverse=>({id:`compact-${reverse?'reversed':'original'}`,method,effort,factsReversed:reverse,schemaReversed:reverse,body:compact(ordered(settings(source.request,method,effort,2048),reverse,reverse)),wire:'compact'}));
 report.plannedCalls=variants.length;
 report.plannedReservationMicroUsd=variants.reduce((n,v)=>n+reservationMicroUsd(v.body,'diagnostic'),0);
 const previousCalls=prior.reduce((n,r)=>n+r.cases.length,0),previousReserved=prior.reduce((n,r)=>n+r.newReservedMicroUsd,0);
 assert(previousCalls+variants.length<=10);assert(previousReserved+report.plannedReservationMicroUsd<=50000);
 assert(variants.every(v=>v.body.model===APPROVED_MODEL));
 report.before=await fingerprint();report.budgetBefore=await ledger();
 assert.equal(report.before.sha256,priorLive.after.sha256,'Business records changed since the reference; stop for review');
 if(prior.length)assert.equal(report.budgetBefore.calls,prior.at(-1).budgetAfter.calls,'Unplanned paid calls since previous stage');
 await mkdir(folder,{recursive:true});await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});ownsFile=true;
 if(live){
  assert.equal(process.env.KFARM_AI_REQUEST_DIAGNOSTIC,'1');assert.equal(process.env.AI_MODE,'nebius');assert.equal(process.env.AI_CALL_SCOPE,'decisions');
  for(const variant of variants){
   const entry:any={...variant,requestHash:digest(variant.body),startedAt:new Date().toISOString(),status:'PENDING_NO_RETRY'};
   report.cases.push(entry);await writeFile(path,JSON.stringify(report,null,2));
   // Guard is shared with production: reserve before network and persist usage.
   const response=await budgetedCompletion(variant.body,'request-diagnostic');
   entry.response={model:response.model,choices:response.choices,usage:response.usage};entry.usage=response.kfarmUsage;
   entry.reasoningTokens=response.usage?.completion_tokens_details?.reasoning_tokens??null;
   entry.reasoningReported=typeof entry.reasoningTokens==='number'&&entry.reasoningTokens>0;
   assert.equal(response.model,APPROVED_MODEL,'Unexpected provider model');
   try{entry.assessment=assess(source.comparison,response,variant.wire);entry.status=entry.assessment.passed?'PASS':'SEMANTIC_FAILURE';}
   catch(error){entry.status='INVALID_RESPONSE';entry.error=error instanceof Error?error.message:'Invalid response';}
   entry.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2));
   console.log(JSON.stringify({id:entry.id,status:entry.status,selected:entry.assessment?.selected,reasoningTokens:entry.reasoningTokens,completionTokens:response.usage?.completion_tokens,issues:entry.assessment?.grounded.rationaleCheck.issues,error:entry.error}));
  }
 }else report.cases=variants.map(v=>({...v,requestHash:digest(v.body),status:'NOT_CALLED'}));
 report.status=live?'COMPLETED':'PREFLIGHT_PASSED';
}catch(error){report.status='STOPPED_NO_RETRY';report.error=error instanceof Error?error.message:'Diagnostic failed';console.error(report.error);process.exitCode=1;}
finally{
 if(report.before){report.after=await fingerprint();report.budgetAfter=await ledger();report.businessPreserved=report.before.sha256===report.after.sha256;
  report.newCalls=report.budgetAfter.calls-report.budgetBefore.calls;report.newReservedMicroUsd=report.budgetAfter.validationReservedMicroUsd-report.budgetBefore.validationReservedMicroUsd;report.newEstimatedMicroUsd=report.budgetAfter.estimatedMicroUsd-report.budgetBefore.estimatedMicroUsd;
  if(!report.businessPreserved){report.status='BUSINESS_CHANGED';process.exitCode=1;}
 }
 report.finishedAt=new Date().toISOString();if(ownsFile)await writeFile(path,JSON.stringify(report,null,2));
 console.log(JSON.stringify({stage,status:report.status,newCalls:report.newCalls,reservedMicroUsd:report.newReservedMicroUsd,estimatedMicroUsd:report.newEstimatedMicroUsd,businessPreserved:report.businessPreserved}));
 await db.$disconnect();
}
