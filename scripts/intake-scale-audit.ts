import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {db} from '../lib/db';
import {fourCenterDatabaseUrl} from './disposable-test-db';
import {validateReservations,reservationSchema} from '../lib/shared-reservations';
import {missionReservation} from '../lib/plan-reservation-sync';
import {assertCrossCenterPeople} from '../lib/integrated-plan';
import {refreshAllCenters} from '../lib/production-sweep';
import {VALIDATION_BUDGET_ID} from '../lib/ai-budget';

assert.equal(process.env.DATABASE_URL,fourCenterDatabaseUrl('kfarm_centers_e2e_scale_20261017'));
const folder='.data/intake-scale-20261017',original='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
assert.equal(process.env.AI_BUDGET_DATABASE_URL,original);
const operating=new PrismaClient({datasourceUrl:original}),prepared=JSON.parse(await readFile(folder+'/prepared.json','utf8'));
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const budget=async()=>({calls:await operating.aiCall.count(),reserved:(await operating.aiBudget.findUnique({where:{id:VALIDATION_BUDGET_ID}}))?.total??0,estimated:(await operating.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0});
const evidence:any={checkedAt:new Date().toISOString(),database:'kfarm_centers_e2e_scale_20261017'};
try{
 const centers=await db.center.findMany({orderBy:{id:'asc'}}),rows=await db.workRecord.findMany(),byKind=(kind:string)=>rows.filter(r=>r.kind===kind);
 const inventories=byKind('fields').filter(r=>r.id==='current').flatMap(r=>r.payload as any[]),cultivations=byKind('cultivation').map(r=>r.payload as any);
 assert.equal(inventories.length,300);assert.equal(new Set(inventories.map(f=>f.pnu)).size,300);
 const reservations=byKind('resourceReservation').map(r=>reservationSchema.parse(r.payload));validateReservations(reservations,[]);
 const missions=centers.flatMap(c=>(c.state as any).missions.map((m:any)=>({centerId:c.id,...m})));
 for(const r of reservations){const m=missions.find((m:any)=>m.centerId===r.centerId&&m.id===r.taskId);assert(m);assert.deepEqual(missionReservation(r.centerId,m,r.id),r)}
 assertCrossCenterPeople(missions.map((m:any)=>({centerId:m.centerId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,operatorIds:m.operatorIds??[],laborSupportIds:m.laborSupportIds??[]})));
 const decisions=byKind('integratedPlan').map(r=>r.payload as any),successful=decisions.filter(d=>d.status==='READY');
 evidence.fields=300;evidence.planned=cultivations.length;evidence.missions=missions.length;evidence.reservations=reservations.length;evidence.laborDemand=byKind('laborDemand').length;
 evidence.crops=cultivations.reduce((a,c)=>{a[c.crop]=(a[c.crop]??0)+1;return a},{});
 evidence.landUse=inventories.reduce((a,f)=>{const key=f.conditions?.landUse??'unknown';a[key]=(a[key]??0)+1;return a},{});
 evidence.ai={successfulDrafts:successful.length,failedDrafts:decisions.filter(d=>d.status==='ERROR').map(d=>({requestId:d.input.requestId,error:d.error})),contracts:successful.reduce((a,d)=>{const key=d.decision?.contract??'NONE';a[key]=(a[key]??0)+1;return a},{}),sameMetricsAsBaseline:successful.filter(d=>JSON.stringify(d.selected.metrics)===JSON.stringify(d.baseline.metrics)).length};
 assert(successful.every(d=>d.source==='NEBIUS'));assert.equal(evidence.planned,299);
 evidence.pending=byKind('continuousProduction').flatMap(r=>(r.payload as any).items.filter((i:any)=>i.status!=='SCHEDULED').map((i:any)=>({center:r.workspace,pnu:i.pnu,status:i.status,reason:i.reason})));
 assert.equal(evidence.pending.length,1);assert.equal(inventories.find(f=>f.pnu===evidence.pending[0].pnu)?.conditions.landUse,'orchard');
 evidence.invariants={uniqueFields:true,noReservationCollisions:true,reservationsMatchMissions:true,noCrossCenterNamedPersonCollision:true};
 if(process.argv.includes('--idle-sweeps')){
  const stable=async()=>hash({centers:await db.center.findMany({orderBy:{id:'asc'}}),cycles:await db.workRecord.count({where:{kind:'cultivation'}}),bookings:await db.workRecord.count({where:{kind:'resourceReservation'}}),calls:(await budget()).calls});
  process.env.KFARM_PRODUCTION_AI='1';
  const before=await stable();evidence.sweeps=[await refreshAllCenters(),await refreshAllCenters()];assert.equal(await stable(),before,'Unchanged worker sweeps duplicated inference or business data');
  assert(evidence.sweeps.flat().every((s:any)=>s.status==='REFRESHED'));evidence.unchangedSweepsPreserved=true;
 }
 const protectedHash=hash({records:await operating.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers:await operating.center.findMany({orderBy:{id:'asc'}}),outbox:await operating.outbox.findMany({orderBy:{id:'asc'}}),receipts:await operating.receipt.findMany({orderBy:{id:'asc'}}),audit:await operating.audit.findMany({orderBy:{id:'asc'}})});
 assert.equal(protectedHash,prepared.before.hash);evidence.operatingPreserved=true;evidence.operatingHash=protectedHash;
 evidence.budget=await budget();evidence.campaignUsage={calls:evidence.budget.calls-prepared.budgetBefore.calls,reservedMicroUsd:evidence.budget.reserved-prepared.budgetBefore.reserved,estimatedMicroUsd:evidence.budget.estimated-prepared.budgetBefore.estimated};
 evidence.status='VERIFIED';
}catch(e){evidence.status='FAILED';evidence.error=e instanceof Error?e.message:String(e);process.exitCode=1}
finally{await writeFile(folder+`/audit-${Date.now()}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await db.$disconnect();await operating.$disconnect()}
