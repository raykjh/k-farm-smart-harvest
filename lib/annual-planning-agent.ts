import {calculateAnnualReplan,type ReplanInput} from './annual-replanning';
import {budgetedCompletion,APPROVED_MODEL} from './ai-budget';
import type {State} from './types';
import type {ForecastResult} from './kma-forecast';
// AI and the UI share the exact same validated scheduling engine.
// No authority to alter the selected task set, constraints or approval state.
export async function proposeAnnualReplan(s:State,input:ReplanInput,weather:ForecastResult,asOf:string){
 const calculate=()=>calculateAnnualReplan(s,input,weather,asOf);
 if(process.env.AI_MODE!=='nebius'||process.env.AI_CALL_SCOPE==='decisions')return {...await calculate(),source:'RULES_AND_SOLVER',trace:[{tool:'calculate_annual_schedule'}]};
 const messages:unknown[]=[{role:'system',content:'You are the K-Farm scheduling assistant. Inspect the requested operation then call calculate_annual_schedule. Constraints and task selection are fixed by the operator. You cannot approve or send messages. Do not invent dates or constraints. Both tools are read-only.'},{role:'user',content:JSON.stringify({request:input.day?'daily redistribution':'individual requested date',selectedCount:input.ids.length,asOf,simulation:input.simulation??null,forecastStatus:weather.status})}];
 const tools=['inspect_request','calculate_annual_schedule'].map(name=>({type:'function',function:{name,description:name==='inspect_request'?'Read selected task and resource counts':'Calculate the common annual scheduling engine with validated constraints',parameters:{type:'object',properties:{},additionalProperties:false}}}));
 let inspected=false;
 for(let i=0;i<3;i++){
  const response=await budgetedCompletion({model:APPROVED_MODEL,messages,tools,max_tokens:500,temperature:0.1});
  const msg=response.choices?.[0]?.message;if(!msg?.tool_calls?.length)throw Error('AI 도구 요청을 확인할 수 없습니다. 승인하지 않았습니다.');
  messages.push(msg);
  for(const call of msg.tool_calls){
   const args=JSON.parse(call.function.arguments);if(!args||Array.isArray(args)||Object.keys(args).length)throw Error('AI의 제약 변경 요청 거부');
   if(call.function.name==='inspect_request'&&!inspected){inspected=true;messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({selected:input.ids.length,machines:s.machines.filter(m=>m.status==='AVAILABLE'&&!m.safetyLock).length,staff:s.staffCount,transport:s.transportCount,approval:'REQUIRED'})});}
   else if(call.function.name==='calculate_annual_schedule'&&inspected)return {...await calculate(),source:'NEBIUS',model:APPROVED_MODEL,trace:[{tool:'inspect_request'},{tool:'calculate_annual_schedule'}]};
   else throw Error('AI 도구 순서 또는 이름 오류');
  }
 }
 throw Error('AI 도구 호출 한도 초과');
}
