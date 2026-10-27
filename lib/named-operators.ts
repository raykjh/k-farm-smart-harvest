import {z} from 'zod';
import {equipmentCode} from './equipment-code';
import type {Mission,State} from './types';
import {dateSlot,slotDate,type SchedulingJob,type ResourceOption} from './scheduling-engine';
import {isClosedTask} from './task-lifecycle';
import {workforceAvailable} from './permanent-workforce';

const kind=z.enum(['DR','TR','RP','PS','CB','PD','SP','TV','SE','GC','RD','SD','HV']);
export const operatorSchema=z.object({
 id:z.string().uuid(),name:z.string().trim().min(1).max(60),active:z.boolean(),
 kinds:z.array(kind).min(1).max(13),weekdays:z.array(z.number().int().min(0).max(6)).max(7),
 from:z.string().date(),until:z.string().date(),excludedDates:z.array(z.string().date()).max(366),
 startMinute:z.number().int().min(480).max(945).multipleOf(15),endMinute:z.number().int().min(495).max(960).multipleOf(15),
 evidence:z.string().trim().min(3).max(1000),
}).strict().refine(p=>p.from<=p.until&&p.startMinute<p.endMinute,'근무 기간·시간을 확인하세요.');
export const operatorRosterSchema=z.array(operatorSchema).max(100).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'운영자 식별자가 중복되었습니다.');
export type NamedOperator=z.infer<typeof operatorSchema>;
export type OperatorCandidate={id:string;allowed:number[]};

/** Missing roster means unverified, never an invented person. Borrowed equipment
 * uses this center's roster; named crews are not implicitly shared by a loan. */
export function withNamedOperators(state:State,job:SchedulingJob,mission:Pick<Mission,'resourceId'|'resourceOccupancyOnly'|'machineOperators'|'staff'|'operatorIds'>):SchedulingJob{
 if(!state.operatorRoster||mission.resourceOccupancyOnly)return job;
 const count=mission.machineOperators??(mission.resourceId?Math.max(1,mission.staff):0);
 if(!Number.isInteger(count)||count<0||count>50)throw Error('장비 운영자 수요 확인이 필요합니다.');
 if(!count)return job;
 const options=job.options??[{resource:job.resource,allowed:job.allowed,borrowed:false,duration:job.duration}];
 const next=options.map((o):ResourceOption=>{
  const code=o.resource?equipmentCode(o.resource).match(/([A-Z]{2})\d+$/)?.[1]:undefined,duration=o.duration??job.duration;
  const assigned=o.resource===mission.resourceId&&mission.operatorIds?.length===1?mission.operatorIds[0]:state.machines.find(m=>m.id===o.resource)?.defaultOperatorId;
  const operatorCandidates=state.operatorRoster!.filter(p=>p.active&&p.kinds.some(k=>k===code)&&(!assigned||count!==1||p.id===assigned)).map(p=>({id:p.id,allowed:o.allowed.filter(s=>{
   const date=slotDate(s),minute=480+((s%32+32)%32)*15;
   const employee=state.permanentWorkforce?.workers.find(w=>w.operatorId===p.id);
   if(state.permanentWorkforce&&(!employee||!Array.from({length:duration},(_,i)=>minute+i*15).every(m=>workforceAvailable(employee,date,m))||[...(state.laborCapacity?.outgoing??[]).filter(w=>w.status==='CONFIRMED'),...(state.laborCapacity?.absences??[])].some(w=>w.workerId===employee.workerId&&w.date===date&&w.startMinute<minute+duration*15&&minute<w.endMinute)))return false;
   return p.from<=date&&date<=p.until&&!p.excludedDates.includes(date)&&p.weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())&&p.startMinute<=minute&&minute+duration*15<=p.endMinute;
  })})).filter(p=>p.allowed.length);
  return {...o,operatorCandidates};
 });
 return {...job,options:next,operatorCount:count,...(mission.operatorIds?{operatorIds:mission.operatorIds}:{})};
}
export function operatorScheduleKey(ids:string[]|undefined){return [...ids??[]].sort().join('|')}

/** Reconcile names against fixed appointments without moving any work. */
export function fixedOperatorJobs(state:State,today:string):SchedulingJob[]{
 return state.missions.filter(m=>!isClosedTask(m.status)&&!m.resourceOccupancyOnly&&m.scheduledDate&&m.scheduledDate>=today).map(m=>{
  const original=dateSlot(m.scheduledDate!)+(m.start%32+32)%32;
  return withNamedOperators(state,{id:m.id,original,duration:m.duration,allowed:[original],resource:m.resourceId,field:m.fieldId,person:null,staff:0,transport:0,locked:true,selected:false,preferred:null,predecessor:null},m);
 });
}
