import {createHash} from 'node:crypto';
import {compareReplanAlternatives} from '../../lib/planning-decision';
import {recommendPlanningAlternative} from '../../lib/planning-adviser';
import {resourceTradeoffCase,tradeoffDay} from './resource-tradeoff-cases';

export const rationaleValidationFolder='.data/validation/20261005-rationale-live';
export const rationaleValidationSources=[
 'lib/ai-budget.ts','lib/ai-budget-ledger.ts','lib/planning-adviser.ts',
 'lib/planning-rationale.ts','lib/planning-priority.ts','lib/planning-decision.ts',
 'lib/planning-resource-metrics.ts','lib/annual-replanning.ts',
 'scripts/fixtures/resource-tradeoff-cases.ts','scripts/fixtures/rationale-validation-cases.ts',
];
export const rationaleValidationGroups=[
 {kind:'equipment',priority:'PREFERRED_DATE',expected:'equipment'},
 {kind:'equipment',priority:'MIN_EXTERNAL',expected:'local'},
 {kind:'labor',priority:'PREFERRED_DATE',expected:'labor'},
 {kind:'compound',priority:'PREFERRED_DATE',expected:'combined'},
] as const;
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Freeze real-engine results before any model call. Only array order changes
 * within a pair; the rules answer is retained locally, never supplied to AI. */
export async function rationaleValidationCases(){
 const cases=[];
 for(const group of rationaleValidationGroups){
  const fixture=resourceTradeoffCase(group.kind),before=digest(fixture.centers);
  const comparison=await compareReplanAlternatives(fixture.state,{...fixture.request,decisionPriority:group.priority},fixture.alternatives,fixture.weather,fixture.asOf);
  if(digest(fixture.centers)!==before)throw Error('Engine mutated four-center inputs');
  for(const order of ['ORIGINAL','REVERSED'] as const){
   const frozen=structuredClone(comparison);
   if(order==='REVERSED'){frozen.results.reverse();frozen.nonDominatedIds.reverse();}
   cases.push({id:`${group.kind}-${group.priority}-${order}`,group:`${group.kind}-${group.priority}`,order,
    expected:group.expected,centersInputHash:before,reason:fixture.request.reason,
    comparison:frozen,baseline:await recommendPlanningAlternative(frozen,fixture.request.reason,'RULES')});
  }
 }
 const shortage=resourceTradeoffCase('compound');
 (shortage.state.missions[0] as typeof shortage.state.missions[0]&{planningWindow:{to:string}}).planningWindow.to=tradeoffDay;
 shortage.state.laborCapacity!.incoming[0].status='OFFERED';
 const impossible=await compareReplanAlternatives(shortage.state,shortage.request,shortage.alternatives,shortage.weather,shortage.asOf);
 return {cases,impossible};
}
