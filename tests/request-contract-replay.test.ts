import {afterEach,expect,it,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {groundPlanningSelection,recommendPlanningAlternative,PLANNING_MAX_TOKENS} from '../lib/planning-adviser';
import {verifyPlanningReview} from '../lib/planning-review';
const transport=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',async original=>({...await original<typeof import('../lib/ai-budget')>(),budgetedCompletion:transport}));
const folder='.data/validation/20261005-request-contract';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
// Optional replay of local evidence. Portable contract coverage lives in the
// other tests; this never fetches or creates missing paid-call evidence.
const hasEvidence=existsSync(`${folder}/compact-live.json`);
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});

it.skipIf(!hasEvidence)('historical compact answers remain valid after bounded output/context changes; approval still needs a human action',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 const prepared=read('.data/validation/20261005-rationale-live/prepared.json');
 const source=prepared.cases.find((c:any)=>c.id==='equipment-PREFERRED_DATE-ORIGINAL');
 const report=read(`${folder}/compact-live.json`);
 for(const entry of report.cases){
  const comparison=structuredClone(source.comparison);
  if(entry.factsReversed){comparison.results.reverse();comparison.nonDominatedIds.reverse();}
  transport.mockResolvedValue(entry.response);
  const recommendation=await recommendPlanningAlternative(comparison,source.reason);
  const current=transport.mock.calls.at(-1)![0];
  expect(current.max_tokens).toBe(PLANNING_MAX_TOKENS);
  expect(current.tools).toEqual(entry.body.tools);
  expect(current).toMatchObject({model:entry.body.model,tool_choice:entry.body.tool_choice,reasoning_effort:entry.body.reasoning_effort,temperature:entry.body.temperature});
  const {numericEvidenceIds,...facts}=JSON.parse(current.messages[1].content);
  expect(facts).toEqual(JSON.parse(entry.body.messages[1].content));
  expect(numericEvidenceIds).toEqual(comparison.results.filter((r:any)=>r.status==='FEASIBLE').map((r:any)=>r.id));
  // This is validator compatibility, not evidence of identical live wire input.
  expect(recommendation).toMatchObject({alternativeId:'equipment',rationaleCheck:{status:'VERIFIED'},rationaleMetadataSource:'SERVER',responseContract:'planning-choice-v2',approval:'REQUIRED',reserved:false});
  const selected=comparison.results.find((r:any)=>r.id==='equipment');
  const review={comparison,recommendation,historyHash:'offline-replay',expires:2000};
  expect(verifyPlanningReview(review,selected.previewRequest,selected.id,comparison.snapshot.id,'offline-replay',1000).selectionBasis).toBe('VERIFIED_AI');
  const altered=structuredClone(review);altered.recommendation.rationale!.rejections=[];
  expect(verifyPlanningReview(altered,selected.previewRequest,selected.id,comparison.snapshot.id,'offline-replay',1000).selectionBasis).toBe('OPERATOR_REVIEW');
 }
 expect(transport).toHaveBeenCalledTimes(2); // Stub only, not live calls.
});

it.skipIf(!hasEvidence)('keeps all eight historical failures invalid instead of repairing old model metadata',()=>{
 const prepared=read('.data/validation/20261005-rationale-live/prepared.json'),live=read('.data/validation/20261005-rationale-live/live.json');
 for(const entry of live.cases){
  const comparison=prepared.cases.find((c:any)=>c.id===entry.id).comparison;
  const raw=JSON.parse(entry.response.choices[0].message.tool_calls[0].function.arguments),before=JSON.stringify(raw);
  const result=groundPlanningSelection(comparison,raw,'MODEL','legacy');
  expect(result.rationaleCheck.status).toBe('INVALID');expect(result.rationaleMetadataSource).toBe('MODEL');
  expect(result.rationale?.selectionReason).toBe('ONLY_ELIGIBLE');expect(JSON.stringify(raw)).toBe(before);
 }
 expect(transport).not.toHaveBeenCalled();
});
