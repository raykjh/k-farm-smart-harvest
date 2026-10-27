import {z} from 'zod';
import type {State} from './types';
import type {LaborOps} from './labor-operations';
import {dateSlot,type SchedulingContract} from './scheduling-engine';

const day=z.string().date();
export const permanentWorkforceSchema=z.object({
 version:z.literal('permanent-workforce-v1'),checkedOn:day,evidenceRef:z.string().trim().min(3).max(200),
 workers:z.array(z.object({workerId:z.string().uuid(),role:z.enum(['WORKER','OPERATOR']),operatorId:z.string().uuid().optional(),
  from:day,to:day,weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute:z.number().int().min(480).max(945).multipleOf(15),endMinute:z.number().int().min(495).max(960).multipleOf(15),
  excludedDates:z.array(day).max(731),
 }).strict()).max(100),
}).strict().superRefine((v,ctx)=>{
 if(new Set(v.workers.map(w=>w.workerId)).size!==v.workers.length)ctx.addIssue({code:'custom',message:'상시 인력 중복'});
 const ids=v.workers.flatMap(w=>w.operatorId?[w.operatorId]:[]);
 if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'운영자 중복'});
 for(const w of v.workers)if(w.from>w.to||Date.parse(w.to)-Date.parse(w.from)>731*86400000||w.startMinute>=w.endMinute||new Set(w.weekdays).size!==w.weekdays.length||(w.role==='OPERATOR')!==!!w.operatorId)ctx.addIssue({code:'custom',message:'상시 근무기간·역할·시간 확인 필요'});
});
export type PermanentWorkforce=z.infer<typeof permanentWorkforceSchema>;
export type WorkforceView=PermanentWorkforce&{registeredPeople:number;horizon:{from:string;to:string}};

/** Enrollment includes permanent workers. Reserve duty is a separate status;
 * proposed hires and headcounts are never attendance. */
export function applyPermanentWorkforce(state:State,raw:unknown,ops:LaborOps,today:string):State{
 const record=permanentWorkforceSchema.parse(raw);
 if(record.checkedOn>today)throw Error('계획 시점 이후의 상시 근무 확인값');
 for(const w of record.workers){
  const p=ops.people.find(p=>p.id===w.workerId);
  if(!p?.active||p.employment==='CENTER_RESERVE')throw Error('상시 인력은 활동 중인 등록자와 별도 근무 확인이 필요합니다. 대기 인력과 중복할 수 없습니다.');
  if(w.operatorId&&!state.operatorRoster?.some(o=>o.id===w.operatorId&&o.active))throw Error('상시 운영자의 자격·등록 확인 필요');
 }
 const result=structuredClone(state),operators=record.workers.filter(w=>w.role==='OPERATOR');
 result.staffCount=record.workers.length;result.crewCapacity={operators:operators.length,workers:record.workers.length-operators.length};
 result.operatorRoster=(result.operatorRoster??[]).filter(o=>operators.some(w=>w.operatorId===o.id));
 result.permanentWorkforce={...record,registeredPeople:new Set(ops.people.filter(p=>p.active).map(p=>p.id)).size,horizon:{from:today,to:new Date(Date.parse(today)+730*86400000).toISOString().slice(0,10)}};
 return result;
}
export function workforceAvailable(w:PermanentWorkforce['workers'][number],date:string,minute:number){
 return w.from<=date&&date<=w.to&&w.weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())&&!w.excludedDates.includes(date)&&w.startMinute<=minute&&minute+15<=w.endMinute;
}
/** Union calendars, confirmed loans and absences by person/slot; never subtract
 * an absence twice or count the same employee as both ordinary and operator. */
export function workforceCapacityBlocks(state:State):NonNullable<SchedulingContract['capacityBlocks']>{
 const roster=state.permanentWorkforce;if(!roster)return [];
 const center=state.centerSharing?.centerId??'demo',blocks:NonNullable<SchedulingContract['capacityBlocks']>=[];
 const unavailable=[...(state.laborCapacity?.outgoing??[]).filter(w=>w.status==='CONFIRMED'),...(state.laborCapacity?.absences??[])];
 for(const w of roster.workers)for(let t=Date.parse(roster.horizon.from);t<=Date.parse(roster.horizon.to);t+=86400000){
  const date=new Date(t).toISOString().slice(0,10),busy=unavailable.filter(a=>a.workerId===w.workerId&&a.date===date),slots:number[]=[];
  for(let i=0;i<32;i++){const minute=480+i*15;if(!workforceAvailable(w,date,minute)||busy.some(b=>b.startMinute<minute+15&&minute<b.endMinute))slots.push(i);}
  for(let i=0;i<slots.length;){const start=slots[i++];let end=start+1;while(slots[i]===end){i++;end++;}
   blocks.push({start:dateSlot(date)+start,duration:end-start,staff:1,capacityDemands:{[`${center}:${w.role==='OPERATOR'?'operators':'workers'}`]:1}});
  }
 }
 // The solver consumes capacity totals, not the identity of an unavailable
 // person. Combine identical intervals so a shared part-time calendar does
 // not exceed the solver's block limit solely because it covers more people.
 const combined=new Map<string,NonNullable<SchedulingContract['capacityBlocks']>[number]>();
 for(const block of blocks){
  const key=`${block.start}:${block.duration}`,existing=combined.get(key);
  if(!existing){combined.set(key,{...block,capacityDemands:{...block.capacityDemands}});continue;}
  existing.staff+=block.staff;
  for(const [pool,count] of Object.entries(block.capacityDemands))existing.capacityDemands[pool]=(existing.capacityDemands[pool]??0)+count;
 }
 return [...combined.values()];
}
export function workforceDaySummary(state:State,date:string){
 const r=state.permanentWorkforce;if(!r)return null;
 const busy=[...(state.laborCapacity?.outgoing??[]).filter(w=>w.status==='CONFIRMED'),...(state.laborCapacity?.absences??[])];
 const hours=(role:'OPERATOR'|'WORKER')=>r.workers.filter(w=>w.role===role).reduce((n,w)=>n+Array.from({length:32},(_,i)=>480+i*15).filter(m=>workforceAvailable(w,date,m)&&!busy.some(a=>a.workerId===w.workerId&&a.date===date&&a.startMinute<m+15&&m<a.endMinute)).length/4,0);
 return {registeredPeople:r.registeredPeople,permanentPeople:r.workers.length,ordinaryHours:hours('WORKER'),operatorHours:hours('OPERATOR'),basis:'CONFIRMED_WORK_CALENDAR' as const,attendanceConfirmed:false as const};
}
