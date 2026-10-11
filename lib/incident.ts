import {isClosedTask} from './task-lifecycle';
import type {State} from './types';
import {simulationImpact} from './simulation';
export type IncidentKind='WIND'|'RAIN'|'DROUGHT'|'BREAKDOWN'|'ABSENCE';
export function affectedByIncident(state:State,kind:IncidentKind,day:string,machineId?:string){
 const tasks=state.missions.filter(m=>m.scheduledDate===day&&!isClosedTask(m.status)&&m.status!=='UNSTAFFED');
 const affected=kind==='BREAKDOWN'?tasks.filter(m=>m.resourceId===machineId):kind==='WIND'||kind==='RAIN'?tasks.filter(m=>simulationImpact(m,{kind,from:day,to:day},day)):[];
 return {ids:affected.map(m=>m.id),unchanged:tasks.filter(m=>!affected.includes(m)).map(m=>m.id)};
}
