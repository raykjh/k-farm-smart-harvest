import {budgetedCompletion,APPROVED_MODEL} from './ai-budget';
import {compareCropFeasibility} from './crop-feasibility';
import {compareCropAlternatives} from './crop-decision';
import type {AnnualPlan} from './annual-plan';
import type {State} from './types';
/** Read-only AI tool. Candidate plans are server-built and cannot be rewritten by the model. */
export async function assessCropCandidates(candidates:{id:string;plan:AnnualPlan}[],state:State,asOf:string){
 const calculate=async ()=>(await compareCropFeasibility(candidates,state,asOf));
 if(process.env.AI_MODE!=='nebius'||process.env.AI_CALL_SCOPE==='decisions')return {source:'RULES',results:await calculate(),approval:'REQUIRED',reserved:false};
 const response=await budgetedCompletion({model:APPROVED_MODEL,max_tokens:250,temperature:0.1,messages:[{role:'system',content:'Call compare_crop_feasibility exactly once with no arguments. This tool only evaluates server-provided crop plans. You cannot change constraints, choose a crop, reserve resources or approve anything.'},{role:'user',content:JSON.stringify({candidateIds:candidates.map(c=>c.id),asOf})}],tools:[{type:'function',function:{name:'compare_crop_feasibility',description:'Evaluate candidate crop plans with the shared dispatch engine',parameters:{type:'object',properties:{},additionalProperties:false}}}]});
 const calls=response.choices?.[0]?.message?.tool_calls;
 if(calls?.length!==1||calls[0].function.name!=='compare_crop_feasibility')throw Error('AI 작물 비교 도구 호출 오류');
 const args=JSON.parse(calls[0].function.arguments);
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw Error('AI 제약 변경 거부');
 return {source:'NEBIUS',results:await calculate(),approval:'REQUIRED',reserved:false};
}

/** Explicit development path: never infer live-call permission from AI_MODE. */
export async function assessDevelopmentCropAlternatives(candidates:{id:string;plan:AnnualPlan}[],state:State,asOf:string,alternatives:unknown){
 return (await compareCropAlternatives(candidates,state,asOf,alternatives));
}
