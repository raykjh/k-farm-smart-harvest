import {it,expect} from 'vitest';
import {regionalStandardSchema} from '../lib/regional-crop-standard';
import {cropCatalog} from '../lib/crop-catalog';
const draft={catalogProfileId:cropCatalog[0].id,region:'계북면',practice:'테스트',variety:'',status:'DRAFT',reviewer:'',orchardStage:null,yieldLowKgPer1000m2:null,yieldHighKgPer1000m2:null,sourceUrls:[],notes:'테스트',operations:[]};
const op={code:'harvest',name:'수확',from:'09-01',to:'10-01',crossYear:false,minTemperatureC:null,maxTemperatureC:null,basis:'검증용',mode:'MANUAL',capability:'',workers:1,operators:0,minutesPer1000m2:100,sourceUrl:'https://example.org/source'};
it('allows incomplete draft without inventing yield and blocks unsupported catalog identity',()=>{
 expect(regionalStandardSchema.safeParse(draft).success).toBe(true);
 expect(regionalStandardSchema.safeParse({...draft,catalogProfileId:'missing'}).success).toBe(false);
 expect(regionalStandardSchema.safeParse({...draft,yieldLowKgPer1000m2:10}).success).toBe(false);
});
it('requires reviewer, source and operations for review',()=>{
 expect(regionalStandardSchema.safeParse({...draft,status:'REVIEWED'}).success).toBe(false);
 expect(regionalStandardSchema.safeParse({...draft,status:'REVIEWED',reviewer:'tester',sourceUrls:[op.sourceUrl],operations:[op]}).success).toBe(true);
});
it('validates date, cross-year, temperature and duplicates without throwing',()=>{
 for(const change of [{from:'13-01'},{from:'02-30'},{from:'12-01'},{minTemperatureC:30,maxTemperatureC:20}])expect(regionalStandardSchema.safeParse({...draft,operations:[{...op,...change}]}).success).toBe(false);
 expect(regionalStandardSchema.safeParse({...draft,operations:[{...op,from:'12-01',to:'02-01',crossYear:true}]}).success).toBe(true);
 expect(regionalStandardSchema.safeParse({...draft,operations:[op,op]}).success).toBe(false);
});
it('requires operator for machines and orchard stage for orchard',()=>{
 expect(regionalStandardSchema.safeParse({...draft,operations:[{...op,mode:'MACHINE_WITH_OPERATOR'}]}).success).toBe(false);
 expect(regionalStandardSchema.safeParse({...draft,operations:[{...op,mode:'MACHINE_WITH_OPERATOR',capability:'harvest',operators:1}]}).success).toBe(true);
 const orchard={...draft,catalogProfileId:cropCatalog.find(c=>c.category==='ORCHARD')!.id};
 expect(regionalStandardSchema.safeParse(orchard).success).toBe(false);
 expect(regionalStandardSchema.safeParse({...orchard,orchardStage:'BEARING'}).success).toBe(true);
});
