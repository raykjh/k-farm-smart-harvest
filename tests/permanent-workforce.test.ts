import {it,expect} from 'vitest';
import {applyPermanentWorkforce,workforceDaySummary,permanentWorkforceSchema,type PermanentWorkforce} from '../lib/permanent-workforce';
import {laborCapacityBlocks} from '../lib/labor-capacity';
import {emptyLaborOps,type Worker} from '../lib/labor-operations';
import {demoResourceState} from '../lib/registered-demo';
import {dateSlot} from '../lib/scheduling-engine';
import {calculateProduction} from '../lib/production-service';
import {jointSource} from './integrated-plan-fixture';
import {withNamedOperators} from '../lib/named-operators';
import {assertCrossCenterPeople} from '../lib/integrated-plan';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup(count=50){
 const ops=emptyLaborOps();ops.people=Array.from({length:count},(_,i)=>({id:id(i),name:`Synthetic ${i}`,active:true,employment:'VOLUNTEER'} as Worker));
 const workforce:PermanentWorkforce={version:'permanent-workforce-v1',checkedOn:'2026-01-01',evidenceRef:'synthetic-reviewed-employment',workers:Array.from({length:5},(_,i)=>({workerId:id(i),role:'WORKER',from:'2026-01-01',to:'2027-12-31',weekdays:[1,2,3,4,5],startMinute:480,endMinute:720,excludedDates:[]}))};
 const state=applyPermanentWorkforce(demoResourceState(),workforce,ops,'2026-10-26');
 return {state,workforce,ops};
}
it('50 registrations including five permanent workers yield 20 confirmed calendar hours, not 200 hours or attendance',()=>{
 expect(workforceDaySummary(setup().state,'2026-10-26')).toMatchObject({registeredPeople:50,permanentPeople:5,ordinaryHours:20,operatorHours:0,attendanceConfirmed:false});
 expect(workforceDaySummary(setup().state,'2026-10-25')!.ordinaryHours).toBe(0);
});
it('keeps a separate-five fixture at 55 registrations and still five permanent workers',()=>{
 expect(workforceDaySummary(setup(55).state,'2026-10-26')).toMatchObject({registeredPeople:55,permanentPeople:5,ordinaryHours:20});
});
it('keeps two years of shared part-time calendars within the solver block limit without restoring unavailable hours',()=>{
 const {state}=setup(),blocks=laborCapacityBlocks(state)!;
 expect(blocks.length).toBeLessThanOrEqual(731);
 const monday=dateSlot('2026-10-26'),sunday=dateSlot('2026-11-01');
 const demand=(slot:number)=>blocks.filter(b=>b.start<=slot&&slot<b.start+b.duration).reduce((n,b)=>n+b.staff,0);
 expect(demand(monday)).toBe(0);expect(demand(monday+16)).toBe(5);expect(demand(sunday)).toBe(5);
 expect(blocks.find(b=>b.start===monday+16)?.capacityDemands).toEqual({'demo:workers':5});
});
it('unions duplicate absences and does not remove non-permanent registrants from permanent capacity',()=>{
 const {state}=setup();state.permanentWorkforce!.horizon={from:'2026-10-26',to:'2026-10-26'};
 const absence={workerId:id(0),date:'2026-10-26',startMinute:480,endMinute:540};
 state.laborCapacity={incoming:[],outgoing:[],absences:[absence,absence,{...absence,workerId:id(20)}]};
 expect(workforceDaySummary(state,'2026-10-26')!.ordinaryHours).toBe(19);
 const blocks=laborCapacityBlocks(state)!;
 expect(blocks.filter(b=>b.start===dateSlot('2026-10-26'))).toHaveLength(1);
 expect(blocks.filter(b=>b.start===dateSlot('2026-10-26'))[0].staff).toBe(1);
});
it('does not silently convert standby employees, inactive registrations or future confirmations',()=>{
 const {state,workforce,ops}=setup();ops.people[0].employment='CENTER_RESERVE';
 expect(()=>applyPermanentWorkforce(state,workforce,ops,'2026-10-26')).toThrow('대기 인력');
 ops.people[0].employment='VOLUNTEER';ops.people[0].active=false;
 expect(()=>applyPermanentWorkforce(state,workforce,ops,'2026-10-26')).toThrow('활동');
 ops.people[0].active=true;
 expect(()=>applyPermanentWorkforce(state,{...workforce,checkedOn:'2027-01-01'},ops,'2026-10-26')).toThrow('시점');
});
it('requires operator qualifications and prohibits duplicate people across roles',()=>{
 const {state,workforce,ops}=setup();workforce.workers[0]={...workforce.workers[0],role:'OPERATOR',operatorId:id(100)};
 expect(()=>applyPermanentWorkforce(state,workforce,ops,'2026-10-26')).toThrow('자격');
 workforce.workers[1].workerId=workforce.workers[0].workerId;
 expect(permanentWorkforceSchema.safeParse(workforce).success).toBe(false);
});
it('enforces future contract expiry in the common crop scheduler without altering saved source data',async()=>{
 const source=jointSource(),{workforce,ops}=setup();
 // No confirmed operator is available. Registration count cannot make machine
 // operations executable, even when every machine is present.
 source.state=applyPermanentWorkforce(source.state!,workforce,ops,source.today);
 const before=JSON.stringify(source),view=await calculateProduction(source);
 expect(view.items.every(i=>i.status==='BLOCKED')).toBe(true);
 expect(JSON.stringify(source)).toBe(before);
});
it('uses each named operator calendar and resolves an operator/support loan to the same person',()=>{
 const {workforce,ops}=setup(),raw=demoResourceState();
 raw.operatorRoster=[0,1].map(n=>({id:id(100+n),name:`Operator ${n}`,active:true,kinds:['TR'],from:'2026-01-01',until:'2027-12-31',weekdays:[1,2,3,4,5],startMinute:480,endMinute:960,excludedDates:[],evidence:'synthetic fixture'}));
 workforce.workers.slice(0,2).forEach((w,n)=>{w.role='OPERATOR';w.operatorId=id(100+n);w.endMinute=960;});
 workforce.workers[0].excludedDates=['2026-10-26'];
 const state=applyPermanentWorkforce(raw,workforce,ops,'2026-10-26'),start=dateSlot('2026-10-26');
 expect(workforceDaySummary(state,'2026-10-26')).toMatchObject({registeredPeople:50,permanentPeople:5,ordinaryHours:12,operatorHours:8});
 const job={id:'tractor',original:start,duration:4,allowed:[start],resource:'TR01',field:'field',person:null,staff:1,transport:0,locked:false,selected:true,preferred:null,predecessor:null};
 const result=withNamedOperators(state,job,{resourceId:'TR01',machineOperators:1,staff:1});
 expect(result.options![0].operatorCandidates?.map(p=>p.id)).toEqual([id(101)]);
 const source=jointSource();source.state=state;source.state.laborCapacity={incoming:[],outgoing:[{id:'loan',ownerCenterId:'demo',workerId:id(1),travelMinutes:30} as any]};
 expect(()=>assertCrossCenterPeople([{centerId:'demo',date:'2026-10-26',startMinute:540,durationMinutes:60,operatorIds:[id(101)]},{centerId:'other',date:'2026-10-26',startMinute:600,durationMinutes:60,laborSupportIds:['loan']}],[source])).toThrow('중복 배정');
 expect(workforceDaySummary(state,'2028-01-03')?.operatorHours).toBe(0);
});
