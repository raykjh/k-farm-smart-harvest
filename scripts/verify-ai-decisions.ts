// --live is explicit paid opt-in. Run with the existing .env/.env.local; never print keys.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {recommendPlanningAlternative} from '../lib/planning-adviser';
import {adviseOperatingCrop} from '../lib/operating-crop-adviser';
import {scheduleCases,cropCase} from './fixtures/ai-decision-cases';
import {APPROVED_MODEL,VALIDATION_MICRO_USD,PRICE_REVIEW_EXPIRES_AT} from '../lib/ai-budget';

const live=process.argv.includes('--live');
const destination='.data/validation/20261004-ai-decisions';
const report:{[k:string]:unknown;cases:unknown[]}={createdAt:new Date().toISOString(),mode:live?'LIVE_NEBIUS':'ENGINE_ONLY',model:live?APPROVED_MODEL:null,additionalCapUsd:VALIDATION_MICRO_USD/1e6,priceReviewExpiresAt:PRICE_REVIEW_EXPIRES_AT,operatingWrites:'AI budget and call ledger only',cases:[]};
async function businessFingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return createHash('sha256').update(JSON.stringify({records,centers,outbox,receipts,audit})).digest('hex');
}
try{
 if(live)assert.equal(process.env.AI_MODE,'nebius','Explicit live environment required');
 report.before=await businessFingerprint();
 const schedules=await scheduleCases(),crop=await cropCase();
 const only=process.argv.find(v=>v.startsWith('--case='))?.slice(7),skip=new Set(process.argv.find(v=>v.startsWith('--skip='))?.slice(7).split(',')??[]);
 for(const c of schedules.filter(c=>(!only||c.id===only)&&!skip.has(c.id))){
  const baseline=await recommendPlanningAlternative(c.comparison,c.reason,'RULES');
  const decision=live?await recommendPlanningAlternative(c.comparison,c.reason):null;
  if(live){assert.equal(decision!.source,'NEBIUS');assert.equal(decision!.inferenceCalled,true);assert(c.comparison.nonDominatedIds.includes(decision!.alternativeId!));}
  report.cases.push({id:c.id,reason:c.reason,checks:c.checks,snapshot:c.comparison.snapshot.id,alternatives:c.comparison.results.map(r=>({id:r.id,status:r.status,metrics:r.metrics,warnings:r.warnings})),baseline,decision,sameChoice:decision?decision.alternativeId===baseline.alternativeId:null});
  await mkdir(destination,{recursive:true});await writeFile(`${destination}/${live?'live':'engine'}${only?'-'+only:''}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({case:c.id,status:'PASS',baseline:baseline.alternativeId,decision:decision?.alternativeId??null,usage:decision?.usage??null}));
 }
 if((!only||crop.id===only)&&!skip.has(crop.id)){
  const baseline=await adviseOperatingCrop(crop.facts),decision=live?await adviseOperatingCrop(crop.facts,true):null;
  if(live){assert.equal(decision!.source,'NEBIUS');assert.equal(decision!.inferenceCalled,true);}
  report.cases.push({...crop,baseline,decision,sameChoice:decision?decision.candidateId===baseline.candidateId:null});
  console.log(JSON.stringify({case:crop.id,status:'PASS',baseline:baseline.candidateId,decision:decision?.candidateId??null,usage:decision&&'usage' in decision?decision.usage:null}));
 }
 report.after=await businessFingerprint();assert.equal(report.after,report.before,'Business records changed');report.businessPreserved=true;report.status='PASS';
}catch(e){report.status='FAIL';report.error=e instanceof Error?e.message:'Comparison failed';console.error(report.error);process.exitCode=1;}
finally{await mkdir(destination,{recursive:true});const only=process.argv.find(v=>v.startsWith('--case='))?.slice(7);await writeFile(`${destination}/${live?'live':'engine'}${only?'-'+only:''}.json`,JSON.stringify(report,null,2));await db.$disconnect();}
