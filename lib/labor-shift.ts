import type {State} from './types';
import {ordinaryWorkerDemand} from './planned-labor-demand';
import {immovable} from './replan-scope';

export const MIN_LABOR_SHIFT_MINUTES=240;
/** Reservation time, not an equipment result or measured elapsed work time. */
export const laborShiftSlots=(slots:number)=>Math.max(MIN_LABOR_SHIFT_MINUTES/15,slots);
export function withMinimumLaborShifts(state:State,ids:string[]):State{
 const selected=new Set(ids);
 return {...state,missions:state.missions.map(m=>{
  if(!selected.has(m.id)||immovable(m)||m.resourceId||!ordinaryWorkerDemand(m)||m.duration>=16||!m.planningWindow)return m;
  return {...m,laborWorkMinutes:m.laborWorkMinutes??m.duration*15,duration:16,planningWindow:{...m.planningWindow,duration:16}};
 })};
}
