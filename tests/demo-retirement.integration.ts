import {expect,it} from 'vitest';
import {PrismaClient,Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import {planDemoRetirement,retirementHash,type RetirementSnapshot} from '../lib/demo-retirement';
import {readRetirementSnapshot,retireDemoGraph,restoreRetiredDemo} from '../lib/demo-retirement-store';
import {retirementFixture} from './demo-retirement-fixture';
const url='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e';
const read=()=>db.$transaction(readRetirementSnapshot,{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
const approval=(token:string)=>({id:randomUUID(),token,actorId:'isolated-test-admin',confirmation:'ARCHIVE_SELECTED_DEMO_RECORDS' as const});
async function clear(){
 if(process.env.DATABASE_URL!==url||process.env.AI_MODE!=='demo'||process.env.NEBIUS_API_KEY)throw Error('Disposable model-free DB only');
 await db.$transaction(async tx=>{await tx.workRecord.deleteMany();await tx.center.deleteMany();await tx.outbox.deleteMany();await tx.receipt.deleteMany();await tx.audit.deleteMany()});
}
async function fixture(){
 await clear();const f=retirementFixture();
 await db.$transaction(async tx=>{
  await tx.center.create({data:{id:'demo',version:1,state:JSON.parse(JSON.stringify(f.b.state))}});
  await tx.center.create({data:{id:'gyenam',version:2,state:JSON.parse(JSON.stringify(emptyCenter('gyenam')))}});
  for(const raw of f.snapshot.records)await tx.workRecord.create({data:JSON.parse(raw)});
  for(const raw of f.snapshot.outbox)await tx.outbox.create({data:{...JSON.parse(raw),body:'Synthetic delivery',planVersion:1}});
  await tx.workRecord.create({data:{workspace:'auth',kind:'user',id:'keep-account',payload:{fixture:true}}});
  await tx.workRecord.create({data:{workspace:'shared',kind:'weatherHourly',id:'keep-weather',payload:{fixture:true}}});
  // Precision beyond a JS numeric round trip must survive both retirement and restore.
  await tx.$executeRaw`UPDATE "Center" SET state=state || '{"precisionProbe":123.1234567890123456789}'::jsonb,"updatedAt"='2026-01-01 01:02:03.123456' WHERE id='demo'`;
  await tx.$executeRaw`UPDATE "WorkRecord" SET payload=payload || '[{"pnu":"9999999999999999999","address":"Synthetic manual parcel","area":1.1234567890123456789,"crop":"","mode":"joint","group":"","rights":"pending"}]'::jsonb WHERE workspace='sandbox' AND kind='fields' AND id='current'`;
 });
 return f;
}
async function invariants(){return {auth:await db.workRecord.findMany({where:{workspace:'auth'}}),weather:await db.workRecord.findMany({where:{workspace:'shared',kind:'weatherHourly'}}),budget:await db.aiBudget.findMany(),calls:await db.aiCall.findMany()};}

it('archives selected descendants, preserves configuration/private records, and restores the exact raw rows',async()=>{
 await fixture();const before=await read(),protectedBefore=await invariants(),plan=planDemoRetirement(before),input=approval(plan.token);
 expect(plan.safe).toBe(true);await retireDemoGraph(db,input);
 expect((await retireDemoGraph(db,input)).alreadyApplied).toBe(true);
 const after=await read(),state=JSON.parse(after.centers.find(r=>JSON.parse(r).id==='demo')!).state;
 expect(state.fields).toEqual([]);expect(state.missions).toEqual([]);expect(state.machines).toHaveLength(16);expect(state.planVersion).toBe(fixturePlanVersion(before)+1);
 expect(after.records.some(raw=>JSON.parse(raw).id==='keep')).toBe(true);
 const inventory=after.records.find(raw=>{const r=JSON.parse(raw);return r.kind==='fields'&&r.id==='current'})!;
 expect(inventory).toContain('1.1234567890123456789');expect(JSON.parse(inventory).payload).toHaveLength(1);
 expect(await invariants()).toEqual(protectedBefore);
 // Independent account/weather changes and billing reservations after retirement
 // must survive restoration; a business rollback must not roll billing back.
 const budgetId='retirement-test-'+randomUUID();
 try{
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'auth',kind:'user',id:'keep-account'}},data:{payload:{fixture:true,changedAfterRetirement:true}}});
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'shared',kind:'weatherHourly',id:'keep-weather'}},data:{payload:{fixture:true,refreshed:true}}});
  await db.aiBudget.create({data:{id:budgetId,total:137,daily:137,day:new Date('2026-10-11')}});
  const independent=await invariants();
  await restoreRetiredDemo(db,input.id,'isolated-test-admin');expect(await read()).toEqual(before);
  expect((await restoreRetiredDemo(db,input.id,'isolated-test-admin')).alreadyRestored).toBe(true);
  expect(await invariants()).toEqual(independent);
 }finally{await db.aiBudget.delete({where:{id:budgetId}})}
});
function fixturePlanVersion(s:RetirementSnapshot){return JSON.parse(s.centers.find(r=>JSON.parse(r).id==='demo')!).state.planVersion;}

it('rejects stale approval and rolls back archive plus prior deletions on an injected failure',async()=>{
 await fixture();const before=await read(),input=approval(planDemoRetirement(before).token);
 await db.workRecord.create({data:{workspace:'sandbox',kind:'manual-note',id:'late',payload:{text:'changed'}}});
 await expect(retireDemoGraph(db,input)).rejects.toThrow('STALE');expect(await db.workRecord.count({where:{workspace:'archive'}})).toBe(0);
 const current=await read();let deleted=0;
 const broken={$transaction:(callback:any,options:any)=>db.$transaction(tx=>callback(new Proxy(tx,{get(target,key){if(key==='workRecord')return new Proxy(tx.workRecord,{get(records,method){if(method==='delete')return async(args:any)=>{const r=await records.delete(args);if(++deleted===2)throw Error('INJECTED_FAILURE');return r};return Reflect.get(records,method)}});return Reflect.get(target,key)}})),options)} as unknown as PrismaClient;
 await expect(retireDemoGraph(broken,approval(planDemoRetirement(current).token))).rejects.toThrow('INJECTED_FAILURE');
 expect(deleted).toBe(2);expect(await read()).toEqual(current);expect(await db.workRecord.count({where:{workspace:'archive'}})).toBe(0);
});
it('refuses restore after a new registration or a damaged archive',async()=>{
 await fixture();const input=approval(planDemoRetirement(await read()).token);await retireDemoGraph(db,input);
 await db.workRecord.create({data:{workspace:'sandbox',kind:'consultation',id:'new-applicant',payload:{farmer:{name:'New fictional applicant'}}}});
 const after=await read();await expect(restoreRetiredDemo(db,input.id,'test')).rejects.toThrow('변경');expect(await read()).toEqual(after);
 await db.workRecord.delete({where:{workspace_kind_id:{workspace:'sandbox',kind:'consultation',id:'new-applicant'}}});
 const key={workspace:'archive',kind:'demoRetirement',id:input.id},r=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}});
 await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:{...r.payload as any,records:[]}}});
 await expect(restoreRetiredDemo(db,input.id,'test')).rejects.toThrow('무결성');
});

it.skipIf(process.env.KFARM_VERIFY_PRIVATE_RETIREMENT!=='1')('verifies the current operating graph on a private copy, never executing against the source database',async()=>{
 const source=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'});
 const readSource=()=>source.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return readRetirementSnapshot(tx)},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
 try{
  const sourceBefore=await readSource();await clear();
  await db.$transaction(async tx=>{
   for(const raw of sourceBefore.centers)await tx.$executeRaw`INSERT INTO "Center" SELECT * FROM jsonb_populate_record(NULL::"Center",${raw}::jsonb)`;
   for(const raw of sourceBefore.records)await tx.$executeRaw`INSERT INTO "WorkRecord" SELECT * FROM jsonb_populate_record(NULL::"WorkRecord",${raw}::jsonb)`;
   for(const raw of sourceBefore.outbox)await tx.$executeRaw`INSERT INTO "Outbox" SELECT * FROM jsonb_populate_record(NULL::"Outbox",${raw}::jsonb)`;
   for(const raw of sourceBefore.receipts)await tx.$executeRaw`INSERT INTO "Receipt" SELECT * FROM jsonb_populate_record(NULL::"Receipt",${raw}::jsonb)`;
  },{timeout:30000});
  expect(await read()).toEqual(sourceBefore);
  const plan=planDemoRetirement(await read());expect(plan.safe).toBe(true);const input=approval(plan.token);
  const result=await retireDemoGraph(db,input);const after=await read();expect(JSON.parse(after.centers.find(r=>JSON.parse(r).id==='demo')!).state.fields).toEqual([]);
  await restoreRetiredDemo(db,input.id,'isolated-test-admin');expect(await read()).toEqual(sourceBefore);expect(await readSource()).toEqual(sourceBefore);
  const dir='.data/validation/20261011-demo-retirement';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/result.json',JSON.stringify({sourceReadOnly:true,disposableDatabase:'kfarm_centers_e2e',counts:result.counts,equipmentRetained:plan.equipmentRetained,rawRestoreExact:true,sourceBeforeAfterHash:retirementHash(sourceBefore),operatingDeletion:false,publicRouteConnected:false,paidCalls:0},null,2));
 }finally{await source.$disconnect()}
},60000);
