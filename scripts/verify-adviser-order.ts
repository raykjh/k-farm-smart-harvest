// Diagnosis only. No production prompt change, approvals, business writes or retries.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {APPROVED_MODEL,budgetedCompletion,reservationMicroUsd,VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';
import {assessDiagnosticResponse,diagnosticFolder,digest} from './fixtures/adviser-order-diagnostic';

const live=process.argv.includes('--live'),path=`${diagnosticFolder}/${live?'live':'preflight'}.json`;
const report:any={startedAt:new Date().toISOString(),status:'PREFLIGHT',mode:live?'LIVE_NEBIUS':'NO_INFERENCE',cases:[],
 scope:'Five predeclared diagnostic variants; only synthetic schedule facts sent. No production behavior or operating records modified.',
 limitations:['One response per variant cannot establish a statistical bias rate.','Only one equipment/date tradeoff; not a general model-quality benchmark.','Resource time is not monetary profit/loss.','Explicit priority wording is experimental, not applied to production.']};
let ownsReport=false;
async function fingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return {sha256:digest({records,centers,outbox,receipts,audit}),counts:{records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length}};
}
async function ledger(){const b=await db.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}});return {reservedMicroUsd:b?.total??0,capMicroUsd:VALIDATION_MICRO_USD,calls:await db.aiCall.count()};}
async function save(){await writeFile(path,JSON.stringify(report,null,2));}
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm','Explicit operating ledger required; no business writes occur');
 assert(!process.env.AI_BUDGET_DATABASE_URL||process.env.AI_BUDGET_DATABASE_URL===process.env.DATABASE_URL,'Use the same persistent budget');
 const prepared=JSON.parse(await readFile(`${diagnosticFolder}/prepared.json`,'utf8'));
 assert.equal(prepared.mode,'OFFLINE_REQUEST_CAPTURE');assert.equal(prepared.paidInference,false);
 for(const [file,hash] of Object.entries(prepared.sourceHashes))assert.equal(digest(await readFile(file,'utf8')),hash,`Source changed: ${file}`);
 assert.deepEqual(prepared.variants.map((v:any)=>v.id),['BASELINE','FACTS_REVERSED','SCHEMA_REVERSED','BOTH_REVERSED','EXPLICIT_LEXICOGRAPHIC']);
 for(const v of prepared.variants){assert.equal(v.requestHash,digest(v.body));assert.equal(v.body.model,APPROVED_MODEL);}
 report.requiredReservationMicroUsd=prepared.variants.reduce((n:number,v:any)=>n+reservationMicroUsd(v.body),0);
 assert.equal(report.requiredReservationMicroUsd,25000);
 report.preparedHash=digest(prepared);report.sourceHashes=prepared.sourceHashes;
 report.before=await fingerprint();report.budgetBefore=await ledger();
 assert(report.budgetBefore.reservedMicroUsd+report.requiredReservationMicroUsd<=VALIDATION_MICRO_USD,'Remaining validation reservation cannot cover five calls');
 report.variants=prepared.variants.map(({body,...metadata}:any)=>metadata);
 await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});ownsReport=true;
 if(live){
  assert.equal(process.env.AI_MODE,'nebius');assert(process.env.NEBIUS_API_KEY,'API key missing');
  for(const v of prepared.variants){
   const entry:any={id:v.id,status:'PENDING_NO_RETRY',startedAt:new Date().toISOString(),orders:v.orders,requestHash:v.requestHash};
   report.cases.push(entry);await save();
   const response=await budgetedCompletion(v.body,'schedule-decision');
   entry.response={model:response.model??null,choices:response.choices,usage:response.usage,kfarmUsage:response.kfarmUsage};
   entry.status='RESPONSE_SAVED';await save();
   entry.assessment=assessDiagnosticResponse(v.body,response);entry.status='CHECKED';entry.finishedAt=new Date().toISOString();await save();
   console.log(JSON.stringify({case:v.id,...entry.assessment,rawArguments:undefined,evidence:undefined,usage:response.kfarmUsage}));
  }
  const choices=Object.fromEntries(report.cases.map((c:any)=>[c.id,c.assessment.selected]));
  report.observations={choices,
   factsOrderChangedChoice:choices.BASELINE!==choices.FACTS_REVERSED||choices.SCHEMA_REVERSED!==choices.BOTH_REVERSED,
   schemaOrderChangedChoice:choices.BASELINE!==choices.SCHEMA_REVERSED||choices.FACTS_REVERSED!==choices.BOTH_REVERSED,
   explicitWordingChangedChoice:choices.BASELINE!==choices.EXPLICIT_LEXICOGRAPHIC,
   priorityAligned:report.cases.filter((c:any)=>c.assessment.priorityAligned).length,
   estimatedMicroUsd:report.cases.reduce((n:number,c:any)=>n+(c.response.kfarmUsage.estimatedMicroUsd??0),0)};
  report.status='DIAGNOSIS_COMPLETE';
 }else report.status='PREFLIGHT_PASS';
}catch(e){report.status='FAILED_NO_RETRY';report.error=e instanceof Error?e.message:'Diagnostic failure';console.error(report.error);process.exitCode=1;}
finally{
 if(report.before){report.after=await fingerprint();report.businessPreserved=report.before.sha256===report.after.sha256;report.budgetAfter=await ledger();if(!report.businessPreserved){report.status='BUSINESS_CHANGED';process.exitCode=1;}}
 report.finishedAt=new Date().toISOString();if(ownsReport)await save();
 console.log(JSON.stringify({status:report.status,businessPreserved:report.businessPreserved,budgetBefore:report.budgetBefore,budgetAfter:report.budgetAfter,observations:report.observations}));
 await db.$disconnect();
}
