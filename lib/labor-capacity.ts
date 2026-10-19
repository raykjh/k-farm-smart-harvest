import {z} from 'zod';
import type {Mission,State} from './types';
import {dateSlot,slotDate,type SchedulingJob,type SchedulingContract} from './scheduling-engine';
import {ordinaryWorkerDemand} from './planned-labor-demand';
import type {ReserveLaborWindow} from './center-reserve';

export const laborCapacityInput=z.object({
 borrowerCenterId:z.string().min(1).max(80),workerId:z.string().uuid(),date:z.string().date(),
 startMinute:z.number().int().min(480).max(945).multipleOf(15),endMinute:z.number().int().min(495).max(960).multipleOf(15),
 travelMinutes:z.number().int().min(0).max(120).multipleOf(15),workCodes:z.array(z.string().min(1).max(40)).min(1).max(30),
 response:z.enum(['APP','SMS','PHONE']),consent:z.literal(true),reason:z.string().trim().min(3).max(500),
}).strict().refine(v=>v.startMinute+2*v.travelMinutes<v.endMinute,'이동 후 작업할 시간이 필요합니다.').refine(v=>new Set(v.workCodes).size===v.workCodes.length,'작업 종류 중복');
export type LaborCapacityWindow=z.infer<typeof laborCapacityInput>&{id:string;ownerCenterId:string;workerName:string;status:'OFFERED'|'CONFIRMED'|'CANCELLED'|'WITHDRAWN';actor:string;createdAt:string;excludedIntervals?:{startMinute:number;endMinute:number}[]};
export type LaborCapacityView={incoming:LaborCapacityWindow[];outgoing:LaborCapacityWindow[];reserves?:ReserveLaborWindow[];allowNewSupport?:boolean;absences?:{workerId:string;date:string;startMinute:number;endMinute:number}[]};
export const capacityOverlap=(a:Pick<LaborCapacityWindow,'date'|'startMinute'|'endMinute'>,b:Pick<LaborCapacityWindow,'date'|'startMinute'|'endMinute'>)=>a.date===b.date&&a.startMinute<b.endMinute&&b.startMinute<a.endMinute;
export const supportKey=(ids?:string[])=>[...ids??[]].sort().join('|');

/** Confirmed named support is optional capacity, not a substitute for operators.
 * Owner windows include both journeys; receiver work must fit inside them. */
export function withLaborSupport(state:State,job:SchedulingJob,m:Pick<Mission,'owner'|'resourceId'|'staff'|'ordinaryWorkers'|'machineOperators'|'resourceOccupancyOnly'|'laborSupportIds'>&{id?:string;operationCode?:string;harvestCarryover?:Mission['harvestCarryover']}):SchedulingJob{
 const windows=(state.laborCapacity?.incoming??[]).filter(w=>state.laborCapacity?.allowNewSupport!==false||m.laborSupportIds?.includes(w.id)),count=ordinaryWorkerDemand(m as Mission);
 const reserves=(state.laborCapacity?.reserves??[]).filter(r=>m.laborSupportIds?.includes(r.id)||!!m.harvestCarryover&&state.laborCapacity?.allowNewSupport!==false);
 if(!count&&!m.laborSupportIds?.length)return job;
 if(!windows.length&&!reserves.length&&!m.laborSupportIds?.length)return job;
 const options=job.options??[{resource:job.resource,allowed:job.allowed,duration:job.duration,borrowed:false}];
 const workerPool=`${state.centerSharing?.centerId??'demo'}:workers`;
 return {...job,ordinaryWorkerCount:count,laborSupportIds:m.laborSupportIds??[],workerPool:state.crewCapacity?workerPool:undefined,options:options.map(o=>({...o,laborCandidates:[...windows.filter(w=>w.status==='CONFIRMED'&&(w.workCodes.includes('*')||w.workCodes.includes(m.operationCode??'general'))).map(w=>({id:w.id,personId:`support:${w.ownerCenterId}:${w.workerId}`,allowed:o.allowed.filter(s=>slotDate(s)===w.date&&480+(s%32+32)%32*15>=w.startMinute+w.travelMinutes&&480+((s%32+32)%32+(o.duration??job.duration))*15<=w.endMinute-w.travelMinutes&&!w.excludedIntervals?.some(x=>480+(s%32+32)%32*15<x.endMinute&&x.startMinute<480+((s%32+32)%32+(o.duration??job.duration))*15))})),
  ...reserves.map(r=>({id:r.id,personId:`reserve:${state.centerSharing?.centerId??'demo'}:${r.workerId}`,allowed:o.allowed.filter(s=>slotDate(s)===r.date&&!r.busy.some(b=>b.missionId!==m.id&&480+(s%32+32)%32*15<b.endMinute&&b.startMinute<480+((s%32+32)%32+(o.duration??job.duration))*15))}))].filter(p=>p.allowed.length)}))};
}
export function laborCapacityBlocks(state:State):SchedulingContract['capacityBlocks']{
 const intervals=[...state.laborCapacity?.outgoing.filter(w=>w.status==='CONFIRMED')??[],...state.laborCapacity?.absences??[]];
 // Union by person/day so two absence records never remove the same person twice.
 const slots=new Map<string,Set<number>>();
 for(const w of intervals){const key=w.workerId+':'+w.date,set=slots.get(key)??new Set<number>();for(let s=Math.max(0,Math.floor((w.startMinute-480)/15));s<Math.min(32,Math.ceil((w.endMinute-480)/15));s++)set.add(dateSlot(w.date)+s);slots.set(key,set)}
 const blocks:NonNullable<SchedulingContract['capacityBlocks']>=[];
 for(const used of slots.values()){const ordered=[...used].sort((a,b)=>a-b);for(let i=0;i<ordered.length;){const start=ordered[i++];let end=start+1;while(ordered[i]===end&&Math.floor(end/32)===Math.floor(start/32)){i++;end++}blocks.push({start,duration:end-start,staff:1,capacityDemands:state.crewCapacity?{[`${state.centerSharing?.centerId??'demo'}:workers`]:1}:{}})}}
 return blocks;
}
