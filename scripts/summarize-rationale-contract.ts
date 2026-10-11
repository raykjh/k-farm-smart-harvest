// Read-only operating DB and existing test evidence; never sends inference.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {RATIONALE_VERSION} from '../lib/planning-rationale';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';
const folder='.data/validation/20261005-rationale-contract';
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
try{
 assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');
 const previous=await json('.data/validation/20261005-ai-order-diagnostics/live.json');
 const prepared=await json('.data/validation/20261005-ai-order-diagnostics/prepared.json');
 assert.equal(digest(await readFile('lib/ai-budget.ts','utf8')),prepared.sourceHashes['lib/ai-budget.ts'],'No budget/model change');
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 const businessHash=digest({records,centers,outbox,receipts,audit});assert.equal(businessHash,previous.after.sha256);
 const budget=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}}),calls=await db.aiCall.count();
 assert.equal(calls,previous.budgetAfter.calls);assert.equal(budget.total,previous.budgetAfter.reservedMicroUsd);
 const all=await json(`${folder}/all-tests.json`),targeted=await json(`${folder}/final-targeted-tests.json`);
 assert.equal(all.success,true);assert.equal(targeted.success,true);
 const ui=await json(`${folder}/ui-final/.last-run.json`),flow=await json(`${folder}/flow/.last-run.json`);
 assert.equal(ui.status,'passed');assert.equal(flow.status,'passed');
 const flowEvidence=await json(`${folder}/flow/model-free-operations-new--c5421-irmation-and-local-delivery/comparison-evidence.json`);
 assert.equal(flowEvidence.paidInference,false);assert.equal(flowEvidence.paidAiCalls,0);
 assert(flowEvidence.comparisons.every((c:any)=>c.ai.rationaleCheck.status==='VERIFIED'&&c.ai.rationaleCheck.source==='RULES'));
 const health=await fetch('http://127.0.0.1:3100/login');assert.equal(health.status,200);
 const changed=['lib/planning-rationale.ts','lib/planning-adviser.ts','lib/planning-review.ts','components/replan-manager.tsx','tests/planning-rationale.test.ts','tests/planning-decision-api.test.ts','e2e/workspace-ui.spec.ts','e2e/model-free-operations.spec.ts'];
 const report={checkedAt:new Date().toISOString(),status:'IMPLEMENTED_AND_LOCALLY_VERIFIED',contractVersion:RATIONALE_VERSION,
  buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),loginHttpStatus:health.status,
  changes:['All rejected candidates must be explained exactly once.','The first differing priority metric and evidence for both candidates must match computed facts.','Infeasible schedules and unverified/blocked calculations have distinct reasons.','Wrong priorities, cherry-picked lower metrics, missing/duplicate/unknown rejections and stale evidence fail validation.','Actual model choices are retained; failures are never silently replaced by rule answers.','Persisted claims are rechecked on selection; unverified/overridden choices are marked OPERATOR_REVIEW rather than VERIFIED_AI.','Legacy records remain unchanged and are not retroactively certified.','Korean/English UI shows submitted reasons, computed comparisons, failures and selection provenance.'],
  tests:{fullSuite:{files:all.testResults.length,passed:all.numPassedTests,failed:all.numFailedTests},finalTargeted:{files:targeted.testResults.length,passed:targeted.numPassedTests,failed:targeted.numFailedTests},uiCases:9,fourCenterUiFlow:'PASS_WITHOUT_PAID_AI',typecheckAndBuild:'PASS'},
  flowCases:flowEvidence.comparisons.map((c:any)=>({case:c.case,source:c.ai.source,rationale:c.ai.rationaleCheck.status})),
  operatingBusiness:{preserved:true,sha256:businessHash,counts:{records:records.length,centers:centers.length,outbox:outbox.length,receipts:receipts.length,audit:audit.length}},
  ai:{newPaidCalls:0,cumulativeCalls:calls,validationReservedUsd:budget.total/1e6,validationCapUsd:VALIDATION_MICRO_USD/1e6,modelAndBudgetUnchanged:true,realModelImprovementVerified:false},
  boundaries:['Controlled model responses in unit/API/UI tests are not live model-quality evidence.','The four-center flow used the real calculation/DB path with synthetic inputs and rule-based advice.','No real SMS, equipment commands, field work, deployment, memory update or shutdown performed.','The stricter provider response schema has not been validated with another paid call; the existing validation cap remains in force.'],
  sourceHashes:Object.fromEntries(await Promise.all(changed.map(async path=>[path,digest(await readFile(path,'utf8'))])))
 };
 await writeFile(`${folder}/summary.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await db.$disconnect();}
