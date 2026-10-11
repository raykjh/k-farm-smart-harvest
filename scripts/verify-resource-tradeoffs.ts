// Run engine-only first. --live permits exactly five bounded calls, no retries.
// Business inputs stay in memory; only the existing paid-call ledger may change.
import assert from 'node:assert/strict';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {compareReplanAlternatives} from '../lib/planning-decision';
import {recommendPlanningAlternative} from '../lib/planning-adviser';
import {priorityMetrics,type DecisionPriority} from '../lib/planning-priority';
import {resourceTradeoffCase,tradeoffDay} from './fixtures/resource-tradeoff-cases';
import {APPROVED_MODEL,VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';

const live=process.argv.includes('--live'),folder='.data/validation/20261005-resource-tradeoffs',path=`${folder}/${live?'live':'engine'}.json`;
const report:any={startedAt:new Date().toISOString(),mode:live?'LIVE_NEBIUS':'ENGINE_ONLY',model:live?APPROVED_MODEL:null,cases:[],status:'RUNNING',monetaryOutcome:null,
 scope:'Synthetic inputs for four centers; production replan solver, validator and adviser. No business DB write, SMS or equipment command.',
 limitations:['Work minutes are not monetary profit/loss; no verified rates or yield-loss function.','Future operation windows, people and agreements are explicit synthetic fixtures.','This checks decision tradeoffs; the prior live UI-to-DB proof is a separate run.']};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return digest({records,centers,outbox,receipts,audit});
}
async function ledger(){const b=await db.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}});return {reservedMicroUsd:b?.total??0,capMicroUsd:VALIDATION_MICRO_USD,calls:await db.aiCall.count()};}
async function save(){await mkdir(folder,{recursive:true});await writeFile(path,JSON.stringify(report,null,2));}
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm','Explicit operating ledger required; no business writes occur');
 assert(!process.env.AI_BUDGET_DATABASE_URL||process.env.AI_BUDGET_DATABASE_URL===process.env.DATABASE_URL,'One persistent ledger only');
 if(live){
  assert.equal(process.env.AI_MODE,'nebius');assert(process.env.NEBIUS_API_KEY);
  assert(!(await access(path).then(()=>true,()=>false)),'Do not repeat paid cases; review the existing live report');
 }
 report.before=await fingerprint();report.budgetBefore=await ledger();
 if(live)assert(report.budgetBefore.reservedMicroUsd+25000<=VALIDATION_MICRO_USD,'Remaining validation budget cannot cover five calls');
 // Complete ALL engine checks before making the first paid request.
 const pending=[];
 for(const kind of ['equipment','labor','compound'] as const){
  for(const priority of (kind==='compound'?['PREFERRED_DATE']:['PREFERRED_DATE','MIN_EXTERNAL']) as DecisionPriority[]){
   const c=resourceTradeoffCase(kind),inputHash=digest(c.centers);
   const comparison=await compareReplanAlternatives(c.state,{...c.request,decisionPriority:priority},c.alternatives,c.weather,c.asOf);
   assert.equal(digest(c.centers),inputHash);
   assert(comparison.results.every(r=>r.status==='FEASIBLE'));
   const eligible=comparison.results.filter(r=>comparison.nonDominatedIds.includes(r.id));
   assert(new Set(eligible.map(r=>JSON.stringify(r.metrics))).size>=2,'A paid comparison needs distinct non-dominated tradeoffs');
   const baseline=await recommendPlanningAlternative(comparison,c.request.reason,'RULES');
   const measure=(id:string|null)=>comparison.results.find(r=>r.id===id)!.metrics!;
   if(priority==='MIN_EXTERNAL')assert.equal(measure(baseline.alternativeId).borrowedEquipmentMinutes+measure(baseline.alternativeId).supportPersonMinutes,0);
   else assert.equal(measure(baseline.alternativeId).preferredDistanceDays,0);
   const entry={id:kind+'-'+priority,kind,priority,centersInputHash:inputHash,snapshot:comparison.snapshot,baseline,alternatives:comparison.results.map(r=>({id:r.id,status:r.status,metrics:r.metrics,dates:r.result!.diff.map(d=>({task:d.id,date:d.date}))})),checks:{distinctNonDominatedTradeoffs:true,allAssignmentsVerified:true,unchangedInputs:true,completedPreserved:comparison.results.every(r=>r.result!.diff.every(d=>d.id==='selected'))}};
   pending.push({c,comparison,entry,measure});
  }
 }
 const shortage=resourceTradeoffCase('compound');
 (shortage.state.missions[0] as any).planningWindow.to=tradeoffDay;shortage.state.laborCapacity!.incoming[0].status='OFFERED';
 const negative=await compareReplanAlternatives(shortage.state,shortage.request,shortage.alternatives,shortage.weather,shortage.asOf);
 assert.equal(negative.nonDominatedIds.length,0);
 const negativeAdvice=await recommendPlanningAlternative(negative);
 assert.equal(negativeAdvice.inferenceCalled,false);assert.equal(negativeAdvice.alternativeId,null);
 report.noFeasibleCase={status:'NO_FEASIBLE_PLAN',inferenceCalled:false,reason:'One-day window and no confirmed worker support; borrowing alone cannot replace ordinary labor'};
 for(const p of pending){
  const decision=live?await recommendPlanningAlternative(p.comparison,p.c.request.reason):null;
  if(decision){assert.equal(decision.source,'NEBIUS');assert.equal(decision.inferenceCalled,true);assert(p.comparison.nonDominatedIds.includes(decision.alternativeId!));}
  const ruleMetrics=p.measure(p.entry.baseline.alternativeId),aiMetrics=decision?p.measure(decision.alternativeId):null;
  const ordered=priorityMetrics(p.entry.priority,true),firstDifferent=aiMetrics?ordered.find(k=>aiMetrics[k]!==ruleMetrics[k]):undefined;
  const priorityAligned=aiMetrics?!firstDifferent||aiMetrics[firstDifferent]<ruleMetrics[firstDifferent]:null;
  report.cases.push({...p.entry,decision,ruleMetrics,aiMetrics,priorityAligned,sameChoice:decision?decision.alternativeId===p.entry.baseline.alternativeId:null,
   firstDifferentMetric:firstDifferent??null,operationalImprovementOverRules:aiMetrics?!!firstDifferent&&aiMetrics[firstDifferent]<ruleMetrics[firstDifferent]:null});
  await save();
  console.log(JSON.stringify({case:p.entry.id,rules:p.entry.baseline.alternativeId,ai:decision?.alternativeId??null,ruleMetrics,aiMetrics,priorityAligned,usage:decision?.usage??null}));
 }
 report.status=live&&report.cases.some((c:any)=>!c.priorityAligned)?'PRIORITY_MISMATCH':'PASS';
 if(report.status==='PRIORITY_MISMATCH')process.exitCode=2;
}catch(e){report.status='FAIL';report.error=e instanceof Error?e.message:'Comparison failed';console.error(report.error);process.exitCode=1;}
finally{
 if(report.before){report.after=await fingerprint();report.businessPreserved=report.after===report.before;if(!report.businessPreserved){report.status='FAIL';process.exitCode=1;}report.budgetAfter=await ledger();}
 report.finishedAt=new Date().toISOString();
 if(report.before)await save();
 await db.$disconnect();
}
