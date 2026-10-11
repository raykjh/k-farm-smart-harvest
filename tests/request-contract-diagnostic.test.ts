import {expect,it,vi,afterEach,beforeAll} from 'vitest';
import {settings,ordered,compact,assess,chooseMethod,chooseEffort,digest} from '../scripts/fixtures/request-contract-diagnostic';
import {ruleRationale} from '../lib/planning-rationale';
import {validateRequest,reservationMicroUsd,APPROVED_MODEL,budgetedCompletion} from '../lib/ai-budget';
import {compareReplanAlternatives} from '../lib/planning-decision';
import {resourceTradeoffCase} from '../scripts/fixtures/resource-tradeoff-cases';
// Portable unit input: no dependency on ignored paid-call artifacts or keys.
let saved:any;
beforeAll(async()=>{
 const f=resourceTradeoffCase('equipment');
 const comparison=await compareReplanAlternatives(f.state,{...f.request,decisionPriority:'PREFERRED_DATE'},f.alternatives,f.weather,f.asOf);
 const ids=comparison.results.map(r=>r.id),ref={type:'object',properties:{alternativeId:{type:'string',enum:ids},metric:{type:'string'}},required:['alternativeId','metric']};
 saved={comparison,request:{model:APPROVED_MODEL,max_tokens:650,reasoning_effort:'none',temperature:0.1,
  messages:[{role:'system',content:'Return contractVersion, selectionReason (ONLY_ELIGIBLE if one eligible ID, otherwise COMPARATIVE), and a rejection for EVERY other alternative exactly once, including infeasible ones.'},
   {role:'user',content:JSON.stringify({eligibleIds:ids,alternatives:comparison.results.map(r=>({id:r.id,metrics:r.metrics}))})}],
  tools:[{type:'function',function:{name:'recommend_alternative',parameters:{type:'object',properties:{alternativeId:{type:'string',enum:ids},contractVersion:{type:'string'},selectionReason:{type:'string'},evidence:{type:'array',items:structuredClone(ref)},rejections:{type:'array',items:structuredClone(ref)}},required:['alternativeId','evidence','contractVersion','selectionReason','rejections']}}}]}};
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('changes only tool_choice in the method comparison and only reasoning_effort in the thinking comparison',()=>{
 const original=digest(saved);
 const a=settings(saved.request,'forced','none',650),b=settings(saved.request,'auto','none',650);
 expect({...a,tool_choice:b.tool_choice}).toEqual(b);
 const c=settings(saved.request,'auto','none',2048),d=settings(saved.request,'auto','low',2048);
 expect({...c,reasoning_effort:d.reasoning_effort}).toEqual(d);
 expect(digest(saved)).toBe(original);
 for(const body of [a,b,c,d]){validateRequest(body,'diagnostic');expect(reservationMicroUsd(body,'diagnostic')).toBe(5000);}
});
it('isolates fact order from schema order while preserving metric values and memberships',()=>{
 const original=saved.request,facts=ordered(original,true,false),schema=ordered(original,false,true),both=ordered(original,true,true);
 expect(facts.tools).toEqual(original.tools);expect(schema.messages).toEqual(original.messages);
 expect(both).toEqual(ordered(facts,false,true));
 const sorted=(b:any)=>JSON.parse(b.messages[1].content).alternatives.sort((a:any,b:any)=>a.id.localeCompare(b.id));
 expect(sorted(facts)).toEqual(sorted(original));
 expect(ordered(both,true,true)).toEqual(original);
});
it('compact output removes only server-known metadata and preserves rejection/evidence constraints',()=>{
 const body=compact(saved.request),p=body.tools[0].function.parameters;
 expect(p.required).toEqual(['alternativeId','evidence','rejections']);
 expect(p.properties.rejections).toEqual(saved.request.tools[0].function.parameters.properties.rejections);
 expect(p.properties.evidence).toEqual(saved.request.tools[0].function.parameters.properties.evidence);
 const good=ruleRationale(saved.comparison,'equipment');
 const answer=(raw:any)=>({model:APPROVED_MODEL,choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify(raw)}}]}}]});
 const raw={alternativeId:'equipment',rejections:good.rationale.rejections,evidence:good.evidence};
 expect(assess(saved.comparison,answer(raw),'compact')).toMatchObject({passed:true,metadataSource:'SERVER'});
 expect(assess(saved.comparison,answer({...raw,rejections:[]}),'compact')).toMatchObject({passed:false});
 expect(()=>assess(saved.comparison,answer({...raw,selectionReason:'ONLY_ELIGIBLE'}),'compact')).toThrow();
 const wrong=ruleRationale(saved.comparison,'local');
 expect(assess(saved.comparison,answer({alternativeId:'local',rejections:wrong.rationale.rejections,evidence:wrong.evidence}),'compact')).toMatchObject({passed:false,selected:'local'});
});
it('chooses settings using declared criteria and requires measured reasoning activation',()=>{
 expect(chooseMethod([{method:'forced',assessment:{passed:false,priorityAligned:false}},{method:'auto',assessment:{passed:true,priorityAligned:true}}])).toBe('auto');
 expect(chooseMethod([])).toBe('auto');
 expect(chooseEffort([{effort:'low',reasoningTokens:0,assessment:{passed:true}}])).toBe('none');
 expect(chooseEffort([{effort:'low',reasoningTokens:30,assessment:{passed:true}},{effort:'none',assessment:{passed:false}}])).toBe('low');
});
it('keeps broader reasoning outside production calls, requires an explicit diagnostic switch and never sends on rejection',async()=>{
 const body=settings(saved.request,'auto','low',2048);
 expect(()=>validateRequest(body)).toThrow();expect(()=>validateRequest({...body,reasoning_effort:'high'},'diagnostic')).toThrow();
 expect(()=>validateRequest({...body,max_tokens:4096},'diagnostic')).not.toThrow();
 expect(()=>validateRequest({...body,max_tokens:4097},'diagnostic')).toThrow();
 vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','fake-test-only');vi.stubEnv('KFARM_AI_REQUEST_DIAGNOSTIC','0');
 const network=vi.fn();vi.stubGlobal('fetch',network);
 await expect(budgetedCompletion(body,'request-diagnostic')).rejects.toThrow('disabled');expect(network).not.toHaveBeenCalled();
});
