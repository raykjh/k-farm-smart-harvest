import {it,expect,vi,afterEach} from 'vitest';
import {emptyCoordinationPolicy,coordinationPolicySchema,candidateContribution,coordinateCandidate,aggregateProduction,marketOutlook,type CoordinationContext} from '../lib/production-coordination';
import {harvestYears} from '../lib/production-coordination-store';
const evidence={sourceUrl:'https://example.com/isolated-test-only',method:'synthetic test',checkedOn:'2026-01-01',validUntil:'2027-12-31'};
const context=():CoordinationContext=>({today:'2026-10-03',centerId:'demo',origin:'REGISTERED',contributions:[],policy:{...emptyCoordinationPolicy(),yields:[{crop:'rice',commodity:'MILLED_RICE',kgPer1000m2:{low:400,high:500},...evidence}],targets:[{commodity:'MILLED_RICE',year:2027,origin:'REGISTERED',kg:1000,...evidence}]}});
const candidate=(c:CoordinationContext,id='one',areaM2=1000)=>candidateContribution({id,centerId:'demo',crop:'rice',areaM2,harvestYears:[2027],origin:'REGISTERED'},c.policy,c.today);
it('separates origins, harvest years and commodities and rejects duplicate cultivation IDs',()=>{
 const c=context(),a=candidate(c);expect(aggregateProduction([a,{...a,id:'demo',origin:'DEMO'},{...a,id:'year',year:2026},{...a,id:'basis',commodity:'PADDY_RICE'}])).toHaveLength(4);
 expect(()=>aggregateProduction([a,a])).toThrow('중복');
 expect(coordinateCandidate(a,90,c).supply.penalty).toBe(0);
 c.contributions=[{...a,id:'other',kg:{low:1800,high:2000}}];expect(coordinateCandidate(a,90,c).supply.penalty).toBe(3);
});
it('accumulates earlier accepted candidates and does not hide unknown production as zero',()=>{
 const c=context();c.contributions.push(candidate(c,'first',2000));
 const a=coordinateCandidate(candidate(c,'next',2000),90,c);expect(a.registeredTotal).toEqual({low:1600,high:2000});expect(a.supply.penalty).toBeGreaterThan(0);
 const unknown=candidateContribution({id:'unknown',centerId:'demo',crop:'pear',areaM2:1000,harvestYears:[2027],origin:'REGISTERED'},c.policy,c.today);expect(unknown.kg).toBeNull();expect(coordinateCandidate(unknown,90,c).supply.status).toBe('INSUFFICIENT_DATA');
});
it('does not invent penalties for expired sources, incompatible years, missing area or cross-year harvests',()=>{
 const c=context();c.policy.targets[0].validUntil='2026-01-02';expect(coordinateCandidate(candidate(c,'large',100000),90,c).supply.penalty).toBe(0);
 c.policy.yields[0].validUntil='2026-01-02';expect(candidate(c).kg).toBeNull();
 expect(candidateContribution({id:'u',centerId:'demo',crop:'rice',areaM2:null,harvestYears:[2026,2027],origin:'REGISTERED'},c.policy,c.today)).toMatchObject({year:null,kg:null});
 expect(harvestYears({plots:[{tasks:[{operationCode:'finish',window:{from:'2027-01-01',to:'2027-01-10'}},{operationCode:'harvest',window:{from:'2026-12-01',to:'2026-12-10'}}]}]} as any)).toEqual([2026]);
});
it('gives reviewed established specialties priority without suppressing resource or suitability checks',()=>{
 const c=context();c.policy.specialties=[{centerId:'demo',crop:'rice',status:'ESTABLISHED',bonus:4,...evidence}];
 const result=coordinateCandidate(candidate(c),100,c);expect(result.score).toBe(100);expect(result.rankingScore).toBe(104);
 c.policy.specialties[0].centerId='janggye';expect(coordinateCandidate(candidate(c),100,c).specialtyBonus).toBe(0);
});
it('validates evidence, ranges, duplicate policies and bounded weights',()=>{
 const c=context();expect(coordinationPolicySchema.parse(c.policy)).toEqual(c.policy);
 c.policy.yields.push(c.policy.yields[0]);expect(()=>coordinationPolicySchema.parse(c.policy)).toThrow();
 expect(()=>coordinationPolicySchema.parse({...emptyCoordinationPolicy(),specialties:[{centerId:'demo',crop:'rice',status:'ESTABLISHED',bonus:6,...evidence}]})).toThrow();
});
it('uses national outlook only for a matching commodity, full harvest period and valid evidence',()=>{
 const c=context(),a={...candidate(c),harvestPeriod:{from:'2027-10-01',to:'2027-10-31'}};
 const outlook={crop:'rice' as const,commodity:'MILLED_RICE',from:'2027-09-01',to:'2027-11-01',pressure:'OVERSUPPLY_RISK' as const,...evidence};
 c.policy.marketOutlooks=[outlook];
 expect(marketOutlook(a,c).status).toBe('OVERSUPPLY_RISK');
 expect(coordinateCandidate(a,90,c).registeredTotal).toEqual(a.kg); // no national totals added
 for(const patch of [{commodity:'PADDY_RICE'},{from:'2027-10-02'},{to:'2027-10-30'},{validUntil:'2026-01-01'},{checkedOn:'2026-12-01'}]){
  c.policy.marketOutlooks=[{...outlook,...patch}];expect(marketOutlook(a,c).status).toBe('UNKNOWN');
 }
 c.policy.marketOutlooks=[outlook];expect(marketOutlook({...a,harvestPeriod:null},c).status).toBe('UNKNOWN');
 expect(()=>coordinationPolicySchema.parse({...c.policy,marketOutlooks:[outlook,outlook]})).toThrow('중복');
});
it('keeps development specialties as trial candidates and cannot invent a specialty from climate alone',()=>{
 const c=context();expect(coordinateCandidate(candidate(c),100,c).specialtyStatus).toBe('NOT_REVIEWED');
 c.policy.specialties=[{centerId:'demo',crop:'rice',status:'DEVELOPMENT_CANDIDATE',bonus:3,...evidence}];
 expect(coordinateCandidate(candidate(c),100,c)).toMatchObject({specialtyStatus:'DEVELOPMENT_CANDIDATE',specialtyReference:{sourceUrl:evidence.sourceUrl}});
 c.policy.specialties.push({centerId:'demo',crop:'potato',status:'ESTABLISHED',bonus:3,...evidence});
 expect(coordinateCandidate(candidate(c),100,c).specialtyStatus).toBe('NOT_REVIEWED');
});
