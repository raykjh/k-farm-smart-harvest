import type {Mission,State} from './types';
export type ExecutionView={missionId:string;source:string;plannedDate:string;assessment:string;simulatedFinishedAt?:string|null;actualStartedAt?:string|null;simulatedStartedAt?:string|null};
function projectedStatus(mission:Mission,record:ExecutionView|undefined){
 if(mission.status==='CANCELLED')return 'CANCELLED';
 if(!record)return mission.status;
 return ['COMPLETED','SIMULATED_COMPLETED'].includes(record.assessment)?'COMPLETED':['HELD','SIMULATED_HELD'].includes(record.assessment)?'HELD':'UNKNOWN';
}
export function executionStatus(state:State,mission:Mission,history:ExecutionView[]){
 if(mission.status==='CANCELLED')return 'CANCELLED';
 const demo=state.fields.find(f=>f.id===mission.fieldId)?.source==='DEMO_ASSUMPTION';
 const record=history.find(r=>r.source===(demo?'DEMO_SIMULATION':'ACTUAL')&&r.missionId===mission.id&&r.plannedDate===mission.scheduledDate);
 return projectedStatus(mission,record);
}
/** One snapshot lookup for bulk reports; retain first-match/date/source semantics. */
export function executionStatusLookup(state:State,history:ExecutionView[]){
 const fields=new Map<string,State['fields'][number]>();
 for(const field of state.fields)if(!fields.has(field.id))fields.set(field.id,field);
 const records=new Map<string,Map<string,Map<string|undefined,ExecutionView>>>();
 for(const record of history){
  let missions=records.get(record.source);if(!missions)records.set(record.source,missions=new Map());
  let dates=missions.get(record.missionId);if(!dates)missions.set(record.missionId,dates=new Map());
  if(!dates.has(record.plannedDate))dates.set(record.plannedDate,record);
 }
 return (mission:Mission)=>{
  const source=fields.get(mission.fieldId)?.source==='DEMO_ASSUMPTION'?'DEMO_SIMULATION':'ACTUAL';
  return projectedStatus(mission,records.get(source)?.get(mission.id)?.get(mission.scheduledDate));
 };
}
