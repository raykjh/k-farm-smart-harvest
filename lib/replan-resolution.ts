import {makeContract,slotDate,type ReplanInput} from './annual-replanning';
import type {State} from './types';
import type {ForecastResult} from './kma-forecast';
import type {ResolutionNeed} from './automatic-replanning';
import {missionPrerequisites} from './mission-prerequisites';
import {withHarvestCarryover} from './harvest-carryover';

/** Actionable work to secure missing inputs/resources after applying the
 * explicit harvest carryover policy. Never fabricates people, purchases,
 * attendance replies or completed prerequisites. */
export function replanResolutionNeeds(state:State,input:ReplanInput,weather:ForecastResult,asOf:string):ResolutionNeed[]{
 state=withHarvestCarryover(state,input,asOf);
 let contract:ReturnType<typeof makeContract>['contract']|undefined;
 try{contract=makeContract(state,{...input,scope:'EXPAND',allowBorrowing:true},weather,asOf).contract}catch{/* Keep the task-level request even when a source record needs repair. */}
 return state.missions.filter(m=>input.ids.includes(m.id)).map(m=>{
  const steps:ResolutionNeed['steps']=[],notes:string[]=[],task=contract?.tasks.find(t=>t.id===m.id),window=m.planningWindow;
  let required:MissionDependency[]=[];
  try{required=missionPrerequisites(state,m,asOf).required}catch{steps.push('DATA');notes.push('선행 작업 연결을 확인합니다.');}
  if(required.some(p=>p.status==='CANCELLED'||p.status!=='COMPLETED'&&(!p.scheduledDate||p.scheduledDate<asOf))){
   steps.push('PREREQUISITE');notes.push('지난 선행 작업의 결과 기록 또는 함께 재배치할 범위를 확인합니다.');
  }
  if(window&&(input.deferAfter?window.to<=input.deferAfter:window.to<asOf)){steps.push('WINDOW');notes.push('저장된 작업기간이 지났습니다. 현장 생육에 따른 기간 재검토가 필요합니다.');}
  const machine=state.machines.find(x=>x.id===m.resourceId);
  if(m.resourceId){
   steps.push('BORROW','PROCUREMENT');
   notes.push(state.centerSharing?.neighborCenterIds.length?'인접 센터 차용 가능 기간·운영자·운송을 확인하고, 부족하면 추가 임대·구매를 요청합니다.':'인접 센터 경계·공유 조건을 연결한 뒤 차용을 확인합니다.');
  }else{steps.push('LABOR');notes.push('센터·인접 센터 인력과 참석 가능 인원을 확보합니다.');}
  if(!window&&!task){steps.push('DATA');notes.push('작업기간과 소요시간 기준을 연결합니다.');}
  const dates=(task?.options?.flatMap(o=>o.allowed.map(slotDate))??[]).sort();
  const originalFrom=window?.from??dates[0]??m.scheduledDate??asOf,to=window?.to??dates.at(-1)??m.scheduledDate??asOf;
  const earliest=[asOf,input.deferAfter?new Date(Date.parse(input.deferAfter)+86400000).toISOString().slice(0,10):'',originalFrom].sort().at(-1)!;
  // An expired recorded window remains visible as recorded, never as an
  // inverted or silently extended replacement date range.
  return {missionId:m.id,task:m.label,from:earliest<=to?earliest:originalFrom,to,equipment:machine?.type??m.resourceId,people:!m.resourceId?Math.max(1,m.ordinaryWorkers??m.staff):null,minutes:!m.resourceId?m.duration*15:null,steps,note:notes.join(' ')};
 });
}
type MissionDependency=State['missions'][number];
