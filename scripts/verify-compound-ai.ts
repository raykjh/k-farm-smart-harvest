// Fixed settings, six distinct live cases maximum, no retries. No business writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {compareReplanAlternatives} from '../lib/planning-decision';
import {recommendPlanningAlternative,PLANNING_MAX_TOKENS} from '../lib/planning-adviser';
import {resourceTradeoffCase,tradeoffDay} from './fixtures/resource-tradeoff-cases';
import {scheduleCases} from './fixtures/ai-decision-cases';
import {APPROVED_MODEL,VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';
import type {DecisionPriority} from '../lib/planning-priority';

const live=process.argv.includes('--live'),afterBilling=process.argv.includes('--resume-after-billing');
const namedRun=process.argv.find(a=>a.startsWith('--run='))?.slice(6),onlyCase=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
if(namedRun)assert(/^[a-z0-9-]{1,60}$/.test(namedRun)&&!afterBilling,'Unique diagnostic run name required');
if(onlyCase)assert(namedRun,'A selected-case run must have its own evidence name');
if(afterBilling&&!live)throw Error('Billing resume requires explicit --live');
const folder=namedRun?'.data/validation/20261011-submission-run':'.data/validation/20261011-crop-ai-compound',run=namedRun??(live?(afterBilling?'compound-live-after-billing':'compound-live'):'compound-engine'),file=`${folder}/${run}.json`;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report:any={startedAt:new Date().toISOString(),mode:live?'LIVE_NEBIUS':'ENGINE_ONLY',model:APPROVED_MODEL,settings:{toolChoice:'auto',reasoningEffort:'low',maxTokens:PLANNING_MAX_TOKENS,temperature:.1},maxCalls:onlyCase?1:6,automaticRetries:0,cases:[],providerResponses:[],status:'RUNNING',limitations:['Synthetic inputs, actual common engine and model adapter.','Minutes and person-minutes are not monetary profit.','No SMS, equipment commands or business DB changes.']};
const realFetch=globalThis.fetch;
async function fingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return hash({records,centers,outbox,receipts,audit});
}
async function ledger(){const budget=await db.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}),calls=await db.aiCall.findMany({select:{reservedMicroUsd:true,estimatedMicroUsd:true}});return {validationReserved:budget?.total??0,calls:calls.length,reserved:calls.reduce((n,c)=>n+c.reservedMicroUsd,0),estimated:calls.reduce((n,c)=>n+(c.estimatedMicroUsd??0),0)}}
async function save(){await writeFile(file,JSON.stringify(report,null,2));}
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');assert(!process.env.AI_BUDGET_DATABASE_URL||process.env.AI_BUDGET_DATABASE_URL===process.env.DATABASE_URL);
 await mkdir(folder,{recursive:true});
 if(live){
  assert.equal(process.env.AI_MODE,'nebius');assert(process.env.NEBIUS_API_KEY);
  const preflight=JSON.parse(await readFile('.data/validation/20261011-crop-ai-compound/compound-engine.json','utf8'));assert.equal(preflight.status,'PASS');
  if(afterBilling){
   // Manual resumption only after the account owner resolves billing. Preserve
   // the original denied request and never remove/reuse its one-run guard.
   const denied=JSON.parse(await readFile(`${folder}/compound-live.json`,'utf8'));
   assert.equal(denied.status,'FAIL');assert.match(denied.error??'',/402/);assert.equal(denied.cases.length,0);
   assert.equal(denied.businessPreserved,true);report.resumesReport='compound-live.json';
  }
  await writeFile(`${folder}/${run}.started`,new Date().toISOString(),{flag:'wx'});
  globalThis.fetch=async(input,init)=>{const response=await realFetch(input,init);
   if(String(input).startsWith('https://api.tokenfactory.nebius.com/')&&response.ok){const p=await response.clone().json();report.providerResponses.push({case:report.currentCase,usage:p.usage,finishReason:p.choices?.[0]?.finish_reason,toolCalls:p.choices?.[0]?.message?.tool_calls});}
   return response;
  };
 }
 report.before=await fingerprint();report.budgetBefore=await ledger();
 assert(report.budgetBefore.validationReserved+90000<=VALIDATION_MICRO_USD,'Insufficient conservative budget for six calls');
 const pending=[];
 for(const [kind,priority] of [['equipment','MIN_EXTERNAL'],['labor','PREFERRED_DATE'],['labor','MIN_EXTERNAL'],['compound','PREFERRED_DATE'],['compound','MIN_EXTERNAL']] as const){
  const c=resourceTradeoffCase(kind),before=hash(c.centers);
  const comparison=await compareReplanAlternatives(c.state,{...c.request,decisionPriority:priority as DecisionPriority},c.alternatives,c.weather,c.asOf);
  assert.equal(hash(c.centers),before);assert(comparison.results.every(r=>r.status==='FEASIBLE'));
  assert(new Set(comparison.results.filter(r=>comparison.nonDominatedIds.includes(r.id)).map(r=>JSON.stringify(r.metrics))).size>=2);
  pending.push({id:kind+'-'+priority,comparison,reason:c.request.reason??'',checks:{unchangedInput:true,distinctTradeoffs:true}});
 }
 const compound=(await scheduleCases()).find(c=>c.id==='compound-fault-wind-absence')!;
 pending.push({id:compound.id,comparison:compound.comparison,reason:compound.reason,checks:compound.checks});
 assert.equal(pending.length,6);
 const impossible=resourceTradeoffCase('compound');(impossible.state.missions[0] as any).planningWindow.to=tradeoffDay;impossible.state.laborCapacity!.incoming[0].status='OFFERED';
 const noPlan=await compareReplanAlternatives(impossible.state,impossible.request,impossible.alternatives,impossible.weather,impossible.asOf),negative=await recommendPlanningAlternative(noPlan);
 assert.equal(noPlan.nonDominatedIds.length,0);assert.equal(negative.inferenceCalled,false);assert.equal(negative.alternativeId,null);
 report.noFeasible={status:'NO_FEASIBLE_PLAN',inferenceCalled:false};
 assert(!onlyCase||pending.some(p=>p.id===onlyCase),'Unknown selected case');
 for(const p of pending.filter(p=>!onlyCase||p.id===onlyCase)){
  report.currentCase=p.id;
  const baseline=await recommendPlanningAlternative(p.comparison,p.reason,'RULES');
  const decision=live?await recommendPlanningAlternative(p.comparison,p.reason):baseline;
  if(live){assert.equal(decision.source,'NEBIUS');assert.equal(decision.inferenceCalled,true)}
  const passed=decision.rationaleCheck?.status==='VERIFIED'&&decision.priorityCheck?.status==='ALIGNED'&&p.comparison.nonDominatedIds.includes(decision.alternativeId!);
  const metrics=(id:string|null)=>p.comparison.results.find(r=>r.id===id)?.metrics;
  report.cases.push({id:p.id,checks:p.checks,passed,baseline,decision,ruleMetrics:metrics(baseline.alternativeId),aiMetrics:metrics(decision.alternativeId),sameChoice:decision.alternativeId===baseline.alternativeId,alternatives:p.comparison.results.map(r=>({id:r.id,status:r.status,metrics:r.metrics})),snapshotId:p.comparison.snapshot.id});
  await save();console.log(JSON.stringify({case:p.id,passed,baseline:baseline.alternativeId,choice:decision.alternativeId,rationale:decision.rationaleCheck?.status,priority:decision.priorityCheck?.status,usage:decision.usage}));
 }
 report.status=report.cases.every((c:any)=>c.passed)?'PASS':'OPERATOR_REVIEW';if(report.status!=='PASS')process.exitCode=2;
}catch(e){report.status='FAIL';report.error=e instanceof Error?e.message:'Verification failed';console.error(report.error);process.exitCode=1}
finally{
 globalThis.fetch=realFetch;
 if(report.before){report.after=await fingerprint();report.businessPreserved=report.before===report.after;report.budgetAfter=await ledger();if(!report.businessPreserved||report.budgetAfter.calls-report.budgetBefore.calls>report.maxCalls){report.status='FAIL';process.exitCode=1}report.finishedAt=new Date().toISOString();await save()}
 await db.$disconnect();
}
