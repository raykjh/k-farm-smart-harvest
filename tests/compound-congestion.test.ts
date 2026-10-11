import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {contentHash} from '../lib/capacity-study-input';
import {compareCapacityPlans,workloadSchedulingContract,type StudyCalculationContext} from '../lib/capacity-study-scheduling';
import {dateSlot,slotDate} from '../lib/scheduling-engine';
import {calculateCurrentSchedule as calculate} from './current-solver';
import {compoundCapacityFixture} from './compound-congestion-fixture';

const evidence:unknown[]=[];
function record(value:unknown){
 evidence.push(value);const dir='.data/validation/20261003-compound-congestion';mkdirSync(dir,{recursive:true});
 writeFileSync(dir+'/results.json',JSON.stringify({checkedAt:new Date().toISOString(),basis:'SYNTHETIC_DATA_REAL_COMMON_CP_SAT',operationalApproval:false,paidAiCalled:false,results:evidence},null,2));
}
const metrics=(result:Awaited<ReturnType<typeof compareCapacityPlans>>)=>result.results.map(r=>({id:r.id,status:r.status,assigned:r.assignments.length,metrics:r.metrics,calculation:r.calculation,reason:r.reason}));

it('combines a seven-day failure and labor absence, borrows only a direct neighbor, preserves lender bookings and inputs',async()=>{
 const f=compoundCapacityFixture(),before=contentHash(f),b=f.summary.baseline;
 const first=await compareCapacityPlans(f.input,b,{...f.context,loans:[],incidents:[]},calculate);
 expect(first.results[0].status).toBe('COMPLETE');
 const lenderTasks=new Set(f.summary.tasks.filter(t=>t.centerId==='cheoncheon').map(t=>t.id));
 const fixed=first.results[0].assignments.filter(a=>lenderTasks.has(a.id));
 expect(fixed.length).toBeGreaterThan(0);
 const context={...f.context,fixedAssignments:fixed},at=performance.now();
 const result=await compareCapacityPlans(f.input,b,context,calculate);
 expect(result.results[0].status).toBe('PARTIAL');
 const borrowed=result.results[1];expect(borrowed.status,JSON.stringify(borrowed)).toBe('COMPLETE');expect(borrowed.metrics.borrowedTasks).toBe(1);
 for(const a of fixed)expect(borrowed.assignments.find(v=>v.id===a.id)).toEqual(a);
 const harvest=f.summary.tasks.find(t=>t.centerId==='demo'&&t.operationCode==='harvest')!;
 expect(borrowed.assignments.find(a=>a.id===harvest.id)?.resource).toBe(f.replacement.id);
 const moved=borrowed.assignments.find(a=>a.id===harvest.id)!;
 expect(fixed.some(a=>a.resource===moved.resource&&slotDate(a.start)===slotDate(moved.start))).toBe(false);
 for(const r of result.results){
  expect(r.approvalEligible).toBe(false);
  expect(r.assignments.filter(a=>a.resource===f.broken.id&&slotDate(a.start)>=f.from&&slotDate(a.start)<=f.to)).toEqual([]);
 }
 expect(contentHash(f)).toBe(before);expect(result.recommendation.inferenceCalled).toBe(false);
 record({case:'fault-absence-adjacent-loan-fixed-lender',results:metrics(result),fixedAssignments:fixed.length,milliseconds:Math.round(performance.now()-at)});

 const variants:[string,Partial<StudyCalculationContext>][]=[
  ['no-loan',{loans:[]}],['not-adjacent',{neighbors:{}}],
  ['unconfirmed-logistics',{loans:f.context.loans.map(l=>({...l,operatorAndTransportConfirmed:false}))}],
  ['replacement-also-broken',{incidents:[...f.context.incidents,{kind:'FAULT' as const,machineId:f.replacement.id,from:f.from,to:f.to}]}],
 ];
 for(const [name,change] of variants){
  // Do not keep a locked lender task on a newly broken machine in this input.
  const c={...f.context,...change},r=await compareCapacityPlans(f.input,b,c,calculate);
  expect(r.results[1].metrics.borrowedTasks,name).toBe(0);expect(r.results[1].metrics.requiredUnassigned,name).toBeGreaterThan(0);
  expect(r.results[1].status,name).toBe('PARTIAL');record({case:name,results:metrics(r)});
 }
},90000);

it('does not treat a borrowed machine as replacement labor, and refuses conflicting fixed work without partial approval',async()=>{
 const f=compoundCapacityFixture();
 const severe={...f.context,incidents:f.context.incidents.map(i=>i.kind==='LABOR_ABSENCE'?{...i,workers:100}:i)};
 const r=await compareCapacityPlans(f.input,f.summary.baseline,severe,calculate);
 expect(r.results[1].status).toBe('PARTIAL');expect(r.results[1].metrics.requiredUnassigned).toBeGreaterThan(0);
 const ids=new Set(r.results[1].assignments.map(a=>a.id));
 const harvest=f.summary.tasks.find(t=>t.centerId==='demo'&&t.operationCode==='harvest')!,finish=f.summary.tasks.find(t=>t.centerId==='demo'&&t.operationCode==='finish')!;
 expect(ids.has(harvest.id)).toBe(false);expect(ids.has(finish.id)).toBe(false);
 const fixed={...f.context,fixedAssignments:[{id:harvest.id,start:dateSlot(f.from),duration:harvest.durationSlots,resource:f.broken.id}]};
 const blocked=await compareCapacityPlans(f.input,f.summary.baseline,fixed,calculate);
 for(const v of blocked.results){expect(v.status).toBe('NO_FEASIBLE_PLAN');expect(v.assignments).toEqual([]);expect(v.approvalEligible).toBe(false)}
 record({case:'severe-labor-shortage',results:metrics(r)});record({case:'locked-broken-resource',results:metrics(blocked)});
},30000);

it('applies the same combined incidents to the 132-owner, four-center, 30-crop workload without adding resources',async()=>{
 const f=compoundCapacityFixture(true),before=contentHash(f),at=performance.now();
 const r=await compareCapacityPlans(f.input,f.summary.baseline,f.context,calculate);
 expect(r.results[0].status,JSON.stringify(metrics(r))).toBe('PARTIAL');
 expect(r.results[0].metrics.requiredUnassigned).toBeGreaterThanOrEqual(4);
 expect(r.results[1].status,JSON.stringify(metrics(r))).toBe('COMPLETE');
 expect(r.results[1].assignments).toHaveLength(1277);expect(r.results[1].metrics.borrowedTasks).toBe(2);
 for(const v of r.results){
  expect(v.approvalEligible).toBe(false);
  if(v.status==='COMPLETE'||v.status==='PARTIAL'){
   expect(v.assignments.length+v.metrics.requiredUnassigned+v.metrics.conditionalUnassigned).toBe(f.summary.tasks.length);
   const c=workloadSchedulingContract(f.summary.tasks,f.summary.baseline,f.context,v.id==='AUTHORIZED_NEIGHBORS');
   // The common verifier already includes synthetic locked absence occupancy.
   expect(v.calculation?.largestComponent).toBeLessThanOrEqual(600);
   for(const a of v.assignments){const task=f.summary.tasks.find(t=>t.id===a.id)!;expect(slotDate(a.start)>=task.from&&slotDate(a.start)<=task.to).toBe(true);}
   expect(c.tasks.length).toBeGreaterThan(f.summary.tasks.length);
  }else{expect(v.assignments).toEqual([]);expect(v.reason).toBeTruthy()}
 }
 expect(contentHash(f)).toBe(before);expect(r.recommendation.inferenceCalled).toBe(false);
 record({case:'compound-1277',tasks:f.summary.tasks.length,owners:f.summary.participation.selectedCount,results:metrics(r),milliseconds:Math.round(performance.now()-at)});
},100000);

it('rejects an oversized connected pool instead of splitting simultaneous cross-center competition by row count',async()=>{
 const f=compoundCapacityFixture(true),context={...f.context,loans:f.summary.baseline.machines.flatMap(m=>Object.entries(f.context.neighbors).filter(([,ids])=>ids.includes(m.ownerCenterId)).map(([borrowerCenterId])=>({machineId:m.id,borrowerCenterId,from:'2027-01-01',to:'2028-12-31',transferSlots:4,operatorAndTransportConfirmed:true,permission:'ASSUMED_FOR_STUDY' as const})))};
 const c=workloadSchedulingContract(f.summary.tasks,f.summary.baseline,context,true),r=await calculate(c);
 expect(r.status).toBe('NO_FEASIBLE_PLAN');expect(r.largestComponent).toBeGreaterThan(600);expect('assignments' in r).toBe(false);
 record({case:'all-adjacent-options-connected-limit',tasks:c.tasks.length,status:r.status,components:r.components,largestComponent:r.largestComponent,reason:r.status==='NO_FEASIBLE_PLAN'?r.reason:undefined,partialApplied:false});
});
