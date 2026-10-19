import {afterEach,describe,it,expect,vi} from 'vitest';
import * as engine from '../lib/scheduling-engine';
import {buildAnnualPlan} from '../lib/annual-plan';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {makeContract} from '../lib/annual-replanning';
import {appendAssignments} from '../lib/delegated-planning';
import {crewCapacityLimits,operatingCrewDemands,assertCrewCapacityFits} from '../lib/operating-capacity';
import {operatingTaskCrew} from '../lib/planned-labor-demand';
import {catalogContext,catalogField,catalogCycle,catalogState} from './catalog-fixtures';
import {calculateCurrentSchedule as calculate} from './current-solver';
afterEach(()=>vi.restoreAllMocks());
describe('qualified crew in the normal operating path',()=>{
 it('does not infer qualifications from staff counts and keeps foreign occupancy out of home crew',()=>{
  const s=catalogState(),m={owner:'장비' as const,resourceId:'TESTSE01',staff:2};
  expect(crewCapacityLimits(s)).toBeUndefined();s.crewCapacity={operators:2,workers:4};
  expect(operatingCrewDemands(s,m)).toEqual({'demo:operators':2,'demo:workers':2});
  expect(operatingCrewDemands(s,{...m,machineOperators:1,ordinaryWorkers:1})).toEqual({'demo:operators':1,'demo:workers':1});
  expect(operatingCrewDemands(s,{...m,resourceOccupancyOnly:true})).toEqual({});
  expect(operatingCrewDemands(s,{...m,owner:'농부',resourceId:null})).toEqual({'demo:operators':0,'demo:workers':2});
  expect(()=>operatingCrewDemands(s,{...m,machineOperators:3})).toThrow('수요');
  s.crewCapacity={operators:20,workers:1};expect(()=>crewCapacityLimits(s)).toThrow('전체');
 });
 it('derives new legacy task roles without changing persisted old missions',()=>{
  const p=buildAnnualPlan([{...catalogField('rice'),conditions:undefined}],2034,1,{},catalogCycle('rice'));
  for(const t of p.plots[0].tasks){const c=operatingTaskCrew(t),r=t.requirements;
   expect((c.machineOperators??0)+(c.ordinaryWorkers??0)+(c.farmerWorkers??0)).toBe(Math.max(1,r.staff));
   if(r.requiresOperator)expect(c.machineOperators).toBe(1);
  }
 });
 it('initial placement rejects missing operators or workers using the current Python solver',async()=>{
  vi.spyOn(engine,'solveSchedule').mockImplementation(calculate);
  const s=catalogState(),p=buildAnnualPlan([catalogField('soybean')],2034,1,catalogContext(),catalogCycle('soybean'),undefined,s);
  s.crewCapacity={operators:1,workers:3};const before=JSON.stringify(s),ready=await previewAnnualDispatch(p,s,'2033-12-31');
  expect(ready.feasibility[0].status,JSON.stringify(ready)).toBe('CAPACITY_FEASIBLE');expect(JSON.stringify(s)).toBe(before);
  for(const crewCapacity of [{operators:0,workers:10},{operators:10,workers:0}]){
   const blocked=await previewAnnualDispatch(p,{...s,crewCapacity},'2033-12-31');expect(blocked.feasibility[0].status).toBe('INCOMPLETE');
  }
  const scheduled=appendAssignments(s,p,ready);expect(()=>assertCrewCapacityFits(scheduled)).not.toThrow();
  expect(()=>assertCrewCapacityFits({...scheduled,crewCapacity:{operators:0,workers:10}})).toThrow('기존 미완료');
  const mission=scheduled.missions.find(m=>m.id.endsWith(':plant'))!;
  const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',fetchedAt:'2034-01-01',points:[]} as const;
  const contract=makeContract(scheduled,{ids:[mission.id],preferred:mission.scheduledDate,scope:'PRESERVE'},weather as any,'2033-12-31').contract;
  expect(contract.capacityLimits).toEqual({'demo:operators':1,'demo:workers':3});
  expect((await calculate(contract)).status).toBe('FEASIBLE');
  expect((await calculate({...contract,capacityLimits:{'demo:operators':0,'demo:workers':10}})).status).toBe('NO_FEASIBLE_PLAN');
 });
 it('splits an operation by the registered compatible machine rate before initial dispatch',async()=>{
  vi.spyOn(engine,'solveSchedule').mockImplementation(calculate);
  const s=catalogState();s.crewCapacity={operators:1,workers:3};
  s.machines=s.machines.map(m=>m.id.includes('SE')?{...m,capacityHaHour:0.015}:m);
  const before=JSON.stringify(s),p=buildAnnualPlan([catalogField('soybean',2000)],2034,1,catalogContext(),catalogCycle('soybean'),undefined,s);
  const tasks=p.plots[0].tasks.filter(t=>t.operationCode==='plant');expect(tasks.length).toBeGreaterThan(1);
  expect(tasks.reduce((n,t)=>n+('workAreaM2' in t?Number(t.workAreaM2):0),0)).toBeCloseTo(2000);
  for(const t of tasks)expect(('workAreaM2' in t?Number(t.workAreaM2):0)/10000/0.015*60+t.requirements.setupMinutes).toBeLessThanOrEqual(480.000001);
  const result=await previewAnnualDispatch(p,s,'2033-12-31');expect(result.feasibility[0].status,JSON.stringify(result)).toBe('CAPACITY_FEASIBLE');
  expect(result.assignments.filter(a=>a.operationKey.includes(':plant')).every(a=>a.durationMinutes<=480)).toBe(true);expect(JSON.stringify(s)).toBe(before);
  const other=catalogState();other.machines.push({...s.machines.find(m=>m.id.includes('SE'))!,id:'OTHERSE01',ownerCenterId:'janggye',capacityHaHour:0.001});
  const local=buildAnnualPlan([catalogField('soybean',2000)],2034,1,catalogContext(),catalogCycle('soybean'),undefined,other);
  expect(local.plots[0].tasks.filter(t=>t.operationCode==='plant')).toHaveLength(1);
 });
});
