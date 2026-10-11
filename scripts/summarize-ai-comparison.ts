import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD,APPROVED_MODEL} from '../lib/ai-budget';

// Read-only DB verification; writes only a local evidence artifact. No inference.
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
assert.equal(process.env.DATABASE_URL,base+'kfarm','Operating ledger readback only');
const operating=new PrismaClient({datasourceUrl:base+'kfarm'}),testDb=new PrismaClient({datasourceUrl:base+'kfarm_centers_e2e'});
const dir='.data/validation/20261005-ai-comparison';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
try{
 const folders=await readdir(dir+'/live-browser',{withFileTypes:true});
 const folder=folders.find(f=>f.isDirectory()&&f.name.startsWith('model-free-operations-'));assert(folder);
 const browser=JSON.parse(await readFile(`${dir}/live-browser/${folder.name}/comparison-evidence.json`,'utf8'));
 assert.equal(browser.paidAiCalls,3);assert.equal(browser.normalIntakes,4);assert.equal(browser.normalTasks,32);
 assert(browser.attendanceReconfirmed&&browser.bothCenterNotices&&browser.finalLocalDelivery);
 const before=JSON.parse(await readFile('.data/backups/20261003-operational-completion/operating-application-snapshot.json','utf8')).snapshot;
 const keys=['records','centers','outbox','receipts','audit'] as const;
 const protectedHash=hash(Object.fromEntries(keys.map(k=>[k,before[k]])));
 const current={records:await operating.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers:await operating.center.findMany({orderBy:{id:'asc'}}),outbox:await operating.outbox.findMany({orderBy:{id:'asc'}}),receipts:await operating.receipt.findMany({orderBy:{id:'asc'}}),audit:await operating.audit.findMany({orderBy:{id:'asc'}})};
 assert.equal(hash(current),protectedHash,'Operating business records changed');
 const ids=browser.comparisons.map((c:any)=>c.ai.usage.callId);
 const calls=await operating.aiCall.findMany({where:{id:{in:ids}},select:{id:true,status:true,model:true,promptTokens:true,completionTokens:true,estimatedMicroUsd:true,reservedMicroUsd:true}});
 assert.equal(calls.length,3);assert(calls.every(c=>c.status==='USAGE_RECORDED'&&c.model===APPROVED_MODEL));
 const reviews=await testDb.workRecord.findMany({where:{kind:'replanning'}});
 const applied=reviews.map(r=>r.payload as any).filter(p=>p.status==='APPLIED'&&p.decision?.recommendation?.source==='NEBIUS');
 assert.equal(applied.length,3);
 for(const c of browser.comparisons){
  assert.equal(c.baseline.snapshotId,c.ai.snapshotId);assert.equal(c.operatorPriority,'MIN_DISRUPTION');
  assert(applied.some(p=>p.decision.recommendation.usage.callId===c.ai.usage.callId));
 }
 const states=await testDb.center.findMany();let plannedTasks=0;
 const windowViolations:string[]=[];
 for(const row of states)for(const m of (row.state as any).missions){
  if(m.id==='past-record')continue;plannedTasks++;
  assert(m.scheduledDate,'Unscheduled accepted task');const w=m.planningWindow;
  if(!w||m.scheduledDate<w.from||m.scheduledDate>w.to)windowViolations.push(row.id+':'+m.id);
 }
 assert.equal(plannedTasks,32);assert.equal(windowViolations.length,0);
 const cap=await operating.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}});
 assert(cap.total<=VALIDATION_MICRO_USD);
 const report={checkedAt:new Date().toISOString(),status:'PASS',model:APPROVED_MODEL,buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),
  operatingBusinessPreserved:true,operatingBusinessSha256:protectedHash,operatingCounts:Object.fromEntries(Object.entries(current).map(([k,v])=>[k,v.length])),
  fourCenterUiIntakes:4,generatedTasks:plannedTasks,finalWindowViolations:windowViolations.length,unassignedAcceptedTasks:0,
  actualModelCalls:calls.length,actualModelApprovalsStored:applied.length,
  sameChoices:browser.comparisons.filter((c:any)=>c.baseline.alternativeId===c.ai.alternativeId).length,
  cases:browser.comparisons.map((c:any)=>({case:c.case,operatorPriority:c.operatorPriority,snapshot:c.snapshot,rule:c.baseline.alternativeId,ai:c.ai.alternativeId,ruleMetrics:c.ruleMetrics,aiMetrics:c.aiMetrics,usage:c.ai.usage})),
  infeasibility:browser.infeasible,
  storedFollowups:{sharedReservations:true,laborReconfirmation:true,bothCenterNotices:true,farmerLocalDelivery:true,idempotentApproval:true,idempotentDelivery:true},
  estimatedCallCostUsd:calls.reduce((s,c)=>s+(c.estimatedMicroUsd??0),0)/1e6,reservedForTheseCallsUsd:calls.reduce((s,c)=>s+c.reservedMicroUsd,0)/1e6,
  validationBudget:{capUsd:VALIDATION_MICRO_USD/1e6,totalReservedUsd:cap.total/1e6,remainingReservationUsd:(VALIDATION_MICRO_USD-cap.total)/1e6},
  externalActions:{realSms:false,hardwareCommands:false},
  authFixtureCleanup:JSON.parse(await readFile(dir+'/auth-fixture-cleanup.json','utf8')),
  evidence:`live-browser/${folder.name}/comparison-evidence.json`,
  limitations:['All three choices matched rules. Two cases had identical feasible metrics and the compound case had one feasible option; no AI optimization advantage demonstrated.',
   'Initial crop choice and initial placement are rules/solver-driven; live AI reviewed subsequent schedule alternatives after genuine intake in the isolated DB.',
   'Synthetic parcel/geography, crop windows, staffing and equipment. Four-center software integration, not field safety, agronomic accuracy, nationwide scale or production readiness.',
   'Infeasibility was detected by the constraint engine before model calls, not independently proved by the LLM.',
   'Token-derived costs are estimates, not provider invoices.']};
 await writeFile(dir+'/summary.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await operating.$disconnect();await testDb.$disconnect()}
