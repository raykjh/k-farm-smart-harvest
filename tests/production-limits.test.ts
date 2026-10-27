import {describe,it,expect} from 'vitest';
import {candidateLimitCheck,productionLimitUsage,productionLimitsSchema,type ProductionLimit} from '../lib/production-limits';
import type {ProductionContribution} from '../lib/production-coordination';
import {calculateProduction} from '../lib/production-service';
import {jointSource} from './integrated-plan-fixture';

export const limit=(changes:Partial<ProductionLimit>={}):ProductionLimit=>({id:'potato-2027',version:'synthetic-v1',commodity:'potato',crops:['potato'],centerIds:['demo'],origin:'DEMO',from:'2027-01-01',to:'2027-12-31',maxKg:500,mode:'HARD',basis:'REVIEWED_PARTICIPANT_TARGET',sourceKind:'SYNTHETIC',sourceUrl:'https://example.org/synthetic-fixture',checkedOn:'2026-01-01',validUntil:'2027-12-31',...changes});
const contribution=(id:string,changes:Partial<ProductionContribution>={}):ProductionContribution=>({id,centerId:'demo',crop:'potato',areaM2:1000,year:2027,commodity:'potato',kg:{low:400,high:500},origin:'DEMO',basis:'SYNTHETIC',harvestPeriod:{from:'2027-06-01',to:'2027-06-20'},...changes});

describe('reviewed participant production limits',()=>{
 it('counts a cultivation once and evaluates upper/lower ranges without inventing national demand',()=>{
  expect(productionLimitUsage(limit(),[contribution('a')],'2026-10-26')).toMatchObject({lowKg:400,highKg:500,remainingKg:0,status:'WITHIN_REFERENCE',coverage:'EXPLICIT_PARTICIPANTS_ONLY'});
  expect(()=>productionLimitUsage(limit(),[contribution('a'),contribution('a')],'2026-10-26')).toThrow('중복');
 });
 it('blocks the next crop after the annual headroom is consumed, but not other centers or origins',()=>{
  expect(candidateLimitCheck(contribution('b'),[contribution('a')],[limit()],'2026-10-26').blocked).toBe(true);
  expect(candidateLimitCheck(contribution('b',{centerId:'other'}),[contribution('a')],[limit()],'2026-10-26').blocked).toBe(false);
  expect(candidateLimitCheck(contribution('b',{origin:'REGISTERED'}),[contribution('a')],[limit()],'2026-10-26').blocked).toBe(false);
 });
 it('keeps missing yield, missing harvest period and stale references unknown, not safe',()=>{
  for(const row of [contribution('a',{kg:null}),contribution('a',{harvestPeriod:null}),contribution('a',{commodity:'wrong'})])expect(candidateLimitCheck(row,[],[limit()],'2026-10-26').blocked).toBe(true);
  expect(candidateLimitCheck(contribution('a'),[],[limit({validUntil:'2026-02-01'})],'2026-10-26').blocked).toBe(true);
 });
 it('does not turn an advisory ceiling into a hard prohibition',()=>expect(candidateLimitCheck(contribution('b'),[contribution('a')],[limit({mode:'ADVISORY'})],'2026-10-26').blocked).toBe(false));
 it('checks seasonal concentration even with annual headroom, counting partial overlap in full',()=>{
  const rows=[contribution('a'),contribution('b')],annual=limit({maxKg:2000}),season=limit({id:'june',from:'2027-06-10',to:'2027-06-15',maxKg:750});
  expect(productionLimitUsage(annual,rows,'2026-10-26').status).toBe('WITHIN_REFERENCE');
  expect(productionLimitUsage(season,rows,'2026-10-26')).toMatchObject({status:'EXCEEDED',excessKg:250,partialPeriod:true});
 });
 it('rejects an invented national quota basis or synthetic target applied to real-origin records',()=>{
  expect(productionLimitsSchema.safeParse([{...limit(),basis:'NATIONAL_FORECAST'}]).success).toBe(false);
  expect(productionLimitsSchema.safeParse([limit({origin:'REGISTERED'})]).success).toBe(false);
 });
 it('uses the same cap in the normal production calculation and leaves existing source data untouched',async()=>{
  const source=jointSource('demo',2);source.criteria.profiles[0].dataOrigin='DEMO';
  source.coordination.policy.yields=[{crop:'potato',commodity:'potato',kgPer1000m2:{low:400,high:500},sourceUrl:'https://example.org/synthetic-fixture',method:'synthetic only',checkedOn:'2026-01-01',validUntil:'2027-12-31'}];
  source.coordination.policy.planningLimits=[limit()];
  const before=JSON.stringify(source),view=await calculateProduction(source,undefined,{choices:source.fields.map(f=>({pnu:f.pnu,crop:'potato',profileId:source.criteria.profiles[0].id}))});
  expect(view.items.map(i=>i.status)).toEqual(['REVIEW','BLOCKED']);
  expect(view.items[1].reason).toContain('생산 목표');
  expect(JSON.stringify(source)).toBe(before);
 });
});
