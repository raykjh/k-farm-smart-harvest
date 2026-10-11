import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {recommendPlanningAlternative,PLANNING_MAX_TOKENS} from '../lib/planning-adviser';
import {APPROVED_MODEL,reservationMicroUsd,validateRequest,MAX_REQUEST_RESERVATION_MICRO_USD} from '../lib/ai-budget';
import {RATIONALE_VERSION} from '../lib/planning-rationale';
import {rationaleValidationCases,rationaleValidationFolder,rationaleValidationSources,digest} from '../scripts/fixtures/rationale-validation-cases';

const transport=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',async original=>({...await original<typeof import('../lib/ai-budget')>(),budgetedCompletion:transport}));
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});

it('predeclares eight same-model rationale checks and an impossible case without paid inference',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 const {cases,impossible}=await rationaleValidationCases(),prepared=[];
 expect(cases).toHaveLength(8);
 for(const c of cases){
  expect(c.baseline.alternativeId).toBe(c.expected);
  expect(c.baseline.rationaleCheck?.status).toBe('VERIFIED');
  expect(c.comparison.results.every(r=>r.status==='FEASIBLE')).toBe(true);
  expect(c.comparison.nonDominatedIds.length).toBeGreaterThanOrEqual(2);
  expect(c.comparison.results.every(r=>r.result!.diff.every(d=>d.id==='selected'))).toBe(true);
  const before=digest(c.comparison);
  const raw={alternativeId:c.expected,evidence:c.baseline.evidence.map(({alternativeId,metric})=>({alternativeId,metric})),rejections:c.baseline.rationale!.rejections};
  transport.mockResolvedValue({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify(raw)}}]}}]});
  const controlled=await recommendPlanningAlternative(c.comparison,c.reason);
  expect(controlled.rationaleCheck?.status).toBe('VERIFIED');
  expect(digest(c.comparison)).toBe(before);
  const request=structuredClone(transport.mock.calls.at(-1)![0]) as Record<string,any>;
  expect(transport.mock.calls.at(-1)![1]).toBe('schedule-decision');
  validateRequest(request,'planning');const reserved=reservationMicroUsd(request,'planning');
  expect(reserved).toBeGreaterThanOrEqual(5000);expect(reserved).toBeLessThanOrEqual(MAX_REQUEST_RESERVATION_MICRO_USD);
  expect(request).toMatchObject({model:APPROVED_MODEL,max_tokens:PLANNING_MAX_TOKENS,reasoning_effort:'low',temperature:0.1,tool_choice:'auto'});
  const facts=JSON.parse(request.messages[1].content);
  expect(facts.contractVersion).toBe(RATIONALE_VERSION);
  expect(facts).not.toHaveProperty('baseline');expect(facts).not.toHaveProperty('expected');
  expect(request.tools[0].function.parameters.required).toEqual(['alternativeId','evidence','rejections']);
  prepared.push({...c,request,requestHash:digest(request),comparisonHash:digest(c.comparison)});
 }
 for(let i=0;i<prepared.length;i+=2){
  const original=prepared[i],reversed=prepared[i+1];
  expect(reversed.baseline.alternativeId).toBe(original.baseline.alternativeId);
  expect(reversed.comparison.snapshot).toEqual(original.comparison.snapshot);
  expect([...reversed.comparison.results].reverse()).toEqual(original.comparison.results);
 }
 // Priority changes the selected tradeoff, not the underlying schedule metrics.
 expect(prepared[0].comparison.results.map(r=>r.metrics)).toEqual(prepared[2].comparison.results.map(r=>r.metrics));
 expect(prepared[0].expected).not.toBe(prepared[2].expected);
 const count=transport.mock.calls.length;
 const noPlan=await recommendPlanningAlternative(impossible);
 expect(noPlan).toMatchObject({alternativeId:null,inferenceCalled:false,source:'RULES'});
 expect(transport).toHaveBeenCalledTimes(count);
 if(process.env.KFARM_EXPORT_RATIONALE_VALIDATION==='1'){
  const sourceHashes=Object.fromEntries(await Promise.all(rationaleValidationSources.map(async path=>[path,digest(await readFile(path,'utf8'))])));
  await mkdir(rationaleValidationFolder,{recursive:true});
  await writeFile(`${rationaleValidationFolder}/prepared.json`,JSON.stringify({preparedAt:new Date().toISOString(),mode:'OFFLINE_REQUEST_CAPTURE',paidInference:false,
   contractVersion:RATIONALE_VERSION,sourceHashes,cases:prepared,
   requiredReservationMicroUsd:prepared.reduce((n,c)=>n+reservationMicroUsd(c.request,'planning'),0),
   noFeasibleCase:{comparison:impossible,advice:noPlan},
   scope:'Real calculation engine with synthetic four-center inputs. Mocked request capture is not model-performance evidence.'},null,2),{flag:'wx'});
 }
});
