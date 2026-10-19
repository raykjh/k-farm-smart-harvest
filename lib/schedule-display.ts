import type {Mission,State,Machine} from './types';

export function equipmentLabel(machine:Machine|undefined,id:string,ko=true){
 const model=(machine as Machine&{ledger?:{model?:string}}|undefined)?.ledger?.model?.trim();
 const name=machine?.name?.trim();
 return model&&name&&model!==name?`${model} (${name})`:model||name||`${ko?'장비':'Equipment'} (${id})`;
}
export function taskResourceLabel(state:State,m:Pick<Mission,'resourceId'>,ko=true){
 return m.resourceId?equipmentLabel(state.machines.find(x=>x.id===m.resourceId),m.resourceId,ko):ko?'인력':'Labor';
}
type ScheduleSnapshot={date:string|null;resource:string;resourceId:string|null;minutes:number;startMinute?:number};
export type ScheduleChangeRow={id:string;field:string;crop:string;task:string;before:ScheduleSnapshot;after:ScheduleSnapshot;changed:('date'|'equipment'|'time'|'added')[]};
export function changedResourceLabel(value:ScheduleSnapshot,other:ScheduleSnapshot,ko=true){
 const label=value.resource==='인력'?(ko?'인력':'Labor'):value.resource;
 return value.resourceId&&value.resourceId!==other.resourceId&&value.resource===other.resource?`${label} · ${value.resourceId}`:label;
}
export function scheduleTimeLabel(value:ScheduleSnapshot,ko=true){
 if(value.startMinute===undefined)return `${value.minutes}${ko?'분':' min'}`;
 const clock=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 return `${clock(value.startMinute)}–${clock(value.startMinute+value.minutes)}`;
}
export function scheduleChangeRows(before:State,after:State,ids:string[]):ScheduleChangeRow[]{
 return ids.flatMap(id=>{
  const old=before.missions.find(m=>m.id===id),next=after.missions.find(m=>m.id===id);if(!next)return [];
  const snapshot=(s:State,m:Mission|undefined)=>({date:m?.scheduledDate??null,resource:m?taskResourceLabel(s,m):'—',resourceId:m?.resourceId??null,minutes:m?.duration?m.duration*15:0,...(m?{startMinute:480+(m.start%32)*15}:{})});
  const a=snapshot(before,old),b=snapshot(after,next),changed:ScheduleChangeRow['changed']=[];
  if(!old)changed.push('added');else{if(a.date!==b.date)changed.push('date');if(a.resourceId!==b.resourceId)changed.push('equipment');if(a.startMinute!==b.startMinute||old.duration!==next.duration)changed.push('time');}
  return [{id,field:after.fields.find(f=>f.id===next.fieldId)?.address??next.fieldId,crop:next.crop,task:next.label,before:a,after:b,changed}];
 });
}
