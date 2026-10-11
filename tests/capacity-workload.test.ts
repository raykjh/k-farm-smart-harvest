import {it,expect} from 'vitest';
import {workloadCrops,WORKLOAD_CATALOG_VERSION} from '../lib/crop-workload-catalog';
import {selectParticipatingOwners,capacityStudySchema,distributeScenarioCrops,contentHash,type CapacityStudyInput} from '../lib/capacity-study-input';
import {compileCapacityWorkload,summarizeCapacity,demandBounds} from '../lib/capacity-workload';
import {workloadSchedulingContract,validateCapacityChoice,compareCapacityPlans} from '../lib/capacity-study-scheduling';
import {verifySchedule,dateSlot} from '../lib/scheduling-engine';

export function studyFixture(count=100):CapacityStudyInput{
 return capacityStudySchema.parse({title:'격리 입력',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'Tests only, not real owners or cadastral parcels',seed:'test',participationRate:0.33,
  owners:Array.from({length:count},(_,i)=>({id:'owner-'+i})),parcels:Array.from({length:count},(_,i)=>({pnu:String(i+1).padStart(19,'0'),centerId:(['demo','janggye','cheoncheon','gyenam'] as const)[i%4],areaM2:1000,ownerId:'owner-'+i,applied:true,cropId:workloadCrops[i%30].id,year:2026,geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'isolated test',suitability:'SUITABLE',cropLocked:false,existingBearingOrchard:i%30>=25}))},includeConditionalReserve:true,overrides:[]});
}
it('has exactly 30 distinct crop profiles with executable methods but no invented verified agronomy',()=>{
 expect(workloadCrops).toHaveLength(30);expect(new Set(workloadCrops.map(c=>c.id)).size).toBe(30);
 for(const p of workloadCrops){expect(p.evidence).toBe('SOURCE_REFERENCED_DEMO_PARAMETERS');expect(p.operations.length).toBeGreaterThan(7);
  for(const op of p.operations){expect(op.windows.length).toBeGreaterThan(0);for(const parent of op.predecessors)expect(p.operations.some(o=>o.code===parent)).toBe(true);
   for(const m of op.methods){expect(m.minutesPer1000m2).toBeGreaterThan(0);expect(m.capability?m.operators>0:m.workers>0).toBe(true);}
   if(['treat','fertilize'].includes(op.code)){expect(op.kind).toBe('CONDITIONAL');expect(op.condition).toBeTruthy();}
  }
 }
});
it('counts owners across centers once, not parcels/area; selection is stable under input reordering',()=>{
 const x=studyFixture();x.population.owners.push({id:'owner-1'});x.population.parcels.push({...x.population.parcels[1],pnu:'9999999999999999999',centerId:'demo',areaM2:100000});
 const a=selectParticipatingOwners(x.population);expect(a.populationCount).toBe(100);expect(a.selectedCount).toBe(33);
 x.population.owners.reverse();x.population.parcels.reverse();expect(selectParticipatingOwners(x.population)).toEqual(a);
 expect(a.parcels.every(p=>a.selectedOwnerIds.includes(p.ownerId))).toBe(true);
 expect(selectParticipatingOwners(studyFixture(2).population).selectedCount).toBe(0);
});
it('rejects unknown ownership and duplicate parcels rather than claiming co-owner consent',()=>{
 const x=studyFixture(2);x.population.parcels[0].ownerId='absent';expect(()=>selectParticipatingOwners(x.population)).toThrow();
 x.population.parcels[0].ownerId='owner-0';x.population.parcels.push(x.population.parcels[0]);expect(()=>selectParticipatingOwners(x.population)).toThrow();
});
it('compiles all crops, cross-year winter crops, repeated harvest and multi-day work; preserves inputs',()=>{
 const x=studyFixture(30);x.population.participationRate=1;x.population.parcels[0].areaM2=30000;
 const before=JSON.stringify(x),r=compileCapacityWorkload(x);
 expect(r.catalogVersion).toBe(WORKLOAD_CATALOG_VERSION);expect(new Set(r.tasks.map(t=>t.cropId)).size).toBe(30);expect(r.blockers).toHaveLength(0);
 expect(r.tasks.filter(t=>t.cropId==='barley'&&t.operationCode==='harvest').every(t=>t.from.startsWith('2027'))).toBe(true);
 expect(r.tasks.filter(t=>t.cropId==='pepper'&&t.operationCode==='harvest').some(t=>t.occurrence===4)).toBe(true);
 expect(r.tasks.some(t=>t.part>1)).toBe(true);expect(r.tasks.every(t=>t.durationSlots>0&&t.durationSlots<=32)).toBe(true);
 expect(new Set(r.tasks.map(t=>t.id)).size).toBe(r.tasks.length);expect(r.tasks.every(t=>t.predecessors.every(id=>r.tasks.some(x=>x.id===id)))).toBe(true);
 expect(JSON.stringify(x)).toBe(before);
});
it('no first-year orchard yields; missing suitability is not zero demand or approval',()=>{
 const x=studyFixture(30);x.population.participationRate=1;x.population.parcels[25].existingBearingOrchard=false;x.population.parcels[0].suitability='UNKNOWN';
 const r=compileCapacityWorkload(x);expect(r.blockers.map(b=>b.code)).toEqual(expect.arrayContaining(['ORCHARD_STAGE','SUITABILITY_REVIEW']));
 expect(r.tasks.some(t=>t.cropId==='apple'||t.cropId==='rice')).toBe(false);expect(r.approvalEligible).toBe(false);
});
it('profiles accept explicit weather-derived windows; larger area increases demand and preserves crop-specific durations',()=>{
 const x=studyFixture(1);x.population.participationRate=1;x.overrides=[{cropId:'rice',operationCode:'plant',windows:[{from:'2026-06-01',to:'2026-06-05'}],basis:'WEATHER_DERIVED',source:'Test weather rule result'}];
 const a=summarizeCapacity(x);expect(a.tasks.find(t=>t.operationCode==='plant')!.from).toBe('2026-06-01');x.population.parcels[0].areaM2=5000;
 const b=summarizeCapacity(x);expect(b.bounds.reduce((n,x)=>n+x.totalHours,0)).toBeGreaterThan(a.bounds.reduce((n,x)=>n+x.totalHours,0));
 expect(b.bounds.find(b=>b.resource==='workers')!.windowLowerBound).toBeGreaterThanOrEqual(2);
 expect(b.baseline.machines.every(m=>m.compatibleCrops.length)).toBe(true);
 const task=a.tasks[0],heavy={...task,from:'2026-05-02',to:'2026-05-02',durationSlots:32,method:{...task.method,workers:3}};
 const peak=demandBounds([heavy,{...heavy,id:'other',method:{...heavy.method,workers:2}},{...heavy,id:'flexible',from:'2026-05-01',method:{...heavy.method,workers:1}}]);
 expect(peak.find(b=>b.resource==='workers')!.windowLowerBound).toBe(5);
});
it('concentrates only eligible unlocked new crop choices and never modifies fixed baseline resources',()=>{
 const x=studyFixture(3);x.population.participationRate=1;for(const p of x.population.parcels){p.eligibleCropIds=['rice','pepper'];p.cropId='pepper'}x.population.parcels[0].cropLocked=true;
 const b=summarizeCapacity(x).baseline,hash=contentHash(b),changed=distributeScenarioCrops(x,{rice:100},'new');
 expect(changed.population.parcels.map(p=>p.cropId)).toEqual(['pepper','rice','rice']);expect(x.population.parcels[1].cropId).toBe('pepper');expect(contentHash(b)).toBe(hash);
 x.population.parcels[1].existingBearingOrchard=true;x.population.parcels[1].cropId='apple';x.population.parcels[1].eligibleCropIds=['apple','rice'];
 expect(distributeScenarioCrops(x,{rice:100},'new').population.parcels[1].cropId).toBe('apple');
});
it('keeps ordinary labor separate from operators and rejects excessive aggregate daily absence',()=>{
 const x=studyFixture(1);x.population.participationRate=1;const a=summarizeCapacity(x),task=a.tasks.find(t=>t.operationCode==='soil')!;
 const c=workloadSchedulingContract([task],a.baseline,{neighbors:{},loans:[],incidents:[]},false),at=c.tasks[0].options![0].allowed[0];
 expect(()=>verifySchedule(c,[{id:task.id,start:at,resource:c.tasks[0].options![0].resource}],'INITIAL_DISPATCH')).not.toThrow();
 c.capacityLimits!['demo:operators']=0;expect(()=>verifySchedule(c,[{id:task.id,start:at,resource:c.tasks[0].options![0].resource}],'INITIAL_DISPATCH')).toThrow('센터별');
});
it('wind blocks drones, not all ground tasks; faults remove equipment until repair; loans need adjacency and confirmed logistics',()=>{
 const x=studyFixture(1);x.population.participationRate=1;const a=summarizeCapacity(x),treat=a.tasks.find(t=>t.operationCode==='treat')!,soil=a.tasks.find(t=>t.operationCode==='soil')!;
 const wind={kind:'WIND' as const,centerId:'demo' as const,from:'2026-01-01',to:'2026-12-31'};
 const c=workloadSchedulingContract([treat,soil],a.baseline,{neighbors:{},loans:[],incidents:[wind]},false);
 expect(c.tasks[0].options).toHaveLength(0);expect(c.tasks[1].options!.length).toBeGreaterThan(0);expect(c.tasks[1].options!.every(o=>o.allowed.length>0)).toBe(true);
 const machine=a.baseline.machines.find(m=>m.capability==='TR')!,loan={...machine,id:'foreign',ownerCenterId:'janggye' as const};a.baseline.machines.push(loan);
 const ctx={neighbors:{demo:['janggye']},loans:[{machineId:'foreign',borrowerCenterId:'demo',from:soil.from,to:soil.to,operatorAndTransportConfirmed:true,permission:'ASSUMED_FOR_STUDY' as const,transferSlots:4}],incidents:[{kind:'FAULT' as const,machineId:machine.id,from:soil.from,to:soil.to}]};
 const loaned=workloadSchedulingContract([soil],a.baseline,ctx,true);expect(loaned.tasks[0].options!.find(o=>o.resource==='foreign')!.allowed.length).toBeGreaterThan(0);expect(loaned.tasks[0].options!.some(o=>o.resource===machine.id)).toBe(false);
 ctx.neighbors.demo=[];expect(workloadSchedulingContract([soil],a.baseline,ctx,true).tasks[0].options!.some(o=>o.resource==='foreign')).toBe(false);
});
it('fails closed on solver outage or oversize workloads; no AI or actual reservations occur',async()=>{
 const x=studyFixture(1);x.population.participationRate=1;const a=summarizeCapacity(x),before=contentHash(a.baseline);
 const r=await compareCapacityPlans(x,a.baseline,{neighbors:{},loans:[],incidents:[]},async()=>{throw Error('offline')});
 expect(r.results.every(r=>r.status==='UNVERIFIED')).toBe(true);expect(r.recommendation.inferenceCalled).toBe(false);expect(r.recommendation.alternativeId).toBeNull();
 expect(contentHash(a.baseline)).toBe(before);expect(()=>validateCapacityChoice(r,{alternativeId:'LOCAL_ONLY',baselineHash:before})).toThrow();
 const tasks=Array.from({length:5001},(_,i)=>({...a.tasks[0],id:'oversize-'+i}));
 expect(()=>workloadSchedulingContract(tasks,a.baseline,{neighbors:{},loans:[],incidents:[]},false)).toThrow('5,000');
 // The adapter passes 601 jobs to the common engine; that engine decides
 // whether their resources/time windows can be safely decomposed.
 expect(workloadSchedulingContract(tasks.slice(0,601),a.baseline,{neighbors:{},loans:[],incidents:[]},false).tasks).toHaveLength(601);
});
