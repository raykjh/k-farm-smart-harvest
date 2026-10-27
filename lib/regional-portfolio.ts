import type {JointField,JointProposal,JointSnapshot} from './integrated-plan';
import type {ProductionContribution} from './production-coordination';
import {candidateLimitCheck,productionLimitUsage,type ProductionLimit} from './production-limits';
import {reviewPlanContribution} from './production-coordination-store';

function context(snapshot:JointSnapshot){
 const contributions=new Map<string,ProductionContribution>(),limits=new Map<string,ProductionLimit>();
 for(const s of snapshot.sources){
  for(const c of s.coordination.contributions){
   const old=contributions.get(c.id);if(old&&JSON.stringify(old)!==JSON.stringify(c))throw Error('센터별 생산량 기준 불일치');
   contributions.set(c.id,c);
  }
  for(const r of s.coordination.policy.planningLimits??[]){
   const old=limits.get(r.id);if(old&&JSON.stringify(old)!==JSON.stringify(r))throw Error('센터별 참여 생산 목표 불일치');
   limits.set(r.id,r);
  }
 }
 return {entries:[...contributions.values()],limits:[...limits.values()],today:snapshot.sources.map(s=>s.today).sort()[0]};
}
const area=(field:JointField)=>field.options[0]?.plan.plan.plots.reduce((n,p)=>n+p.area,0)??0;
/** Deterministic, scarce-options-first lookahead. This is a candidate envelope,
 * not a proof of jointly schedulable future work or an optimal allocation. The
 * common scheduler still evaluates and approves only the current small batch. */
export function regionalPortfolio(snapshot:JointSnapshot,fixed?:JointProposal){
 const c=context(snapshot),entries=[...c.entries],chosen=new Map<string,string>(),deferred:string[]=[];
 const all=snapshot.allFields??snapshot.fields;
 const current=new Set(snapshot.fields.map(f=>f.id));
 let constrainedAreaM2=0;
 const rows=all.map(f=>({f,options:[...f.options].filter(o=>o.ready).sort((a,b)=>b.score-a.score||a.crop.localeCompare(b.crop)||a.profileId.localeCompare(b.profileId))}));
 const fixedRows=fixed?.choices.map(p=>({field:all.find(f=>f.id===p.field)!,option:p.option}))??[];
 for(const {field,option} of fixedRows){
  const o=field?.options.find(o=>o.id===option);if(!o)throw Error('지역 계획의 고정 선택 오류');
  chosen.set(field.id,o.id);
  if(o.coordination)entries.push(o.coordination.production);
 }
 const violations=c.limits.map(r=>productionLimitUsage(r,entries,c.today));
 for(const {f,options} of rows.filter(r=>!chosen.has(r.f.id)).sort((a,b)=>a.options.length-b.options.length||a.f.id.localeCompare(b.f.id,undefined,{numeric:true}))){
  const source=snapshot.sources.find(s=>s.scopeId===f.centerId)!;
  const match=options.find(o=>{
   if(!o.coordination)return true;
   if(candidateLimitCheck(o.coordination.production,entries,c.limits,c.today).blocked)return false;
   if(!o.plan.plan.context?.variety)return true;
   const review=reviewPlanContribution(o.plan.plan,{id:o.coordination.production.id,centerId:f.centerId,crop:o.crop,origin:o.coordination.production.origin},source.coordination.policy,c.today,entries);
   return review.variety?.eligible===true;
  });
  if(match){chosen.set(f.id,match.id);if(match.coordination)entries.push(match.coordination.production);constrainedAreaM2+=area(f);}
  else deferred.push(f.id);
 }
 // Do not label fixed fields feasible when a chosen option cannot be scheduled
 // or its hard target cannot be met. The separately returned preview is only
 // for the remaining, already registered fields.
 const remaining=all.filter(f=>!current.has(f.id));
 const remainingCandidateAreaM2=remaining.filter(f=>chosen.has(f.id)).reduce((n,f)=>n+area(f),0);
 const remainingDeferredAreaM2=remaining.filter(f=>!chosen.has(f.id)).reduce((n,f)=>n+area(f),0);
 const groups=new Map<string,{crops:string[];fields:number;areaM2:number}>();
 for(const f of remaining){const crops=[...new Set(f.options.filter(o=>o.ready).map(o=>o.crop))].sort(),key=crops.join(',');const g=groups.get(key)??{crops,fields:0,areaM2:0};g.fields++;g.areaM2+=area(f);groups.set(key,g);}
 return {scope:'KNOWN_UNCONFIRMED_PARTICIPANTS' as const,method:'SCARCE_OPTIONS_FIRST_V1' as const,
  jointlyScheduled:false as const,remainingFields:remaining.length,remainingCandidateAreaM2,remainingDeferredAreaM2,
  candidateAreaM2:constrainedAreaM2,selectedChoices:snapshot.fields.map(f=>({field:f.id,option:chosen.get(f.id)??f.options[0].id})),
  selectedDeferred:snapshot.fields.filter(f=>deferred.includes(f.id)).map(f=>f.id),
  remainingGroups:[...groups.values()].sort((a,b)=>b.fields-a.fields).slice(0,30),remainingGroupsOmitted:Math.max(0,groups.size-30),
  limits:violations,hardLimitViolations:violations.filter(r=>r.mode==='HARD'&&r.status!=='WITHIN_REFERENCE'&&fixedRows.some(({field,option})=>{
   const p=field.options.find(o=>o.id===option)?.coordination?.production;
   return p&&candidateLimitCheck(p,c.entries,c.limits,c.today).rows.some(v=>v.id===r.id);
  })).length};
}

export function regionalRuleProposal(snapshot:JointSnapshot):JointProposal{
 return {staffing:'CORE_AND_PEAK',choices:regionalPortfolio(snapshot).selectedChoices};
}
