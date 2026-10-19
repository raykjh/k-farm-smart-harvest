import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {db} from '../lib/db';
import {aiBudgetDb} from '../lib/ai-budget-ledger';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD,budgetedCompletion} from '../lib/ai-budget';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {adviseJointPlan} from '../lib/integrated-plan-adviser';
import {jointSource} from '../tests/integrated-plan-fixture';

if(!process.argv.includes('--live'))throw Error('Explicit --live is required; no automatic paid test');
if(!process.env.DATABASE_URL?.endsWith('/kfarm')||process.env.AI_BUDGET_DATABASE_URL&&process.env.AI_BUDGET_DATABASE_URL!==process.env.DATABASE_URL)throw Error('Use the existing operating budget ledger; no fresh allowance');
async function fingerprint(){
 const records=await db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers=await db.center.findMany({orderBy:{id:'asc'}}),outbox=await db.outbox.findMany({orderBy:{id:'asc'}}),receipts=await db.receipt.findMany({orderBy:{id:'asc'}}),audit=await db.audit.findMany({orderBy:{id:'asc'}});
 return createHash('sha256').update(JSON.stringify({records,centers,outbox,receipts,audit})).digest('hex');
}
async function ledger(){const d=aiBudgetDb();return {reserved:(await d.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,calls:await d.aiCall.count(),estimated:(await d.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0};}
const report:any={version:'joint-ai-live-v1',startedAt:new Date().toISOString(),input:'SYNTHETIC_IN_MEMORY_4_CENTER_NO_BUSINESS_WRITES',maxCalls:4};
try{
 report.before=await fingerprint();report.budgetBefore=await ledger();
 if(report.budgetBefore.reserved+40000>VALIDATION_MICRO_USD)throw Error('Existing approved allowance cannot cover the bounded run');
 const sources=['demo','janggye','cheoncheon','gyenam'].map(id=>jointSource(id,1));
 const snapshot=await collectJointSnapshot(sources,sources.map(s=>s.scopeId)),baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
 report.trace=[];
 const decision=await adviseJointPlan(snapshot,baseline,async body=>{
  const response=await budgetedCompletion(body,'crop-decision'),m=response.choices?.[0]?.message;
  report.trace.push({finishReason:response.choices?.[0]?.finish_reason,contentLength:m?.content?.length??0,tools:(m?.tool_calls??[]).map((c:any)=>({name:c.function?.name,argumentLength:c.function?.arguments?.length??0}))});
  return response;
 });
 report.result={contract:decision.contract,source:decision.source,model:decision.model,baseline:baseline.metrics,selected:decision.selected.metrics,mix:decision.selected.mix,staffing:decision.selected.staffing.map(s=>({center:s.centerId,core:s.contractWorkers,dailyPersonShifts:s.dailyPersonShifts,reserve:s.reserveWorkers})),evidence:decision.evidence,usage:decision.usage,status:decision.selected.status};
 report.status='VERIFIED';
}catch(e){report.status='ERROR';report.error=e instanceof Error?e.message:String(e);process.exitCode=1;}
finally{
 report.after=await fingerprint();report.businessPreserved=report.before===report.after;report.budgetAfter=await ledger();
 report.newCalls=report.budgetAfter.calls-(report.budgetBefore?.calls??report.budgetAfter.calls);report.newReservedMicroUsd=report.budgetAfter.reserved-(report.budgetBefore?.reserved??report.budgetAfter.reserved);report.newEstimatedMicroUsd=report.budgetAfter.estimated-(report.budgetBefore?.estimated??report.budgetAfter.estimated);
 if(!report.businessPreserved)process.exitCode=1;
 await mkdir('.data/verification',{recursive:true});const file='.data/verification/integrated-ai-'+report.startedAt.replace(/[:.]/g,'-')+'.json';await writeFile(file,JSON.stringify(report,null,2),'utf8');report.file=file;
 console.log(JSON.stringify(report));await db.$disconnect();if(aiBudgetDb()!==db)await aiBudgetDb().$disconnect();
}
