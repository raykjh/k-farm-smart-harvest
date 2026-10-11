import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {compareReplanAlternatives} from '../lib/planning-decision';
import {recommendPlanningAlternative} from '../lib/planning-adviser';
import {decisionPriorities,priorityMetrics} from '../lib/planning-priority';
import {APPROVED_MODEL,reservationMicroUsd,MAX_REQUEST_RESERVATION_MICRO_USD} from '../lib/ai-budget';
import {resourceTradeoffCase} from '../scripts/fixtures/resource-tradeoff-cases';
import {assessDiagnosticResponse,diagnosticFolder,diagnosticVariants,digest,type DiagnosticBody} from '../scripts/fixtures/adviser-order-diagnostic';

const transport=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai-budget',async importOriginal=>({...await importOriginal<typeof import('../lib/ai-budget')>(),budgetedCompletion:transport}));
const answer=(id:string)=>({model:APPROVED_MODEL,choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'recommend_alternative',arguments:JSON.stringify({alternativeId:id,evidence:[{alternativeId:id,metric:'preferredDistanceDays'}]})}}]}}]});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});

async function capture(){
 vi.stubEnv('AI_MODE','nebius');
 const c=resourceTradeoffCase('equipment'),before=digest(c.centers);
 const comparison=await compareReplanAlternatives(c.state,{...c.request,decisionPriority:'PREFERRED_DATE'},c.alternatives,c.weather,c.asOf);
 expect(comparison.results.every(r=>r.status==='FEASIBLE')).toBe(true);
 expect(comparison.nonDominatedIds).toEqual(['local','equipment']);
 expect(digest(c.centers)).toBe(before);
 const baseline=await recommendPlanningAlternative(comparison,c.request.reason,'RULES');
 expect(baseline.alternativeId).toBe('equipment');
 transport.mockResolvedValue(answer('equipment'));
 await recommendPlanningAlternative(comparison,c.request.reason);
 const body=structuredClone(transport.mock.calls.at(-1)![0]) as DiagnosticBody;
 return {body,baseline,comparison,centersInputHash:before};
}

it('captures the current production request with a fake transport, no paid inference or business writes',async()=>{
 const captured=await capture(),facts=JSON.parse(captured.body.messages[1].content);
 expect(facts.operatorPriority).toBe('PREFERRED_DATE');
 expect(facts.priorityOrder[0]).toBe('preferredDistanceDays');
 expect(facts.alternatives.map((a:any)=>[a.id,a.metrics.preferredDistanceDays,a.metrics.borrowedEquipmentMinutes])).toEqual([['local',1,0],['equipment',0,240]]);
 expect(captured.body.model).toBe(APPROVED_MODEL);expect(transport).toHaveBeenCalledTimes(1);
 expect(transport.mock.calls[0][1]).toBe('schedule-decision');
 if(process.env.KFARM_EXPORT_ORDER_DIAGNOSTIC==='1'){
  const sourceFiles=['lib/planning-adviser.ts','lib/planning-priority.ts','lib/ai-budget.ts'];
  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,digest(await readFile(path,'utf8'))])));
  const variants=diagnosticVariants(captured.body);
  await mkdir(diagnosticFolder,{recursive:true});
  await writeFile(`${diagnosticFolder}/prepared.json`,JSON.stringify({preparedAt:new Date().toISOString(),
   mode:'OFFLINE_REQUEST_CAPTURE',paidInference:false,case:'equipment-PREFERRED_DATE',sourceHashes,
   centersInputHash:captured.centersInputHash,snapshot:captured.comparison.snapshot,baseline:captured.baseline,
   variants,totalReservationMicroUsd:variants.reduce((n,v)=>n+reservationMicroUsd(v.body,'planning'),0),
   qualification:'Actual production request builder and scheduling engine, mocked network transport. Not a saved wire request from the prior run. Synthetic inputs only.'},null,2),{flag:'wx'});
 }
});

it('isolates data order, schema order and explicit priority wording without changing facts or model settings',async()=>{
 const {body}=await capture(),before=digest(body),variants=diagnosticVariants(body);
 expect(variants.map(v=>v.orders.selectionEnum)).toEqual([['local','equipment'],['local','equipment'],['equipment','local'],['equipment','local'],['local','equipment']]);
 expect(variants.map(v=>v.orders.alternatives)).toEqual([['local','equipment'],['equipment','local'],['local','equipment'],['equipment','local'],['local','equipment']]);
 const reservations=variants.map(v=>reservationMicroUsd(v.body,'planning'));
 expect(reservations.every(n=>n>=5000&&n<=MAX_REQUEST_RESERVATION_MICRO_USD)).toBe(true);
 expect(reservations.slice(0,4)).toEqual(Array(4).fill(reservations[0]));
 for(const v of variants){
  const restored=structuredClone(v.body);
  if(v.reverseFacts){const facts=JSON.parse(restored.messages[1].content);facts.alternatives.reverse();facts.eligibleIds.reverse();restored.messages[1].content=JSON.stringify(facts);}
  if(v.reverseSchema){const p=restored.tools[0].function.parameters.properties;p.alternativeId.enum.reverse();p.evidence.items.properties.alternativeId.enum.reverse();}
  if(v.explicitPriority){expect(restored.messages[0].content).toContain('STRICT LEXICOGRAPHIC');restored.messages[0].content=body.messages[0].content;}
  expect(restored).toEqual(body);
  expect(assessDiagnosticResponse(v.body,answer('local'))).toMatchObject({priorityAligned:false,ruleChoice:'equipment',firstDifference:{metric:'preferredDistanceDays',selected:1,rule:0}});
  expect(assessDiagnosticResponse(v.body,answer('equipment'))).toMatchObject({priorityAligned:true,ruleChoice:'equipment'});
 }
 expect(digest(body)).toBe(before);
});

it('rules and model priority payload remain invariant to candidate order across all priorities and three resource cases',async()=>{
 vi.stubEnv('AI_MODE','nebius');
 for(const kind of ['equipment','labor','compound'] as const){
  const c=resourceTradeoffCase(kind),base=await compareReplanAlternatives(c.state,c.request,c.alternatives,c.weather,c.asOf);
  for(const priority of decisionPriorities){
   const choices=[];
   for(const reverse of [false,true]){
    const comparison=structuredClone(base);
    for(const r of comparison.results)if(r.previewRequest)r.previewRequest.decisionPriority=priority;
    if(reverse){comparison.results.reverse();comparison.nonDominatedIds.reverse();}
    const before=digest(comparison),rules=await recommendPlanningAlternative(comparison,'','RULES');choices.push(rules.alternativeId);
    transport.mockResolvedValue(answer(rules.alternativeId!));
    await recommendPlanningAlternative(comparison,'');
    const facts=JSON.parse(transport.mock.calls.at(-1)![0].messages[1].content);
    expect(facts.operatorPriority).toBe(priority);expect(facts.priorityOrder).toEqual(priorityMetrics(priority,true));
    expect(digest(comparison)).toBe(before);
   }
   expect(choices[0]).toBe(choices[1]);
  }
 }
});

it('diagnostic scoring rejects malformed, ungrounded and truncated answers rather than crediting them as success',async()=>{
 const {body}=await capture();
 expect(()=>assessDiagnosticResponse(body,answer('invented'))).toThrow();
 const truncated=answer('equipment');truncated.choices[0].finish_reason='length';
 expect(()=>assessDiagnosticResponse(body,truncated)).toThrow('Truncated');
 const wrongMetric=answer('equipment');wrongMetric.choices[0].message.tool_calls[0].function.arguments=JSON.stringify({alternativeId:'equipment',evidence:[{alternativeId:'equipment',metric:'profit'}]});
 expect(()=>assessDiagnosticResponse(body,wrongMetric)).toThrow();
 const oldBudget=transport.mock.calls.length;
 expect(assessDiagnosticResponse(body,answer('local')).priorityAligned).toBe(false);
 expect(transport.mock.calls).toHaveLength(oldBudget);
});
