import {nationalDisplayRows} from '../lib/national-display';
import {it,expect} from 'vitest';
import {buildNationalOverview,type NationalRecord} from '../lib/national-overview';
import type {State} from '../lib/types';
import {nationalScaleFixture} from './national-scale-fixture';
const state=(id:string):State=>({name:id,fields:[],missions:[],machines:[],events:[],revisions:[],planVersion:1,staffCount:0,transportCount:0,ruleVersion:'test',registered:true,planned:true});
function fixture(count=2,center='fifth-center'){
 const records:NationalRecord[]=[],s=state(center);
 for(let i=0;i<count;i++){const id='cycle-'+i,pnu='5274036023'+String(i).padStart(9,'0');s.fields.push({id:pnu,farmerId:'PRIVATE_PHONE',name:'PRIVATE_NAME',address:'PRIVATE_ADDRESS',area:1000,crop:'감자',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'',source:'REGISTERED'});
 records.push({workspace:'center:'+center,kind:'cultivation',id,payload:{id,pnu,crop:'potato',start:'2026-03-01',end:'2026-06-30'}},{workspace:'center:'+center,kind:'cultivationPlan',id,payload:{context:{},plots:[{pnu,area:1000,referenceId:'potato-spring',yieldRange:{low:2000,high:2500},tasks:[{id:'harvest:'+id,operationCode:'harvest',window:{from:'2026-06-01',to:'2026-06-30'}}]}]}});
 }
 return {centers:[{id:center,state:s,version:1}],records};
}
it('includes registered centers beyond the original four and exposes only summaries',()=>{const f=fixture(),result=buildNationalOverview(f.centers,f.records,{year:2026},'2026-05-01');expect(result.summary).toMatchObject({centers:1,cultivations:2,approvedAreaM2:2000,growingAreaM2:2000});expect(result.rows[0].production).toEqual([{commodity:'FRESH_SPRING_POTATO',low:4000,high:5000,cultivations:2}]);expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|5274036023000000000|cycle-0/);});
it('keeps closed cultivations, unknown yields and unrelated filters distinct',()=>{const f=fixture();(f.records[0].payload as any).closedAt='2026-04-01';delete (f.records[3].payload as any).plots[0].yieldRange;const r=buildNationalOverview(f.centers,f.records,{year:2026,quarter:2,region:'52'},'2026-05-01');expect(r.summary.cultivations).toBe(1);expect(r.rows[0].production).toEqual([]);expect(r.summary.missingYield).toBe(1);for(const filter of [{year:2027},{year:2026,quarter:3},{year:2026,region:'11'},{year:2026,origin:'DEMO' as const}])expect(buildNationalOverview(f.centers,f.records,filter,'2026-05-01').rows).toEqual([]);});
it('counts effective corrected shipments once and never merges commodity forms',()=>{const f=fixture(1),base={kind:'SHIPMENT',cultivationId:'cycle-0',date:'2026-06-01',source:'ACTUAL',voided:false,quantityKg:100,commodity:'FRESH',supersedesId:null};for(const entry of [{...base,id:'old'},{...base,id:'new',supersedesId:'old',quantityKg:80},{...base,id:'dry',commodity:'DRIED',quantityKg:10}])f.records.push({workspace:'center:fifth-center',kind:'operatingLedger',id:entry.id,payload:entry});expect(buildNationalOverview(f.centers,f.records,{year:2026},'2026-07-01').rows[0].shipments).toEqual([{commodity:'FRESH',kg:80,entries:1},{commodity:'DRIED',kg:10,entries:1}]);});
it('preserves shipments from withdrawn cycles and filters them by shipment date across years',()=>{const f=fixture(1);Object.assign(f.records[0].payload as object,{closedAt:'2026-06-30',closureCategory:'WITHDRAWAL'});f.records.push({workspace:'center:fifth-center',kind:'operatingLedger',id:'shipment',payload:{id:'shipment',kind:'SHIPMENT',cultivationId:'cycle-0',date:'2027-01-02',source:'ACTUAL',voided:false,quantityKg:80,commodity:'FRESH',supersedesId:null}});const r=buildNationalOverview(f.centers,f.records,{year:2027,quarter:1},'2027-02-01');expect(r.summary.cultivations).toBe(0);expect(r.rows[0].shipments).toEqual([{commodity:'FRESH',kg:80,entries:1}]);expect(buildNationalOverview(f.centers,f.records,{year:2027,quarter:2},'2027-06-01').rows).toEqual([]);});
it('does not double count a persisted proposal once its cultivation is approved',()=>{const f=fixture(1),proposal={cultivation:f.records[0].payload,plan:f.records[1].payload};f.records.push({workspace:'center:fifth-center',kind:'continuousProduction',id:'current',payload:{items:[{status:'REVIEW',proposal}]}});expect(buildNationalOverview(f.centers,f.records,{year:2026},'2026-05-01').summary).toMatchObject({cultivations:1,pendingPlans:0});});
it('keeps sealed prepared registrations separate before field-state projection',()=>{const f=fixture(1),id='10000000-0000-4000-8000-000000000001';f.records.push({workspace:'center:fifth-center',kind:'registrationOrigin',id,payload:{version:'registration-origin-v1',dataOrigin:'SYNTHETIC',batchId:id,consultationId:id,requestId:id,inputHash:'a'.repeat(64),pnus:[f.centers[0].state.fields[0].id],actorId:'test',registeredAt:'2026-10-20T00:00:00Z'}});expect(buildNationalOverview(f.centers,f.records,{year:2026,origin:'DEMO'},'2026-05-01').summary.cultivations).toBe(1);expect(buildNationalOverview(f.centers,f.records,{year:2026,origin:'REGISTERED'},'2026-05-01').rows).toEqual([]);});
it('aggregates 30000 prepared cultivation records with deterministic totals',()=>{const f=fixture(30000),started=performance.now(),result=buildNationalOverview(f.centers,f.records,{year:2026},'2026-05-01');expect(result.summary.cultivations).toBe(30000);expect(result.summary.approvedAreaM2).toBe(30000000);expect(result.rows[0].production[0].low).toBe(60000000);expect(performance.now()-started).toBeLessThan(10000);});
it('counts 3000 mixed crops with 18000 scheduled tasks and dated execution evidence',()=>{
 const f=nationalScaleFixture(3000,4),result=buildNationalOverview(f.centers,f.records,{year:2027},'2027-06-15');
 expect(result.summary).toMatchObject({cultivations:f.expectations.cultivations,approvedAreaM2:f.expectations.approvedAreaM2,harvestCompletedAreaM2:f.expectations.harvestCompletedAreaM2,overdue:f.expectations.overdue,missingYield:f.expectations.missingYield});
 for(const crop of ['rice','potato','pepper'] as const)expect(result.rows.filter(r=>r.crop===crop).reduce((n,r)=>n+r.cultivations,0)).toBe(f.expectations.crops[crop]);
 expect(JSON.stringify(result)).not.toContain('LOAD_PRIVATE');
 expect(buildNationalOverview(f.centers,f.records,{year:2026},'2027-06-15').rows).toEqual([]);
 const first=f.centers[0].id,filtered=buildNationalOverview(f.centers,f.records,{year:2027,center:first,crop:'pepper'},'2027-06-15');
 expect(filtered.summary.cultivations).toBe(result.rows.filter(r=>r.centerId===first&&r.crop==='pepper').reduce((n,r)=>n+r.cultivations,0));
});

it('operating display merges input provenance without changing totals or source records',()=>{
 const f=fixture();f.centers[0].state.fields[0].source='DEMO_ASSUMPTION';
 const original=buildNationalOverview(f.centers,f.records,{year:2026},'2026-05-01').rows,before=structuredClone(original);
 expect(original).toHaveLength(2);
 const rows=nationalDisplayRows(original);expect(rows).toHaveLength(1);
 expect(rows[0]).toMatchObject({cultivations:2,fields:2,approvedAreaM2:2000,production:[{commodity:'FRESH_SPRING_POTATO',low:4000,high:5000,cultivations:2}]});
 expect(rows[0]).not.toHaveProperty('origin');expect(original).toEqual(before);
});
