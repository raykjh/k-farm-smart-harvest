import {centerId as activeCenterId,recordSpace} from './workspace';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {db} from './db';
import {actorLabel} from './auth';
import {executionStatus} from './execution-view';
import {readExecutionHistory} from './replan-history';
import {isClosedTask,isRecordedOptionalCancellation} from './task-lifecycle';
import {syncChangedPlanReservations} from './plan-reservation-sync';
import type {State} from './types';

export const cancellationInput=z.object({requestId:z.string().uuid(),expectedPlanVersion:z.number().int(),missionIds:z.array(z.string().min(1)).min(1).max(600),category:z.enum(['UNNECESSARY','WITHDRAWAL','CROP_CHANGE']),reason:z.string().trim().min(1).max(2000),unperformedConfirmed:z.literal(true)}).strict();
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));

export async function cancelTasks(input:unknown){
 const b=cancellationInput.parse(input),actor=actorLabel();
 const requestHash=createHash('sha256').update(JSON.stringify({input:b,actor})).digest('hex');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  const key={workspace:recordSpace(),kind:'taskCancellation',id:b.requestId};
  const receipt=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if(receipt){const saved=receipt.payload as any;if(saved.requestHash!==requestHash)throw Error('요청 번호의 내용이 다릅니다.');return {...saved.result,alreadyApplied:true};}
  const row=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),before=row.state as unknown as State;
  if(before.planVersion!==b.expectedPlanVersion)throw Error('계획이 변경되었습니다. 다시 불러오세요.');
  const ids=new Set(b.missionIds);let tasks=before.missions.filter(m=>ids.has(m.id));
  if(ids.size!==b.missionIds.length||tasks.length!==ids.size)throw Error('취소할 작업을 중복 없이 선택하세요.');
  const history=await readExecutionHistory(tx);
  const affectedFields=new Set(tasks.map(m=>m.fieldId));
  if(b.category!=='UNNECESSARY'){
   for(const m of before.missions)if(affectedFields.has(m.fieldId)&&!isClosedTask(executionStatus(before,m,history)))ids.add(m.id);
   tasks=before.missions.filter(m=>ids.has(m.id));
  }
  for(const m of tasks){
   if(isClosedTask(executionStatus(before,m,history)))throw Error('완료·취소된 작업은 취소로 덮어쓸 수 없습니다.');
   const latest=history.find(e=>e.missionId===m.id&&e.plannedDate===m.scheduledDate) as any;
   if(latest?.actualStartedAt||latest?.simulatedStartedAt||(m as any).executionStartedAt||(m as any).safetyLock||before.machines.some(r=>r.id===m.resourceId&&(r.safetyLock||r.status==='WORKING')))throw Error('작업 시작·안전 상태를 먼저 확인하세요.');
  }
  const dependents=before.missions.filter(m=>!ids.has(m.id)&&!isClosedTask(executionStatus(before,m,history))&&(m as any).predecessorMissionIds?.some((id:string)=>ids.has(id)));
  if(dependents.length&&!(b.category==='UNNECESSARY'&&tasks.every(m=>isRecordedOptionalCancellation({...m,status:'CANCELLED',cancellation:{requestId:b.requestId,category:b.category,reason:b.reason,confirmedAt:new Date().toISOString(),confirmedBy:actor}}))))throw Error(`후속 작업이 연결되어 있습니다. 함께 변경하거나 취소할 범위를 검토하세요: ${dependents.map(m=>m.label).slice(0,5).join(', ')}`);
  if(b.category!=='UNNECESSARY')await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${recordSpace()}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace()}`}))`;
  const labor=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}}});
  if((labor?.payload as any)?.jobs?.some((j:any)=>ids.has(j.missionId)&&(j.status==='COMPLETED'||j.worked?.length)))throw Error('실제 근무 기록이 있습니다. 작업 결과를 먼저 정리하세요.');
  const after=structuredClone(before),now=new Date().toISOString();
  const archived=tasks.some(m=>!m.scheduledDate)?await tx.workRecord.findMany({where:{workspace:'shared',kind:'cancelledReservation'},orderBy:{updatedAt:'desc'}}):[];
  for(const m of after.missions.filter(m=>ids.has(m.id))){
   // A released booking has no active date. Keep its last recorded date in the closed ledger.
   if(!m.scheduledDate){const previous=archived.find(r=>{const p=r.payload as any;return p.reservation?.centerId===activeCenterId()&&p.reservation?.taskId===m.id});m.scheduledDate=(previous?.payload as any)?.before?.scheduledDate??m.originalScheduledDate;}
   m.status='CANCELLED';m.cancellation={requestId:b.requestId,category:b.category,reason:b.reason,confirmedAt:now,confirmedBy:actor};
  }
  // Keep the mission/date/resource snapshot for history; release only active reservations.
  const linked=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
  const reservations=linked.filter(r=>(r.payload as any).centerId===activeCenterId()&&ids.has((r.payload as any).taskId));
  await syncChangedPlanReservations(tx,activeCenterId(),before,after,[...ids],actor);
  for(const r of reservations)await tx.workRecord.create({data:{workspace:'shared',kind:'cancelledReservation',id:r.id,version:r.version+1,payload:json({reservation:r.payload,before:tasks.find(m=>m.id===(r.payload as any).taskId),reason:b.reason,taskCancellationId:b.requestId,actorId:actor})}});
  // Retain the original per-operation reservation/demand documents with an explicit closure.
  for(const m of tasks)for(const kind of ['annualReservation','laborDemand']){
   const k={workspace:recordSpace(),kind,id:m.id},record=await tx.workRecord.findUnique({where:{workspace_kind_id:k}});
   if(record)await tx.workRecord.update({where:{workspace_kind_id:k},data:{version:{increment:1},payload:json({...record.payload as object,status:'CANCELLED',taskCancellationId:b.requestId})}});
  }
  if(b.category!=='UNNECESSARY'){
   const inventoryKey={workspace:recordSpace(),kind:'fields',id:'current'},inventory=await tx.workRecord.findUnique({where:{workspace_kind_id:inventoryKey}});
   const entries=(inventory?.payload??[]) as any[];
   const cycles=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'cultivation'}});
   const nowDay=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
   for(const pnu of affectedFields){
    const field=after.fields.find(f=>f.id===pnu);if(!field)throw Error('연결 농지가 없습니다.');
    await tx.workRecord.create({data:{workspace:recordSpace(),kind:'fieldClosure',id:b.requestId+':'+pnu,payload:json({field:before.fields.find(f=>f.id===pnu),inventory:entries.find(f=>f.pnu===pnu)??null,category:b.category,reason:b.reason,actor,at:now,retention:'UNTIL_POLICY_SET',missionIds:tasks.filter(m=>m.fieldId===pnu).map(m=>m.id)})}});
    field.serviceStatus=b.category==='WITHDRAWAL'?'WITHDRAWN':'CROP_REQUIRED';if(b.category==='CROP_CHANGE')field.crop=null;
    const pk={workspace:recordSpace(),kind:'fieldParticipation',id:pnu},participation=await tx.workRecord.findUnique({where:{workspace_kind_id:pk}});
    if(participation)await tx.workRecord.update({where:{workspace_kind_id:pk},data:{version:{increment:1},payload:json({...participation.payload as object,status:b.category==='WITHDRAWAL'?'ENDED':'PAUSED',reason:b.reason,changedAt:now})}});
    for(const c of cycles){const p=c.payload as any;if(p.pnu===pnu&&!p.closedAt&&(p.end>=nowDay||tasks.some(m=>(m as any).cultivationId===c.id)))await tx.workRecord.update({where:{workspace_kind_id:{workspace:c.workspace,kind:c.kind,id:c.id}},data:{version:{increment:1},payload:json({...p,closedAt:now,closureCategory:b.category})}});}
   }
   if(inventory){
    const values=b.category==='WITHDRAWAL'?entries.filter(f=>!affectedFields.has(f.pnu)):entries.map(f=>affectedFields.has(f.pnu)?{...f,crop:'',group:''}:f);
    // A removed member must not leave a one-field crop group behind.
    const groups=new Map<string,number>();for(const f of values)if(f.group)groups.set(f.group,(groups.get(f.group)??0)+1);
    const payload=values.map(f=>f.group&&(groups.get(f.group)??0)<2?{...f,group:''}:f);
    await tx.workRecord.update({where:{workspace_kind_id:inventoryKey},data:{payload:json(payload),version:{increment:1}}});
   }
  }
  after.planVersion++;
  for(const revision of after.revisions)if(revision.status==='REVIEW_REQUIRED')revision.status='SUPERSEDED';
  await tx.center.update({where:{id:activeCenterId()},data:{state:json(after),version:{increment:1}}});
  const farmers=[...new Set(tasks.flatMap(m=>{const f=after.fields.find(f=>f.id===m.fieldId);return f?.farmerId?[f.farmerId]:[]}))];
  for(const farmerId of farmers)await tx.outbox.updateMany({where:{centerId:activeCenterId(),farmerId,status:{in:['PENDING','FAILED']},planVersion:{lte:before.planVersion}},data:{status:'SUPERSEDED'}});
  for(const farmerId of farmers)await tx.outbox.create({data:{status:'RECORDED_ONLY',id:`task-cancel:${b.requestId}:${farmerId}`,centerId:activeCenterId(),farmerId,planVersion:after.planVersion,body:`선택 작업이 취소되었습니다: ${tasks.filter(m=>after.fields.some(f=>f.id===m.fieldId&&f.farmerId===farmerId)).map(m=>m.label).join(', ')}. 사유: ${b.reason}. 최신 계획을 확인해주세요.`}});
  const result={ok:true,planVersion:after.planVersion,cancelled:tasks.length,releasedReservations:reservations.length};
  await tx.workRecord.create({data:{...key,payload:json({requestHash,input:b,actor,at:now,before:tasks,result})}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:'task.cancel',detail:json({requestId:b.requestId,actor,missionIds:b.missionIds,category:b.category,reason:b.reason})}});
  return result;
 },{timeout:20000});
}
