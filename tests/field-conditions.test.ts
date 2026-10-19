import {it,expect} from 'vitest';
import {emptyConditions,recommendConditions} from '../lib/field-conditions';
import {fieldEntry} from '../lib/field-record';
import {parcelBoundarySchema} from '../lib/parcel-boundary';
it('missing facts never generate scores',()=>expect(recommendConditions().every(r=>r.score===null)).toBe(true));
it('reviewed paddy favors rice and water failure blocks rice',()=>{
 const c={...emptyConditions(),landUse:'paddy' as const,water:'yes' as const,drainage:'good' as const,machineAccess:'yes' as const,laborAvailable:'yes' as const,climate:{rice:'suitable' as const,potato:'suitable' as const,pepper:'marginal' as const},region:'계북면',checkedOn:'2026-09-18',evidence:'test only: reviewed crop / site'};
 expect(recommendConditions(c)[0]).toMatchObject({crop:'rice',score:100});expect(recommendConditions({...c,water:'no'}).find(r=>r.crop==='rice')!.blocked).toContain('PADDY_WATER_REQUIRED');
 const field=fieldEntry.parse({pnu:'4574034026106160004',address:'test',area:1000,crop:'rice',mode:'joint',group:'',rights:'pending',conditions:c});expect(field.conditions).toEqual(c);
});
it('access changes relative ranking and absent pepper labor blocks recommendation',()=>{
 const c={...emptyConditions(),landUse:'upland' as const,water:'yes' as const,drainage:'good' as const,machineAccess:'no' as const,laborAvailable:'yes' as const,climate:{rice:'suitable' as const,potato:'suitable' as const,pepper:'suitable' as const},region:'계북면',checkedOn:'2026-09-18',evidence:'test only'};
 expect(recommendConditions(c)[0].crop).toBe('pepper');expect(recommendConditions({...c,laborAvailable:'no'}).find(r=>r.crop==='pepper')!.status).toBe('BLOCKED');expect(recommendConditions({...c,evidence:''}).find(r=>r.crop==='pepper')!.score).toBeNull();
});
it('distinguishes cadastral paddy, actual upland and a facility without migrating legacy fields',()=>{
 const c={...emptyConditions(),landUse:'upland' as const,cadastralUse:'paddy' as const,water:'yes' as const,drainage:'good' as const,machineAccess:'yes' as const,laborAvailable:'yes' as const,climate:{rice:'unsuitable' as const,potato:'suitable' as const,pepper:'suitable' as const},region:'test',checkedOn:'2026-01-01',evidence:'synthetic only'};
 expect(recommendConditions(c).find(r=>r.crop==='potato')?.status).toBe('PROVISIONAL');
 expect(recommendConditions({...c,growingEnvironment:'open_field'})).toEqual(recommendConditions(c));
 for(const env of ['unheated_greenhouse','heated_greenhouse'] as const){
  const candidate=recommendConditions({...c,growingEnvironment:env}).find(r=>r.crop==='potato')!;
  expect(candidate.missing).toContain('FACILITY_PRACTICE_REVIEW');expect(candidate.score).toBeNull();
 }
 expect(recommendConditions({...c,growingEnvironment:'unknown'}).find(r=>r.crop==='potato')?.missing).toContain('GROWING_ENVIRONMENT');
 expect(recommendConditions({...c,landUse:'paddy',growingEnvironment:'open_field'}).find(r=>r.crop==='potato')?.blocked).toContain('UPLAND_DRAINAGE_REVIEW');
});
it('stores bounded parcel geometry separately from executable machine work areas',()=>{
 const boundary={source:'VWORLD',checkedOn:'2026-10-01',geometry:{type:'Polygon',coordinates:[[[127,35],[127.001,35],[127.001,35.001],[127,35]]]}};
 expect(parcelBoundarySchema.parse(boundary)).toEqual(boundary);
 expect(()=>parcelBoundarySchema.parse({...boundary,geometry:{type:'Polygon',coordinates:[[[127,35],[127,36],[128,36],[128,35]]]}})).toThrow();
});
