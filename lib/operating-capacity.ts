import type {Mission,State} from './types';
import {isClosedTask} from './task-lifecycle';
import {taskCrewStaff,ordinaryWorkerDemand} from './planned-labor-demand';

export type CrewCapacity={operators:number;workers:number};
type CrewMission=Pick<Mission,'owner'|'resourceId'|'staff'|'resourceOccupancyOnly'|'machineOperators'|'ordinaryWorkers'|'farmerWorkers'>;
const count=(n:number)=>Number.isInteger(n)&&n>=0;
export function crewCapacityLimits(state:State):Record<string,number>|undefined{
 const c=state.crewCapacity;if(!c)return;
 if(!count(c.operators)||!count(c.workers)||c.operators+c.workers>state.staffCount)throw Error('역할별 인원은 서로 중복 없이 전체 작업인원 이내여야 합니다.');
 const center=state.centerSharing?.centerId??'demo';
 return {[`${center}:operators`]:c.operators,[`${center}:workers`]:c.workers};
}

/** Unknown legacy machine crews occupy both qualified pools conservatively.
 * Neither an old staff count nor an account is evidence of operator training. */
export function operatingCrewDemands(state:State,m:CrewMission):Record<string,number>|undefined{
 if(!crewCapacityLimits(state))return;
 if(m.resourceOccupancyOnly)return {};
 const staff=taskCrewStaff(m),operators=m.machineOperators??0,workers=m.owner==='농부'?ordinaryWorkerDemand(m):m.ordinaryWorkers??0;
 if(!count(staff)||!count(operators)||!count(workers)||operators+workers>staff)throw Error('작업별 운영자·일반인력 수요 확인이 필요합니다.');
 const unknown=staff-operators-workers,center=state.centerSharing?.centerId??'demo';
 return {[`${center}:operators`]:operators+(m.resourceId?unknown:0),[`${center}:workers`]:workers+unknown};
}

/** Settings never silently invalidate a reservation that has already been approved. */
export function assertCrewCapacityFits(state:State,validatedSupportIds=new Set<string>()){
 const limits=crewCapacityLimits(state);if(!limits)return;
 const slots=new Map<string,Record<string,number>>();
 for(const m of state.missions){
  if(isClosedTask(m.status)||!m.scheduledDate||m.resourceOccupancyOnly)continue;
  const demands=operatingCrewDemands(state,m)??{},start=(m.start%32+32)%32;
  const workerPool=`${state.centerSharing?.centerId??'demo'}:workers`;
  demands[workerPool]=Math.max(0,(demands[workerPool]??0)-(m.laborSupportIds??[]).filter(id=>validatedSupportIds.has(id)).length);
  if(!Number.isInteger(start)||!Number.isInteger(m.duration)||m.duration<1||start+m.duration>32)throw Error('기존 작업의 시간 확인이 필요합니다.');
  for(let i=start;i<start+m.duration;i++){
   const key=m.scheduledDate+':'+i,used=slots.get(key)??{};
   for(const [pool,n] of Object.entries(demands)){
    used[pool]=(used[pool]??0)+n;
    if(used[pool]>limits[pool])throw Error(`${m.scheduledDate}: 기존 미완료 작업의 운영자·일반인력 한도가 부족합니다. 역할 확인·재계획 후 저장하세요.`);
   }
   slots.set(key,used);
  }
 }
}
