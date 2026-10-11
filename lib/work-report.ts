import {isClosedTask} from './task-lifecycle';
import {executionStatus,type ExecutionView} from './execution-view';
import type {State} from './types';

export type ReportEvidence=ExecutionView & {recordId:string;version:number;updatedAt:string;actualStartedAt?:string|null;actualFinishedAt?:string|null;simulatedStartedAt?:string|null;confirmedBy?:string;confirmedAt?:string;ruleVersion?:string;stationId?:string};
export function buildWorkReport(state:State,evidence:ReportEvidence[],today:string){
 const rows=state.missions.map(m=>{
  const field=state.fields.find(f=>f.id===m.fieldId);
  const matching=evidence.filter(e=>e.missionId===m.id&&e.plannedDate===m.scheduledDate);
  const e=matching[0];
  const simulated=field?.source==='DEMO_ASSUMPTION'||e?.source==='DEMO_SIMULATION';
  const status=executionStatus(state,m,evidence);
  const finishedAt=simulated?e?.simulatedFinishedAt:e?.actualFinishedAt;
  const startedAt=simulated?e?.simulatedStartedAt:e?.actualStartedAt;
  const confirmed=status==='COMPLETED'&&!!finishedAt&&Number.isFinite(Date.parse(finishedAt))&&finishedAt.slice(0,10)<=today&&(simulated||!!(e?.confirmedBy&&e.confirmedAt));
  const elapsed=startedAt&&finishedAt?(Date.parse(finishedAt)-Date.parse(startedAt))/60000:NaN;
  return {schemaVersion:'work-report-v1',missionId:m.id,cultivationId:(m as typeof m&{cultivationId?:string}).cultivationId??null,fieldId:m.fieldId,crop:m.crop,task:m.label,source:simulated?'SIMULATED':'ACTUAL',status,confirmed,plannedDate:m.scheduledDate??null,originalPlannedDate:m.originalScheduledDate??m.scheduledDate??null,finishedAt:finishedAt??null,plannedMinutes:m.duration*15,executionMinutes:confirmed&&Number.isFinite(elapsed)&&elapsed>=0?elapsed:null,equipmentId:m.resourceId,plannedWorkers:m.staff,actualWorkers:null,actualCost:null,actualYield:null,confirmedBy:e?.confirmedBy??null,confirmedAt:e?.confirmedAt??null,ruleVersion:e?.ruleVersion??null,stationId:e?.stationId??null,evidenceId:e?.recordId??null,evidenceVersion:e?.version??null,evidenceUpdatedAt:e?.updatedAt??null,cancellation:m.cancellation??null,overdue:!isClosedTask(status)&&!!m.scheduledDate&&m.scheduledDate<today};
 });
 return {schemaVersion:'work-report-v1',asOf:today,planVersion:state.planVersion,rows};
}
export function summarizeWorkReport(rows:ReturnType<typeof buildWorkReport>['rows']){
 return {planned:rows.length,confirmed:rows.filter(r=>r.confirmed).length,completionNeedsEvidence:rows.filter(r=>r.status==='COMPLETED'&&!r.confirmed).length,cancelled:rows.filter(r=>r.status==='CANCELLED').length,unfinished:rows.filter(r=>!isClosedTask(r.status)).length,overdue:rows.filter(r=>r.overdue).length,rescheduled:rows.filter(r=>r.originalPlannedDate!==r.plannedDate).length};
}
