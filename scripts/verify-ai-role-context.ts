import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';
import {aiBudgetDb} from '../lib/ai-budget-ledger';
import {budgetedCompletion,reservationMicroUsd,VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {adviseJointPlan} from '../lib/integrated-plan-adviser';
import {jointSource} from '../tests/integrated-plan-fixture';
import {cropGuidelines} from '../lib/crop-guidelines';

// Synthetic, in-memory comparisons. Only accounting records may be written.
// No registration, reservation, staging, approval, outbox or operating DB reset.
const live=process.argv.includes('--live'),cap=500_000,maxCalls=16;
if(new URL(process.env.DATABASE_URL??'file:///missing').pathname!=='/kfarm'||process.env.AI_BUDGET_DATABASE_URL&&process.env.AI_BUDGET_DATABASE_URL!==process.env.DATABASE_URL)throw Error('Use the original operating ledger; never create a fresh allowance.');
async function businessHash(){
 const [records,centers,outbox,receipts,audit]=await Promise.all([db.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),db.center.findMany({orderBy:{id:'asc'}}),db.outbox.findMany({orderBy:{id:'asc'}}),db.receipt.findMany({orderBy:{id:'asc'}}),db.audit.findMany({orderBy:{id:'asc'}})]);
 return createHash('sha256').update(JSON.stringify({records,centers,outbox,receipts,audit})).digest('hex');
}
async function ledger(){const d=aiBudgetDb();return {reserved:(await d.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,calls:await d.aiCall.count(),estimated:(await d.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0};}
const sources=()=>['demo','janggye','cheoncheon','gyenam'].map((id,index)=>{
 const s=jointSource(id,1),pnu='5274036023'+String(910000000+index);
 s.fields[0].pnu=pnu;s.participations[0].pnu=pnu;s.contacts[0].payload.fields[0].pnu=pnu;
 s.fields[0].conditions!.growingEnvironment='open_field';s.fields[0].conditions!.cadastralUse='upland';
 return s;
});
const evidence={sourceUrl:'https://example.com/synthetic-ai-contract-test',method:'SYNTHETIC ASSUMPTION, NOT NATIONAL DATA',checkedOn:'2026-01-01',validUntil:'2027-12-31'};
function marketSources(){return sources().map(s=>{
 s.coordination.policy.yields=[{crop:'potato',commodity:'TEST_POTATO',kgPer1000m2:{low:100,high:200},...evidence},{crop:'pepper',commodity:'TEST_PEPPER',kgPer1000m2:{low:100,high:200},...evidence}];
 s.coordination.policy.marketOutlooks=[{crop:'potato',commodity:'TEST_POTATO',from:'2027-01-01',to:'2027-12-31',pressure:'OVERSUPPLY_RISK',...evidence},{crop:'pepper',commodity:'TEST_PEPPER',from:'2027-01-01',to:'2027-12-31',pressure:'BALANCED',...evidence}];
 s.coordination.policy.specialties=[{centerId:s.scopeId,crop:'pepper',status:'ESTABLISHED',bonus:3,...evidence}];return s;
});}
const scenarios=[
 {id:'land-eligibility',build:()=>{const rows=sources(),s=rows[0];Object.assign(s.fields[0].conditions!,{landUse:'paddy',cadastralUse:'paddy',climate:{rice:'suitable',potato:'suitable',pepper:'suitable'}});s.criteria.profiles[0].context.operations!.rice=Object.fromEntries(cropGuidelines.rice.steps.filter(x=>['PROCESS','REPEAT'].includes(x.kind)).map((x,i)=>[x.code,{from:`2027-${String(i+2).padStart(2,'0')}-01`,to:`2027-${String(i+2).padStart(2,'0')}-20`,laborMinutesPer1000m2:60}]));return rows;}},
 {id:'reviewed-supply-and-specialty',build:marketSources},
 {id:'specialty-with-labor-shortage',build:()=>marketSources().map(s=>{s.state!.staffCount=1;for(const r of Object.values(s.criteria.profiles[0].context.operations!.pepper!)){if(r.from){r.to=r.from;r.laborMinutesPer1000m2=600;}}return s;})},
 {id:'unsecured-resources-stay-requests',build:()=>sources().map(s=>{s.state!.staffCount=0;s.state!.machines=[];return s;})},
];
const report:any={version:'ai-role-context-v1',startedAt:new Date().toISOString(),live,inputBasis:'SYNTHETIC_IN_MEMORY_NOT_OPERATIONAL_PROOF',capMicroUsd:cap,maxCalls,cases:[]};
let calls=0;
try{
 report.businessBefore=await businessHash();report.budgetBefore=await ledger();
 if(live&&report.budgetBefore.reserved+maxCalls*10_000>VALIDATION_MICRO_USD)throw Error('Insufficient existing authorized balance for the bounded run');
 for(const scenario of scenarios){
  const source=scenario.build(),unchanged=JSON.stringify(source),snap=await collectJointSnapshot(source,source.map(s=>s.scopeId));
  const baseline=await evaluateJointProposal(snap,jointRuleProposal(snap)),row:any={id:scenario.id,fields:snap.fields.length,remaining:snap.remaining,sourceFingerprint:snap.fingerprint,baseline:{status:baseline.status,metrics:baseline.metrics,mix:baseline.mix},trace:[]};report.cases.push(row);
  if(live){
   try{
    const decision=await adviseJointPlan(snap,baseline,async body=>{
     const before=await ledger(),reservation=reservationMicroUsd(body,'planning');
     if(calls>=maxCalls||before.reserved-report.budgetBefore.reserved+reservation>cap)throw Error('This verification allowance is exhausted');
     calls++;
     const result=await budgetedCompletion(body,'crop-decision');
     row.trace.push({usage:result.kfarmUsage,finishReason:result.choices?.[0]?.finish_reason,tool:result.choices?.[0]?.message?.tool_calls?.[0]?.function?.name,requestBytes:Buffer.byteLength(JSON.stringify(body))});return result;
    });
    row.status='VERIFIED';row.contract=decision.contract;row.selected={status:decision.selected.status,metrics:decision.selected.metrics,mix:decision.selected.mix,context:decision.selected.decisionContext};row.evidence=decision.evidence;row.equalMetrics=JSON.stringify(decision.selected.metrics)===JSON.stringify(baseline.metrics);row.alternatives=decision.alternatives.map(a=>({metrics:a.metrics,mix:a.mix}));
   }catch(e){row.status='REJECTED_NO_RETRY';row.error=e instanceof Error?e.message:String(e);}
  }else row.status='MODEL_FREE_PREFLIGHT';
  if(JSON.stringify(source)!==unchanged)throw Error('Source mutation detected');
 }
 report.status=report.cases.every((c:any)=>!c.error)?'VERIFIED':'REVIEW_REQUIRED';
}catch(e){report.status='ERROR';report.error=e instanceof Error?e.message:String(e);process.exitCode=1;}
finally{
 report.businessAfter=await businessHash();report.businessPreserved=report.businessBefore===report.businessAfter;report.budgetAfter=await ledger();
 if(report.budgetBefore){report.newCalls=report.budgetAfter.calls-report.budgetBefore.calls;report.newReservedMicroUsd=report.budgetAfter.reserved-report.budgetBefore.reserved;report.newEstimatedMicroUsd=report.budgetAfter.estimated-report.budgetBefore.estimated;}
 if(!report.businessPreserved)process.exitCode=1;
 await mkdir('.data/verification',{recursive:true});const file='.data/verification/ai-role-context-'+report.startedAt.replace(/[:.]/g,'-')+'.json';await writeFile(file,JSON.stringify(report,null,2),'utf8');
 console.log(JSON.stringify({...report,file}));await db.$disconnect();if(aiBudgetDb()!==db)await aiBudgetDb().$disconnect();
}
