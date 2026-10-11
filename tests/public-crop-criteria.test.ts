import {describe,it,expect} from 'vitest';
import {cropCodes} from '../lib/crop-registry';
import {publicYieldCriteria,publicRegionalCriteria,publicCriteriaCoverage,yieldPolicyDraft,regionalPolicyDraft,PUBLIC_CRITERIA_CHECKED_ON} from '../lib/public-crop-criteria';
import {emptyCoordinationPolicy,coordinationPolicySchema,candidateContribution,coordinateCandidate} from '../lib/production-coordination';
import {informationCrop} from '../lib/operating-information';

describe('reviewed public reference data, not operational defaults',()=>{
 it('covers 12 sourced yields and explicitly leaves 18 unavailable',()=>{
  expect(publicYieldCriteria).toHaveLength(12);expect(publicCriteriaCoverage).toHaveLength(30);
  expect(publicCriteriaCoverage.filter(r=>r.yield==='NOT_COLLECTED')).toHaveLength(18);
  expect(new Set(publicYieldCriteria.map(r=>r.crop)).size).toBe(12);
  for(const r of publicYieldCriteria){
   expect(cropCodes).toContain(r.crop);expect(new URL(r.sourceUrl).hostname).toBe('mods.go.kr');
   expect(r.years).toHaveLength(r.values.length);expect(r.publishedOn<=PUBLIC_CRITERIA_CHECKED_ON).toBe(true);
   expect(r.kgPer1000m2).toEqual({low:Math.min(...r.values),high:Math.max(...r.values)});
   expect(r.locator).toContain('PDF');expect(informationCrop(r.crop)?.publicYieldReference).toBe(r);
   expect(yieldPolicyDraft(r.id)).not.toHaveProperty('validUntil');
   expect(coordinationPolicySchema.parse({...emptyCoordinationPolicy(),yields:[{...yieldPolicyDraft(r.id),validUntil:'2027-12-31'}]}).yields).toHaveLength(1);
  }
  expect(informationCrop('peach')!.publicYieldReference).toBeNull();
 });
 it('preserves crop practice, grain basis and bearing-orchard qualifications',()=>{
  expect(publicYieldCriteria.find(r=>r.crop==='rice')!.commodity).toBe('MILLED_RICE_92_9');
  expect(publicYieldCriteria.find(r=>r.crop==='potato')!.commodity).toBe('FRESH_SPRING_POTATO');
  expect(publicYieldCriteria.find(r=>r.crop==='pepper')!.qualification[0]).toContain('임의 환산');
  expect(publicYieldCriteria.find(r=>r.crop==='barley')!.kgPer1000m2).toEqual({low:365,high:365});
  expect(publicYieldCriteria.find(r=>r.crop==='apple')!.qualification[0]).toContain('미성목');
  expect(publicYieldCriteria.find(r=>r.crop==='garlic')!.years).toEqual([2025,2026]);
 });
 it('does not seed policies or substitute historical output for an appropriate-supply target',()=>{
  const policy=emptyCoordinationPolicy(),today=PUBLIC_CRITERIA_CHECKED_ON;
  const input={id:'one',centerId:'demo',crop:'rice' as const,areaM2:1000,harvestYears:[2027],origin:'REGISTERED' as const};
  expect(candidateContribution(input,policy,today).kg).toBeNull();
  policy.yields=[{...yieldPolicyDraft(publicYieldCriteria[0].id),validUntil:'2027-12-31'}];
  const contribution=candidateContribution(input,policy,today);
  expect(contribution.kg).toEqual({low:514,high:530});
  expect(coordinateCandidate(contribution,90,{policy,today,centerId:'demo',origin:'REGISTERED',contributions:[]}).supply.penalty).toBe(0);
  expect(policy.targets).toEqual([]);expect(policy.specialties).toEqual([]);
  policy.yields[0].validUntil='2026-10-02';expect(candidateContribution(input,policy,today).kg).toBeNull();
 });
 it('limits county evidence to review candidates, zero bonus, and the four relevant centers',()=>{
  expect(publicRegionalCriteria.scope).toBe('COUNTY_CONTEXT_ONLY');
  for(const center of publicRegionalCriteria.centerIds)for(const crop of publicRegionalCriteria.crops){
   const draft=regionalPolicyDraft(center,crop);expect(draft).toMatchObject({centerId:center,crop,status:'DEVELOPMENT_CANDIDATE',bonus:0});
   expect(draft).not.toHaveProperty('validUntil');expect(draft.method).toContain('면별 확인 전');
   expect(coordinationPolicySchema.parse({...emptyCoordinationPolicy(),specialties:[{...draft,validUntil:'2027-12-31'}]}).specialties).toHaveLength(1);
  }
  expect(()=>regionalPolicyDraft('unknown','apple')).toThrow();expect(()=>regionalPolicyDraft('demo','rice')).toThrow();
 });
});
