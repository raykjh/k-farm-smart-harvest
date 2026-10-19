import {z} from 'zod';
import {calculateAnnualReplan,hash,slotDate,weatherHash,REPLANNING_RULE_VERSION,type ReplanInput} from './annual-replanning';
import type {State} from './types';
import type {ForecastResult} from './kma-forecast';
import {SCHEDULING_ENGINE_VERSION} from './scheduling-engine';
import {decisionMetrics} from './planning-priority';
import {planningResourceMetrics} from './planning-resource-metrics';

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const replanAlternativesSchema=z.array(z.object({
 id:z.string().trim().min(1).max(80),label:z.string().trim().min(1).max(120),
 preferred:day.nullable().optional(),scope:z.enum(['PRESERVE','EXPAND']).optional(),
 // Confirmation facts belong to the operator's base request, never the drafter.
 replacement:z.enum(['NONE','REQUESTED']).optional(),
 newLaborSupport:z.boolean().optional(),allowBorrowing:z.boolean().optional(),manualFallback:z.boolean().optional(),
}).strict()).min(1).max(6).refine(v=>new Set(v.map(x=>x.id)).size===v.length,'대안 ID 중복');
export type ReplanAlternative=z.infer<typeof replanAlternativesSchema>[number];
export const decisionSnapshot=(state:State,weather:ForecastResult,asOf:string)=>hash({engine:SCHEDULING_ENGINE_VERSION,replanning:REPLANNING_RULE_VERSION,state,weather:weatherHash(weather),asOf});
export const replanRequest=(request:ReplanInput):ReplanInput=>({manualFallback:request.manualFallback,deferAfter:request.deferAfter,outage:request.outage,allowBorrowing:request.allowBorrowing,searchMode:request.searchMode,ids:request.ids,day:request.day,preferred:request.preferred,reason:request.reason,scope:request.scope,replacement:request.replacement,simulation:request.simulation,...(request.automaticReplacement===false?{automaticReplacement:false}:{}),...(request.newLaborSupport===false?{newLaborSupport:false}:{}),...(request.decisionPriority?{decisionPriority:request.decisionPriority}:{})});

type Metrics={changedTasks:number;otherChangedTasks:number;resourceChanges:number;shiftDays:number;preferredDistanceDays:number;borrowedEquipmentMinutes:number;supportPersonMinutes:number};
type DecisionResult={
 id:string;label:string;status:'FEASIBLE'|'NO_FEASIBLE_PLAN'|'BLOCKED';reason?:string;
 metrics:Metrics|null;warnings:string[];result:Awaited<ReturnType<typeof calculateAnnualReplan>>|null;
 previewRequest:({action:'preview';decisionSource:'DEVELOPMENT_REVIEW';comparisonSnapshot:string}&ReplanInput)|null;
};

/** Read-only planning tools. A human/development assistant can supply alternatives;
 * a later model adapter must use this same contract, not write schedules itself. */
export async function compareReplanAlternatives(state:State,request:ReplanInput,alternatives:unknown,weather:ForecastResult,asOf:string){
 const options=replanAlternativesSchema.parse(alternatives);
 day.parse(asOf);
 const snapshot=structuredClone(state),forecast=structuredClone(weather);
 // Do not echo route metadata, alternatives or future model-only fields into preview.
 const base:ReplanInput=structuredClone(replanRequest(request));
 const snapshotId=decisionSnapshot(snapshot,forecast,asOf),selected=new Set(base.ids);
 const results:DecisionResult[]=[];
 for(const option of options){
  const input:ReplanInput={...base,
   preferred:option.preferred===null?undefined:option.preferred??base.preferred,
   scope:option.scope??base.scope,allowBorrowing:option.allowBorrowing??base.allowBorrowing,manualFallback:option.manualFallback??base.manualFallback,
   replacement:option.replacement==='NONE'?undefined:base.replacement,
   ...(option.replacement==='NONE'?{automaticReplacement:false}:{}),
   ...(option.newLaborSupport===false||base.newLaborSupport===false?{newLaborSupport:false}:{}),
  };
  try{
   if(option.replacement==='REQUESTED'&&!base.replacement)throw Error('담당자가 확인한 대체 장비 요청이 없습니다.');
   // Deliberately never calls an inference API, irrespective of AI_MODE.
   const result=await calculateAnnualReplan(snapshot,input,forecast,asOf);
   if(result.status!=='FEASIBLE'){
    const status=result.failureKind&&result.failureKind!=='INFEASIBLE'?'BLOCKED':'NO_FEASIBLE_PLAN';
    results.push({id:option.id,label:option.label,status,reason:result.reason,metrics:null,warnings:result.warnings,result,previewRequest:null});continue;
   }
   const diff=result.diff;
   const selectedIds=new Set(base.ids.flatMap(id=>result.workSplit?.find(s=>s.sourceId===id)?.partIds??[id]));
   const assignments=result.assignments as {id:string;start:number}[];
   const metrics:Metrics={...planningResourceMetrics(snapshot,result,asOf),changedTasks:diff.length,otherChangedTasks:diff.filter(d=>!selectedIds.has(d.id)).length,
    resourceChanges:diff.filter(d=>d.beforeResource!==d.afterResource).length,
    shiftDays:diff.reduce((n,d)=>n+Math.abs(Math.floor(d.after/32)-Math.floor(d.before/32)),0),
    preferredDistanceDays:input.preferred?assignments.filter(a=>selectedIds.has(a.id)).reduce((n,a)=>n+Math.abs(Date.parse(input.preferred!)-Date.parse(slotDate(a.start)))/86400000,0):0};
   results.push({id:option.id,label:option.label,status:'FEASIBLE',metrics,warnings:result.warnings,result,
    previewRequest:{...input,action:'preview',decisionSource:'DEVELOPMENT_REVIEW',comparisonSnapshot:snapshotId}});
   if(base.searchMode==='LOCAL_FIRST')break;
  }catch(e){results.push({id:option.id,label:option.label,status:'BLOCKED',reason:e instanceof Error?e.message:'계산 실패',metrics:null,warnings:[],result:null,previewRequest:null});}
 }
 // Do not compare different preferred dates as though they were one objective.
 const feasible=results.filter(r=>r.status==='FEASIBLE');
 const dominates=(a:DecisionResult,b:DecisionResult)=>{
  if(a.previewRequest?.preferred!==b.previewRequest?.preferred)return false;
  const keys=decisionMetrics;
  return keys.every(k=>a.metrics![k]<=b.metrics![k])&&keys.some(k=>a.metrics![k]<b.metrics![k]);
 };
 return {source:'DEVELOPMENT_REVIEW' as const,inferenceCalled:false,approval:'REQUIRED' as const,reserved:false,
  snapshot:{id:snapshotId,asOf,planVersion:snapshot.planVersion,ruleVersion:snapshot.ruleVersion,requestHash:hash(base)},
  results,nonDominatedIds:feasible.filter(r=>!feasible.some(other=>dominates(other,r))).map(r=>r.id),
  note:'대안별 동일 엔진 검증입니다. 실제 AI 호출·전역 최적해·예약·승인 완료가 아니며 선택한 안도 최신 자료로 다시 계산합니다.'};
}
