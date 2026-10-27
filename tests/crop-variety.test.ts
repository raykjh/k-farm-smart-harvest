import {it,expect} from 'vitest';
import {checkVariety,varietyYield,type VarietyReview,varietyReviewSchema} from '../lib/crop-variety';
import {emptyConditions} from '../lib/field-conditions';
import {calculateProduction} from '../lib/production-service';
import {jointSource} from './integrated-plan-fixture';
import {reviewPlanContribution} from '../lib/production-coordination-store';
import {aggregateProduction,emptyCoordinationPolicy,type ProductionContribution} from '../lib/production-coordination';

const review=(extra:Partial<VarietyReview>={}):VarietyReview=>({id:'synthetic-potato-a',version:'fixture-v1',name:'Synthetic variety A',crop:'potato',commodity:'potato',regions:['계북면'],status:'TRIAL',harvest:{from:'2027-01-01',to:'2027-12-31'},supplyAreaM2:2000,trialAreaM2:1000,yieldKgPer1000m2:{low:400,high:500},sourceKind:'SYNTHETIC',sourceUrl:'https://example.org/variety-fixture',checkedOn:'2026-01-01',validUntil:'2027-12-31',...extra});
const input=(r=review())=>({review:r,conditions:{...emptyConditions(),region:'계북면'},crop:r.crop,areaM2:1000,centerId:'demo',origin:'DEMO' as const,today:'2026-10-26',harvest:{from:'2027-06-01',to:'2027-06-20'},existing:[] as ProductionContribution[],candidateId:'new'});
it('checks reviewed region, supply and trial area before specialty scoring',()=>{
 expect(checkVariety(input()).eligible).toBe(true);
 expect(checkVariety({...input(),areaM2:1001}).reasons).toContain('VARIETY_TRIAL_LIMIT');
 expect(checkVariety({...input(),review:review({supplyAreaM2:null})}).reasons).toContain('VARIETY_SUPPLY_REVIEW');
 expect(checkVariety({...input(),conditions:{...emptyConditions(),region:'other'}}).reasons).toContain('VARIETY_REGION_REVIEW');
});
it('reserves trial area across existing and proposed cultivations of the same variety',()=>{
 const p=input();p.existing=[{id:'old',centerId:'demo',crop:'potato',areaM2:700,year:2027,commodity:'potato',kg:{low:280,high:350},origin:'DEMO',basis:'synthetic',varietyId:p.review.id,harvestPeriod:p.harvest}];
 expect(checkVariety(p).reasons).toContain('VARIETY_TRIAL_LIMIT');
 expect(checkVariety({...p,areaM2:300}).eligible).toBe(true);
});
it('blocks future/expired/season-mismatched evidence and real-data reuse of synthetic variety inputs',()=>{
 for(const r of [review({checkedOn:'2026-12-01'}),review({validUntil:'2026-01-02'}),review({harvest:{from:'2027-07-01',to:'2027-12-31'}})])expect(checkVariety(input(r)).eligible).toBe(false);
 expect(checkVariety({...input(),origin:'REGISTERED'}).eligible).toBe(false);
});
const apple=()=>review({id:'synthetic-apple-a',crop:'apple',commodity:'apple',status:'ESTABLISHED',supplyAreaM2:null,trialAreaM2:null,yieldKgPer1000m2:null,orchard:{minimumBearingYears:4,pollinationRequired:true,compatiblePollinizers:['synthetic-apple-b'],ageYields:[{fromAge:4,toAge:20,kgPer1000m2:{low:1000,high:1500}}]}});
it('preserves existing bearing variety even if a consent flag is present, and requires reviewed pollination',()=>{
 const p=input(apple());p.conditions={...p.conditions,landUse:'orchard',existingBearingOrchard:true,existingOrchardCrop:'apple',orchard:{varietyId:'synthetic-apple-a',plantedYear:2020,stage:'BEARING',changeConsent:false,pollinizerVarietyIds:['synthetic-apple-b']}};
 expect(checkVariety(p).eligible).toBe(true);
 expect(checkVariety({...p,conditions:{...p.conditions,orchard:{...p.conditions.orchard!,varietyId:'different',changeConsent:true}}}).reasons).toContain('EXISTING_VARIETY_PRESERVED');
 expect(checkVariety({...p,conditions:{...p.conditions,orchard:{...p.conditions.orchard!,pollinizerVarietyIds:[]}}}).reasons).toContain('POLLINATION_REVIEW');
});
it('never assigns mature yield or an executable annual conversion to a newly planted orchard',()=>{
 const p=input(apple());p.conditions={...p.conditions,landUse:'orchard',orchard:{varietyId:p.review.id,plantedYear:2026,stage:'NEW_PLANTING',changeConsent:true,pollinizerVarietyIds:['synthetic-apple-b']}};
 expect(varietyYield(p.review,p.conditions,2027)).toEqual({low:0,high:0});
 expect(checkVariety(p)).toMatchObject({eligible:false});
 expect(checkVariety(p).reasons).toContain('IMMATURE_ORCHARD');
});
it('rejects overlapping age bands and unknown age yields instead of using an adult default',()=>{
 const r=apple();r.orchard!.ageYields.push({fromAge:10,toAge:25,kgPer1000m2:{low:1000,high:2000}});
 expect(varietyReviewSchema.safeParse(r).success).toBe(false);
 expect(varietyYield(apple(),{...emptyConditions(),orchard:{varietyId:'synthetic-apple-a',plantedYear:1980,stage:'BEARING',changeConsent:false,pollinizerVarietyIds:[]}},2027)).toBeNull();
});
it('normal production admits only available trial area, persists its variety context, and aggregates by parent commodity once',async()=>{
 const s=jointSource();s.criteria.profiles[0].dataOrigin='DEMO';s.criteria.profiles[0].context.variety=review();
 const view=await calculateProduction(s,undefined,{choices:s.fields.map(f=>({pnu:f.pnu,crop:'potato',profileId:s.criteria.profiles[0].id}))});
 expect(view.items.map(i=>i.status)).toEqual(['REVIEW','BLOCKED']);
 const p=view.items[0].proposal!.plan;
 expect(view.items[0].criteriaName).toContain('Synthetic variety A');
 const a=reviewPlanContribution(p,{id:'saved-a',centerId:'demo',crop:'potato',origin:'DEMO'},emptyCoordinationPolicy(),s.today).contribution;
 const b={...a,id:'saved-b',varietyId:'synthetic-potato-b'};
 expect(aggregateProduction([a,b])).toEqual([{commodity:'potato',year:2027,origin:'DEMO',kg:{low:800,high:1000},cultivations:2}]);
});
