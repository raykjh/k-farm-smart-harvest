import {it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {withNamedOperators,operatorRosterSchema,type NamedOperator} from '../lib/named-operators';
import {dateSlot,verifySchedule,type SchedulingJob,type SchedulingContract} from '../lib/scheduling-engine';
import * as engine from '../lib/scheduling-engine';
import {buildAnnualPlan} from '../lib/annual-plan';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {appendAssignments} from '../lib/delegated-planning';
import {catalogState,catalogContext,catalogField,catalogCycle} from './catalog-fixtures';
import {calculateCurrentSchedule as calculate} from './current-solver';

const day=dateSlot('2034-05-01');
const person=(kinds:NamedOperator['kinds']=['TR','SE','GC']):NamedOperator=>({id:randomUUID(),name:'홍운영',active:true,kinds,weekdays:[0,1,2,3,4,5,6],from:'2034-01-01',until:'2034-12-31',excludedDates:[],startMinute:480,endMinute:960,evidence:'격리 검증용 교육·근무표 가정'});
const job=(id:string,resource='TESTTR01'):SchedulingJob=>({id,resource,field:id,person:null,staff:1,transport:1,original:day,duration:4,allowed:[day,day+4],selected:true,preferred:null,predecessor:null,optional:true});
const contract=(tasks:SchedulingJob[]):SchedulingContract=>({tasks,purpose:'INITIAL',freezeBefore:0,staffCapacity:8,transportCapacity:8,daily:false});
afterEach(()=>vi.restoreAllMocks());

it('assigns one qualified person to different equipment without overlapping shifts',async()=>{
 const s=catalogState(),p=person();s.operatorRoster=[p];
 const tasks=[job('a'),job('b','TESTTR02')].map(j=>withNamedOperators(s,j,{resourceId:j.resource,machineOperators:1,staff:1}));
 const result=await calculate(contract(tasks));expect(result.status).toBe('FEASIBLE');if(result.status!=='FEASIBLE')return;
 expect(result.assignments).toHaveLength(2);expect(new Set(result.assignments.map(a=>a.start)).size).toBe(2);
 expect(result.assignments.every(a=>a.operatorIds?.join()===p.id)).toBe(true);
 expect(()=>verifySchedule(contract(tasks),result.assignments.map(a=>({...a,start:day})),'INITIAL_DISPATCH')).toThrow('중복 배정');
 expect(()=>verifySchedule(contract(tasks),result.assignments.map(a=>({...a,operatorIds:[randomUUID()]})),'INITIAL_DISPATCH')).toThrow('운영자');
});
it('enforces skills, shift boundaries, excluded dates and freezes named assignments',async()=>{
 const s=catalogState(),p=person(['TR']);s.operatorRoster=[p];
 const make=(j:SchedulingJob)=>withNamedOperators(s,j,{resourceId:j.resource,machineOperators:1,staff:1,operatorIds:j.operatorIds});
 const dr=await calculate(contract([make(job('dr','TESTDR01'))]));expect(dr.status==='FEASIBLE'&&dr.assignments).toEqual([]);
 p.excludedDates=['2034-05-01'];expect((await calculate(contract([make(job('off'))]))).status).toBe('FEASIBLE');
 const excluded=await calculate(contract([make({...job('locked'),optional:false,locked:true,operatorIds:[p.id]})]));expect(excluded.status).toBe('NO_FEASIBLE_PLAN');
 p.excludedDates=[];p.startMinute=540;
 expect(make(job('early')).options![0].operatorCandidates).toEqual([{id:p.id,allowed:[day+4]}]);
 p.startMinute=480;p.endMinute=525;
 expect(make(job('too-long')).options![0].operatorCandidates).toEqual([]);
 expect(operatorRosterSchema.safeParse([{...p,startMinute:540,endMinute:480}]).success).toBe(false);
});
it('normal catalog planning persists individual operators and later admissions preserve their bookings',async()=>{
 vi.spyOn(engine,'solveSchedule').mockImplementation(calculate);
 const s=catalogState();s.operatorRoster=[person(['TR','SE','GC','DR','SP'])];
 const plan=buildAnnualPlan([catalogField('soybean')],2034,1,catalogContext(),catalogCycle('soybean'),undefined,s);
 const first=await previewAnnualDispatch(plan,s,'2033-12-31');expect(first.feasibility[0].status).toBe('CAPACITY_FEASIBLE');
 const scheduled=appendAssignments(s,plan,first),original=structuredClone(scheduled.missions);
 expect(scheduled.missions.filter(m=>m.resourceId).every(m=>m.operatorIds?.length===1)).toBe(true);
 const f={...catalogField('soybean'),pnu:'5274036023900020001'},c={...catalogCycle('soybean'),id:randomUUID(),pnu:f.pnu};
 const second=buildAnnualPlan([f],2034,1,catalogContext(),c,undefined,scheduled),placement=await previewAnnualDispatch(second,scheduled,'2033-12-31');
 expect(placement.feasibility[0].status).toBe('CAPACITY_FEASIBLE');expect(scheduled.missions).toEqual(original);
 const all=appendAssignments(scheduled,second,placement).missions.filter(m=>m.resourceId);
 for(const a of all)for(const b of all)if(a.id!==b.id&&a.scheduledDate===b.scheduledDate&&a.operatorIds?.some(id=>b.operatorIds?.includes(id)))expect(a.start+a.duration<=b.start||b.start+b.duration<=a.start).toBe(true);
},30000);
