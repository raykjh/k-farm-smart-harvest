import {isClosedTask} from './task-lifecycle';
import {recordSpace} from './workspace';
import {createHash,randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {State} from './types';
import {availableFor,notice,newAttendance,advanceAttendance,canAssign,emptyLaborOps,type LaborOps,type LaborJob} from './labor-operations';
import {reserveSupportId,isReserveSupport} from './center-reserve';
import {ordinaryWorkerDemand} from './planned-labor-demand';
import {laborSharingLock,reconcileLaborShares} from './labor-sharing';
import {refreshLaborRecoveries} from './labor-recovery-store';
import {currentLaborDemands} from './labor-demands';
import {laborPoliciesForDates} from './labor-policy-store';
import {prepareRecruitment} from './labor-recruitment';
import {payBasis,payLabel} from './labor-policy';
/** Called while the caller holds the Center lock, in the plan transaction. */
export async function reconcileLaborPlan(tx:Prisma.TransactionClient,centerId:string,state:State){
 await laborSharingLock(tx);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace(centerId)}`}))`;
 const key={workspace:recordSpace(centerId),kind:'laborOperations',id:'current'};
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
 const s=(row?.payload??emptyLaborOps()) as unknown as LaborOps,now=new Date().toISOString(),oldJobIds=new Set(s.jobs.map(j=>j.id));let changed=false;
 for(const job of [...s.jobs]){
  if(job.status==='COMPLETED')continue;
  const m=state.missions.find(m=>m.id===job.missionId),f=state.fields.find(f=>f.id===m?.fieldId);
  const count=m?ordinaryWorkerDemand(m):0;
  const value=m&&!isClosedTask(m.status)&&m.scheduledDate&&count>0?{id:m.id,missionId:m.id,task:m.label,address:f?.address??m.fieldId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,count,workCode:(m as any).operationCode??'general',held:m.status==='HELD'||m.status==='UNSTAFFED'}:null;
  const sourceHash=value?createHash('sha256').update(JSON.stringify(value)).digest('hex'):null;
  if(job.status==='OPEN'&&sourceHash===job.sourceHash)continue;
  if(job.status==='OPEN'){
   for(const worker of new Set([...job.invited,...job.assigned]))notice(s,job,worker,'CANCELLED',now);
   job.status='STALE';job.assigned=[];job.reserveSlots=[];changed=true;
  }
  if(!value||value.held||m?.status==='COMPLETED'||s.jobs.some(j=>j.missionId===job.missionId&&j.status==='OPEN')||s.jobs.some(j=>(j as any).replacesJobId===job.id))continue;
  const next:LaborJob={...value,fieldId:m?.fieldId,cultivationId:(m as any)?.cultivationId,id:randomUUID(),sourceHash:sourceHash!,pay:job.pay,payBasis:job.payBasis,status:'OPEN',invited:[],responses:{},distances:{...job.distances},assigned:[],manual:null,worked:[]};
  Object.assign(next,{replacesJobId:job.id});if(job.attendance)next.attendance=newAttendance();
  next.invited=s.people.filter(p=>p.employment!=='CENTER_RESERVE'&&availableFor(p,next)).map(p=>p.id);s.jobs.push(next);
  if(next.attendance){next.invited=[];if(!m?.laborSupportIds?.some(isReserveSupport))advanceAttendance(s,next,now);}else for(const worker of next.invited)notice(s,next,worker,'RECONFIRM',now);
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
  const next:LaborJob={...value,fieldId:m.fieldId,cultivationId:(m as any).cultivationId,id:randomUUID(),sourceHash:createHash('sha256').update(JSON.stringify(value)).digest('hex'),pay:prior.pay,payBasis:prior.payBasis,status:'OPEN',invited:[],responses:{},distances:{...prior.distances},assigned:[],manual:null,worked:[]};
  Object.assign(next,{splitFromJobId:prior.id});if(prior.attendance)next.attendance=newAttendance();next.invited=s.people.filter(p=>p.employment!=='CENTER_RESERVE'&&availableFor(p,next)).map(p=>p.id);s.jobs.push(next);
  if(next.attendance){next.invited=[];advanceAttendance(s,next,now);}else for(const worker of next.invited)notice(s,next,worker,'RECONFIRM',now);
  changed=true;
 }
 // An urgent harvest may not have opened recruitment yet. A solver-selected
 // reserve must become a named local assignment in this same transaction.
 for(const m of state.missions){
  const supportIds=m.laborSupportIds?.filter(isReserveSupport)??[];
  if(!supportIds.length||isClosedTask(m.status)||!m.scheduledDate)continue;
  const count=ordinaryWorkerDemand(m),field=state.fields.find(f=>f.id===m.fieldId);
  const value={id:m.id,missionId:m.id,task:m.label,address:field?.address??m.fieldId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,count,workCode:(m as any).operationCode??'general',held:false};
  let job=s.jobs.find(j=>j.missionId===m.id&&j.status==='OPEN');
  if(!job){job={...value,id:randomUUID(),sourceHash:createHash('sha256').update(JSON.stringify(value)).digest('hex'),pay:'센터 근무 기준',status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[],attendance:newAttendance()};s.jobs.push(job);changed=true;}
  const workers=s.people.filter(p=>supportIds.includes(reserveSupportId(centerId,p.id,m.scheduledDate!)));
  if(workers.length!==supportIds.length||workers.length>count)throw Error('예비인력 명부가 변경되었습니다. 다시 배치하세요.');
  for(const worker of workers){
   const probe={...job,invited:[...job.invited,worker.id],responses:{...job.responses,[worker.id]:'STANDBY' as const}};
   if(worker.employment!=='CENTER_RESERVE'||!canAssign(s,probe,worker))throw Error('예비인력의 대기근무·중복 배정을 확인하세요.');
   if(job.manual!==null&&!job.manual.includes(worker.id))throw Error('담당자가 확정한 인력 배정과 충돌합니다.');
   if(!job.invited.includes(worker.id))job.invited.push(worker.id);
   job.responses[worker.id]='STANDBY';
   if(!job.assigned.includes(worker.id)){if(job.assigned.length>=count)throw Error('확정 인력 배정이 변경되었습니다. 다시 계산하세요.');job.assigned.push(worker.id);notice(s,job,worker.id,'ASSIGNED',now);changed=true;}
   if(job.attendance&&!job.attendance.proposed.includes(worker.id))job.attendance.proposed.push(worker.id);
  }
 }
 const demands=await currentLaborDemands(tx,centerId,state),policies=await laborPoliciesForDates(tx,centerId,demands.map(d=>d.date));
 if(prepareRecruitment(s,demands,policies,now))changed=true;
 if(changed){
  for(const j of s.jobs)if(!oldJobIds.has(j.id)&&j.payBasis&&j.payBasis.year!==Number(j.date.slice(0,4))){const p=policies[j.date.slice(0,4)];j.payBasis=payBasis(p?.policy??null,p?.version??0);j.pay=payLabel(j.payBasis);}
  s.reserveCapacityByYear=Object.fromEntries(Object.entries(policies).map(([year,p])=>[year,p.policy?.reserveCount??3]));
  for(const j of s.jobs)if(j.status==='OPEN'&&demands.some(d=>d.missionId===j.missionId&&!d.held&&!d.completed))advanceAttendance(s,j,now);
  if(row)await tx.workRecord.update({where:{workspace_kind_id:key},data:{version:{increment:1},payload:JSON.parse(JSON.stringify(s))}});
  else await tx.workRecord.create({data:{...key,version:1,payload:JSON.parse(JSON.stringify(s))}});
 }
 await reconcileLaborShares(tx,{centerId,state});
 await refreshLaborRecoveries(tx,centerId,state);
}
