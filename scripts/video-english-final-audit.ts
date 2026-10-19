import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {fourCenterDatabaseUrl} from './disposable-test-db';

const folder=resolve('.data/video-capture-20261018/english-take-01'),baseline=JSON.parse(await readFile(resolve(folder,'baseline.json'),'utf8'));
const original=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'}),scale=new PrismaClient({datasourceUrl:fourCenterDatabaseUrl('kfarm_centers_e2e_scale_20261017')}),film=new PrismaClient({datasourceUrl:fourCenterDatabaseUrl('kfarm_centers_e2e_enfilm_20261018')});
const oldFilm=new PrismaClient({datasourceUrl:fourCenterDatabaseUrl('kfarm_centers_e2e_video_20261018')});
const hash=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function business(client:PrismaClient){return {centers:await client.center.findMany({orderBy:{id:'asc'}}),records:await client.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),outbox:await client.outbox.findMany({orderBy:{id:'asc'}}),receipts:await client.receipt.findMany({orderBy:{id:'asc'}}),audit:await client.audit.findMany({orderBy:{id:'asc'}})};}
try{
 const oldFilmBaseline=JSON.parse(await readFile(resolve('.data/video-capture-20261018/full-take-01/final-filming-snapshot.json'),'utf8'));
 const preserved={originalFilming:hash(await business(oldFilm))===oldFilmBaseline.sha256,operating:hash(await business(original))===baseline.businessHashes.operating,scale:hash(await business(scale))===baseline.businessHashes.scale};assert(preserved.operating&&preserved.scale&&preserved.originalFilming);
 const snapshot=await business(film),plans=snapshot.records.filter(r=>r.kind==='integratedPlan').map(r=>r.payload as any),ready=plans.filter(p=>p.status==='READY'),failed=plans.filter(p=>p.status==='ERROR');
 const budget={calls:await original.aiCall.count(),reserved:(await original.aiBudget.findUnique({where:{id:'nebius-decisions-20261004'}}))!.total,estimated:(await original.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0};
 const tasks=snapshot.centers.flatMap(c=>(c.state as any).missions);assert.equal(new Set(tasks.map((t:any)=>t.id)).size,tasks.length);
 const summary={at:new Date().toISOString(),locale:'en',properNames:'Korean source names retained',preserved,originalBusinessHash:baseline.businessHashes,filming:{registered:snapshot.records.filter(r=>r.kind==='fields'&&r.id==='current').reduce((n,r)=>n+(r.payload as any[]).length,0),cultivations:snapshot.records.filter(r=>r.kind==='cultivation').length,tasks:tasks.length,resourceReservations:snapshot.records.filter(r=>r.kind==='resourceReservation').length,laborDemands:snapshot.records.filter(r=>r.kind==='laborDemand').length,outbox:snapshot.outbox.length,actualSent:snapshot.outbox.filter(m=>m.status==='SENT').length},modelPlans:{ready:ready.length,failed:failed.length,matchingBaselineMetrics:ready.filter(p=>hash(p.selected.metrics)===hash(p.baseline.metrics)).length,errors:failed.map(p=>p.error)},budgetBefore:baseline.budget,budgetAfter:budget,delta:{calls:budget.calls-baseline.budget.calls,reservedMicroUsd:budget.reserved-baseline.budget.reserved,estimatedMicroUsd:budget.estimated-baseline.budget.estimated},invoiceVerified:false};
 assert.equal(summary.filming.registered,300);assert.equal(summary.filming.cultivations,299);assert.equal(summary.filming.actualSent,0);assert(ready.every(p=>p.source==='NEBIUS'));
 await writeFile(resolve(folder,'final-filming-snapshot.json'),JSON.stringify({format:'KFARM_FILMING_BUSINESS_SNAPSHOT_V1',sha256:hash(snapshot),snapshot}),{flag:'wx'});
 assert.equal(hash(JSON.parse(await readFile(resolve(folder,'final-filming-snapshot.json'),'utf8')).snapshot),hash(snapshot));
 const ledger={budgets:await original.aiBudget.findMany({orderBy:{id:'asc'}}),calls:await original.aiCall.findMany({orderBy:{id:'asc'}})};
 await writeFile(resolve(folder,'final-shared-ai-ledger.json'),JSON.stringify({format:'KFARM_AI_LEDGER_SNAPSHOT_V1',sha256:hash(ledger),snapshot:ledger,warning:'Do not roll back this shared usage ledger when restoring filming business data.'}),{flag:'wx'});
 assert.equal(hash(JSON.parse(await readFile(resolve(folder,'final-shared-ai-ledger.json'),'utf8')).snapshot),hash(ledger));
 await writeFile(resolve(folder,'final-audit.json'),JSON.stringify(summary,null,2),{flag:'wx'});console.log(JSON.stringify(summary));
}finally{await Promise.all([original.$disconnect(),scale.$disconnect(),film.$disconnect(),oldFilm.$disconnect()]);}
