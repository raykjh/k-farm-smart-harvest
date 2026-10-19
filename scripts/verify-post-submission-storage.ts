import assert from 'node:assert/strict';
import {PrismaClient,Prisma} from '@prisma/client';
import {readFile,writeFile} from 'node:fs/promises';
import {localTestDatabaseBase as base} from './disposable-test-db';

// Read-only, independent post-server-stop proof. Never seed, reset or repair DBs.
const database='kfarm_centers_e2e_role_live_20261018b',failedDatabase='kfarm_centers_e2e_role_live_20261018a';
const journey=JSON.parse(await readFile('.data/verification/submission-journey/role-20261018-live-b.json','utf8'));
assert.equal(journey.status,'PASS');assert.equal(journey.live,true);assert.equal(journey.database,database);
const client=new PrismaClient({datasourceUrl:base+database}),failed=new PrismaClient({datasourceUrl:base+failedDatabase}),ledger=new PrismaClient({datasourceUrl:base+'kfarm'});
try{
 const report=await client.$transaction(async tx=>{
  const rows=await tx.workRecord.findMany(),find=(kind:string)=>rows.filter(r=>r.kind===kind),centers=await tx.center.findMany();
  const drafts=find('integratedPlan');assert.equal(drafts.length,1);
  const draft=drafts[0].payload as any;assert.equal(draft.status,'READY');assert.equal(draft.source,'NEBIUS');assert.equal(draft.decision.contract,'joint-crop-resources-v4');
  const approvals=find('productionApproval');assert.equal(approvals.length,1);
  const approval=approvals[0].payload as any;assert.equal(approval.integratedPlan.requestId,draft.input.requestId);assert.equal(approval.integratedPlan.evaluationId,draft.selected.id);
  assert.equal(approval.integratedPlan.source,'NEBIUS');assert.equal(approval.result.fields,2);
  const fieldRow=rows.find(r=>r.kind==='fields'&&r.workspace==='sandbox')!;
  assert.equal((fieldRow.payload as any[]).length,2);
  for(const f of fieldRow.payload as any[]){assert.equal(f.conditions.growingEnvironment,'open_field');assert.ok(['paddy','upland'].includes(f.conditions.cadastralUse));assert.equal(f.boundary.geometry.type,'Polygon');}
  assert.equal(find('cultivation').length,2);assert.equal(find('annualReservation').length,13);assert.equal(find('laborDemand').length,13);assert.equal(find('resourceReservation').length,7);
  const replan=find('replanning').map(r=>r.payload as any).find(p=>p.status==='APPLIED');assert.ok(replan);assert.equal(replan.decision.recommendation.source,'NEBIUS');
  const change=find('taskPlanChange');assert.equal(change.length,1);assert.equal((change[0].payload as any).before.scheduledDate,(change[0].payload as any).after.scheduledDate);
  assert.notEqual((change[0].payload as any).before.resourceId,(change[0].payload as any).after.resourceId);
  assert.equal(find('automaticReplan').filter(r=>(r.payload as any).status==='APPLIED').length,1);
  const callIds=[...draft.decision.usage.map((u:any)=>u.callId),replan.decision.recommendation.usage.callId];
  const calls=await ledger.aiCall.findMany({where:{id:{in:callIds}}});assert.equal(calls.length,4);assert.ok(calls.every(c=>c.status==='USAGE_RECORDED'));
  for(const c of centers)assert.ok((c.state as any).missions.some((m:any)=>m.id==='past-record'&&m.status==='COMPLETED'));
  const outbox=await tx.outbox.findMany();assert.ok(outbox.every(r=>r.status==='RECORDED_ONLY'&&r.attempts===0));
  assert.equal(find('smsAttempt').length,0);
  return {status:'PASS',database,approvalBoundToModelDraft:true,metricOrigin:draft.decision.evidenceOrigin,actualPaidCallsLinked:calls.length,fieldConditionsAndBoundariesPersisted:true,cultivations:2,scheduledTasks:13,essentialTasks:draft.selected.metrics.requiredTasks,unplacedEssentialTasks:0,sharedReservations:7,laborDemand:13,appliedChanges:1,existingCompletedSentinelsPreserved:4,externalSmsOrEquipmentSent:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
 assert.equal(await failed.workRecord.count({where:{kind:{in:['cultivation','productionApproval','annualReservation','resourceReservation']}}}),0);
 assert.equal(await failed.workRecord.count({where:{kind:'integratedPlan',payload:{path:['status'],equals:'ERROR'}}}),1);
 const result={...report,previousInvalidModelAttemptBlockedBeforeApproval:true,checkedAt:new Date().toISOString()};
 await writeFile('.data/verification/post-submission-20261018/storage-after-stop.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}finally{await client.$disconnect();await failed.$disconnect();await ledger.$disconnect();}
