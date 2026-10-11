// Read-only replay of saved provider responses. No inference or business writes.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {checkRationale} from '../lib/planning-rationale';
import {verifyPlanningReview} from '../lib/planning-review';
import {rationaleValidationFolder as folder,digest} from './fixtures/rationale-validation-cases';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';

try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');
 const prepared=JSON.parse(await readFile(`${folder}/prepared.json`,'utf8')),live=JSON.parse(await readFile(`${folder}/live.json`,'utf8'));
 assert.equal(digest(prepared),live.preparedHash);assert.equal(live.networkCalls,8);assert.equal(live.cases.length,8);
 const cases=[];
 for(const entry of live.cases){
  const input=prepared.cases.find((c:any)=>c.id===entry.id);assert(input);
  const response=entry.response,decision=entry.decision;
  assert.equal(response.model,live.model);assert.equal(entry.httpStatus,200);assert.equal(response.choices[0].finish_reason,'tool_calls');
  const raw=JSON.parse(response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(raw.alternativeId,decision.alternativeId);
  assert.deepEqual({contractVersion:raw.contractVersion,selectionReason:raw.selectionReason,rejections:raw.rejections},decision.rationale);
  assert.deepEqual(raw.evidence,decision.evidence.map(({alternativeId,metric}:any)=>({alternativeId,metric})));
  const checked=checkRationale(input.comparison,raw.alternativeId,raw.evidence,decision.rationale,'MODEL');
  assert.deepEqual(checked,decision.rationaleCheck);assert.equal(checked.status,'INVALID');
  const review={comparison:input.comparison,recommendation:decision,historyHash:'read-only-replay',expires:2000};
  const selected=input.comparison.results.find((c:any)=>c.id===raw.alternativeId);
  const verified=verifyPlanningReview(review,selected.previewRequest,selected.id,input.comparison.snapshot.id,review.historyHash,1000);
  assert.equal(verified.selectionBasis,'OPERATOR_REVIEW');
  cases.push({id:entry.id,expected:entry.baseline,selected:raw.alternativeId,priorityAligned:decision.priorityCheck.status==='ALIGNED',
   rationaleVerified:false,issues:checked.issues,firstListedSelected:raw.alternativeId===input.request.tools[0].function.parameters.properties.alternativeId.enum[0],
   eligibleCount:JSON.parse(input.request.messages[1].content).eligibleIds.length,claimedSelectionReason:raw.selectionReason,
   explicitSelectionBasis:verified.selectionBasis,callId:decision.usage.callId});
 }
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 const sha256=digest({records,centers,outbox,receipts,audit});assert.equal(sha256,live.before.sha256);
 const calls=await db.aiCall.findMany({where:{id:{in:cases.map(c=>c.callId)}}});assert.equal(calls.length,8);assert(calls.every(c=>c.status==='USAGE_RECORDED'));
 const ledger=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}});assert.equal(ledger.total,live.budgetAfter.reservedMicroUsd);
 const testReport=JSON.parse(await readFile(`${folder}/all-tests.json`,'utf8'));
 const buildId=(await readFile('.next/BUILD_ID','utf8')).trim();
 const summary={checkedAt:new Date().toISOString(),status:'LIVE_VALIDATION_COMPLETED_MODEL_NOT_ACCEPTED',model:live.model,contractVersion:live.contractVersion,
  results:{calls:8,priorityAligned:cases.filter(c=>c.priorityAligned).length,fullContractPassed:0,firstListedSelected:cases.filter(c=>c.firstListedSelected).length,
   incorrectOnlyEligibleClaims:cases.filter(c=>c.eligibleCount>1&&c.claimedSelectionReason==='ONLY_ELIGIBLE').length,orderPairs:live.observations.orderPairs},
  interpretation:'The current model/request combination failed the contract. Candidate-order dependence was observed in this small controlled run; this does not isolate provider behavior, schema effects, or model capability, and is not a statistical reliability rate.',
  safeguards:{allInvalidReasonsDetected:true,actualChoicesPreserved:true,allExplicitSelectionsMarkedOperatorReview:true,noAutomaticApply:true,noFeasibleCaseCalls:0},
  costs:{newCalls:8,reservedUsd:live.newReservedMicroUsd/1e6,tokenEstimatedUsd:live.newEstimatedMicroUsd/1e6,invoiceVerified:false,
   cumulativeValidationReservedUsd:ledger.total/1e6,approvedCapUsd:VALIDATION_MICRO_USD/1e6,cumulativeCalls:await db.aiCall.count(),automaticRetries:0},
  verification:{offlineReplayCases:cases.length,unitFiles:testReport.testResults.filter((r:any)=>r.status==='passed').length,unitTests:testReport.numPassedTests,unitFailures:testReport.numFailedTests,buildId,
   browserFlowRerun:false,sourceHashes:live.sourceHashes},
  business:{preserved:true,sha256,counts:{records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length}},cases,
  boundaries:['Synthetic scenario data only. No actual weather clearance, staff commitment or borrowing agreement.','No operating plan, reservation, notification, SMS or equipment command was written or sent.','No additional model calls or model/settings changes after the eight predeclared calls.'],
  next:'Review the request/schema and provider configuration, then separately approve any reasoning/model change and comparison budget. Do not claim AI quality from validator success.'};
 await writeFile(`${folder}/summary.json`,JSON.stringify(summary,null,2));
 console.log(JSON.stringify({status:summary.status,results:summary.results,costs:summary.costs,safeguards:summary.safeguards,business:summary.business,verification:{...summary.verification,sourceHashes:undefined}}));
}finally{await db.$disconnect();}
