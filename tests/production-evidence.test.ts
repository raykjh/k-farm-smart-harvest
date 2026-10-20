import {describe,expect,it} from 'vitest';
import {nationalReferenceSchema,nationalReferencesSchema,selectNationalReferences,type NationalReference} from '../lib/production-evidence';

// Synthetic contract fixtures, never approved operating evidence.
const base=():NationalReference=>({crop:'rice',sourceUrl:'https://example.com/isolated-contract-test',asOf:'2026-09-28',checkedOn:'2026-10-19',validUntil:'2026-10-31',observationPeriod:{from:'2026-09-15',to:'2026-09-15'},harvestPeriod:null,commodity:'MILLED_RICE_92_9',unit:'KRW/20kg',version:'synthetic-v1',origin:'OBSERVED',geography:'KR',reuse:'ALLOWED',priceStage:'PRODUCING_AREA',facts:{metric:'PRICE',value:1000}});
describe('national evidence contract and selection',()=>{
 it('keeps observed prices and national production as background without deriving a demand cap or future price',()=>{
  const price=base(),production={...base(),unit:'tonne' as const,priceStage:null,facts:{metric:'PRODUCTION' as const,value:3000000}};
  const result=selectNationalReferences('rice','2026-10-19',[price,production]);
  expect(result).toMatchObject({scope:'NATIONAL_BACKGROUND_ONLY',status:'AVAILABLE',forecastSupport:'NOT_ASSESSED_FOR_HARVEST',participatingDemandCap:null});
  expect(result.references.map(r=>r.facts.metric).sort()).toEqual(['PRICE','PRODUCTION']);
  expect(result).not.toHaveProperty('priceForecast');expect(result).not.toHaveProperty('pressure');
 });
 it('rejects unit, product-stage and range mismatches before use',()=>{
  for(const patch of [{unit:'ha'},{priceStage:null},{facts:{metric:'PRICE',low:200,high:100}},{facts:{metric:'PRICE',value:300,low:100,high:200}},{facts:{metric:'PRICE',low:100}},{facts:{metric:'PRICE',value:-1}}]){
   const row={...base(),...patch};expect(nationalReferenceSchema.safeParse(row).success).toBe(false);
   expect(selectNationalReferences('rice','2026-10-19',[row])).toMatchObject({status:'INSUFFICIENT_DATA',references:[],excluded:[{reasons:['INVALID_REFERENCE_CONTRACT']}]});
  }
 });
 it('does not silently turn missing observations into zero',()=>{
  const row={...base(),facts:{metric:'PRICE' as const}};
  expect(selectNationalReferences('rice','2026-10-19',[row]).references[0].facts).toEqual({metric:'PRICE'});
  expect(selectNationalReferences('rice','2026-10-19',[row]).status).toBe('INSUFFICIENT_DATA');
  expect(selectNationalReferences('rice','2026-10-19',[]).status).toBe('INSUFFICIENT_DATA');
 });
 it('keeps incompatible crops and commodity forms separate without conversion',()=>{
  const paddy={...base(),commodity:'PADDY_RICE',unit:'KRW/kg' as const,priceStage:'FARM_GATE' as const};
  const potato={...paddy,crop:'potato' as const,commodity:'FRESH_SPRING_POTATO'};
  const result=selectNationalReferences('rice','2026-10-19',[base(),paddy,potato]);
  expect(result.references.map(r=>r.commodity).sort()).toEqual(['MILLED_RICE_92_9','PADDY_RICE']);
  expect(selectNationalReferences('pear','2026-10-19',[base(),potato]).status).toBe('INSUFFICIENT_DATA');
 });
 it('excludes future, expired and unreviewed reuse evidence independently',()=>{
  const rows=[{...base(),version:'future',checkedOn:'2026-10-20'},{...base(),version:'expired',validUntil:'2026-10-18',checkedOn:'2026-10-17'},{...base(),version:'reuse',reuse:'REVIEW_REQUIRED'}];
  for(const [i,reason] of ['FUTURE_REFERENCE','EXPIRED_REFERENCE','REUSE_REVIEW_REQUIRED'].entries()){
   expect(selectNationalReferences('rice','2026-10-19',[rows[i]])).toMatchObject({status:'INSUFFICIENT_DATA',references:[],excluded:[{reasons:[reason]}]});
  }
 });
 it('requires valid calendar dates and chronological observations and reviews',()=>{
  for(const patch of [{asOf:'2026-02-30'},{checkedOn:'2026-09-20'},{observationPeriod:{from:'2026-09-16',to:'2026-09-15'}},{observationPeriod:{from:'2026-09-29',to:'2026-09-30'}}])expect(nationalReferenceSchema.safeParse({...base(),...patch}).success).toBe(false);
  expect(()=>selectNationalReferences('rice','2026-02-30',[base()])).toThrow();
 });
 it('requires explicit outlook harvest coverage but never assumes it covers the candidate harvest',()=>{
  const period={from:'2026-10-01',to:'2026-10-31'},row={...base(),origin:'OUTLOOK' as const,harvestPeriod:period};
  expect(nationalReferenceSchema.safeParse({...base(),harvestPeriod:period}).success).toBe(false);
  expect(nationalReferenceSchema.safeParse({...row,harvestPeriod:null}).success).toBe(false);
  expect(nationalReferenceSchema.safeParse({...row,harvestPeriod:{from:'2026-08-01',to:'2026-08-31'}}).success).toBe(false);
  expect(selectNationalReferences('rice','2026-10-19',[row])).toMatchObject({forecastSupport:'NOT_ASSESSED_FOR_HARVEST',participatingDemandCap:null});
 });
 it('rejects all duplicate observations rather than selecting the first candidate or counting versions twice',()=>{
  const rows=[base(),{...base(),version:'synthetic-v2',facts:{metric:'PRICE' as const,value:900}}];
  expect(nationalReferencesSchema.safeParse(rows).success).toBe(false);
  const result=selectNationalReferences('rice','2026-10-19',rows);
  expect(result.references).toEqual([]);expect(result.excluded).toHaveLength(2);
  expect(result.excluded.every(e=>e.reasons.includes('DUPLICATE_REFERENCE'))).toBe(true);
  expect(selectNationalReferences('rice','2026-10-19',[...rows].reverse())).toEqual(result);
 });
 it('is deterministic across source order and does not mutate callers',()=>{
  const rows=[base(),{...base(),sourceUrl:'https://example.com/second-source',facts:{metric:'PRICE' as const,low:800,high:1200}}];
  const before=JSON.stringify(rows),first=selectNationalReferences('rice','2026-10-19',rows);
  expect(selectNationalReferences('rice','2026-10-19',[...rows].reverse())).toEqual(first);
  first.references[0].facts.value=0;expect(JSON.stringify(rows)).toBe(before);
 });
 it('permits negative changes without permitting negative physical quantities',()=>{
  const row={...base(),unit:'percent' as const,priceStage:null,facts:{metric:'YEAR_ON_YEAR_CHANGE' as const,value:-23.8}};
  expect(nationalReferenceSchema.safeParse(row).success).toBe(true);
  expect(nationalReferenceSchema.safeParse({...row,facts:{metric:'YEAR_ON_YEAR_CHANGE',value:-101}}).success).toBe(false);
 });
 it('bounds evidence size and rejects unrecognized fields',()=>{
  const rows=Array.from({length:301},(_,i)=>({...base(),sourceUrl:`https://example.com/source-${i}`}));
  expect(nationalReferencesSchema.safeParse(rows).success).toBe(false);
  expect(selectNationalReferences('rice','2026-10-19',rows).references).toEqual([]);
  expect(nationalReferenceSchema.safeParse({...base(),demandCap:1000}).success).toBe(false);
 });
});
