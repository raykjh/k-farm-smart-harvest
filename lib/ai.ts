import type {State} from './types';
import {solve} from './scheduler';
import {z} from 'zod';
import {impactFacts,verifiedSummary} from './ai-facts';
import {APPROVED_MODEL,budgetedCompletion} from './ai-budget';
// The model can inspect and ask the deterministic solver, never approve or dispatch.
export async function propose(s:State){
 const trace:{tool:string;result:string}[]=[];
 const run=async(name:string,args:unknown)=>{
  if(name==='inspect_impact'){const result=impactFacts(s);trace.push({tool:name,result:JSON.stringify(result)});return result;}
  if(name==='solve_schedule'){const {preferBatch}=z.object({preferBatch:z.boolean()}).parse(args);const r=await solve(s,preferBatch);trace.push({tool:name,result:`${r.feasible?'충돌 없는 일정':'해결 불가'}, ${r.diff.length}건 변경, ${r.groups}개 묶음`});return r;}
  throw new Error('허용되지 않은 AI 도구');
 };
 if(process.env.AI_MODE!=='nebius'||process.env.AI_CALL_SCOPE==='decisions'){
  await run('inspect_impact',{}); const result=await solve(s,true);
  trace.push({tool:'solve_schedule',result:`OR-Tools 실제 계산: ${result.diff.length}건 변경, ${result.groups}개 묶음`});
  return {...result,summary:verifiedSummary(s,result),source:'DEMO_RULES' as const,trace};
 }
 if(!process.env.NEBIUS_API_KEY)throw new Error('Nebius API 키가 없습니다. 데모 모드를 사용하거나 서버 설정을 완료하세요.');
 const tools=[{type:'function',function:{name:'inspect_impact',description:'Read verified demo operational constraints and deterministic impact closure.',parameters:{type:'object',properties:{},additionalProperties:false}}},{type:'function',function:{name:'solve_schedule',description:'Calculate and validate a replacement schedule using OR-Tools, respecting safety, deadlines and shared resources.',parameters:{type:'object',properties:{preferBatch:{type:'boolean'}},required:['preferBatch'],additionalProperties:false}}}];
 const messages:unknown[]=[{role:'system',content:'You are K-Farm operations assistant. Call inspect_impact then solve_schedule, each once. All data is DEMO_ASSUMPTION. Never waive safety or claim approval, execution or SMS delivery. Counts are missions, never hours. The application renders the final explanation from verified solver data; do not generate prose. All tools are read-only.'},{role:'user',content:'강풍 이벤트가 발생했습니다. 영향을 확인하고, 공동장비와 운송·인력 충돌 없이 재계획하세요.'}];
 let result:Awaited<ReturnType<typeof solve>>|undefined; let inspected=false;
 for(let i=0;i<4;i++){
  const payload=await budgetedCompletion({model:process.env.NEBIUS_MODEL??APPROVED_MODEL,messages,tools,max_tokens:1200,temperature:0.2}); const msg=payload.choices?.[0]?.message;
  if(!msg)throw new Error('Nebius 응답 형식 오류');messages.push(msg);
  if(msg.tool_calls?.length){
   if(msg.tool_calls.length>3)throw new Error('AI 도구 호출 한도 초과');
   for(const call of msg.tool_calls){
    if(call.function.name==='inspect_impact'&&inspected)throw new Error('중복 영향 검토 요청 거부');
    if(call.function.name==='solve_schedule'&&(!inspected||result))throw new Error('영향 검토 전 또는 중복 계산 요청 거부');
    const r=await run(call.function.name,JSON.parse(call.function.arguments));
    if(call.function.name==='inspect_impact')inspected=true;
    if(call.function.name==='solve_schedule')result=r as Awaited<ReturnType<typeof solve>>;
    messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(r)});
   }
   if(result&&inspected)return {...result,summary:verifiedSummary(s,result),source:'NEBIUS' as const,trace};
  }else throw new Error('AI가 필요한 도구를 호출하지 않았습니다. 자유 형식 설명은 표시하지 않습니다.');
 }
 throw new Error('AI 제한 횟수 안에 검증된 재계획을 완료하지 못했습니다. 자동 승인하지 않았습니다.');
}
