import {it,expect} from 'vitest';
import {cropCatalog,cropProfileSchema,assessCropService,legacyCatalogProfile} from '../lib/crop-catalog';
import {cropWorkProfileSchema,currentWorkMethods} from '../lib/crop-work-profile';
import {buildAnnualPlan} from '../lib/annual-plan';
const profile=legacyCatalogProfile('rice')!;
const context={region:'계북면',practice:profile.practice,areaM2:1000,today:'2026-09-20'};
const review={profileId:profile.id,region:context.region,practice:context.practice,minAreaM2:100,maxAreaM2:2000,reviewedBy:'test',validUntil:'2026-12-31',evidenceUrls:['https://example.org/test'],deliverable:'YES',smartFarm:'NOT_CLEARLY_BETTER',cooperativeBenefit:'BETTER',rationale:'Synthetic test comparison only',commercialReuseCleared:true};
it('stores versioned catalog entries without pretending they are operational crops',()=>{
 expect(cropCatalog.length).toBeGreaterThan(100);expect(new Set(cropCatalog.map(c=>c.id)).size).toBe(cropCatalog.length);
 expect(cropCatalog.every(c=>cropProfileSchema.safeParse(c).success)).toBe(true);
 expect(cropCatalog.filter(c=>c.legacyPlanner)).toHaveLength(3);
 expect(cropCatalog.filter(c=>c.category==='ORCHARD').every(c=>c.orchard?.bearing==='UNREVIEWED')).toBe(true);
});
it('does not manufacture comparative efficiency or smart-farm superiority',()=>{
 expect(assessCropService(profile,null,context).decision).toBe('REVIEW_REQUIRED');
 expect(assessCropService(profile,{...review,smartFarm:'UNKNOWN'},context).decision).toBe('REVIEW_REQUIRED');
 expect(assessCropService(profile,{...review,smartFarm:'CLEARLY_BETTER'},context).decision).toBe('SMART_FARM_FIRST');
 expect(assessCropService(profile,{...review,cooperativeBenefit:'NOT_BETTER'},context).decision).toBe('OUT_OF_SCOPE');
 expect(assessCropService(profile,review,context)).toMatchObject({decision:'KFARM_CANDIDATE',automaticScheduling:false});
});
it('requires matching region, practice, area, validity and reuse permission',()=>{
 for(const r of [{...review,region:'다른 지역'},{...review,practice:'다른 작형'},{...review,validUntil:'2026-01-01'},{...review,maxAreaM2:500},{...review,commercialReuseCleared:false},{...review,evidenceUrls:[]}])expect(assessCropService(profile,r,context).decision).toBe('REVIEW_REQUIRED');
});
const manual={mode:'MANUAL',availability:'CURRENT',capability:null,operators:0,workers:2,transportVehicles:0,minutesPer1000m2:100,setupMinutes:10,sourceUrl:'https://example.org/test'};
const orchard={catalogProfileId:'test-apple',version:'test',region:'test',practice:'test',lifecycle:'PERENNIAL',orchardStage:'BEARING',status:'REVIEWED',reviewer:'test',sourceUrls:['https://example.org/test'],operations:[{code:'harvest',name:'test',criticality:'BLOCKING',trigger:'PHENOLOGY',windowBasis:'test only',predecessors:[],recurrence:'ANNUAL',methods:[manual]}]};
it('supports orchard stages, recurrence and current manual work without inventing automation',()=>{
 const p=cropWorkProfileSchema.parse(orchard);expect(currentWorkMethods(p,'harvest')).toHaveLength(1);
 expect(cropWorkProfileSchema.safeParse({...orchard,orchardStage:null}).success).toBe(false);
 const op=orchard.operations[0];
 expect(cropWorkProfileSchema.safeParse({...orchard,operations:[{...op,methods:[{...manual,availability:'FUTURE_ONLY'}]}]}).success).toBe(false);
 expect(cropWorkProfileSchema.safeParse({...orchard,operations:[{...op,predecessors:['harvest']}]}).success).toBe(false);
 expect(cropWorkProfileSchema.safeParse({...orchard,operations:[{...op,methods:[{...manual,mode:'AUTOMATED_WITH_OPERATOR',capability:'harvester',operators:0}]}]}).success).toBe(false);
});
it('blocks catalog-only crops from the legacy planner with an explicit message',()=>{
 expect(()=>buildAnnualPlan([{pnu:'test',address:'test',area:1000,crop:'apple',mode:'full',group:'',rights:'pending'}] as any,2026,1)).toThrow('작업 프로필');
});
