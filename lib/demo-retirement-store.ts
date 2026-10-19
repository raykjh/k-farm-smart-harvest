import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {planDemoRetirement,retirementHash,recordIdentity,type RetirementSnapshot} from './demo-retirement';

type Tx=Prisma.TransactionClient;
const archiveKey=(id:string)=>({workspace:'archive',kind:'demoRetirement',id});
const command=z.object({id:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),actorId:z.string().min(1),confirmation:z.literal('ARCHIVE_SELECTED_DEMO_RECORDS')}).strict();
const rawRows=(rows:{raw:string}[])=>rows.map(r=>r.raw);
/** Read only: never return these private rows to a public or unauthenticated UI. */
export async function readRetirementSnapshot(tx:Tx):Promise<RetirementSnapshot>{
 const [centers,records,outbox,receipts]=await Promise.all([
  tx.$queryRaw<{raw:string}[]>`SELECT row_to_json(t)::text AS raw FROM "Center" t ORDER BY id`,
  tx.$queryRaw<{raw:string}[]>`SELECT row_to_json(t)::text AS raw FROM "WorkRecord" t WHERE workspace NOT IN ('auth','archive') AND NOT (workspace='shared' AND kind IN ('weatherHourly','weatherObservation','climateNormals')) ORDER BY workspace,kind,id`,
  tx.$queryRaw<{raw:string}[]>`SELECT row_to_json(t)::text AS raw FROM "Outbox" t ORDER BY id`,
  tx.$queryRaw<{raw:string}[]>`SELECT row_to_json(t)::text AS raw FROM "Receipt" t ORDER BY id`,
 ]);
 return {centers:rawRows(centers),records:rawRows(records),outbox:rawRows(outbox),receipts:rawRows(receipts)};
}
async function lock(tx:Tx){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-data'))`;
 await tx.$queryRaw`SELECT id FROM "Center" ORDER BY id FOR UPDATE`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
}
const digestArchive=(p:any)=>retirementHash({contract:p.contract,requestHash:p.requestHash,actorId:p.actorId,batchId:p.batchId,counts:p.counts,records:p.records,outbox:p.outbox,receipts:p.receipts,beforeCenter:p.beforeCenter,beforeInventory:p.beforeInventory,afterHash:p.afterHash});

/** No route or button invokes this yet. Invoke only after explicit review of the
 * pinned plan. The transaction journals exact original rows before deletion. */
export async function retireDemoGraph(client:PrismaClient,input:z.infer<typeof command>){
 const b=command.parse(input),requestHash=retirementHash(b);
 return client.$transaction(async tx=>{
  await lock(tx);
  const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:archiveKey(b.id)}});
  if(previous){const p=previous.payload as any;if(p.requestHash!==requestHash||p.status!=='RETIRED')throw Error('정리 요청 ID를 새로 확인하세요.');if(p.digest!==digestArchive(p))throw Error('보관본 무결성 오류');return {id:b.id,counts:p.counts,alreadyApplied:true};}
  const snapshot=await readRetirementSnapshot(tx),plan=planDemoRetirement(snapshot);
  if(plan.token!==b.token)throw Error('STALE_DEMO_RETIREMENT');
  if(!plan.safe)throw Error('BLOCKED_DEMO_RETIREMENT');
  const payload={contract:plan.contract,requestHash,actorId:b.actorId,batchId:plan.batchId,counts:plan.counts,status:'PREPARING',records:plan.records,outbox:plan.outbox,receipts:plan.receipts,beforeCenter:plan.beforeCenter,beforeInventory:plan.beforeInventory,afterHash:'',digest:''};
  await tx.workRecord.create({data:{...archiveKey(b.id),payload}});
  for(const raw of plan.records){const r=JSON.parse(raw);await tx.workRecord.delete({where:{workspace_kind_id:{workspace:r.workspace,kind:r.kind,id:r.id}}});}
  for(const raw of plan.outbox)await tx.outbox.delete({where:{id:JSON.parse(raw).id}});
  for(const raw of plan.receipts)await tx.receipt.delete({where:{id:JSON.parse(raw).id}});
  // Filter in PostgreSQL so unrelated JSON numbers are not rounded by JS.
  await tx.$executeRaw`UPDATE "WorkRecord" SET payload=COALESCE((SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(payload) WITH ORDINALITY AS a(value,ord) WHERE NOT ((value->>'pnu')=ANY(${plan.fieldIds}::text[]))),'[]'::jsonb),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE workspace='sandbox' AND kind='fields' AND id='current'`;
  // Keep equipment, named operators and capacity/settings. Plans never reset to v0.
  await tx.$executeRaw`UPDATE "Center" SET state=state || '{"fields":[],"missions":[],"events":[],"revisions":[],"registered":false,"planned":false,"productionLedger":{"version":1,"entries":{},"totals":{}}}'::jsonb || jsonb_build_object('planVersion',(state->>'planVersion')::int+1),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id='demo'`;
  payload.status='RETIRED';payload.afterHash=retirementHash(await readRetirementSnapshot(tx));payload.digest=digestArchive(payload);
  await tx.workRecord.update({where:{workspace_kind_id:archiveKey(b.id)},data:{payload}});
  await tx.audit.create({data:{centerId:'demo',action:'demoGraph.retire',detail:{archiveId:b.id,actorId:b.actorId,counts:plan.counts,equipmentRetained:plan.equipmentRetained}}});
  return {id:b.id,counts:plan.counts,alreadyApplied:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}

/** Exact rollback only while the post-retirement business footprint is unchanged.
 * Auth, weather refreshes and independent API billing are never rolled back. */
export async function restoreRetiredDemo(client:PrismaClient,id:string,actorId:string){
 z.string().uuid().parse(id);z.string().min(1).parse(actorId);
 return client.$transaction(async tx=>{
  await lock(tx);const saved=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:archiveKey(id)}}),p=saved.payload as any;
  if(p.contract!=='demo-retirement-v1'||p.digest!==digestArchive(p))throw Error('보관본 무결성 오류');
  if(p.status==='RESTORED')return {id,alreadyRestored:true};
  if(p.status!=='RETIRED'||retirementHash(await readRetirementSnapshot(tx))!==p.afterHash)throw Error('정리 후 자료가 변경되어 자동 복구하지 않았습니다.');
  const keys=new Set<string>();for(const raw of p.records){const r=JSON.parse(raw),key=recordIdentity(r);if(keys.has(key))throw Error('보관본 중복');keys.add(key);}
  await tx.$executeRaw`DELETE FROM "Center" WHERE id='demo'`;
  await tx.$executeRaw`INSERT INTO "Center" SELECT * FROM jsonb_populate_record(NULL::"Center",${p.beforeCenter}::jsonb)`;
  await tx.$executeRaw`DELETE FROM "WorkRecord" WHERE workspace='sandbox' AND kind='fields' AND id='current'`;
  await tx.$executeRaw`INSERT INTO "WorkRecord" SELECT * FROM jsonb_populate_record(NULL::"WorkRecord",${p.beforeInventory}::jsonb)`;
  for(const raw of p.records)await tx.$executeRaw`INSERT INTO "WorkRecord" SELECT * FROM jsonb_populate_record(NULL::"WorkRecord",${raw}::jsonb)`;
  for(const raw of p.outbox)await tx.$executeRaw`INSERT INTO "Outbox" SELECT * FROM jsonb_populate_record(NULL::"Outbox",${raw}::jsonb)`;
  for(const raw of p.receipts)await tx.$executeRaw`INSERT INTO "Receipt" SELECT * FROM jsonb_populate_record(NULL::"Receipt",${raw}::jsonb)`;
  await tx.workRecord.update({where:{workspace_kind_id:archiveKey(id)},data:{payload:{...p,status:'RESTORED',restoredBy:actorId}}});
  await tx.audit.create({data:{centerId:'demo',action:'demoGraph.restore',detail:{archiveId:id,actorId}}});
  return {id,alreadyRestored:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
