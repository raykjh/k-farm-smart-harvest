import {isClosedTask} from './task-lifecycle';
import {recordSpace} from './workspace';
import {createHash,randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {State} from './types';
import {availableFor,notice,type LaborOps,type LaborJob} from './labor-operations';
import {ordinaryWorkerDemand} from './planned-labor-demand';
import {laborSharingLock,reconcileLaborShares} from './labor-sharing';
import {refreshLaborRecoveries} from './labor-recovery-store';
/** Called while the caller holds the Center lock, in the plan transaction. */
export async function reconcileLaborPlan(tx:Prisma.TransactionClient,centerId:string,state:State){
 await laborSharingLock(tx);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace(centerId)}`}))`;
 const key={workspace:recordSpace(centerId),kind:'laborOperations',id:'current'};
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});if(!row){await reconcileLaborShares(tx,{centerId,state});await refreshLaborRecoveries(tx,centerId,state);return;}
 const s=row.payload as unknown as LaborOps,now=new Date().toISOString();let changed=false;
 for(const job of [...s.jobs]){
  if(job.status==='COMPLETED')continue;
  const m=state.missions.find(m=>m.id===job.missionId),f=state.fields.find(f=>f.id===m?.fieldId);
  const count=m?ordinaryWorkerDemand(m):0;
  const value=m&&!isClosedTask(m.status)&&m.scheduledDate&&count>0?{id:m.id,missionId:m.id,task:m.label,address:f?.address??m.fieldId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,count,workCode:(m as any).operationCode??'general',held:m.status==='HELD'||m.status==='UNSTAFFED'}:null;
  const sourceHash=value?createHash('sha256').update(JSON.stringify(value)).digest('hex'):null;
  if(job.status==='OPEN'&&sourceHash===job.sourceHash)continue;
  if(job.status==='OPEN'){
   for(const worker of new Set([...job.invited,...job.assigned]))notice(s,job,worker,'CANCELLED',now);
   job.status='STALE';job.assigned=[];changed=true;
  }
  if(!value||value.held||m?.status==='COMPLETED'||s.jobs.some(j=>j.missionId===job.missionId&&j.status==='OPEN')||s.jobs.some(j=>(j as any).replacesJobId===job.id))continue;
  const next:LaborJob={...value,id:randomUUID(),sourceHash:sourceHash!,pay:job.pay,status:'OPEN',invited:[],responses:{},distances:{...job.distances},assigned:[],manual:null,worked:[]};
  Object.assign(next,{replacesJobId:job.id});
  next.invited=s.people.filter(p=>p.employment!=='CENTER_RESERVE'&&availableFor(p,next)).map(p=>p.id);s.jobs.push(next);
  for(const worker of next.invited)notice(s,next,worker,'RECONFIRM',now);
  changed=true;
 }
 // A newly split day is a NEW attendance request, never copied attendance.
 // Use the prior recruitment's pay/eligibility inputs and re-invite available
 // applicants; no recruitment is invented if the source was not opened.
 for(const m of state.missions as (State['missions'][number]&{equipmentSplit?:{sourceId:string}})[]){
  const parent=m.equipmentSplit?.sourceId;
  if(!parent||parent===m.id||isClosedTask(m.status)||!m.scheduledDate||s.jobs.some(j=>j.missionId===m.id))continue;
  const prior=s.jobs.find(j=>j.missionId===parent&&j.status!=='COMPLETED');
  const count=ordinaryWorkerDemand(m);if(!prior||count<=0)continue;
  const field=state.fields.find(f=>f.id===m.fieldId),value={id:m.id,missionId:m.id,task:m.label,address:field?.address??m.fieldId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,count,workCode:(m as any).operationCode??'general',held:m.status==='HELD'||m.status==='UNSTAFFED'};
  if(value.held)continue;
  const next:LaborJob={...value,id:randomUUID(),sourceHash:createHash('sha256').update(JSON.stringify(value)).digest('hex'),pay:prior.pay,status:'OPEN',invited:[],responses:{},distances:{...prior.distances},assigned:[],manual:null,worked:[]};
  Object.assign(next,{splitFromJobId:prior.id});next.invited=s.people.filter(p=>p.employment!=='CENTER_RESERVE'&&availableFor(p,next)).map(p=>p.id);s.jobs.push(next);
  for(const worker of next.invited)notice(s,next,worker,'RECONFIRM',now);
  changed=true;
 }
 if(changed)await tx.workRecord.update({where:{workspace_kind_id:key},data:{version:{increment:1},payload:JSON.parse(JSON.stringify(s))}});
 await reconcileLaborShares(tx,{centerId,state});
 await refreshLaborRecoveries(tx,centerId,state);
}
