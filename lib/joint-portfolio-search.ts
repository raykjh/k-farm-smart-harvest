import {evaluateJointProposal,type JointSnapshot,type JointEvaluation,type JointProposal} from './integrated-plan';

export const MAX_JOINT_CROP_COMBINATIONS=16;
const feasible=(e:JointEvaluation)=>e.metrics.hardLimitViolations===0&&e.metrics.missingTasks===0;
const proposalKey=(p:JointProposal)=>JSON.stringify({staffing:p.staffing,choices:[...p.choices].sort((a,b)=>a.field.localeCompare(b.field,undefined,{numeric:true}))});
export type JointPortfolioAudit={
 version:'bounded-crop-search-v1';maximumCombinations:number;combinations:number;
 status:'NOT_NEEDED'|'TOO_LARGE'|'NO_OPTIONS'|'COMPLETE';
 trials:{evaluationId:string;proposal:JointProposal;metrics:JointEvaluation['metrics']}[];
 offeredEvaluationIds:string[];reserved:false;
};

/** A small, complete search of individually ready crop options when the initial
 * field-by-field plan fails joint constraints. Larger spaces keep the existing
 * model workflow; never silently prune a field's candidates to fit this bound.
 * Every trial uses the same scheduler and is retained as evidence, not a write.
 * The model still chooses among the original and newly offered evaluations. */
export async function discoverJointAlternatives(snapshot:JointSnapshot,baseline:JointEvaluation,known:JointEvaluation[]){
 const audit:JointPortfolioAudit={version:'bounded-crop-search-v1',maximumCombinations:MAX_JOINT_CROP_COMBINATIONS,combinations:0,status:'NOT_NEEDED',trials:[],offeredEvaluationIds:[],reserved:false};
 if(feasible(baseline))return {audit,additions:[] as JointEvaluation[]};
 const rows=[...snapshot.fields].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})).map(f=>({f,options:f.options.filter(o=>o.ready).sort((a,b)=>a.crop.localeCompare(b.crop)||a.profileId.localeCompare(b.profileId)||a.id.localeCompare(b.id))}));
 if(rows.some(r=>!r.options.length)){audit.status='NO_OPTIONS';return {audit,additions:[] as JointEvaluation[]};}
 audit.combinations=rows.reduce((n,r)=>Math.min(MAX_JOINT_CROP_COMBINATIONS+1,n*r.options.length),1);
 if(audit.combinations>MAX_JOINT_CROP_COMBINATIONS){audit.status='TOO_LARGE';return {audit,additions:[] as JointEvaluation[]};}
 let choices:JointProposal['choices'][]=[[]];
 for(const {f,options} of rows)choices=choices.flatMap(c=>options.map(o=>[...c,{field:f.id,option:o.id}]));
 const cache=new Map(known.map(e=>[proposalKey(e.proposal),e]));
 const trials:JointEvaluation[]=[];
 for(const combination of choices){
  const proposal:JointProposal={choices:combination,staffing:baseline.proposal.staffing},key=proposalKey(proposal);
  const trial=cache.get(key)??await evaluateJointProposal(snapshot,proposal);
  trials.push(trial);audit.trials.push({evaluationId:trial.id,proposal:trial.proposal,metrics:trial.metrics});
 }
 // Offer a labor-efficient plan and, when different, a less concentrated mix.
 // This is candidate discovery, not an automatic approval or a profit ranking.
 const candidates=trials.filter(e=>feasible(e)&&!known.some(k=>k.id===e.id));
 const order=(a:JointEvaluation,b:JointEvaluation)=>b.metrics.horizonReadyAreaM2-a.metrics.horizonReadyAreaM2||a.metrics.personHours-b.metrics.personHours||a.metrics.largestCropShare-b.metrics.largestCropShare||proposalKey(a.proposal).localeCompare(proposalKey(b.proposal));
 candidates.sort(order);
 const first=candidates[0],second=first?[...candidates].filter(e=>e.id!==first.id).sort((a,b)=>b.metrics.horizonReadyAreaM2-a.metrics.horizonReadyAreaM2||a.metrics.largestCropShare-b.metrics.largestCropShare||order(a,b))[0]:undefined;
 const additions=[first,second].filter((e):e is JointEvaluation=>!!e);
 audit.offeredEvaluationIds=additions.map(e=>e.id);audit.status='COMPLETE';
 return {audit,additions};
}
