import {describe,it,expect} from 'vitest';
import {buildAnnualPlan} from '../lib/annual-plan';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {cropCodes} from '../lib/crop-registry';
import {cultivationSchema,previousCultivationTerminals} from '../lib/cultivation';
import {fieldInventory} from '../lib/field-record';
import {recommendConditions} from '../lib/field-conditions';
import {catalogOperationTasks} from '../lib/catalog-operating-plan';
import {catalogContext,catalogField,catalogCycle,catalogState} from './catalog-fixtures';
import {appendAssignments} from '../lib/delegated-planning';
import {cropPeriod,planContinuousProduction} from '../lib/continuous-production';
import {supportsMissionCrop} from '../lib/replan-resource-options';
import {ordinaryWorkerDemand} from '../lib/planned-labor-demand';
import {missionResourceUse} from '../lib/scheduling-constraints';

describe('common operating path for 30 crop profiles',()=>{
 it('uses ordinary registration/cultivation contracts and stable operation identities for all 30 crops',()=>{
  for(const crop of cropCodes){
   const f=catalogField(crop),c=catalogCycle(crop),context=catalogContext(),before=JSON.stringify({f,c,context});
   expect(fieldInventory.parse([f])[0].crop).toBe(crop);expect(cultivationSchema.parse(c).crop).toBe(crop);
   const p=buildAnnualPlan([f],2034,1,context,c),again=buildAnnualPlan([f],2034,1,context,c);
   expect(p).toEqual(again);expect(p.taskCount).toBeGreaterThan(7);expect(p.plots[0].yieldRange).toBeNull();
   expect('dataOrigin' in p.plots[0]&&p.plots[0].dataOrigin).toBe('DEMO');
   const keys=new Set(p.plots[0].tasks.map(t=>t.operationKey));expect(keys.size).toBe(p.taskCount);
   for(const t of p.plots[0].tasks){expect(t.operationKey.startsWith(`cultivation:${c.id}:`)).toBe(true);expect(t.predecessorKeys.every(k=>keys.has(k))).toBe(true);}
   expect(JSON.stringify({f,c,context})).toBe(before);
  }
 });
 it('retains winter crop seasons and rejects next seasons that miss required work windows',()=>{
  for(const crop of ['barley','wheat','garlic','onion'] as const){
   const period=cropPeriod(crop,catalogContext(),'2034-01-01',null);
   expect(period.start.startsWith('2034')).toBe(true);expect(period.end.startsWith('2035')).toBe(true);
   expect(()=>cropPeriod(crop,catalogContext(),'2035-02-01',null)).toThrow('다음 작기');
   expect(()=>cropPeriod(crop,catalogContext(),'2034-01-01','2034-12-31')).toThrow('참여 종료');
  }
 });
 it('preserves a confirmed existing orchard species instead of replacing mature trees by score',()=>{
  const f=catalogField('apple');f.conditions!.climate.pear='suitable';f.conditions!.climate.rice='suitable';
  expect(recommendConditions(f.conditions).find(c=>c.crop==='pear')!.blocked).toContain('EXISTING_ORCHARD_PRESERVED');
  expect(recommendConditions(f.conditions).find(c=>c.crop==='rice')!.blocked).toContain('PADDY_WATER_REQUIRED');
  delete f.conditions!.existingOrchardCrop;expect(()=>buildAnnualPlan([f],2034,1,catalogContext(),catalogCycle('apple'))).toThrow('적합성');
  f.conditions!.existingOrchardCrop='apple';f.conditions!.existingBearingOrchard=false;expect(()=>buildAnnualPlan([f],2034,1,catalogContext(),catalogCycle('apple'))).toThrow();
 });
 it('orders every part and harvest round, and links the next crop after the last actual terminal task',()=>{
  const p=buildAnnualPlan([catalogField('lettuce',4000)],2034,1,catalogContext(),catalogCycle('lettuce'));
  const tasks=p.plots[0].tasks,harvest=tasks.filter(t=>t.operationCode==='harvest');
  expect(harvest).toHaveLength(9);expect(harvest[3].predecessorKeys).toContain(harvest[2].operationKey);expect(harvest[1].predecessorKeys).toContain(harvest[0].operationKey);
  const terminal=previousCultivationTerminals(catalogCycle('lettuce'),tasks);
  expect(terminal).toContain(`cultivation:${catalogCycle('lettuce').id}:finish:3`);expect(terminal).not.toContain(`cultivation:${catalogCycle('lettuce').id}:finish`);
  expect(()=>previousCultivationTerminals(catalogCycle('lettuce'),[])).toThrow('마지막 작업');
 });
 it('does not silently ignore an unsupported method-rate edit or renumber harvest occurrences',()=>{
  const c=catalogContext();c.operations={soybean:{plant:{staff:0}}};expect(()=>catalogOperationTasks('soybean',catalogField('soybean').pnu,1000,c)).toThrow('인원 변경');
  c.operations={soybean:{harvest:{occurrences:[{occurrence:2,from:'2034-10-01',to:'2034-10-10'}]}}};expect(()=>catalogOperationTasks('soybean',catalogField('soybean').pnu,1000,c)).toThrow('회차');
  expect(()=>catalogOperationTasks('soybean',catalogField('soybean').pnu,1000,{region:'계북면'})).toThrow('버전');
 });
 it('uses registered compatible equipment and the common solver, never dispatching unreviewed treatment',async()=>{
  const p=buildAnnualPlan([catalogField('soybean')],2034,1,catalogContext(),catalogCycle('soybean')),s=catalogState(),before=JSON.stringify(s);
  const r=await previewAnnualDispatch(p,s,'2033-12-31');expect(r.feasibility[0].status,JSON.stringify(r)).toBe('CAPACITY_FEASIBLE');
  expect(r.assignments.some(a=>a.operationKey.endsWith(':treat')||a.operationKey.endsWith(':fertilize'))).toBe(false);
  const saved=appendAssignments(s,p,r);const planted=saved.missions.find(m=>m.id.endsWith(':plant'))!;
  const harvested=saved.missions.find(m=>m.id.endsWith(':harvest'))!;expect(harvested.machineOperators).toBe(1);expect(ordinaryWorkerDemand(harvested)).toBe(1);expect(harvested.staff).toBe(2);
  expect(planted.compatibilityCrop).toBe('soybean');expect(supportsMissionCrop({...s.machines[0],compatibleCrops:['rice']},planted)).toBe(false);
  const removed={...s,machines:s.machines.map(m=>m.id.includes('SE')?{...m,compatibleCrops:[]}:m)};
  expect((await previewAnnualDispatch(p,removed,'2033-12-31')).feasibility[0].status).toBe('INCOMPLETE');expect(JSON.stringify(s)).toBe(before);
 });
 it('counts center labor for newly generated work even when legacy enrollment metadata is retained',async()=>{
  const f=catalogField('soybean');f.mode='joint';f.conditions!.farmerCrew=3;
  const p=buildAnnualPlan([f],2034,1,catalogContext(),catalogCycle('soybean')),s=catalogState(),r=await previewAnnualDispatch(p,s,'2033-12-31');
  const saved=appendAssignments(s,p,r),harvest=saved.missions.find(m=>m.id.endsWith(':harvest'))!;
  expect(harvest.farmerWorkers).toBe(0);expect(harvest.machineOperators).toBe(1);expect(harvest.staff).toBe(2);expect(ordinaryWorkerDemand(harvest)).toBe(1);
  expect(missionResourceUse(saved,harvest).person).toBeNull();expect(f.mode).toBe('joint');
 });
 it('does not derive available labor from ownership or a legacy farmer crew count',async()=>{
  const f=catalogField('lettuce');f.mode='joint';
  const withoutCrew=await previewAnnualDispatch(buildAnnualPlan([f],2034,1,catalogContext(),catalogCycle('lettuce')),catalogState(),'2033-12-31');expect(withoutCrew.feasibility[0].status).toBe('CAPACITY_FEASIBLE');
  f.conditions!.farmerCrew=3;const ready=await previewAnnualDispatch(buildAnnualPlan([f],2034,1,catalogContext(),catalogCycle('lettuce')),catalogState(),'2033-12-31');expect(ready.feasibility[0].status).toBe('CAPACITY_FEASIBLE');expect(ready.assignments.filter(a=>!a.machineId).every(a=>a.owner==='센터 인력'&&a.staff>0)).toBe(true);
 });
 it('adds delegated new crops in receipt order with the same planner and preserves completed cycles',async()=>{
  const f=catalogField('soybean'),criteria={profiles:[{id:'next',name:'격리 작기',context:catalogContext(),dataOrigin:'DEMO' as const,sourceBatchId:'isolated-crop30-test'}]};
  const participation={pnu:f.pnu,consultationId:f.consultationId!,receivedAt:'2033-12-01T00:00:00Z',status:'ACTIVE' as const,term:{from:'2033-12-01',until:null,continuousConsent:true as const},changedAt:'2033-12-01T00:00:00Z',reason:'격리 동의'};
  const i={fields:[f],participations:[participation],cycles:[],state:catalogState(),criteria,version:1,today:'2033-12-31',names:{},consentedPnus:[f.pnu]};
  const first=await planContinuousProduction(i);expect(first.items[0].status,first.items[0].reason).toBe('REVIEW');const proposal=first.items[0].proposal!;
  const prior=appendAssignments(i.state,proposal.plan,proposal.dispatch);prior.missions.forEach(m=>m.status='COMPLETED');const before=JSON.stringify(prior);
  const second=await planContinuousProduction({...i,today:'2034-12-31',state:prior,cycles:[proposal.cultivation],criteria:{profiles:[{...criteria.profiles[0],context:catalogContext(2035)}]}});
  expect(second.items[0].status,second.items[0].reason).toBe('REVIEW');expect(second.items[0].proposal!.cultivation.previousId).toBe(proposal.cultivation.id);expect(JSON.stringify(prior)).toBe(before);expect(second.inferenceCalled).toBe(false);
 });
});
