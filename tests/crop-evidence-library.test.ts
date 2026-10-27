import {it,expect} from 'vitest';
import {savedNationalCropReferences,focusedCropEvidenceScope} from '../lib/crop-evidence-library';
import {selectNationalReferences} from '../lib/production-evidence';
import {marketOutlook,emptyCoordinationPolicy} from '../lib/production-coordination';
import {readProductionCoordination} from '../lib/production-coordination-store';
import {pricedEconomicScenarioSource,economicScenarioProposal} from './integrated-economics-fixture';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {adviseJointPlan} from '../lib/integrated-plan-adviser';
import {validateRequest} from '../lib/ai-budget';

it('retains dated prices with exact market stages and excludes unreviewed reuse without manufacturing a forecast',()=>{
 const pepper=selectNationalReferences('pepper','2026-10-20',savedNationalCropReferences);
 expect(pepper.status).toBe('AVAILABLE');expect(pepper.participatingDemandCap).toBeNull();
 expect(pepper.references.filter(r=>r.facts.metric==='PRICE').every(r=>r.priceStage==='WHOLESALE'&&r.unit==='KRW/600g')).toBe(true);
 for(const crop of ['rice','potato'] as const){const s=selectNationalReferences(crop,'2026-10-20',savedNationalCropReferences);expect(s.status).toBe('INSUFFICIENT_DATA');expect(s.excluded.length).toBeGreaterThan(0);expect(s.excluded.every(r=>r.reasons.includes('REUSE_REVIEW_REQUIRED'))).toBe(true);}
 expect(selectNationalReferences('pepper','2026-11-01',savedNationalCropReferences).status).toBe('INSUFFICIENT_DATA');
 expect(selectNationalReferences('pepper','2026-10-19',savedNationalCropReferences).status).toBe('INSUFFICIENT_DATA');
 const policy={...emptyCoordinationPolicy(),nationalReferences:savedNationalCropReferences};
 expect(marketOutlook({id:'x',centerId:'demo',crop:'pepper',areaM2:1000,year:2027,commodity:'DRIED_RED_PEPPER',kg:{low:200,high:250},origin:'DEMO',basis:'test',harvestPeriod:{from:'2027-08-01',to:'2027-10-31'}},{policy,contributions:[],centerId:'demo',today:'2026-10-20',origin:'DEMO'}).status).toBe('UNKNOWN');
 expect(focusedCropEvidenceScope.climate.localNormals).toBe('NOT_SELECTED');
});
it('keeps the reviewed bundle within the paid request contract through three calculations and complete selection references',async()=>{
 const source=pricedEconomicScenarioSource('demo',2);source.today='2026-10-20';source.coordination.today=source.today;source.coordination.policy.nationalReferences=structuredClone(savedNationalCropReferences);
 const snapshot=await collectJointSnapshot([source],['demo']),baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));let calls=0,maxBytes=0;
 const decision=await adviseJointPlan(snapshot,baseline,async body=>{
  validateRequest(body,'planning');maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(body),'utf8'));calls++;
  const messages=body.messages as any[],last=messages.at(-1),result=last.role==='tool'?JSON.parse(last.content):null;
  const proposal=economicScenarioProposal(snapshot,calls===2?'pepper':'potato');
  const args=calls===4?{evaluationId:'E0',assessments:Object.fromEntries(result.evaluatedIds.map((id:string)=>[id,'baseBalanceWon']))}:{staffing:proposal.staffing,choices:Object.fromEntries(proposal.choices.map(c=>[c.field,c.option]))};
  return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'scripted-'+calls,type:'function',function:{name:calls===4?'select_plan':'evaluate_plan',arguments:JSON.stringify(args)}}]}}]};
 });
 expect(calls).toBe(4);expect(maxBytes).toBeLessThanOrEqual(16384);expect(decision.selected.id).toBe(baseline.id);expect(decision.usage).toEqual([]);
});
it('provides reproducible read-only defaults while preserving explicit empty overrides and stored payloads',async()=>{
 const saved=emptyCoordinationPolicy(),before=JSON.stringify(saved);let writes=0;
 const tx={$queryRaw:async()=>[],center:{findMany:async()=>[{id:'demo'}]},workRecord:{findUnique:async()=>({payload:saved,version:7}),findMany:async()=>[],create:async()=>{writes++},update:async()=>{writes++}}};
 const a=await readProductionCoordination(tx as any,'demo','2026-10-20');
 const b=await readProductionCoordination(tx as any,'demo','2026-10-20');
 expect(a).toEqual(b);expect(a.policy.nationalReferences).toHaveLength(22);expect(a.policy.targets).toEqual([]);expect(a.policy.economicReferences).toBeUndefined();
 expect(JSON.stringify(saved)).toBe(before);expect(writes).toBe(0);
 a.policy.nationalReferences!.pop();expect((await readProductionCoordination(tx as any,'demo','2026-10-20')).policy.nationalReferences).toHaveLength(22);
 const explicit={...tx,workRecord:{...tx.workRecord,findUnique:async()=>({payload:{...saved,nationalReferences:[]},version:8})}};
 expect((await readProductionCoordination(explicit as any,'demo','2026-10-20')).policy.nationalReferences).toEqual([]);
});
