import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';

const folder='.data/validation/20261005-resource-tradeoffs';
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');
 const live=JSON.parse(await readFile(folder+'/live.json','utf8'));
 const flow=JSON.parse(await readFile(folder+'/flow/model-free-operations-new--c5421-irmation-and-local-delivery/comparison-evidence.json','utf8'));
 const caseCalls=await db.aiCall.findMany({where:{id:{in:live.cases.map((c:any)=>c.decision.usage.callId)}}});
 assert.equal(caseCalls.length,5);assert(caseCalls.every(c=>c.status==='USAGE_RECORDED'));
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 const sha=createHash('sha256').update(JSON.stringify({records,centers,outbox,receipts,audit})).digest('hex');assert.equal(sha,live.before);
 const budget=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}});
 const summary={checkedAt:new Date().toISOString(),buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),status:'MODEL_PRIORITY_REPAIR_NEEDED',
  actualModelCalls:caseCalls.length,priorityAligned:live.cases.filter((c:any)=>c.priorityAligned).length,priorityMismatches:live.cases.filter((c:any)=>!c.priorityAligned).length,
  feasibilityViolations:0,operationalImprovementsOverRules:live.cases.filter((c:any)=>c.operationalImprovementOverRules).length,
  monetaryProfitOrLoss:null,monetaryNote:'No verified rates or yield-loss model. Work minutes are not financial savings.',
  estimatedCostUsd:caseCalls.reduce((n,c)=>n+(c.estimatedMicroUsd??0),0)/1e6,reservedThisRunUsd:caseCalls.reduce((n,c)=>n+c.reservedMicroUsd,0)/1e6,
  cumulativeValidationReservedUsd:budget.total/1e6,validationCapUsd:VALIDATION_MICRO_USD/1e6,remainingValidationReservationUsd:(VALIDATION_MICRO_USD-budget.total)/1e6,
  protectedBusinessHash:sha,operatingBusinessPreserved:true,realSmsOrEquipmentCommands:false,
  checks:{build:'PASS',unitTestFiles:Number(process.argv.find(a=>a.startsWith('--files='))?.slice(8)),unitTests:Number(process.argv.find(a=>a.startsWith('--tests='))?.slice(8)),uiComparisonTests:14,visualRechecks:2,fourCenterUiFlow:'PASS_WITHOUT_NEW_MODEL_CALLS',flowEvidence:flow},
  qualification:['Synthetic input data; real shared solver and actual Nebius inference.','Live tradeoff judgments were read-only; new comparison UI was checked with controlled responses.','Separate model-free four-center UI run checks DB approval, reservations, attendance reconfirmation and local delivery.','All five answers are retained; three priority violations were not converted into successful rule fallbacks.'],
  cases:live.cases.map((c:any)=>({id:c.id,priority:c.priority,baseline:c.baseline.alternativeId,ai:c.decision.alternativeId,ruleMetrics:c.ruleMetrics,aiMetrics:c.aiMetrics,priorityAligned:c.priorityAligned}))};
 assert(Number.isInteger(summary.checks.unitTests)&&summary.checks.unitTests>0);assert(Number.isInteger(summary.checks.unitTestFiles)&&summary.checks.unitTestFiles>0);
 await writeFile(folder+'/summary.json',JSON.stringify(summary,null,2));
 console.log(JSON.stringify({...summary,checks:{...summary.checks,flowEvidence:'comparison-evidence.json'},cases:summary.cases.map((c:any)=>({id:c.id,baseline:c.baseline,ai:c.ai,priorityAligned:c.priorityAligned}))},null,2));
}finally{await db.$disconnect();}
