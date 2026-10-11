import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {compoundCapacityFixture} from './compound-congestion-fixture';
import {calculateCurrentSchedule as calculate} from './current-solver';
import {workloadSchedulingContract,studyLoanWindows} from '../lib/capacity-study-scheduling';
import {slotDate} from '../lib/scheduling-engine';
import {contentHash} from '../lib/capacity-study-input';

it('narrows broad adjacent candidates by compatible windows and fixed lender bookings without deleting tasks',async()=>{
 const f=compoundCapacityFixture(true),before=contentHash(f),tasks=f.summary.tasks,b=f.summary.baseline;
 const baseline=await calculate(workloadSchedulingContract(tasks,b,{...f.context,loans:[],incidents:[]},false));
 expect(baseline.status).toBe('FEASIBLE');if(baseline.status!=='FEASIBLE')return;
 expect(baseline.assignments).toHaveLength(1277);
 const taskCenters=new Map(tasks.map(t=>[t.id,t.centerId]));
 const fixed=baseline.assignments.filter(a=>taskCenters.get(a.id)!=='demo');
 const context={...f.context,loans:studyLoanWindows(tasks,b,f.context.neighbors),fixedAssignments:fixed};
 const c=workloadSchedulingContract(tasks,b,context,true);
 expect(c.tasks.filter(t=>!t.id.startsWith('absence:'))).toHaveLength(1277);
 for(const t of c.tasks.filter(t=>t.resourceDayCenter==='demo'))for(const o of t.options??[]){
  expect(o.allowed.length).toBeGreaterThan(0);
  if(o.resource)for(const booked of fixed.filter(a=>a.resource===o.resource))expect(o.allowed.some(s=>slotDate(s)===slotDate(booked.start))).toBe(false);
 }
 const result=await calculate(c);expect(result.status,JSON.stringify(result)).toBe('FEASIBLE');
 expect(result.largestComponent).toBeLessThanOrEqual(600);
 if(result.status==='FEASIBLE')for(const a of fixed)expect(result.assignments.find(v=>v.id===a.id)).toEqual(a);
 expect(contentHash(f)).toBe(before);
 const dir='.data/validation/20261003-loan-windows-ui';mkdirSync(dir,{recursive:true});
 writeFileSync(dir+'/bounded-scale.json',JSON.stringify({checkedAt:new Date().toISOString(),basis:'SYNTHETIC_DATA_REAL_COMMON_SOLVER',taskCount:tasks.length,fixedLenderTasks:fixed.length,loanWindows:context.loans.length,status:result.status,components:result.components,largestComponent:result.largestComponent,assigned:result.status==='FEASIBLE'?result.assignments.filter(a=>!a.id.startsWith('absence:')).length:0,unassigned:result.status==='FEASIBLE'?result.unassigned?.length:null,lenderBookingsUnchanged:true,operationalApproval:false,paidAiCalls:0},null,2));
},100000);
