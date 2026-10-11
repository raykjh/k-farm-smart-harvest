import type {Mission,State} from './types';
export type ExecutionView={missionId:string;source:string;plannedDate:string;assessment:string;simulatedFinishedAt?:string|null;actualStartedAt?:string|null;simulatedStartedAt?:string|null};
export function executionStatus(state:State,mission:Mission,history:ExecutionView[]){
 if(mission.status==='CANCELLED')return 'CANCELLED';
 const demo=state.fields.find(f=>f.id===mission.fieldId)?.source==='DEMO_ASSUMPTION';
 const record=history.find(r=>r.source===(demo?'DEMO_SIMULATION':'ACTUAL')&&r.missionId===mission.id&&r.plannedDate===mission.scheduledDate);
 if(!record)return mission.status;
 return ['COMPLETED','SIMULATED_COMPLETED'].includes(record.assessment)?'COMPLETED':['HELD','SIMULATED_HELD'].includes(record.assessment)?'HELD':'UNKNOWN';
}
