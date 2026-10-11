// Replays existing evidence only. Never invokes a provider or writes business data.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {groundPlanningSelection} from '../lib/planning-adviser';
import {requestDiagnosticFolder as folder,digest} from './fixtures/request-contract-diagnostic';
import {VALIDATION_BUDGET_ID,DAILY_MICRO_USD,VALIDATION_MICRO_USD} from '../lib/ai-budget';
const read=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');
 const stages=await Promise.all(['tools','reasoning','order','compact'].map(s=>read(`${folder}/${s}-live.json`)));
 assert(stages.every(s=>s.status==='COMPLETED'&&s.businessPreserved));
 const entries=stages.flatMap(s=>s.cases);assert.equal(entries.length,10);
 const cases=entries.map(entry=>{
  const stage=stages.find(s=>s.cases.includes(entry))!;
  const raw=JSON.parse(entry.response.choices[0].message.tool_calls[0].function.arguments);
  const grounded=groundPlanningSelection(stage.comparison,raw,'MODEL',entry.wire);
  assert.equal(grounded.alternativeId,entry.assessment.selected);assert.equal(grounded.rationaleCheck.status==='VERIFIED',entry.assessment.rationaleVerified);
  return {id:entry.id,method:entry.method,effort:entry.effort,wire:entry.wire,selected:grounded.alternativeId,expected:entry.assessment.expected,passed:entry.assessment.passed,reasoningTokens:entry.reasoningTokens,completionTokens:entry.response.usage.completion_tokens,issues:grounded.rationaleCheck.issues,callId:entry.usage.callId};
 });
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 const businessHash=digest({records,centers,outbox,receipts,audit});assert.equal(businessHash,stages[0].before.sha256);
 const ledger=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}}),calls=await db.aiCall.count();
 assert.equal(calls,stages.at(-1).budgetAfter.calls);assert.equal(ledger.total,stages.at(-1).budgetAfter.validationReservedMicroUsd);
 const tests=await read(`${folder}/all-tests.json`),recheck=await read(`${folder}/budget-date-recheck.json`);
 // Preserve the full-run failures as evidence; the only subsequent change was
 // its test-date fixture. Do not rewrite the original report as if it passed.
 assert.equal(tests.numFailedTests,2);assert(recheck.success);assert.equal(recheck.numFailedTests,0);
 assert.equal(recheck.numPassedTests,3);
 assert(tests.testResults.filter((r:any)=>r.status!=='passed').every((r:any)=>r.name.endsWith('ai-budget-db.test.ts')));
 const summary={checkedAt:new Date().toISOString(),status:'CONTROLLED_REQUEST_COMPARISON_COMPLETE',model:stages[0].source.model,
  results:{totalCalls:cases.length,noReasoning:{calls:cases.filter(c=>c.effort==='none').length,passed:cases.filter(c=>c.effort==='none'&&c.passed).length},lowReasoning:{calls:cases.filter(c=>c.effort==='low').length,passed:cases.filter(c=>c.effort==='low'&&c.passed).length},orderVariants:4,compactVariants:2},cases,
  interpretation:'In this single equipment/date-priority scenario, changing forced to auto without reasoning did not help; low reasoning passed all seven trials including independently permuted orders and compact output. This is not broad model reliability, labor/compound coverage, or an isolated proof about provider internals.',
  application:{toolChoice:'auto',reasoningEffort:'low',maxTokens:2048,temperature:0.1,wire:'planning-choice-v2',metadataSource:'SERVER',legacyClaimsUnchanged:true,approvalRequired:true,automaticRetry:false,cropAdviserUnchanged:true},
  costs:{newCalls:cases.length,newReservedUsd:stages.reduce((n,s)=>n+s.newReservedMicroUsd,0)/1e6,newTokenEstimateUsd:stages.reduce((n,s)=>n+s.newEstimatedMicroUsd,0)/1e6,invoiceVerified:false,cumulativeValidationReservedUsd:ledger.total/1e6,dailyLimitUsd:DAILY_MICRO_USD===null?null:DAILY_MICRO_USD/1e6,additionalCumulativeValidationLimitUsd:VALIDATION_MICRO_USD/1e6,totalLedgerCalls:calls},
  verification:{unitFiles:tests.testResults.length,uniqueTestsValidated:tests.numPassedTests+tests.numFailedTests,
   fullRun:{passed:tests.numPassedTests,failed:tests.numFailedTests},recheck:{file:'tests/ai-budget-db.test.ts',passed:recheck.numPassedTests,failed:0,fix:'Use PostgreSQL CURRENT_DATE for date-only test fixtures; UTC Date disagreed with Asia/Seoul after midnight.'},
   buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),browserFlowRerun:false,currentRequestMatchesPaidCompactTrials:true},
  business:{preserved:true,sha256:businessHash,counts:{records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length}},
  next:'Validate the compact thinking contract on MIN_EXTERNAL, labor, compound, infeasible/blocked and tie cases before a broad performance claim. Current offline regressions are not live model evidence for those scenarios.'};
 await writeFile(`${folder}/summary.json`,JSON.stringify(summary,null,2),{flag:'wx'});
 console.log(JSON.stringify(summary,null,2));
}finally{await db.$disconnect();}
