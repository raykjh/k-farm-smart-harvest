import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {db} from '../lib/db';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD,APPROVED_MODEL} from '../lib/ai-budget';
const dir='.data/validation/20261004-ai-decisions';
try{
 const reports=await Promise.all(['live-preferred-date-tradeoff.json','live.json'].map(async f=>JSON.parse(await readFile(`${dir}/${f}`,'utf8'))));
 assert(reports.every(r=>r.status==='PASS'&&r.businessPreserved));
 const cases=reports.flatMap(r=>r.cases);assert.equal(cases.length,6);assert.equal(new Set(cases.map(c=>c.id)).size,6);
 const original=JSON.parse(await readFile('.data/backups/20261003-operational-completion/operating-application-snapshot.json','utf8')).snapshot;
 const protectedRows={records:original.records,centers:original.centers,outbox:original.outbox,receipts:original.receipts,audit:original.audit};
 const originalHash=createHash('sha256').update(JSON.stringify(protectedRows)).digest('hex');
 assert(reports.every(r=>r.before===originalHash&&r.after===originalHash));
 const ids=cases.map(c=>c.decision.usage.callId);
 const calls=await db.aiCall.findMany({where:{id:{in:ids}},select:{id:true,reservedMicroUsd:true,estimatedMicroUsd:true,promptTokens:true,completionTokens:true,status:true}});
 assert.equal(calls.length,6);
 const cap=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}});
 const result={checkedAt:new Date().toISOString(),model:APPROVED_MODEL,status:'PASS',liveDecisionCases:6,changedChoices:cases.filter(c=>!c.sameChoice).length,
  decisions:cases.map(c=>({id:c.id,baseline:c.baseline.alternativeId??c.baseline.candidateId,ai:c.decision.alternativeId??c.decision.candidateId,sameChoice:c.sameChoice,usage:c.decision.usage,checks:c.checks})),
  decisionEstimatedUsd:calls.reduce((n,c)=>n+(c.estimatedMicroUsd??0),0)/1e6,decisionReservedUsd:calls.reduce((n,c)=>n+c.reservedMicroUsd,0)/1e6,
  validationBudget:{capUsd:VALIDATION_MICRO_USD/1e6,reservedUsd:cap.total/1e6,includesConnectionCheck:true},
  web:{buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),comparisonRegressionTests:9,responseSource:'Controlled browser responses, separate from actual model calls above',screenshot:'test-results/workspace-ui-explicit-AI-c-6df3d-ver-auto-applies-the-choice/ai-comparison-ko.png'},
  activation:{mode:process.env.AI_MODE,scope:process.env.AI_CALL_SCOPE,ordinaryCalculation:'RULES_AND_SOLVER',paidOptIn:'Schedule-change checkbox',automaticCropInference:false,backgroundProductionWorker:false},
  businessPreserved:true,businessSha256:originalHash,
  limitations:['Synthetic isolated cases, not field safety or agronomic validation','Token-derived estimates, not provider invoices','No real loans, SMS, equipment dispatch or operational approvals','One observed preference-sensitive difference, not a statistical performance evaluation','Crop comparison is verified at the adapter; automatic crop intake remains rules-only'],
  reports:['live-preferred-date-tradeoff.json','live.json']};
 await writeFile(`${dir}/summary.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await db.$disconnect()}
