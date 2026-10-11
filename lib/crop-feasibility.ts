import type {AnnualPlan} from './annual-plan';
import type {State} from './types';
import {previewAnnualDispatch} from './annual-dispatch';
/** Candidates are alternatives, never simultaneous reservations. */
export async function compareCropFeasibility(candidates:{id:string;plan:AnnualPlan}[],state:State,asOf:string){
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw Error('후보 ID 중복');
 const assessments=[];
 for(const c of candidates){
  const result=await previewAnnualDispatch(c.plan,state,asOf);
  assessments.push({candidateId:c.id,status:result.feasibility.length>0&&result.feasibility.every(f=>f.status==='CAPACITY_FEASIBLE')?'CAPACITY_FEASIBLE':'INCOMPLETE',assigned:result.assignments.length,pending:result.pending,fields:result.feasibility,reserved:false,dispatch:result});
 }
 return assessments;
}
