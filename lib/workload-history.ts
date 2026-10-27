import type {AnnualPlan} from './annual-plan';
import type {ReportEvidence} from './work-report';
import type {LaborOps} from './labor-operations';
import type {FieldEntry} from './field-record';
import type {GuidelineContext} from './crop-guidelines';
import {isLegacyCrop,type SupportedCropCode} from './crop-registry';
import {operationRequirement} from './operation-requirements';

export type WorkloadObservation={id:string;fieldId:string;crop:SupportedCropCode;operation:string;conditionsKey:string;varietyId:string|null;origin:'ACTUAL'|'DEMO_SIMULATION';areaM2:number;crew:number;elapsedMinutes:number;completedOn:string};
const conditionKey=(c:FieldEntry['conditions'])=>c?JSON.stringify([c.region,c.landUse,c.growingEnvironment??'LEGACY_UNSPECIFIED',c.water,c.drainage,c.machineAccess]):'';
const kstDay=(v:string)=>Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+9*3600000).toISOString().slice(0,10):'9999-12-31';
/** Only effective completion records joined to completed, confirmed labor
 * results. Scheduled crew/headcount and COMPLETED alone cannot train a rate. */
export function workloadObservations(plans:AnnualPlan[],history:ReportEvidence[],ops:LaborOps|undefined,today:string):WorkloadObservation[]{
 if(!ops)return [];
 const tasks=new Map(plans.flatMap(plan=>plan.plots.flatMap(plot=>plot.tasks.map(task=>[task.id,{plan,plot,task}] as const))));
 const jobs=new Map(ops.jobs.filter(j=>j.status==='COMPLETED').map(j=>[j.missionId,j]));
 const result:WorkloadObservation[]=[],seen=new Set<string>();
 for(const e of history){
  if(seen.has(e.missionId))continue;seen.add(e.missionId);
  const row=tasks.get(e.missionId),job=jobs.get(e.missionId);
  if(!row||!job||!['COMPLETED','SIMULATED_COMPLETED'].includes(e.assessment)||!e.confirmedBy||!e.confirmedAt||kstDay(e.confirmedAt)>today||!job.completedAt||kstDay(job.completedAt)>today)continue;
  const {task,plot,plan}=row;
  if(task.requirements.machineCode||!['PROCESS','REPEAT'].includes(task.kind)||!plot.conditions||!isLegacyCrop(plot.crop))continue;
  const simulated=e.source==='DEMO_SIMULATION',started=simulated?e.simulatedStartedAt:e.actualStartedAt,finished=simulated?e.simulatedFinishedAt:e.actualFinishedAt;
  if((simulated&&e.assessment!=='SIMULATED_COMPLETED')||(!simulated&&(e.source!=='ACTUAL'||e.assessment!=='COMPLETED'))||!started||!finished)continue;
  const elapsed=(Date.parse(finished)-Date.parse(started))/60000,area=task.workAreaM2,crew=job.worked.length+(job.reserveWorked?.length??0);
  if(!Number.isFinite(elapsed)||elapsed<=0||elapsed>480||!Number.isFinite(area)||area<=0||crew!==Math.max(1,task.requirements.staff)||!crew)continue;
  if(new Set(job.worked).size!==job.worked.length||new Set(job.reserveWorked??[]).size!==(job.reserveWorked?.length??0)||job.worked.some(id=>!job.assigned.includes(id))||job.reserveWorked?.some(id=>!job.reserveSlots?.includes(id)))continue;
  if(ops.workExceptions?.some(x=>x.jobId===job.id)||!task.window||job.date<task.window.from||job.date>task.window.to||job.date!==e.plannedDate||kstDay(started)!==job.date||kstDay(finished)!==job.date||job.date>today)continue;
  if(!e.missionSnapshot||e.missionSnapshot.id!==task.id||e.missionSnapshot.resourceId!==null||e.missionSnapshot.scheduledDate!==job.date)continue;
  result.push({id:e.missionId,fieldId:plot.pnu,crop:plot.crop,operation:task.operationCode,conditionsKey:conditionKey(plot.conditions),varietyId:plan.context.variety?.id??null,origin:simulated?'DEMO_SIMULATION':'ACTUAL',areaM2:area,crew,elapsedMinutes:elapsed,completedOn:job.date});
 }
 return result;
}
export type WorkloadCalibration={operation:string;method:'MATCHED_HISTORY_MEDIAN_V1';samples:number;fields:number;oldMinutesPer1000m2:number;newMinutesPer1000m2:number;evidenceIds:string[];origin:WorkloadObservation['origin'];asOf:string};
const median=(rows:number[])=>{const s=[...rows].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
export function calibrateWorkload<T extends GuidelineContext>(context:T,field:FieldEntry,crop:SupportedCropCode,today:string,observations:WorkloadObservation[],origin:WorkloadObservation['origin']){
 const next=structuredClone(context),evidence:WorkloadCalibration[]=[];
 // Catalog coefficients and machine throughput have separate reviewed rules;
 // this first adapter calibrates elapsed manual work with unchanged crew only.
 if(context.catalog||!isLegacyCrop(crop)||!field.area||!field.conditions)return {context:next,evidence};
 for(const [operation,rule] of Object.entries(next.operations?.[crop]??{})){
  const req=operationRequirement(crop,operation,field.mode,rule);
  if(req.machineCode||!req.laborMinutesPer1000m2||!rule.from||rule.from<=today)continue;
  const matched=observations.filter(o=>o.crop===crop&&o.operation===operation&&o.origin===origin&&o.conditionsKey===conditionKey(field.conditions)&&o.varietyId===(context.variety?.id??null)&&o.crew===Math.max(1,req.staff)&&o.completedOn<rule.from!&&o.completedOn<=today&&o.areaM2>=field.area!*0.8&&o.areaM2<=field.area!*1.25).sort((a,b)=>b.completedOn.localeCompare(a.completedOn)||a.id.localeCompare(b.id)).slice(0,100);
  const unique=[...new Map(matched.map(o=>[o.id,o])).values()],fields=new Set(unique.map(o=>o.fieldId));
  if(unique.length<5||fields.size<3)continue;
  const rates=unique.map(o=>o.elapsedMinutes/o.areaM2*1000),rate=median(rates),deviation=median(rates.map(r=>Math.abs(r-rate)));
  const oldRate=req.laborMinutesPer1000m2+req.setupMinutes/field.area*1000;
  if(!Number.isFinite(rate)||rate<=0||rate<oldRate*0.5||rate>oldRate*2||deviation>rate*0.3)continue;
  // The observed rate includes setup. Do not add the old setup a second time.
  rule.laborMinutesPer1000m2=Math.round(rate*100)/100;rule.setupMinutes=0;
  evidence.push({operation,method:'MATCHED_HISTORY_MEDIAN_V1',samples:unique.length,fields:fields.size,oldMinutesPer1000m2:oldRate,newMinutesPer1000m2:rule.laborMinutesPer1000m2,evidenceIds:unique.map(o=>o.id),origin,asOf:today});
 }
 return {context:next,evidence};
}
