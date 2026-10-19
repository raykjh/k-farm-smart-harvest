import type {Mission,State} from './types';
import {isClosedTask} from './task-lifecycle';
import {taskCrewStaff} from './planned-labor-demand';
type ScopedMission=Mission&{planningLocked?:boolean;executionStartedAt?:string;safetyLock?:boolean;planningWindow?:{from:string;to:string};predecessorMissionIds?:string[]};
export const immovable=(m:Mission)=>isClosedTask(m.status)||!!m.resourceOccupancyOnly||!!(m as ScopedMission).planningLocked||!!(m as ScopedMission).executionStartedAt||!!(m as ScopedMission).safetyLock;
/** Minimal connected conflict scope inside the already-scoped home-center state.
 * Shared resource/person/windows, saturated crew/transport or dependencies only. */
export function relatedReplanIds(s:State,ids:string[],asOf:string){
 const related=new Set(ids),candidates=(s.missions as ScopedMission[]).filter(m=>!immovable(m)&&m.scheduledDate&&m.scheduledDate>=asOf);
 let expanded=true;while(expanded){expanded=false;
  for(const m of candidates){if(related.has(m.id))continue;
   for(const a of s.missions.filter(t=>related.has(t.id)) as ScopedMission[]){
    const dep=m.predecessorMissionIds?.includes(a.id)||a.predecessorMissionIds?.includes(m.id);
    const from=m.planningWindow?.from??m.scheduledDate!,to=m.planningWindow?.to??m.scheduledDate!,af=a.planningWindow?.from??a.scheduledDate!,at=a.planningWindow?.to??a.scheduledDate!;
    const overlaps=from<=at&&af<=to;
    const sameMachine=!!m.resourceId&&m.resourceId===a.resourceId;
    const sameField=!!m.fieldId&&m.fieldId===a.fieldId;
    const sameOperator=(m.operatorIds?.some(id=>a.operatorIds?.includes(id))??false)||(m.laborSupportIds?.some(id=>a.laborSupportIds?.includes(id))??false);
    const overlapGroup=candidates.filter(t=>(t.planningWindow?.from??t.scheduledDate!)<=at&&af<=(t.planningWindow?.to??t.scheduledDate!));
    const capacity=(overlapGroup.reduce((n,t)=>n+taskCrewStaff(t),0)>s.staffCount)||(m.transport>0&&a.transport>0&&overlapGroup.reduce((n,t)=>n+t.transport,0)>s.transportCount);
    if(dep||overlaps&&(sameField||sameMachine||sameOperator||capacity)){related.add(m.id);expanded=true;break;}
   }
  }
 }return related;
}
