import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {planPreparedBatch} from './prepared-batch-retirement';
import {readRetirementSnapshot} from './demo-retirement-store';
import {retirementHash,type RetirementSnapshot} from './demo-retirement';
import {lockProduction} from './production-service';
const key=(id:string)=>({workspace:'archive',kind:'preparedBatch',id});
export const preparedRetirementCommand=z.object({id:z.string().uuid(),centerId:z.string().min(1),batchId:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),confirmation:z.literal('ARCHIVE_PREPARED_INPUTS')}).strict();
const digest=(p:any)=>retirementHash({contract:p.contract,requestHash:p.requestHash,actorId:p.actorId,centerId:p.centerId,batchId:p.batchId,counts:p.counts,beforeCenter:p.beforeCenter,records:p.records,patches:p.patches,outbox:p.outbox,receipts:p.receipts,afterHash:p.afterHash});
export const preparedPlanSummary=(p:ReturnType<typeof planPreparedBatch>)=>({centerId:p.centerId,batchId:p.batchId,token:p.token,safe:p.safe,blockers:p.blockers,counts:p.counts});
export async function retirePreparedBatch(client:PrismaClient,input:z.infer<typeof preparedRetirementCommand>,actorId:string){
 const b=preparedRetirementCommand.parse(input),requestHash=retirementHash({b,actorId});
 return client.$transaction(async tx=>{
  await lockProduction(tx);
  const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:key(b.id)}});
  if(previous){const p=previous.payload as any;if(p.requestHash!==requestHash||p.status!=='RETIRED'||p.digest!==digest(p))throw Error('정리 요청 ID 또는 보관본을 확인하세요.');return {id:b.id,counts:p.counts,alreadyApplied:true};}
  const plan=planPreparedBatch(await readRetirementSnapshot(tx),b.centerId,b.batchId);
  if(plan.token!==b.token)throw Error('STALE_PREPARED_INPUTS');if(!plan.safe)throw Error('BLOCKED_PREPARED_INPUTS');
  const archive={contract:plan.contract,requestHash,actorId,centerId:b.centerId,batchId:b.batchId,counts:plan.counts,status:'PREPARING',beforeCenter:plan.beforeCenter,records:plan.records,patches:plan.patches.map(p=>p.raw),outbox:plan.outbox,receipts:plan.receipts,afterHash:'',digest:''};
  await tx.workRecord.create({data:{...key(b.id),payload:archive}});
  for(const raw of plan.records){const r=JSON.parse(raw);await tx.workRecord.delete({where:{workspace_kind_id:{workspace:r.workspace,kind:r.kind,id:r.id}}});}
  for(const patch of plan.patches){const r=JSON.parse(patch.raw);
   for(const a of patch.arrays){
    if(!a.path.length)await tx.$executeRaw`UPDATE "WorkRecord" SET payload=COALESCE((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(payload) WITH ORDINALITY x(v,n) WHERE NOT COALESCE((v->>${a.key})=ANY(${a.ids}::text[]),false)),'[]'::jsonb) WHERE workspace=${r.workspace} AND kind=${r.kind} AND id=${r.id}`;
    else await tx.$executeRaw`UPDATE "WorkRecord" SET payload=jsonb_set(payload,${a.path}::text[],COALESCE((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(payload#>${a.path}::text[]) WITH ORDINALITY x(v,n) WHERE NOT COALESCE((v->>${a.key})=ANY(${a.ids}::text[]),false)),'[]'::jsonb)) WHERE workspace=${r.workspace} AND kind=${r.kind} AND id=${r.id}`;
   }
   if(patch.invalidatePlan)await tx.$executeRaw`UPDATE "WorkRecord" SET payload=(payload-'integratedPlan') || '{"fingerprint":"INPUTS_RETIRED","sourceFingerprint":"INPUTS_RETIRED"}'::jsonb WHERE workspace=${r.workspace} AND kind=${r.kind} AND id=${r.id}`;
   await tx.$executeRaw`UPDATE "WorkRecord" SET version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE workspace=${r.workspace} AND kind=${r.kind} AND id=${r.id}`;
  }
  for(const raw of plan.outbox)await tx.outbox.delete({where:{id:JSON.parse(raw).id}});
  for(const raw of plan.receipts)await tx.receipt.delete({where:{id:JSON.parse(raw).id}});
  // Filter individual JSON elements in PostgreSQL; unrelated numbers retain
  // their exact stored precision, including on archive restoration.
  await tx.$executeRaw`UPDATE "Center" SET state=state || jsonb_build_object(
   'fields',COALESCE((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(state->'fields') WITH ORDINALITY x(v,n) WHERE NOT ((v->>'id')=ANY(${plan.fieldIds}::text[]))),'[]'::jsonb),
   'missions',COALESCE((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(state->'missions') WITH ORDINALITY x(v,n) WHERE NOT ((v->>'id')=ANY(${plan.missionIds}::text[]))),'[]'::jsonb),
   'revisions',COALESCE((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(state->'revisions') WITH ORDINALITY x(v,n) WHERE NOT ((v->>'id')=ANY(${plan.revisionIds}::text[]))),'[]'::jsonb),
   'planVersion',COALESCE((state->>'planVersion')::int,0)+1),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=${b.centerId}`;
  await tx.$executeRaw`UPDATE "Center" SET state=state || jsonb_build_object('registered',jsonb_array_length(state->'fields')>0,'planned',jsonb_array_length(state->'missions')>0) WHERE id=${b.centerId}`;
  const ledger=(JSON.parse(plan.beforeCenter).state as any).productionLedger;
  if(ledger){
   await tx.$executeRaw`UPDATE "Center" SET state=jsonb_set(state,'{productionLedger,entries}',(state#>'{productionLedger,entries}')-${plan.fieldIds}::text[]) WHERE id=${b.centerId}`;
   await tx.$executeRaw`UPDATE "Center" SET state=jsonb_set(state,'{productionLedger,totals}',COALESCE((SELECT jsonb_object_agg(bucket,jsonb_build_object('low',low,'high',high)) FROM (SELECT v->>'source'||':'||(v->>'commodity')||':'||(v#>>'{period,year}')||CASE WHEN v#>>'{period,quarter}' IS NULL THEN '' ELSE '-Q'||(v#>>'{period,quarter}') END AS bucket,SUM((v#>>'{kg,low}')::numeric) AS low,SUM((v#>>'{kg,high}')::numeric) AS high FROM jsonb_each(state#>'{productionLedger,entries}') x(k,v) GROUP BY bucket) totals),'{}'::jsonb)) WHERE id=${b.centerId}`;
  }
  archive.status='RETIRED';archive.afterHash=retirementHash(await readRetirementSnapshot(tx));archive.digest=digest(archive);
  await tx.workRecord.update({where:{workspace_kind_id:key(b.id)},data:{payload:archive}});
  await tx.audit.create({data:{centerId:b.centerId,action:'preparedBatch.retire',detail:{archiveId:b.id,batchId:b.batchId,actorId,counts:plan.counts}}});
  return {id:b.id,counts:plan.counts,alreadyApplied:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function restorePreparedBatch(client:PrismaClient,id:string,actorId:string){
 z.string().uuid().parse(id);
 return client.$transaction(async tx=>{
  await lockProduction(tx);const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key(id)}}),p=row.payload as any;
  if(p.contract!=='prepared-batch-retirement-v1'||p.digest!==digest(p))throw Error('보관본 무결성 오류');if(p.status==='RESTORED')return {id,alreadyRestored:true};
  if(p.status!=='RETIRED'||retirementHash(await readRetirementSnapshot(tx))!==p.afterHash)throw Error('정리 이후 업무 자료가 변경되어 자동 복구하지 않았습니다.');
  await tx.$executeRaw`DELETE FROM "Center" WHERE id=${p.centerId}`;
  await tx.$executeRaw`INSERT INTO "Center" SELECT * FROM jsonb_populate_record(NULL::"Center",${p.beforeCenter}::jsonb)`;
  for(const raw of p.patches){const r=JSON.parse(raw);await tx.workRecord.delete({where:{workspace_kind_id:{workspace:r.workspace,kind:r.kind,id:r.id}}});}
  for(const raw of [...p.records,...p.patches])await tx.$executeRaw`INSERT INTO "WorkRecord" SELECT * FROM jsonb_populate_record(NULL::"WorkRecord",${raw}::jsonb)`;
  for(const raw of p.outbox)await tx.$executeRaw`INSERT INTO "Outbox" SELECT * FROM jsonb_populate_record(NULL::"Outbox",${raw}::jsonb)`;
  for(const raw of p.receipts)await tx.$executeRaw`INSERT INTO "Receipt" SELECT * FROM jsonb_populate_record(NULL::"Receipt",${raw}::jsonb)`;
  await tx.workRecord.update({where:{workspace_kind_id:key(id)},data:{payload:{...p,status:'RESTORED',restoredBy:actorId}}});
  await tx.audit.create({data:{centerId:p.centerId,action:'preparedBatch.restore',detail:{archiveId:id,actorId}}});
  return {id,alreadyRestored:false};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
