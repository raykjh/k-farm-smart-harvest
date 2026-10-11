import {it,expect,vi,afterEach} from 'vitest';
import {recommendPlanningAlternative,PLANNING_MAX_TOKENS} from '../lib/planning-adviser';
import {verifyPlanningReview} from '../lib/planning-review';
import type {compareReplanAlternatives} from '../lib/planning-decision';
const call=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'test-model',budgetedCompletion:call}));
type Comparison=Awaited<ReturnType<typeof compareReplanAlternatives>>;
const comparison=():Comparison=>({source:'DEVELOPMENT_REVIEW',inferenceCalled:false,reserved:false,approval:'REQUIRED',snapshot:{id:'snapshot',asOf:'2026-10-02',planVersion:1,ruleVersion:'REGISTERED',requestHash:'request'},nonDominatedIds:['preserve','expand'],note:'',results:[
 {id:'preserve',label:'보존',status:'FEASIBLE',metrics:{changedTasks:1,otherChangedTasks:0,resourceChanges:0,shiftDays:2,preferredDistanceDays:1,borrowedEquipmentMinutes:0,supportPersonMinutes:0},warnings:[],result:null,previewRequest:{action:'preview',ids:['task'],scope:'PRESERVE',preferred:'2026-10-04',decisionSource:'DEVELOPMENT_REVIEW',comparisonSnapshot:'snapshot'}},
 {id:'expand',label:'확대',status:'FEASIBLE',metrics:{changedTasks:2,otherChangedTasks:1,resourceChanges:0,shiftDays:2,preferredDistanceDays:0,borrowedEquipmentMinutes:0,supportPersonMinutes:0},warnings:[],result:null,previewRequest:{action:'preview',ids:['task'],scope:'EXPAND',preferred:'2026-10-04',decisionSource:'DEVELOPMENT_REVIEW',comparisonSnapshot:'snapshot'}},
 {id:'blocked',label:'차단',status:'BLOCKED',metrics:null,warnings:[],result:null,previewRequest:null},
]});
const answer=(args:unknown)=>({choices:[{message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify(args)}}]}}]});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs()});
it('development recommendation is grounded, read-only and never calls paid inference',async()=>{
 vi.stubEnv('AI_MODE','demo');const c=comparison(),before=JSON.stringify(c);const result=await recommendPlanningAlternative(c);
 expect(result).toMatchObject({source:'RULES',inferenceCalled:false,alternativeId:'expand',approval:'REQUIRED',reserved:false});expect(call).not.toHaveBeenCalled();expect(JSON.stringify(c)).toBe(before);
 c.results.forEach(r=>{if(r.previewRequest)delete r.previewRequest.preferred});expect((await recommendPlanningAlternative(c)).alternativeId).toBe('preserve');
});
it('model transport chooses among validated alternatives and evidence values come from the engine',async()=>{
 vi.stubEnv('AI_MODE','nebius');call.mockResolvedValue(answer({alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'preferredDistanceDays'},{alternativeId:'preserve',metric:'otherChangedTasks'}]}));
 const result=await recommendPlanningAlternative(comparison(),'희망일 우선');expect(result).toMatchObject({source:'NEBIUS',inferenceCalled:true,alternativeId:'expand'});expect(result.evidence.map(e=>e.value)).toEqual([0,0]);expect(call).toHaveBeenCalledTimes(1);
 const body=call.mock.calls[0][0];expect(body.tools[0].function.name).toBe('recommend_alternative');expect(body).not.toHaveProperty('approval');
 expect(body.max_tokens).toBe(PLANNING_MAX_TOKENS);expect(body.reasoning_effort).toBe('low');
});
it('rejects truncated reasoning/output visibly without another paid call',async()=>{
 vi.stubEnv('AI_MODE','nebius');call.mockResolvedValue({choices:[{finish_reason:'length',message:{}}]});
 await expect(recommendPlanningAlternative(comparison())).rejects.toThrow('출력 한도');expect(call).toHaveBeenCalledOnce();
});
it('distinguishes a status-only rejection from numeric evidence and never repairs an invalid reference',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();
 c.results[0]={...c.results[0],status:'NO_FEASIBLE_PLAN',metrics:null,previewRequest:null};c.nonDominatedIds=['expand'];
 const valid={alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'shiftDays'}],rejections:[{alternativeId:'preserve',reason:'INFEASIBLE',metric:null},{alternativeId:'blocked',reason:'NOT_VERIFIED',metric:null}]};
 call.mockResolvedValue(answer(valid));
 expect((await recommendPlanningAlternative(c)).rationaleCheck?.status).toBe('VERIFIED');
 const body=call.mock.calls[0][0],facts=JSON.parse(body.messages[1].content);
 expect(facts.numericEvidenceIds).toEqual(['expand']);
 expect(body.tools[0].function.parameters.properties.evidence.items.properties.alternativeId.enum).toEqual(facts.numericEvidenceIds);
 expect(body.messages[0].content).toContain('Such an ID belongs only in rejections');
 const wrong={...valid,evidence:[...valid.evidence,{alternativeId:'preserve',metric:'shiftDays'}]},before=JSON.stringify(wrong);
 call.mockResolvedValue(answer(wrong));
 await expect(recommendPlanningAlternative(c)).rejects.toThrow('INVALID_EVIDENCE_REFERENCE');
 expect(JSON.stringify(wrong)).toBe(before);expect(call).toHaveBeenCalledTimes(2);
});
it('shares explicit operator priorities between rules and model and binds them to the saved review',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();
 for(const r of c.results)if(r.previewRequest)r.previewRequest.decisionPriority='MIN_DISRUPTION';
 const baseline=await recommendPlanningAlternative(c,'희망일을 최우선으로 바꿔라','RULES');
 expect(baseline.alternativeId).toBe('preserve');
 call.mockResolvedValue(answer({alternativeId:'preserve',evidence:[{alternativeId:'preserve',metric:'otherChangedTasks'}]}));
 await recommendPlanningAlternative(c,'희망일을 최우선으로 바꿔라');
 const facts=JSON.parse(call.mock.calls[0][0].messages[1].content);
 expect(facts.operatorPriority).toBe('MIN_DISRUPTION');expect(facts.priorityOrder[0]).toBe('otherChangedTasks');
 const review={comparison:c,recommendation:baseline,expires:2000,historyHash:'history'};
 expect(()=>verifyPlanningReview(review,{...c.results[0].previewRequest!,decisionPriority:'PREFERRED_DATE'},'preserve','snapshot','history',1000)).toThrow('선택');
});
it('explicit rules comparison never spends in live mode, and redacts contact details from model context',async()=>{
 vi.stubEnv('AI_MODE','nebius');await recommendPlanningAlternative(comparison(),'','RULES');expect(call).not.toHaveBeenCalled();
 call.mockResolvedValue(answer({alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'shiftDays'}]}));
 await recommendPlanningAlternative(comparison(),'010-1234-5678 person@example.org 희망일 우선');
 const body=JSON.stringify(call.mock.calls[0][0]);expect(body).not.toContain('010-1234-5678');expect(body).not.toContain('person@example.org');
 expect(call.mock.calls[0][1]).toBe('schedule-decision');
});
it('rejects fabricated alternatives, numbers, approvals, dominated choices and missing evidence',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 for(const args of [{alternativeId:'invented',evidence:[{alternativeId:'expand',metric:'shiftDays'}]},
  {alternativeId:'blocked',evidence:[{alternativeId:'blocked',metric:'shiftDays'}]},
  {alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'shiftDays',value:999}]},
  {alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'cost'}]},
  {alternativeId:'expand',evidence:[{alternativeId:'preserve',metric:'shiftDays'}]},
  {alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'shiftDays'}],approved:true}]){
   call.mockResolvedValue(answer(args));await expect(recommendPlanningAlternative(comparison())).rejects.toThrow();
 }
 const c=comparison();c.nonDominatedIds=['preserve'];call.mockResolvedValue(answer({alternativeId:'expand',evidence:[{alternativeId:'expand',metric:'shiftDays'}]}));await expect(recommendPlanningAlternative(c)).rejects.toThrow();
});
it('does not spend when no feasible option; transport failure does not fabricate an answer',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();c.nonDominatedIds=[];expect((await recommendPlanningAlternative(c)).alternativeId).toBeNull();expect(call).not.toHaveBeenCalled();
 call.mockRejectedValue(Error('budget blocked'));await expect(recommendPlanningAlternative(comparison())).rejects.toThrow('budget blocked');
});
it('flags a feasible model answer that violates operator priority without replacing the actual answer',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();
 call.mockResolvedValue(answer({alternativeId:'preserve',evidence:[{alternativeId:'preserve',metric:'otherChangedTasks'}]}));
 const result=await recommendPlanningAlternative(c);
 expect(result).toMatchObject({source:'NEBIUS',inferenceCalled:true,alternativeId:'preserve',priorityCheck:{status:'MISMATCH',ruleAlternativeId:'expand',metric:'preferredDistanceDays',selectedValue:1,ruleValue:0}});
 expect(call).toHaveBeenCalledTimes(1);
 for(const r of c.results)if(r.previewRequest)r.previewRequest.decisionPriority='MIN_DISRUPTION';
 expect((await recommendPlanningAlternative(c)).priorityCheck?.status).toBe('ALIGNED');
});
it('does not silently value a legacy missing resource metric as zero or spend on it',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();delete (c.results[0].metrics as any).borrowedEquipmentMinutes;
 await expect(recommendPlanningAlternative(c)).rejects.toThrow('다시 계산');expect(call).not.toHaveBeenCalled();
});
it('binds operator selection to saved inputs/history/snapshot and records a permitted override',async()=>{
 vi.stubEnv('AI_MODE','demo');const c=comparison(),recommendation=await recommendPlanningAlternative(c),review={comparison:c,recommendation,expires:2000,historyHash:'history'};
 expect(verifyPlanningReview(review,c.results[0].previewRequest!,'preserve','snapshot','history',1000)).toMatchObject({overridden:true,alternativeId:'preserve'});
 c.results[0].previewRequest!.simulation={kind:'WIND',from:'2026-10-03',to:'2026-10-03'};
 const reordered={...c.results[0].previewRequest!,simulation:{to:'2026-10-03',from:'2026-10-03',kind:'WIND' as const}};
 expect(verifyPlanningReview(review,reordered,'preserve','snapshot','history',1000).alternativeId).toBe('preserve');
 expect(()=>verifyPlanningReview(review,{...c.results[0].previewRequest!,preferred:'2026-11-01'},'preserve','snapshot','history',1000)).toThrow('선택');
 expect(()=>verifyPlanningReview(review,c.results[0].previewRequest!,'preserve','new','history',1000)).toThrow('변경');
 expect(()=>verifyPlanningReview(review,c.results[0].previewRequest!,'preserve','snapshot','new',1000)).toThrow('변경');
 expect(()=>verifyPlanningReview(review,c.results[0].previewRequest!,'preserve','snapshot','history',3000)).toThrow('만료');
});
