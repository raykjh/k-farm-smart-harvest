import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {recordSpace} from './workspace';
import type {State} from './types';
import {ordinaryWorkerDemand} from './planned-labor-demand';

export async function currentLaborDemands(tx:Prisma.TransactionClient,centerId:string,state?:State){
 const rows=await tx.workRecord.findMany({where:{workspace:recordSpace(centerId),kind:'laborDemand'}}),center=state?null:await tx.center.findUnique({where:{id:centerId}}),s=state??center?.state as unknown as State|undefined;
 return rows.flatMap(row=>{
  const m=s?.missions.find(m=>m.id===row.id),count=m?ordinaryWorkerDemand(m):0;
  if(!m||m.status==='CANCELLED'||!m.scheduledDate||count<1)return [];
  const f=s?.fields.find(f=>f.id===m.fieldId),value={id:m.id,missionId:m.id,task:m.label,address:f?.address??m.fieldId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,count,workCode:(m as typeof m&{operationCode?:string}).operationCode??'general',held:m.status==='HELD'||m.status==='UNSTAFFED'};
  return [{...value,fieldId:m.fieldId,cultivationId:(m as typeof m&{cultivationId?:string}).cultivationId,completed:m.status==='COMPLETED',sourceHash:createHash('sha256').update(JSON.stringify(value)).digest('hex')}];
 });
}
