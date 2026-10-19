import {z} from 'zod';
import type {State,Mission} from './types';
import {immovable} from './replan-scope';
import {equipmentCode} from './equipment-code';
export const manualWorkAlternativeSchema=z.object({
 workers:z.number().int().min(1).max(50),minutesPer1000m2:z.number().positive().max(20000),setupMinutes:z.number().nonnegative().max(480),
 transport:z.number().int().min(0).max(10),simpleWorkConfirmed:z.literal(true),reviewedBy:z.string().trim().min(1),basis:z.enum(['REVIEWED','DEMO_INPUT']),sourceRef:z.string().trim().min(1).max(2000),
}).strict();
export type ManualWorkAlternative=z.infer<typeof manualWorkAlternativeSchema>;
export type ManualReviewIssue='FIELD'|'PARTICIPATION'|'PROTECTED'|'SPECIALIST';
export function manualReviewIssue(state:State,mission:Mission):ManualReviewIssue|null{
 const field=state.fields.find(f=>f.id===mission.fieldId),area=manualWorkArea(state,mission);
 if(!field||!Number.isFinite(area)||area<=0||area>field.area)return 'FIELD';
 if(field.mode!=='완전 위탁형')return 'PARTICIPATION';
 if(immovable(mission)||String(mission.status)==='WORKING')return 'PROTECTED';
 const operation=(mission as Mission&{operationCode?:string}).operationCode??'';
 const machine=state.machines.find(m=>m.id===mission.resourceId);
 const kind=(machine as typeof machine&{ledger?:{kind?:string}})?.ledger?.kind??machine?.type;
 if(['treat','spray','drive','transport'].includes(operation)||['DR','SP','TV'].includes(kind??'')||mission.resourceId&&/(DR|SP|TV)\d+$/.test(equipmentCode(mission.resourceId)))return 'SPECIALIST';
 return null;
}
export function manualWorkArea(state:State,mission:Mission){
 // A split package uses its recorded area, never the whole parcel again.
 return (mission as Mission&{workAreaM2?:number}).workAreaM2??state.fields.find(f=>f.id===mission.fieldId)?.area??0;
}
export function manualWorkRequirement(state:State,mission:Mission){
 const parsed=manualWorkAlternativeSchema.safeParse(mission.manualAlternative),field=state.fields.find(f=>f.id===mission.fieldId);
 if(!parsed.success||!field||manualReviewIssue(state,mission))return null;
 const rule=parsed.data;if(rule.basis==='DEMO_INPUT'&&field.source!=='DEMO_ASSUMPTION')return null;
 const duration=Math.ceil((manualWorkArea(state,mission)/1000*rule.minutesPer1000m2+rule.setupMinutes)/15);
 return {...rule,duration,personMinutes:rule.workers*duration*15};
}
export function withManualFallback(state:State,ids:string[]){
 const next=structuredClone(state),conversions:string[]=[];
 for(const m of next.missions.filter(m=>ids.includes(m.id)&&m.resourceId)){
  const rule=manualWorkRequirement(next,m);
  // Multi-day manual methods need explicit daily work packages, not invented
  // speedups or an unbounded worker count to force a one-day result.
  if(!rule||rule.duration>32)continue;
  m.resourceId=null;m.owner='센터 인력';m.staff=rule.workers;m.ordinaryWorkers=rule.workers;m.machineOperators=0;m.farmerWorkers=0;m.operatorIds=[];m.laborSupportIds=[];
  m.duration=rule.duration;m.transport=rule.transport;
  if(m.planningWindow)m.planningWindow={...m.planningWindow,duration:m.duration};
  m.executionMethod='MANUAL';conversions.push(m.id);
 }return {state:next,conversions};
}
