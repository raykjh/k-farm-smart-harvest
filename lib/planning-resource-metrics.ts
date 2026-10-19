import type {State} from './types';
import type {calculateAnnualReplan} from './annual-replanning';
import {isClosedTask} from './task-lifecycle';
import {slotDate} from './scheduling-engine';
import {isReserveSupport} from './center-reserve';

/** Compare the same whole-center future plan, not different solver scopes.
 * Work minutes only: rates, travel and resulting yield/profit are not inferred. */
export function planningResourceMetrics(state:State,result:Awaited<ReturnType<typeof calculateAnnualReplan>>,asOf:string){
 const effective=new Map(state.missions.map(m=>[m.id,m]));
 for(const change of result.diff){
  const source=effective.get(change.id)??state.missions.find(m=>m.id===change.sourceId);
  if(!source)throw Error('대안 자원 집계의 원본 작업이 없습니다.');
  effective.set(change.id,{...source,id:change.id,scheduledDate:slotDate(change.after),resourceId:change.afterResource,duration:change.afterDuration,laborSupportIds:change.afterLaborSupport});
 }
 let borrowedEquipmentMinutes=0,supportPersonMinutes=0;
 for(const m of effective.values()){
  if(m.resourceOccupancyOnly||isClosedTask(m.status)||!m.scheduledDate||m.scheduledDate<asOf)continue;
  const machine=state.machines.find(r=>r.id===m.resourceId);
  if(machine?.ownerCenterId&&machine.ownerCenterId!==(state.centerSharing?.centerId??'demo'))borrowedEquipmentMinutes+=m.duration*15;
  supportPersonMinutes+=(m.laborSupportIds?.filter(id=>!isReserveSupport(id)).length??0)*m.duration*15;
 }
 return {borrowedEquipmentMinutes,supportPersonMinutes};
}
