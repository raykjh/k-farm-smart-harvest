// User-approved +$0.05, at most eight predeclared calls. No retries or business writes.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {recommendPlanningAlternative,type PlanningRecommendation} from '../lib/planning-adviser';
import {RATIONALE_VERSION} from '../lib/planning-rationale';
import {APPROVED_MODEL,reservationMicroUsd,VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD,PRICE_REVIEW_EXPIRES_AT} from '../lib/ai-budget';
import {rationaleValidationFolder as folder,rationaleValidationGroups,digest} from './fixtures/rationale-validation-cases';

const live=process.argv.includes('--live'),path=`${folder}/${live?'live':'preflight'}.json`;
const originalFetch=globalThis.fetch;
const report:any={startedAt:new Date().toISOString(),mode:live?'LIVE_NEBIUS':'NO_INFERENCE',status:'PREFLIGHT',contractVersion:RATIONALE_VERSION,model:APPROVED_MODEL,cases:[],
 authorization:{additionalReservationMicroUsd:50000,maxCalls:8,cumulativeCapMicroUsd:150000},
 scope:'Synthetic four-center inputs and real production adviser. Only the existing paid-call ledger may change.',
 limitations:['One trial per variant is not a statistical reliability rate.','Resource minutes are not monetary profit/loss.','No field safety clearance, real agreements, SMS, equipment commands, deployment, or business approval.','This run does not re-test the browser-to-DB flow.']};
let ownsReport=false,networkCalls=0;
async function fingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return {sha256:digest({records,centers,outbox,receipts,audit}),counts:{records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length}};
}
async function ledger(){
 const budget=await db.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}),primary=await db.aiBudget.findUnique({where:{id:'nebius-primary'}}),usage=await db.aiCall.aggregate({_sum:{estimatedMicroUsd:true,promptTokens:true,completionTokens:true}});
 return {reservedMicroUsd:budget?.total??0,primaryReservedMicroUsd:primary?.total??0,capMicroUsd:VALIDATION_MICRO_USD,calls:await db.aiCall.count(),tokenEstimate:usage._sum};
}
async function save(){await writeFile(path,JSON.stringify(report,null,2));}
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm','Explicit operating ledger required; business data is read-only');
 assert(!process.env.AI_BUDGET_DATABASE_URL||process.env.AI_BUDGET_DATABASE_URL===process.env.DATABASE_URL,'Do not create a new allowance');
 assert.equal(VALIDATION_MICRO_USD,150000);assert(Date.now()<Date.parse(PRICE_REVIEW_EXPIRES_AT));
 const prepared=JSON.parse(await readFile(`${folder}/prepared.json`,'utf8'));
 assert.equal(prepared.mode,'OFFLINE_REQUEST_CAPTURE');assert.equal(prepared.paidInference,false);assert.equal(prepared.contractVersion,RATIONALE_VERSION);
 for(const [file,hash] of Object.entries(prepared.sourceHashes))assert.equal(digest(await readFile(file,'utf8')),hash,`Source changed: ${file}`);
 const ids=rationaleValidationGroups.flatMap(g=>['ORIGINAL','REVERSED'].map(order=>`${g.kind}-${g.priority}-${order}`));
 assert.deepEqual(prepared.cases.map((c:any)=>c.id),ids);
 for(const c of prepared.cases){assert.equal(digest(c.request),c.requestHash);assert.equal(digest(c.comparison),c.comparisonHash);assert.equal(c.request.model,APPROVED_MODEL);assert.equal(c.baseline.rationaleCheck.status,'VERIFIED');}
 report.requiredReservationMicroUsd=prepared.cases.reduce((n:number,c:any)=>n+reservationMicroUsd(c.request),0);
 assert.equal(report.requiredReservationMicroUsd,40000);assert(report.requiredReservationMicroUsd<=report.authorization.additionalReservationMicroUsd);
 report.preparedHash=digest(prepared);report.sourceHashes=prepared.sourceHashes;
 report.before=await fingerprint();report.budgetBefore=await ledger();
 assert(report.budgetBefore.reservedMicroUsd+report.requiredReservationMicroUsd<=VALIDATION_MICRO_USD,'Remaining approved validation cap cannot cover eight calls');
 await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});ownsReport=true;
 const negative=await recommendPlanningAlternative(prepared.noFeasibleCase.comparison);
 assert.equal(negative.inferenceCalled,false);assert.equal(negative.alternativeId,null);
 report.noFeasibleCase={status:'NO_FEASIBLE_PLAN',inferenceCalled:false};
 if(live){
  assert.equal(process.env.AI_MODE,'nebius');assert.equal(process.env.AI_CALL_SCOPE,'decisions');assert(process.env.NEBIUS_API_KEY,'API key missing');
  for(const c of prepared.cases){
   const entry:any={id:c.id,group:c.group,order:c.order,status:'PENDING_NO_RETRY',startedAt:new Date().toISOString(),requestHash:c.requestHash,baseline:c.baseline.alternativeId};
   report.cases.push(entry);await save();
   globalThis.fetch=async (input,init)=>{
    assert.equal(String(input),'https://api.tokenfactory.nebius.com/v1/chat/completions','Unexpected network destination');
    assert.equal(digest(JSON.parse(String(init?.body))),c.requestHash,'Actual request changed after offline checks');
    assert(networkCalls<8,'Maximum approved call count reached');networkCalls++;
    const response=await originalFetch(input,init);
    entry.httpStatus=response.status;
    if(response.ok){
     const raw=await response.clone().json();
     entry.response={model:raw.model,choices:raw.choices,usage:raw.usage};
     await save();
    }
    return response;
   };
   try{
    const decision:PlanningRecommendation=await recommendPlanningAlternative(c.comparison,c.reason);
    entry.decision=decision;
    assert.equal(decision.source,'NEBIUS');assert.equal(decision.inferenceCalled,true);
    entry.pass=decision.priorityCheck?.status==='ALIGNED'&&decision.rationaleCheck?.status==='VERIFIED'&&decision.alternativeId===c.baseline.alternativeId;
    entry.status=entry.pass?'PASS':'CONTRACT_FAILED';
   }catch(e){
    entry.pass=false;entry.status='INVALID_RESPONSE';entry.error=e instanceof Error?e.message:'Invalid response';
    if(!entry.response||entry.httpStatus!==200)throw e; // Never retry network/provider failures.
   }finally{globalThis.fetch=originalFetch;entry.finishedAt=new Date().toISOString();entry.budgetAfter=await ledger();await save();}
   console.log(JSON.stringify({case:entry.id,status:entry.status,selected:entry.decision?.alternativeId,priority:entry.decision?.priorityCheck,rationale:entry.decision?.rationaleCheck,usage:entry.decision?.usage,error:entry.error}));
  }
  report.observations={passed:report.cases.filter((c:any)=>c.pass).length,total:report.cases.length,priorityAligned:report.cases.filter((c:any)=>c.decision?.priorityCheck?.status==='ALIGNED').length,
   rationaleVerified:report.cases.filter((c:any)=>c.decision?.rationaleCheck?.status==='VERIFIED').length,
   orderPairs:rationaleValidationGroups.map(g=>{const group=`${g.kind}-${g.priority}`,pair=report.cases.filter((c:any)=>c.group===group);return {group,choices:pair.map((c:any)=>c.decision?.alternativeId??null),bothPassed:pair.every((c:any)=>c.pass),sameChoice:pair.every((c:any)=>!!c.decision)&&pair[0].decision.alternativeId===pair[1].decision.alternativeId};})};
  report.status=report.observations.passed===8?'ALL_EIGHT_PASSED':'MODEL_CONTRACT_FAILURES';
 }else report.status='PREFLIGHT_PASS';
}catch(e){report.status='STOPPED_NO_RETRY';report.error=e instanceof Error?e.message:'Verification failed';console.error(report.error);process.exitCode=1;}
finally{
 globalThis.fetch=originalFetch;
 if(report.before){report.after=await fingerprint();report.businessPreserved=report.before.sha256===report.after.sha256;report.budgetAfter=await ledger();
  if(!report.businessPreserved){report.status='BUSINESS_CHANGED';process.exitCode=1;}
  report.newCalls=report.budgetAfter.calls-report.budgetBefore.calls;report.newReservedMicroUsd=report.budgetAfter.reservedMicroUsd-report.budgetBefore.reservedMicroUsd;
  report.newEstimatedMicroUsd=(report.budgetAfter.tokenEstimate.estimatedMicroUsd??0)-(report.budgetBefore.tokenEstimate.estimatedMicroUsd??0);
 }
 report.networkCalls=networkCalls;report.finishedAt=new Date().toISOString();if(ownsReport)await save();
 console.log(JSON.stringify({status:report.status,businessPreserved:report.businessPreserved,newCalls:report.newCalls,newReservedMicroUsd:report.newReservedMicroUsd,newEstimatedMicroUsd:report.newEstimatedMicroUsd,observations:report.observations}));
 await db.$disconnect();
}
