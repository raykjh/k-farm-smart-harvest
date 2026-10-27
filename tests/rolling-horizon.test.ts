import {it,expect} from 'vitest';
import {jointSource} from './integrated-plan-fixture';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal} from '../lib/integrated-plan';
import {regionalRuleProposal} from '../lib/regional-portfolio';

async function scenario(count=8){
 const s=jointSource('demo',count);(s.coordination as {origin:string}).origin='DEMO';s.criteria.profiles[0].dataOrigin='DEMO';
 s.fields.forEach((f,i)=>{if(i>=4)f.conditions!.climate.pepper='unsuitable'});
 s.coordination.policy.yields=[{crop:'potato',commodity:'POTATO',kgPer1000m2:{low:1000,high:1200},sourceUrl:'https://example.org/synthetic-test',method:'Synthetic test only',checkedOn:'2026-01-01',validUntil:'2027-12-31'}];
 s.coordination.policy.planningLimits=[{id:'trial-quota',version:'test',commodity:'POTATO',crops:['potato'],centerIds:['demo'],origin:'DEMO',from:'2027-01-01',to:'2027-12-31',maxKg:4800,mode:'HARD',basis:'REVIEWED_PARTICIPANT_TARGET',sourceKind:'SYNTHETIC',sourceUrl:'https://example.org/synthetic-test',checkedOn:'2026-01-01',validUntil:'2027-12-31'}];
 return collectJointSnapshot([s],['demo']);
}
it('compares scheduled later-field area while preserving the exact current proposal and writing no future approval',async()=>{
 const snapshot=await scenario(),before=JSON.stringify(snapshot);
 const baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot)),regional=await evaluateJointProposal(snapshot,regionalRuleProposal(snapshot));
 expect(baseline.metrics.horizonReadyAreaM2).toBe(4000);
 expect(regional.metrics.horizonReadyAreaM2).toBe(8000);
 expect(regional.horizon).toMatchObject({evaluatedFields:8,omittedFields:0,missingTasks:0,reserved:false,approvalRequired:true});
 expect(regional.metrics.fields).toBe(snapshot.fields.length);
 expect(regional.views.flatMap(v=>v.choices)).toHaveLength(snapshot.fields.length);
 expect(regional.proposal).toEqual(regionalRuleProposal(snapshot));
 expect(JSON.stringify(snapshot)).toBe(before);
});
it('keeps the horizon bounded and reports omitted registrations instead of claiming a national plan',async()=>{
 const snapshot=await scenario(16),result=await evaluateJointProposal(snapshot,regionalRuleProposal(snapshot));
 expect(result.horizon.evaluatedFields).toBe(12);expect(result.horizon.omittedFields).toBe(4);
 expect(result.horizon.missingTasks).toBeGreaterThan(0);expect(result.metrics.fields).toBeLessThan(12);
});
