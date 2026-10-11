import {z} from 'zod';
import type {compareReplanAlternatives} from './planning-decision';
import {decisionMetrics,priorityMetrics} from './planning-priority';

export const RATIONALE_VERSION='planning-rationale-v1';
export const rejectionReasons=['PRIORITY','SCOPE_TIEBREAK','ID_TIEBREAK','INFEASIBLE','NOT_VERIFIED'] as const;
export const selectionReasons=['ONLY_ELIGIBLE','COMPARATIVE'] as const;
type Metric=typeof decisionMetrics[number];
type Comparison=Awaited<ReturnType<typeof compareReplanAlternatives>>;
type Alternative=Comparison['results'][number];
export const rationaleSchema=z.object({
 contractVersion:z.literal(RATIONALE_VERSION),selectionReason:z.enum(selectionReasons),
 rejections:z.array(z.object({alternativeId:z.string().min(1).max(80),reason:z.enum(rejectionReasons),metric:z.enum(decisionMetrics).nullable()}).strict()).max(5),
}).strict();
export type Rationale=z.infer<typeof rationaleSchema>;
export type EvidenceRef={alternativeId:string;metric:Metric;value?:number};
export type RationaleIssue={code:'MISSING_RATIONALE'|'WRONG_SELECTION_REASON'|'MISSING_REJECTION'|'DUPLICATE_REJECTION'|'UNKNOWN_REJECTION'|'WRONG_REJECTION_REASON'|'WRONG_DECISIVE_METRIC'|'MISSING_COMPARISON_EVIDENCE'|'PRIORITY_CONTRADICTION'|'TIEBREAK_CONTRADICTION'|'INVALID_EVIDENCE';alternativeId?:string;metric?:Metric};
export type PairwiseReason={alternativeId:string;reason:typeof rejectionReasons[number];metric:Metric|null;selectedValue?:number;rejectedValue?:number;outcome:'BETTER'|'WORSE'|'INFEASIBLE'|'NOT_VERIFIED'};
export type RationaleCheck={contractVersion:typeof RATIONALE_VERSION;source:'MODEL'|'RULES';status:'VERIFIED'|'INVALID';selectionReason:typeof selectionReasons[number];issues:RationaleIssue[];comparisons:(PairwiseReason&{claimedReason:typeof rejectionReasons[number]|null;claimedMetric:Metric|null;verified:boolean})[]};
const scopeCost=(r:Alternative)=>r.previewRequest?.scope==='PRESERVE'?0:r.previewRequest?.scope==='EXPAND'?2:1;

/** All priorities are lexicographic. Candidate order never breaks a tie. */
export function rationaleContext(comparison:Comparison){
 const feasible=comparison.results.filter(r=>r.status==='FEASIBLE'&&r.metrics&&comparison.nonDominatedIds.includes(r.id));
 const priority=feasible[0]?.previewRequest?.decisionPriority??'DEFAULT';
 const preferred=feasible.some(r=>!!r.previewRequest?.preferred),keys=priorityMetrics(priority,preferred);
 if(new Set(comparison.results.map(r=>r.id)).size!==comparison.results.length)throw Error('대안 ID가 중복되었습니다. 다시 계산하세요.');
 if(feasible.some(r=>(r.previewRequest?.decisionPriority??'DEFAULT')!==priority))throw Error('서로 다른 판단 우선순위가 섞였습니다. 다시 비교하세요.');
 if(new Set(feasible.map(r=>r.previewRequest?.preferred??'')).size>1)throw Error('서로 다른 희망일 기준을 섞어 비교할 수 없습니다. 같은 희망일로 다시 비교하세요.');
 if(comparison.results.some(r=>r.status==='FEASIBLE'&&(!r.metrics||keys.some(k=>!Number.isFinite(r.metrics![k])||r.metrics![k]<0))))throw Error('자원 비교 기준이 변경되었습니다. 대안을 다시 계산하세요.');
 const compare=(a:Alternative,b:Alternative)=>{for(const k of keys){const d=a.metrics![k]-b.metrics![k];if(d)return d;}return scopeCost(a)-scopeCost(b)||a.id.localeCompare(b.id);};
 return {feasible,priority,preferred,keys,ranked:[...feasible].sort(compare)};
}

export function pairwiseReasons(comparison:Comparison,selectedId:string):PairwiseReason[]{
 const context=rationaleContext(comparison),selected=context.feasible.find(r=>r.id===selectedId);
 if(!selected)throw Error('AI가 검증되지 않은 대안을 선택했습니다. 승인하지 않았습니다.');
 return comparison.results.filter(r=>r.id!==selectedId).map(r=>{
  if(r.status==='BLOCKED')return {alternativeId:r.id,reason:'NOT_VERIFIED',metric:null,outcome:'NOT_VERIFIED'};
  if(r.status==='NO_FEASIBLE_PLAN')return {alternativeId:r.id,reason:'INFEASIBLE',metric:null,outcome:'INFEASIBLE'};
  const metric=context.keys.find(k=>selected.metrics![k]!==r.metrics![k]);
  if(metric)return {alternativeId:r.id,reason:'PRIORITY',metric,selectedValue:selected.metrics![metric],rejectedValue:r.metrics![metric],outcome:selected.metrics![metric]<r.metrics![metric]?'BETTER':'WORSE'};
  const scopeDifference=scopeCost(selected)-scopeCost(r);
  return {alternativeId:r.id,reason:scopeDifference?'SCOPE_TIEBREAK':'ID_TIEBREAK',metric:null,outcome:(scopeDifference||selected.id.localeCompare(r.id))<0?'BETTER':'WORSE'};
 });
}

/** Checks claims against computed facts; it never repairs the model's choice. */
export function checkRationale(comparison:Comparison,selectedId:string,evidence:EvidenceRef[],claim:unknown,source:'MODEL'|'RULES'):RationaleCheck{
 const context=rationaleContext(comparison),expected=pairwiseReasons(comparison,selectedId),parsed=rationaleSchema.safeParse(claim);
 const selectionReason=context.feasible.length===1?'ONLY_ELIGIBLE':'COMPARATIVE';
 const issues:RationaleIssue[]=[];
 if(!parsed.success)issues.push({code:'MISSING_RATIONALE'});
 else if(parsed.data.selectionReason!==selectionReason)issues.push({code:'WRONG_SELECTION_REASON'});
 const rejections=parsed.success?parsed.data.rejections:[];
 for(const r of rejections)if(!expected.some(e=>e.alternativeId===r.alternativeId))issues.push({code:'UNKNOWN_REJECTION',alternativeId:r.alternativeId});
 const cites=(id:string,metric:Metric)=>evidence.some(e=>e.alternativeId===id&&e.metric===metric);
 if(!evidence.some(e=>e.alternativeId===selectedId)||evidence.some(e=>{const a=comparison.results.find(r=>r.id===e.alternativeId);return a?.status!=='FEASIBLE'||!Number.isFinite(a.metrics?.[e.metric])||(e.value!==undefined&&e.value!==a.metrics![e.metric]);}))issues.push({code:'INVALID_EVIDENCE'});
 const comparisons=expected.map(fact=>{
  const start=issues.length,matches=rejections.filter(r=>r.alternativeId===fact.alternativeId),r=matches[0];
  if(!r)issues.push({code:'MISSING_REJECTION',alternativeId:fact.alternativeId});
  if(matches.length>1)issues.push({code:'DUPLICATE_REJECTION',alternativeId:fact.alternativeId});
  if(r&&r.reason!==fact.reason)issues.push({code:'WRONG_REJECTION_REASON',alternativeId:fact.alternativeId});
  if(r&&r.metric!==fact.metric)issues.push({code:'WRONG_DECISIVE_METRIC',alternativeId:fact.alternativeId,...(fact.metric?{metric:fact.metric}:{})});
  if(fact.metric&&(!cites(selectedId,fact.metric)||!cites(fact.alternativeId,fact.metric)))issues.push({code:'MISSING_COMPARISON_EVIDENCE',alternativeId:fact.alternativeId,metric:fact.metric});
  if(fact.outcome==='WORSE')issues.push({code:fact.metric?'PRIORITY_CONTRADICTION':'TIEBREAK_CONTRADICTION',alternativeId:fact.alternativeId,...(fact.metric?{metric:fact.metric}:{})});
  return {...fact,claimedReason:r?.reason??null,claimedMetric:r?.metric??null,verified:issues.length===start};
 });
 return {contractVersion:RATIONALE_VERSION,source,status:issues.length?'INVALID':'VERIFIED',selectionReason,issues,comparisons};
}

/** Transparent rule explanations, never represented as model-produced claims. */
export function ruleRationale(comparison:Comparison,selectedId:string){
 const context=rationaleContext(comparison),pairs=pairwiseReasons(comparison,selectedId);
 const refs:EvidenceRef[]=[{alternativeId:selectedId,metric:context.keys[0]}];
 for(const p of pairs)if(p.metric)refs.push({alternativeId:selectedId,metric:p.metric},{alternativeId:p.alternativeId,metric:p.metric});
 const evidence=[...new Map(refs.map(e=>[e.alternativeId+':'+e.metric,e])).values()];
 const rationale:Rationale={contractVersion:RATIONALE_VERSION,selectionReason:context.feasible.length===1?'ONLY_ELIGIBLE':'COMPARATIVE',rejections:pairs.map(p=>({alternativeId:p.alternativeId,reason:p.reason,metric:p.metric}))};
 return {evidence,rationale};
}
