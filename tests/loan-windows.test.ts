import {it,expect} from 'vitest';
import {compoundCapacityFixture} from './compound-congestion-fixture';
import {studyLoanWindows,workloadSchedulingContract} from '../lib/capacity-study-scheduling';
import {dateSlot,slotDate,verifySchedule,type SchedulingContract} from '../lib/scheduling-engine';
import {contentHash} from '../lib/capacity-study-input';

it('keeps disjoint compatible work windows instead of granting every machine the entire year',()=>{
 const f=compoundCapacityFixture(),task=f.summary.tasks.find(t=>t.centerId==='demo'&&t.operationCode==='harvest')!;
 const tasks=[{...task,from:'2027-05-01',to:'2027-05-02'},{...task,id:task.id+'-next',from:'2027-09-01',to:'2027-09-02'}];
 const loans=studyLoanWindows(tasks,f.summary.baseline,f.context.neighbors);
 expect(loans).toHaveLength(2);expect(loans.map(l=>[l.from,l.to])).toEqual([['2027-05-01','2027-05-02'],['2027-09-01','2027-09-02']]);
 expect(loans.every(l=>l.machineId===f.replacement.id&&l.permission==='ASSUMED_FOR_STUDY')).toBe(true);
 expect(studyLoanWindows(tasks,f.summary.baseline,{})).toEqual([]);
});

it('intersects all loan windows with operation days, failures and immutable other-center bookings',()=>{
 const f=compoundCapacityFixture(),harvest=f.summary.tasks.find(t=>t.centerId==='demo'&&t.operationCode==='harvest')!,lender=f.summary.tasks.find(t=>t.centerId==='cheoncheon'&&t.operationCode==='harvest')!;
 const context={...f.context,loans:[{...f.context.loans[0],from:f.from,to:f.from,transferSlots:4},{...f.context.loans[0],from:'2027-09-22',to:'2027-09-24',transferSlots:6}],
  incidents:[...f.context.incidents,{kind:'FAULT' as const,machineId:f.replacement.id,from:'2027-09-23',to:'2027-09-23'}],
  fixedAssignments:[{id:lender.id,start:dateSlot('2027-09-24'),duration:lender.durationSlots,resource:f.replacement.id}]};
 const before=contentHash(context),c=workloadSchedulingContract(f.summary.tasks,f.summary.baseline,context,true),job=c.tasks.find(t=>t.id===harvest.id)!;
 expect(job.options?.every(o=>o.allowed.length>0)).toBe(true);
 expect(job.options?.filter(o=>o.resource===f.broken.id)).toEqual([]);
 expect(job.options?.map(o=>({days:[...new Set(o.allowed.map(slotDate))],duration:o.duration}))).toEqual([
  {days:[f.from],duration:harvest.durationSlots+4},{days:['2027-09-22'],duration:harvest.durationSlots+6},
 ]);
 expect(c.tasks.find(t=>t.id===lender.id)?.options?.some(o=>o.resource===f.replacement.id&&o.allowed.includes(dateSlot('2027-09-24')))).toBe(true);
 expect(contentHash(context)).toBe(before);
});

it('independently verifies the selected duration for one machine with different travel windows',()=>{
 const c:SchedulingContract={purpose:'INITIAL',freezeBefore:0,daily:false,staffCapacity:0,transportCapacity:0,tasks:[{id:'task',original:0,duration:4,resource:'machine',field:null,person:null,staff:0,transport:0,selected:true,preferred:null,predecessor:null,optional:true,allowed:[],options:[{resource:'machine',allowed:[0],duration:6,borrowed:true},{resource:'machine',allowed:[32],duration:8,borrowed:true}]}]};
 expect(()=>verifySchedule(c,[{id:'task',start:32,resource:'machine',duration:8}],'INITIAL_DISPATCH')).not.toThrow();
 expect(()=>verifySchedule(c,[{id:'task',start:32,resource:'machine',duration:6}],'INITIAL_DISPATCH')).toThrow();
 expect(()=>verifySchedule(c,[{id:'task',start:16,resource:'machine',duration:8}],'INITIAL_DISPATCH')).toThrow();
});
