import {recordSpace} from './workspace';
import {db} from './db';
import {executionStatus,type ExecutionView} from './execution-view';
import type {State} from './types';
export async function readExecutionHistory(client:Pick<typeof db,'$queryRaw'>=db){
 const rows=await client.$queryRaw<{payload:ExecutionView}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='taskExecutionAssessment' ORDER BY "updatedAt" DESC,id`;
 const seen=new Set<string>();return rows.map(r=>r.payload).filter(r=>{if(seen.has(r.missionId))return false;seen.add(r.missionId);return true});
}
export function planningState(raw:State,history:ExecutionView[]){
 const state=structuredClone(raw);
 for(const m of state.missions){const effective=executionStatus(raw,m,history);m.status=effective==='UNKNOWN'?'UNSTAFFED':effective;
  const source=state.fields.find(f=>f.id===m.fieldId)?.source==='DEMO_ASSUMPTION'?'DEMO_SIMULATION':'ACTUAL';
  const evidence=history.find(r=>r.source===source&&r.missionId===m.id&&r.plannedDate===m.scheduledDate);
  const started=source==='ACTUAL'?evidence?.actualStartedAt:evidence?.simulatedStartedAt;
  if(started)(m as typeof m&{executionStartedAt?:string}).executionStartedAt=started;
 }
 return state;
}
