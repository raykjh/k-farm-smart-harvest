import type {Prisma} from '@prisma/client';
import type {State,Mission} from './types';
import {recordSpace} from './workspace';
import {isClosedTask} from './task-lifecycle';
import {emptyLaborOps,type LaborOps,type LaborJob} from './labor-operations';
import type {LaborShare} from './labor-sharing';

export type LaborRecovery={id:string;kind:'LOCAL_ABSENCE'|'SHARE_WITHDRAWAL'|'WINDOW_WITHDRAWAL';centerId:string;ownerCenterId:string;workerId:string;workerName:string;reason:string;actor:string;recordedAt:string;windowId?:string;jobId?:string;date:string;startMinute:number;endMinute:number;tasks:{id:string;signature:string}[];status:'OPEN'|'RESOLVED';resolution?:'REPLACED'|'REPLANNED'|'CLOSED';resolvedAt?:string};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const signature=(m:Mission)=>JSON.stringify([m.scheduledDate,m.start,m.duration,m.resourceId,[...m.laborSupportIds??[]].sort()]);
export const recoveryKey=(center:string,id:string)=>({workspace:recordSpace(center),kind:'laborRecovery',id});
export async function recoveryRows(tx:Prisma.TransactionClient,center:string){return tx.workRecord.findMany({where:{workspace:recordSpace(center),kind:'laborRecovery'},orderBy:{id:'asc'}})}
export async function recordLaborRecovery(tx:Prisma.TransactionClient,input:Omit<LaborRecovery,'tasks'|'status'|'recordedAt'>&{missionIds:string[]}){
 const center=await tx.center.findUniqueOrThrow({where:{id:input.centerId}}),s=center.state as unknown as State;
 const {missionIds,...rest}=input,tasks=s.missions.filter(m=>missionIds.includes(m.id)&&!isClosedTask(m.status));
 if(!tasks.length)return;
 const issue:LaborRecovery={...rest,tasks:tasks.map(m=>({id:m.id,signature:signature(m)})),status:'OPEN',recordedAt:new Date().toISOString()};
 await tx.workRecord.create({data:{...recoveryKey(input.centerId,input.id),payload:json(issue)}});
}
/** Caller holds center lock(s) and the shared labor lock. No schedule or actual
 * work is rewritten. Only the execution-review flag and recovery record change. */
export async function refreshLaborRecoveries(tx:Prisma.TransactionClient,centerId:string,stateOverride?:State){
 const rows=await recoveryRows(tx,centerId);if(!rows.length)return;
 const row=await tx.center.findUniqueOrThrow({where:{id:centerId}}),state=stateOverride??structuredClone(row.state) as unknown as State;
 const roster=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(centerId),kind:'laborOperations',id:'current'}}}),ops=(roster?.payload??emptyLaborOps()) as unknown as LaborOps;
 const shares=(await tx.workRecord.findMany({where:{workspace:'shared',kind:'laborShare'}})).map(r=>r.payload as unknown as LaborShare);
 const affected=new Set<string>(),blocked=new Set<string>();let changed=false;
 for(const r of rows){const issue=r.payload as unknown as LaborRecovery;if(issue.status!=='OPEN')continue;
  const current=issue.tasks.flatMap(t=>{affected.add(t.id);const m=state.missions.find(m=>m.id===t.id);return m&&!isClosedTask(m.status)?[{m,original:t}]:[]});
  const same=current.filter(({m,original})=>signature(m)===original.signature);
  const staffed=(m:Mission)=>{const j=ops.jobs.find(j=>j.missionId===m.id&&j.status==='OPEN');return !!j&&j.assigned.length+shares.filter(s=>s.borrowerCenterId===centerId&&s.jobId===j.id&&s.sourceHash===j.sourceHash&&s.status==='ASSIGNED').length>=j.count};
  const replaced=issue.kind!=='WINDOW_WITHDRAWAL'&&same.every(({m})=>staffed(m));
  if(!current.length||!same.length||replaced){
   issue.status='RESOLVED';issue.resolution=!current.length?'CLOSED':!same.length?'REPLANNED':'REPLACED';issue.resolvedAt=new Date().toISOString();
   await tx.workRecord.update({where:{workspace_kind_id:recoveryKey(centerId,issue.id)},data:{payload:json(issue),version:{increment:1}}});
  }else{
   for(const {m} of same)blocked.add(m.id);
   const farmers=new Set(same.flatMap(({m})=>state.fields.filter(f=>f.id===m.fieldId).map(f=>f.farmerId)));
   for(const farmerId of farmers){const id=`labor-recovery:${issue.id}:${farmerId}`;
    if(!await tx.outbox.findUnique({where:{id}}))await tx.outbox.create({data:{id,centerId,farmerId,planVersion:state.planVersion,body:'작업 인력 변동으로 대체 인력과 일정을 확인 중입니다. 변경계획 확정 후 안내합니다.'}});
   }
  }
 }
 for(const id of affected){const m=state.missions.find(m=>m.id===id);if(!m||isClosedTask(m.status))continue;
  if(blocked.has(id)){if(!m.laborRecoveryRequired){m.laborRecoveryRequired=true;changed=true}}
  else if(m.laborRecoveryRequired){delete m.laborRecoveryRequired;changed=true}
 }
 if(changed&&!stateOverride){state.planVersion++;await tx.center.update({where:{id:centerId},data:{state:json(state),version:{increment:1}}});}
}
export function absenceInput(id:string,centerId:string,workerId:string,workerName:string,job:LaborJob,reason:string,actor:string){return {id,kind:'LOCAL_ABSENCE' as const,centerId,ownerCenterId:centerId,workerId,workerName,jobId:job.id,missionIds:[job.missionId],date:job.date,startMinute:job.startMinute,endMinute:job.startMinute+job.durationMinutes,reason,actor}}

/** The original unavailable interval remains unavailable after moving its job.
 * A confirmed replacement in the same interval restores the reviewed capacity. */
export async function localAbsenceWindows(tx:Prisma.TransactionClient,centerId:string){
 const rows=await recoveryRows(tx,centerId);
 return rows.map(r=>r.payload as unknown as LaborRecovery).filter(r=>r.kind==='LOCAL_ABSENCE');
}
