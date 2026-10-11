import type {Prisma} from '@prisma/client';
import type {EquipmentLoan} from './center-sharing';
import type {State} from './types';
import {recordSpace} from './workspace';
import {executionStatus,type ExecutionView} from './execution-view';
import {isClosedTask} from './task-lifecycle';

/** Include unindexed tasks and standalone bookings. Completed evidence remains history. */
export async function loanDependencies(tx:Prisma.TransactionClient,old:EquipmentLoan,next:EquipmentLoan){
 // An unapproved request grants no usage right; its withdrawal must not touch
 // jobs covered by a different, already confirmed loan for the same machine.
 if(old.status!=='CONFIRMED')return {tasks:[],reservations:[],preservedCompleted:0};
 const center=await tx.center.findUniqueOrThrow({where:{id:old.borrowerCenterId}}),state=center.state as unknown as State;
 const historyRows=await tx.workRecord.findMany({where:{workspace:recordSpace(old.borrowerCenterId),kind:'taskExecutionAssessment'},orderBy:[{updatedAt:'desc'},{id:'asc'}]});
 const history=historyRows.map(r=>r.payload as unknown as ExecutionView);
 const includes=(date:string|undefined)=>!!date&&next.status==='CONFIRMED'&&next.usableFrom<=date&&date<=next.usableUntil;
 const tasks=state.missions.filter(m=>m.resourceId===old.machineId&&(!m.scheduledDate||old.usableFrom<=m.scheduledDate&&m.scheduledDate<=old.usableUntil)).map(m=>{
  const status=executionStatus(state,m,history);
  return {id:m.id,label:m.label,date:m.scheduledDate??null,status,affected:!isClosedTask(status)&&!includes(m.scheduledDate)};
 });
 const rows=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'},orderBy:{id:'asc'}});
 const reservations=rows.flatMap(row=>{
  const r=row.payload as {centerId:string;resourceId:string;taskId:string;from:string;to:string};
  if(r.centerId!==old.borrowerCenterId||r.resourceId!==old.machineId)return [];
  const from=new Date(Date.parse(r.from)+9*3600000).toISOString().slice(0,10),to=new Date(Date.parse(r.to)-1+9*3600000).toISOString().slice(0,10);
  if(from>old.usableUntil||to<old.usableFrom)return [];
  const mission=state.missions.find(m=>m.id===r.taskId),closed=!!mission&&isClosedTask(executionStatus(state,mission,history));
  return [{id:row.id,taskId:r.taskId,from,to,affected:!closed&&!(includes(from)&&includes(to))}];
 });
 return {tasks,reservations,preservedCompleted:tasks.filter(t=>t.status==='COMPLETED').length};
}
