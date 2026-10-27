import {expect,it,vi} from 'vitest';
import {adviseJointPlan,jointSelectionReview,verifyRegionalSelection} from '../lib/integrated-plan-adviser';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {jointSource} from './integrated-plan-fixture';

const tool=(name:string,args:unknown)=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'review-test',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
async function setup(){const snapshot=await collectJointSnapshot([jointSource()],['demo']);return {snapshot,baseline:await evaluateJointProposal(snapshot,jointRuleProposal(snapshot))};}
function completion(correct=true){let n=0;return vi.fn(async(body:Record<string,unknown>)=>{
 n++;const input=JSON.parse((body.messages as any[])[1].content);
 if(n===1)return tool('evaluate_plan',{choices:Object.fromEntries(input.fields.map((f:any)=>[f.id,f.options.find((o:any)=>o.crop==='pepper').id])),staffing:'CORE_AND_PEAK'});
 return tool('select_plan',{evaluationId:correct&&n===3?'E0':'E1',assessments:{E0:'personHours',E1:'personHours'}});
});}
it('lets the model correct one dominated selection and records the rejected model choice',async()=>{
 const {snapshot,baseline}=await setup(),complete=completion();
 const before=structuredClone(snapshot),d=await adviseJointPlan(snapshot,baseline,complete,'regional-review');
 expect(complete).toHaveBeenCalledTimes(3);expect(d.selected.id).toBe(baseline.id);
 expect(d.selectionAudit?.rejectedSelections).toEqual([{step:1,arguments:{evaluationId:'E1',assessments:{E0:'personHours',E1:'personHours'}},reason:'모든 운영 지표가 같거나 더 나은 계산 대안이 있습니다.'}]);
 expect(d.selectionAudit?.review.rows.map(r=>r.evaluationId)).toEqual(['E0','E1']);
 expect(snapshot).toEqual(before);expect(d.selected.reserved).toBe(false);
});
it('does not accept repeated bad choices or add a second semantic correction',async()=>{
 const {snapshot,baseline}=await setup(),complete=completion(false);
 await expect(adviseJointPlan(snapshot,baseline,complete,'regional-review')).rejects.toThrow('더 나은 계산 대안');expect(complete).toHaveBeenCalledTimes(3);
});
it('keeps the legacy policy fail-closed without a correction turn',async()=>{
 const {snapshot,baseline}=await setup(),complete=completion();
 await expect(adviseJointPlan(snapshot,baseline,complete,'current')).rejects.toThrow('더 나은 계산 대안');expect(complete).toHaveBeenCalledTimes(2);
});
it('never retries an unknown transport outcome or a truncated response',async()=>{
 const {snapshot,baseline}=await setup();
 for(const action of ['network','truncation']){const base=completion(),complete=vi.fn(async(body:Record<string,unknown>)=>{
  if(complete.mock.calls.length===1)return base(body);
  if(action==='network')throw Error('Unknown paid outcome');
  return {choices:[{finish_reason:'length',message:{tool_calls:[]}}]};
 });await expect(adviseJointPlan(snapshot,baseline,complete,'regional-review')).rejects.toThrow();expect(complete).toHaveBeenCalledTimes(2);}
});
it('keeps the legacy regional protocol unchanged when no later registered fields exist',async()=>{
 const {snapshot,baseline}=await setup(),complete=completion();expect(snapshot.remaining).toBe(0);
 await expect(adviseJointPlan(snapshot,baseline,complete,'regional')).rejects.toThrow('더 나은 계산 대안');expect(complete).toHaveBeenCalledTimes(2);
 const second=complete.mock.calls[1][0];expect(JSON.stringify(second)).not.toContain('selectionReview');
});
it('reviews a feasible portfolio baseline and lets the model correct a dominated choice once',async()=>{
 const {snapshot,baseline}=await setup(),complete=completion(),legacy=completion(),portfolioInputs:unknown[]=[],legacyInputs:unknown[]=[];
 expect(snapshot.remaining).toBe(0);expect(baseline.metrics.missingTasks).toBe(0);
 const decision=await adviseJointPlan(snapshot,baseline,async body=>{portfolioInputs.push(structuredClone(body));return complete(body)});
 expect(complete).toHaveBeenCalledTimes(3);expect(decision.selected.id).toBe(baseline.id);
 expect(decision.portfolioAudit?.status).toBe('NOT_NEEDED');
 expect(decision.selectionAudit?.rejectedSelections).toHaveLength(1);
 expect(decision.selectionAudit?.review.rows.map(r=>r.evaluationId)).toEqual(['E0','E1']);
 await expect(adviseJointPlan(snapshot,baseline,async body=>{legacyInputs.push(structuredClone(body));return legacy(body)},'regional')).rejects.toThrow('더 나은 계산 대안');
 expect(portfolioInputs[0]).toEqual(legacyInputs[0]);
});
it('keeps repeated dominated portfolio choices blocked instead of selecting a server fallback',async()=>{
 const {snapshot,baseline}=await setup(),complete=completion(false);
 await expect(adviseJointPlan(snapshot,baseline,complete)).rejects.toThrow('더 나은 계산 대안');
 expect(complete).toHaveBeenCalledTimes(3);
});
it('uses the new review by default only when later registered fields remain',async()=>{
 const snapshot=await collectJointSnapshot([jointSource('demo',8)],['demo']),baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot)),complete=completion();
 expect(snapshot.remaining).toBeGreaterThan(0);const d=await adviseJointPlan(snapshot,baseline,complete);
 expect(d.selectionAudit?.version).toBe('regional-selection-review-v1');expect(d.selected.id).toBe(baseline.id);
 expect(d.selectionAudit?.rejectedSelections).toHaveLength(1);expect(complete).toHaveBeenCalledTimes(3);
});
it('prioritizes feasible trial area without choosing an infeasible larger plan or fabricating economics',async()=>{
 const {baseline}=await setup(),larger={...baseline,id:'f'.repeat(64),metrics:{...baseline.metrics,horizonReadyAreaM2:baseline.metrics.horizonReadyAreaM2+1000,personHours:baseline.metrics.personHours+50}};
 const all=new Map([[baseline.id,baseline],[larger.id,larger]]),refs=new Map([['E0',baseline.id],['E1',larger.id]]);
 expect(()=>verifyRegionalSelection(baseline,all)).toThrow('시험 면적');expect(()=>verifyRegionalSelection(larger,all)).not.toThrow();
 const review=jointSelectionReview(all,refs);expect(review.rows[1].deltaFromE0[review.columns.indexOf('horizonReadyAreaM2')]).toBe(1000);
 expect(review.columns).not.toContain('baseBalanceWon');expect(baseline.metrics.baseBalanceWon).toBeNull();expect(review.rows).toHaveLength(2);
 larger.metrics.hardLimitViolations=1;expect(()=>verifyRegionalSelection(baseline,all)).not.toThrow();expect(jointSelectionReview(all,refs).rows[1].feasible).toBe(false);
 larger.metrics.hardLimitViolations=0;larger.metrics.missingTasks=1;expect(()=>verifyRegionalSelection(baseline,all)).not.toThrow();
});
