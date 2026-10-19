import {centerId as activeCenterId,recordSpace} from './workspace';
import type {Prisma} from '@prisma/client';
import type {FieldEntry} from './field-record';
import type {State} from './types';
import {appendAssignments,type delegatedProposal} from './delegated-planning';
import {syncChangedPlanReservations} from './plan-reservation-sync';
import {plannedLaborDemand} from './planned-labor-demand';
import {applyRegistrationOrigins} from './registration-origin';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
/** Caller locks center and field inventory, revalidates proposal and authority. */
export async function commitDelegatedPlans(tx:Prisma.TransactionClient,input:{state:State;fields:FieldEntry[];version:number;plans:Awaited<ReturnType<typeof delegatedProposal>>['plans'];names:Record<string,string>;proposalId:string;actor:string;today:string}){
 const {plans,proposalId,actor,today}=input;
 if(!plans.length||plans.some(p=>!p.dispatch.assignments.length||!p.dispatch.feasibility.length||p.dispatch.feasibility.some(f=>f.status!=='CAPACITY_FEASIBLE')))throw Error('필수 작업 배치가 완료된 계획만 확정할 수 있습니다.');
 let next=structuredClone(input.state);const fields=structuredClone(input.fields),version=input.version+1,farmerIds=new Set<string>();
 for(const row of plans){
  const field=fields.find(f=>f.pnu===row.cultivation.pnu);
  if(!field?.consultationId)throw Error('농지·농부 연결 확인 필요');
  if(row.dispatch.assignments.some(a=>next.missions.some(m=>m.id===a.taskId)))throw Error('이미 연결된 작업입니다.');
  next=appendAssignments(next,row.plan,row.dispatch,input.names);
  // Preparing a future crop must not overwrite the current crop on the field.
  if(!field.crop||row.cultivation.start<=today)field.crop=row.cultivation.crop;
  const plan={...row.plan,fieldVersion:version};
  for(const [kind,payload] of [['cultivation',row.cultivation],['cultivationPlan',plan]] as const)await tx.workRecord.create({data:{workspace:recordSpace(),kind,id:row.cultivation.id,payload:json(payload)}});
  for(const a of row.dispatch.assignments){
   await tx.workRecord.create({data:{workspace:recordSpace(),kind:'annualReservation',id:a.taskId,payload:json({...a,status:'RESERVED',source:'PLANNING_SIMULATION',approvedAt:new Date().toISOString(),approvedBy:actor})}});
   await tx.workRecord.create({data:{workspace:recordSpace(),kind:'laborDemand',id:a.taskId,payload:json(plannedLaborDemand(plan,a))}});
  }
  farmerIds.add(field.consultationId);
 }
 await tx.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace(),kind:'fields',id:'current'}},data:{payload:json(fields),version}});
 await applyRegistrationOrigins(tx,next);
 await syncChangedPlanReservations(tx,activeCenterId(),input.state,next,plans.flatMap(r=>r.dispatch.assignments.map(a=>a.taskId)),actor);
 next.planVersion++;await tx.center.update({where:{id:activeCenterId()},data:{state:json(next),version:{increment:1}}});
 for(const farmerId of farmerIds)await tx.outbox.create({data:{status:'RECORDED_ONLY',id:'delegated:'+proposalId+':'+farmerId,centerId:activeCenterId(),farmerId,planVersion:next.planVersion,body:'위탁 농지의 작물·작업 계획이 확정되었습니다. 작업 일정은 농사계획에서 확인해주세요.'}});
 return {ok:true,fields:plans.length,assigned:plans.reduce((n,r)=>n+r.dispatch.assignments.length,0),unassigned:plans.reduce((n,r)=>n+r.dispatch.pending.length,0),notifications:farmerIds.size};
}
