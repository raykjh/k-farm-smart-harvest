import {it,expect} from 'vitest';
import {regionalPortfolio,regionalRuleProposal} from '../lib/regional-portfolio';
import {INTEGRATED_PLAN_VERSION,type JointField,type JointSnapshot} from '../lib/integrated-plan';
import {jointSource} from './integrated-plan-fixture';
import type {ProductionLimit} from '../lib/production-limits';

function scenario(first:number,last:number,area:number):JointSnapshot{
 const source=jointSource('demo',0);
 source.coordination.policy.planningLimits=(['potato','pepper'] as const).map(crop=>({id:crop,version:'synthetic-v1',commodity:crop,crops:[crop],centerIds:['demo'],origin:'DEMO',from:'2027-01-01',to:'2027-12-31',maxKg:(crop==='potato'?last:first)*area/2,mode:'HARD',basis:'REVIEWED_PARTICIPANT_TARGET',sourceKind:'SYNTHETIC',sourceUrl:'https://example.org/synthetic-fixture',checkedOn:'2026-01-01',validUntil:'2027-12-31'} satisfies ProductionLimit));
 const fields=Array.from({length:first+last},(_,i)=>({id:`F${i+1}`,centerId:'demo',pnu:`PRIVATE-${i}`,options:(i<first?['potato','pepper']:['potato']).map((crop,j)=>({id:`O${i*2+j+1}`,crop,profileId:crop,pnu:`PRIVATE-${i}`,score:crop==='potato'?100:90,ready:true,plan:{plan:{plots:[{area}]}},coordination:{production:{id:`proposal-${i}`,centerId:'demo',crop,areaM2:area,year:2027,commodity:crop,kg:{low:area/2,high:area/2},origin:'DEMO',basis:'SYNTHETIC',harvestPeriod:{from:'2027-06-01',to:'2027-06-20'}}}}))})) as unknown as JointField[];
 return {version:INTEGRATED_PLAN_VERSION,fingerprint:'test',sources:[source],scope:['demo'],fields:fields.slice(0,first),allFields:fields,excluded:[],remaining:last};
}
it.each([[2,2,1000],[3,3,750],[4,4,1200],[5,5,600]])('preserves later single-crop opportunities (%i/%i at %im2); candidate envelope only',(first,last,area)=>{
 const snapshot=scenario(first,last,area),greedy={staffing:'CORE_AND_PEAK' as const,choices:snapshot.fields.map(f=>({field:f.id,option:f.options[0].id}))};
 const current=regionalPortfolio(snapshot,greedy),reference=regionalRuleProposal(snapshot),improved=regionalPortfolio(snapshot,reference);
 expect(current.remainingCandidateAreaM2).toBe(0);
 expect(improved.remainingCandidateAreaM2).toBe(last*area);
 expect(improved.hardLimitViolations).toBe(0);
 expect(improved.jointlyScheduled).toBe(false);
 expect(snapshot.fields.map(f=>f.options.find(o=>o.id===reference.choices.find(c=>c.field===f.id)!.option)!.crop)).toEqual(Array(first).fill('pepper'));
});
it('does not invent future registrations; with no remaining fields there is no lookahead gain',()=>{
 const snapshot=scenario(2,2,1000);snapshot.allFields=snapshot.fields;snapshot.remaining=0;
 expect(regionalPortfolio(snapshot).remainingFields).toBe(0);
 expect(regionalPortfolio(snapshot).remainingCandidateAreaM2).toBe(0);
});
it('does not count unready future options as confirmed feasibility',()=>{
 const snapshot=scenario(2,2,1000);snapshot.allFields![2].options[0].ready=false;
 expect(regionalPortfolio(snapshot).remainingCandidateAreaM2).toBe(1000);
});
it('is insensitive to candidate ordering and does not mutate the inputs',()=>{
 const snapshot=scenario(3,3,800),before=JSON.stringify(snapshot),a=regionalRuleProposal(snapshot);
 const reverse=structuredClone(snapshot);reverse.allFields!.reverse();reverse.allFields!.forEach(f=>f.options.reverse());
 expect(regionalRuleProposal(reverse)).toEqual(a);expect(JSON.stringify(snapshot)).toBe(before);
});
