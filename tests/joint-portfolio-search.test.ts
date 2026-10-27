import {expect,it} from 'vitest';
import {portfolioSource} from './portfolio-search-fixture';
import {jointSource} from './integrated-plan-fixture';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {regionalRuleProposal} from '../lib/regional-portfolio';
import {discoverJointAlternatives} from '../lib/joint-portfolio-search';
import {adviseJointPlan} from '../lib/integrated-plan-adviser';

it.each(['production-target','harvest-collision'] as const)('finds feasible crop mixtures under %s without converting missing labor to capacity',async kind=>{
 const snapshot=await collectJointSnapshot([portfolioSource(kind)],['demo']),before=JSON.stringify(snapshot);
 const baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot)),reference=await evaluateJointProposal(snapshot,regionalRuleProposal(snapshot));
 expect(baseline.metrics.missingTasks+baseline.metrics.hardLimitViolations).toBeGreaterThan(0);
 expect(reference.metrics.missingTasks).toBe(0);
 const found=await discoverJointAlternatives(snapshot,baseline,[baseline,reference]);
 expect(found.audit.status).toBe('COMPLETE');expect(found.audit.trials).toHaveLength(8);
 const best=found.additions[0];expect(best.metrics.missingTasks).toBe(0);expect(best.metrics.hardLimitViolations).toBe(0);
 expect(best.metrics.horizonReadyAreaM2).toBe(reference.metrics.horizonReadyAreaM2);
 expect(best.metrics.personHours).toBeLessThan(reference.metrics.personHours*0.9);
 expect(best.metrics.baseBalanceWon).toBeNull();expect(best.reserved).toBe(false);
 expect(JSON.stringify(snapshot)).toBe(before);
},30000);

it('requires an actual model selection, full candidate references, and keeps every search trial in the decision',async()=>{
 const snapshot=await collectJointSnapshot([portfolioSource('production-target')],['demo']),baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));let calls=0;
 const decision=await adviseJointPlan(snapshot,baseline,async body=>{
  calls++;const messages=body.messages as any[],input=JSON.parse(messages[1].content);
  const facts=calls===1?null:JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);
  const args=calls===1?{choices:Object.fromEntries(input.fields.map((f:any)=>[f.id,f.options.find((o:any)=>o.crop==='pepper').id])),staffing:'CORE_AND_PEAK'}:{evaluationId:facts.cropSearch.offered[0].id,assessments:Object.fromEntries(facts.evaluatedIds.map((id:string)=>[id,'personHours']))};
  return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'local-mock',type:'function',function:{name:calls===1?'evaluate_plan':'select_plan',arguments:JSON.stringify(args)}}]}}]};
 });
 expect(calls).toBe(2);expect(decision.portfolioAudit?.trials).toHaveLength(8);
 expect(decision.alternatives.length).toBeLessThanOrEqual(3);expect(decision.modelReferences.evaluationId).toMatch(/^E[23]$/);
 expect(decision.selected.metrics.hardLimitViolations).toBe(0);expect(decision.selected.metrics.missingTasks).toBe(0);
},30000);

it('keeps candidate order and source data stable and bounds large spaces without pruning options',async()=>{
 const snapshot=await collectJointSnapshot([portfolioSource('production-target')],['demo']),base=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
 const a=await discoverJointAlternatives(snapshot,base,[base]),reverse=structuredClone(snapshot);reverse.fields.reverse();reverse.fields.forEach(f=>f.options.reverse());
 const b=await discoverJointAlternatives(reverse,base,[base]);expect(b.audit.trials.map(t=>t.evaluationId)).toEqual(a.audit.trials.map(t=>t.evaluationId));
 const large=structuredClone(snapshot);large.fields.forEach(f=>f.options.push({...f.options[0],id:'O999'}));
 const skipped=await discoverJointAlternatives(large,base,[base]);expect(skipped.audit.status).toBe('TOO_LARGE');expect(skipped.audit.trials).toHaveLength(0);
},30000);

it('does not add searches to a feasible initial plan',async()=>{
 const snapshot=await collectJointSnapshot([jointSource()],['demo']),base=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
 expect((await discoverJointAlternatives(snapshot,base,[base])).audit.status).toBe('NOT_NEEDED');
});
