import {afterEach,expect,it,vi} from 'vitest';
import type {compareReplanAlternatives} from '../lib/planning-decision';
import {recommendPlanningAlternative} from '../lib/planning-adviser';
import {verifyPlanningReview} from '../lib/planning-review';
import {RATIONALE_VERSION,checkRationale,pairwiseReasons,ruleRationale,type EvidenceRef,type Rationale} from '../lib/planning-rationale';
const transport=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'test-only',budgetedCompletion:transport}));
type Comparison=Awaited<ReturnType<typeof compareReplanAlternatives>>;
function comparison():Comparison{
 const local={changedTasks:1,otherChangedTasks:0,resourceChanges:0,shiftDays:1,preferredDistanceDays:1,borrowedEquipmentMinutes:0,supportPersonMinutes:0};
 const preview={action:'preview' as const,ids:['task'],scope:'PRESERVE' as const,preferred:'2032-09-01',decisionPriority:'PREFERRED_DATE' as const,decisionSource:'DEVELOPMENT_REVIEW' as const,comparisonSnapshot:'snapshot'};
 return {source:'DEVELOPMENT_REVIEW',inferenceCalled:false,approval:'REQUIRED',reserved:false,snapshot:{id:'snapshot',asOf:'2032-08-31',planVersion:1,ruleVersion:'test',requestHash:'test'},nonDominatedIds:['local','equipment'],note:'',results:[
  {id:'local',label:'자체 자원',status:'FEASIBLE',metrics:local,warnings:[],result:null,previewRequest:{...preview}},
  {id:'equipment',label:'차용',status:'FEASIBLE',metrics:{...local,resourceChanges:1,shiftDays:0,preferredDistanceDays:0,borrowedEquipmentMinutes:240},warnings:[],result:null,previewRequest:{...preview}},
  {id:'blocked',label:'미확정 인력',status:'NO_FEASIBLE_PLAN',metrics:null,warnings:[],result:null,previewRequest:null},
 ]};
}
const claim=():Rationale=>({contractVersion:RATIONALE_VERSION,selectionReason:'COMPARATIVE',rejections:[{alternativeId:'local',reason:'PRIORITY',metric:'preferredDistanceDays'},{alternativeId:'blocked',reason:'INFEASIBLE',metric:null}]});
const evidence=():EvidenceRef[]=>[{alternativeId:'equipment',metric:'preferredDistanceDays'},{alternativeId:'local',metric:'preferredDistanceDays'}];
const answer=(payload:any)=>{const {contractVersion:_version,selectionReason:_count,...wire}=payload;return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify(wire)}}]}}]};};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});

it('verifies every rejection and hydrates decisive values from computed facts, not model-authored numbers',async()=>{
 vi.stubEnv('AI_MODE','nebius');transport.mockResolvedValue(answer({alternativeId:'equipment',evidence:evidence(),...claim()}));
 const result=await recommendPlanningAlternative(comparison());
 expect(result.rationaleCheck).toMatchObject({source:'MODEL',status:'VERIFIED',issues:[],comparisons:[{alternativeId:'local',metric:'preferredDistanceDays',selectedValue:0,rejectedValue:1,verified:true},{alternativeId:'blocked',reason:'INFEASIBLE',metric:null,verified:true}]});
 expect(result.rationale).toEqual(claim());expect(result.evidence.map(e=>e.value)).toEqual([0,1]);
 const body=transport.mock.calls[0][0],p=body.tools[0].function.parameters;
 expect(p.required).toEqual(['alternativeId','evidence','rejections']);
 expect(p.properties).not.toHaveProperty('contractVersion');expect(p.properties).not.toHaveProperty('selectionReason');
 expect(result).toMatchObject({responseContract:'planning-choice-v2',rationaleMetadataSource:'SERVER'});
 expect(p.properties.rejections).toMatchObject({minItems:2,maxItems:2});
 expect(body.messages[0].content).toContain('STRICT LEXICOGRAPHIC');
 expect(body.messages[1].content).not.toContain('ruleAlternativeId');
 expect(body).toMatchObject({max_tokens:4096,reasoning_effort:'low',temperature:0.1,tool_choice:'auto'});
});

for(const [name,mutate,code] of [
 ['omitted candidate',(c:Rationale)=>{c.rejections.pop()},'MISSING_REJECTION'],
 ['duplicate candidate',(c:Rationale)=>{c.rejections.push({...c.rejections[0]})},'DUPLICATE_REJECTION'],
 ['invented candidate',(c:Rationale)=>{c.rejections[0].alternativeId='invented'},'UNKNOWN_REJECTION'],
 ['selected candidate in rejections',(c:Rationale)=>{c.rejections[0].alternativeId='equipment'},'UNKNOWN_REJECTION'],
 ['false infeasibility',(c:Rationale)=>{c.rejections[0].reason='INFEASIBLE';c.rejections[0].metric=null},'WRONG_REJECTION_REASON'],
 ['later-priority cherry picking',(c:Rationale)=>{c.rejections[0].metric='shiftDays'},'WRONG_DECISIVE_METRIC'],
 ['unsupported single-candidate claim',(c:Rationale)=>{c.selectionReason='ONLY_ELIGIBLE'},'WRONG_SELECTION_REASON'],
 ['metric fabricated for infeasible candidate',(c:Rationale)=>{c.rejections[1].metric='shiftDays'},'WRONG_DECISIVE_METRIC'],
] as const)it(`rejects ${name}`,()=>{
 const c=claim();mutate(c);const checked=checkRationale(comparison(),'equipment',evidence(),c,'MODEL');
 expect(checked.status).toBe('INVALID');expect(checked.issues.map(i=>i.code)).toContain(code);
});

it('requires both sides of the decisive comparison and rejects changed cached evidence values',()=>{
 const checked=checkRationale(comparison(),'equipment',evidence().slice(0,1),claim(),'MODEL');
 expect(checked.issues).toContainEqual({code:'MISSING_COMPARISON_EVIDENCE',alternativeId:'local',metric:'preferredDistanceDays'});
 expect(checkRationale(comparison(),'equipment',evidence().map(e=>({...e,value:999})),claim(),'MODEL').issues).toContainEqual({code:'INVALID_EVIDENCE'});
});

it('preserves a priority-violating actual choice and flags even a correctly identified decisive metric',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=claim();c.rejections[0].alternativeId='equipment';
 transport.mockResolvedValue(answer({alternativeId:'local',evidence:evidence(),...c}));
 const result=await recommendPlanningAlternative(comparison());
 expect(result.alternativeId).toBe('local');expect(result.priorityCheck?.status).toBe('MISMATCH');
 expect(result.rationaleCheck?.status).toBe('INVALID');
 expect(result.rationaleCheck?.issues).toContainEqual({code:'PRIORITY_CONTRADICTION',alternativeId:'equipment',metric:'preferredDistanceDays'});
 expect(transport).toHaveBeenCalledTimes(1);
});

it('does not certify the correct choice when the model supplies no explanation',async()=>{
 vi.stubEnv('AI_MODE','nebius');transport.mockResolvedValue(answer({alternativeId:'equipment',evidence:evidence()}));
 const result=await recommendPlanningAlternative(comparison());
 expect(result.priorityCheck?.status).toBe('ALIGNED');expect(result.rationaleCheck?.status).toBe('INVALID');
 expect(result.rationaleCheck?.issues).toContainEqual({code:'MISSING_RATIONALE'});
});

it('handles a sole eligible candidate and explains an infeasible option without fabricated evidence',async()=>{
 const c=comparison();c.results.shift();c.nonDominatedIds=['equipment'];
 const result=await recommendPlanningAlternative(c,'','RULES');
 expect(result.rationaleCheck).toMatchObject({source:'RULES',status:'VERIFIED',selectionReason:'ONLY_ELIGIBLE',comparisons:[{alternativeId:'blocked',reason:'INFEASIBLE'}]});
 expect(transport).not.toHaveBeenCalled();
});

it('does not misstate an unverified or failed calculation as proven infeasibility',()=>{
 const c=comparison();c.results[2].status='BLOCKED';
 const r=claim();
 expect(checkRationale(c,'equipment',evidence(),r,'MODEL').issues).toContainEqual({code:'WRONG_REJECTION_REASON',alternativeId:'blocked'});
 r.rejections[1].reason='NOT_VERIFIED';
 expect(checkRationale(c,'equipment',evidence(),r,'MODEL')).toMatchObject({status:'VERIFIED',comparisons:[{alternativeId:'local'},{alternativeId:'blocked',reason:'NOT_VERIFIED',outcome:'NOT_VERIFIED',verified:true}]});
});

it('checks scope and stable-ID tie breakers, independent of candidate order',async()=>{
 const c=comparison();c.results[1].metrics={...c.results[0].metrics!};c.results[0].previewRequest!.scope='EXPAND';
 expect(pairwiseReasons(c,'equipment')[0]).toMatchObject({reason:'SCOPE_TIEBREAK',metric:null,outcome:'BETTER'});
 for(const reverse of [false,true]){
  if(reverse)c.results.reverse();
  const result=await recommendPlanningAlternative(c,'','RULES');expect(result.alternativeId).toBe('equipment');expect(result.rationaleCheck?.status).toBe('VERIFIED');
 }
 c.results.find(r=>r.id==='local')!.previewRequest!.scope='PRESERVE';
 expect(pairwiseReasons(c,'equipment').find(r=>r.alternativeId==='local')).toMatchObject({reason:'ID_TIEBREAK',outcome:'BETTER'});
 const wrong=ruleRationale(c,'local');
 expect(checkRationale(c,'local',wrong.evidence,wrong.rationale,'MODEL').issues).toContainEqual({code:'TIEBREAK_CONTRADICTION',alternativeId:'equipment'});
});

it('rechecks persisted reasons and records a human decision instead of trusting cached VERIFIED',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();transport.mockResolvedValue(answer({alternativeId:'equipment',evidence:evidence(),...claim()}));
 const recommendation=await recommendPlanningAlternative(c),review={comparison:c,recommendation,historyHash:'history',expires:2000};
 expect(verifyPlanningReview(review,c.results[1].previewRequest!,'equipment','snapshot','history',1000).selectionBasis).toBe('VERIFIED_AI');
 expect(verifyPlanningReview(review,c.results[0].previewRequest!,'local','snapshot','history',1000).selectionBasis).toBe('OPERATOR_REVIEW');
 recommendation.rationale!.rejections=[];
 expect(recommendation.rationaleCheck?.status).toBe('VERIFIED');
 const result=verifyPlanningReview(review,c.results[1].previewRequest!,'equipment','snapshot','history',1000);
 expect(result.selectionBasis).toBe('OPERATOR_REVIEW');expect(result.recommendation.rationaleCheck?.status).toBe('INVALID');
 expect(recommendation.rationaleCheck?.status).toBe('VERIFIED'); // recheck does not rewrite past records
 delete recommendation.rationale;
 expect(verifyPlanningReview(review,c.results[1].previewRequest!,'equipment','snapshot','history',1000).selectionBasis).toBe('OPERATOR_REVIEW');
});

it('rejects mixed priority or preferred-date contexts before any paid transport',async()=>{
 vi.stubEnv('AI_MODE','nebius');const c=comparison();c.results[1].previewRequest!.decisionPriority='MIN_EXTERNAL';
 await expect(recommendPlanningAlternative(c)).rejects.toThrow('우선순위');
 c.results[1].previewRequest!.decisionPriority='PREFERRED_DATE';c.results[1].previewRequest!.preferred='2032-09-02';
 await expect(recommendPlanningAlternative(c)).rejects.toThrow('희망일');expect(transport).not.toHaveBeenCalled();
});

it('rejects truncated answers even if the tool arguments happen to be valid JSON',async()=>{
 vi.stubEnv('AI_MODE','nebius');const response=answer({alternativeId:'equipment',evidence:evidence(),...claim()});response.choices[0].finish_reason='length';transport.mockResolvedValue(response);
 await expect(recommendPlanningAlternative(comparison())).rejects.toThrow('출력 한도');expect(transport).toHaveBeenCalledOnce();
});

it('rejects model-authored metadata in the compact contract instead of overwriting it with server facts',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 transport.mockResolvedValue({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify({alternativeId:'equipment',evidence:evidence(),...claim(),selectionReason:'ONLY_ELIGIBLE'})}}]}}]});
 await expect(recommendPlanningAlternative(comparison())).rejects.toThrow();
 expect(transport).toHaveBeenCalledTimes(1);
});
