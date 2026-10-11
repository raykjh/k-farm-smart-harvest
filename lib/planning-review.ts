import {hash,type ReplanInput} from './annual-replanning';
import {replanRequest,type compareReplanAlternatives} from './planning-decision';
import type {PlanningRecommendation} from './planning-adviser';
import {checkRationale} from './planning-rationale';
type Comparison=Awaited<ReturnType<typeof compareReplanAlternatives>>;
// PostgreSQL JSONB reorders object keys. Compare semantic inputs, not key order.
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const requestFingerprint=(input:ReplanInput)=>hash(canonical(replanRequest(input)));
export type PlanningReview={comparison:Comparison;recommendation:PlanningRecommendation;baseline?:PlanningRecommendation;historyHash:string;expires:number};
export function verifyPlanningReview(review:PlanningReview,input:ReplanInput,alternativeId:string,snapshotId:string,historyHash:string,now=Date.now()){
 if(review.expires<now||review.comparison.snapshot.id!==snapshotId||review.historyHash!==historyHash)throw Error('판단 이후 계획·실적·기상이 변경되었거나 만료되었습니다. 다시 비교하세요.');
 const choice=review.comparison.results.find(r=>r.id===alternativeId);
 if(choice?.status!=='FEASIBLE'||!choice.previewRequest||requestFingerprint(input)!==requestFingerprint(choice.previewRequest))throw Error('선택 대안과 요청이 다릅니다. 다시 비교하세요.');
 const recommendation=review.recommendation;
 // Re-evaluate saved claims, including legacy records, rather than trusting a
 // cached VERIFIED flag. An explicit human choice remains possible and visible.
 const rationaleCheck=recommendation.alternativeId?checkRationale(review.comparison,recommendation.alternativeId,recommendation.evidence,recommendation.rationale,recommendation.source==='NEBIUS'?'MODEL':'RULES'):undefined;
 const overridden=recommendation.alternativeId!==alternativeId;
 const selectionBasis=recommendation.source==='NEBIUS'&&!overridden&&rationaleCheck?.status==='VERIFIED'?'VERIFIED_AI':recommendation.source==='RULES'&&!overridden?'RULE_BASELINE':'OPERATOR_REVIEW';
 return {alternativeId,recommendation:{...recommendation,rationaleCheck},overridden,selectionBasis};
}
