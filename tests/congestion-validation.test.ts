import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {calculateCurrentSchedule as calculate} from './current-solver';
import {verifySchedule,type SchedulingContract,type SchedulingJob} from '../lib/scheduling-engine';
import {contentHash} from '../lib/capacity-study-input';
import {summarizeCapacity} from '../lib/capacity-workload';
import {capacityScaleFixture} from './capacity-scale-fixture';
import {compareCapacityPlans} from '../lib/capacity-study-scheduling';
const evidence:Record<string,unknown>[]=[];
const persist=()=>{const dir='.data/validation/20261003-capacity-partitions';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/congestion.json',JSON.stringify({checkedAt:new Date().toISOString(),basis:'SYNTHETIC_INPUT_REAL_COMMON_ENGINE',results:evidence},null,2))};
const dense=(count:number):SchedulingContract=>({purpose:'REPLAN',rebuildMode:'EXPAND',daily:false,freezeBefore:0,staffCapacity:20,transportCapacity:20,tasks:Array.from({length:count},(_,i):SchedulingJob=>({id:'dense-'+i,original:Math.floor(i/20),allowed:[Math.floor(i/20),Math.floor(i/20)+1],duration:1,resource:'machine-'+i%20,field:'field-'+i,person:null,staff:1,transport:1,selected:true,movable:true,preferred:0,predecessor:null}))});
it('solves and independently validates one connected 600-task busy day, then proves a hard resource loss cannot be hidden',async()=>{
 const c=dense(600),before=contentHash(c),at=performance.now(),r=await calculate(c);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 expect(r.assignments).toHaveLength(600);verifySchedule(c,r.assignments,r.phase);expect(contentHash(c)).toBe(before);
 evidence.push({case:'dense-600',tasks:600,assigned:r.assignments.length,milliseconds:Math.round(performance.now()-at),optimal:r.optimal});
 const shortage={...c,staffCapacity:0},blocked=await calculate(shortage);expect(blocked.status).toBe('NO_FEASIBLE_PLAN');expect('assignments' in blocked).toBe(false);
 evidence.push({case:'dense-600-no-staff',status:blocked.status,partialApplied:false});persist();
},60000);
it('refuses a 601-job connected period, and validates 2,400 jobs only when time periods are independent',async()=>{
 const over=dense(601),rejected=await calculate(over);expect(rejected.status).toBe('NO_FEASIBLE_PLAN');expect('assignments' in rejected).toBe(false);
 const c=dense(200);c.tasks=Array.from({length:12},(_,month)=>dense(200).tasks.map(t=>({...t,id:`month-${month}-${t.id}`,original:t.original+month*32*30,allowed:t.allowed.map(s=>s+month*32*30),preferred:month*30}))).flat();
 const at=performance.now(),r=await calculate(c);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 expect(r.assignments).toHaveLength(2400);expect(r.components).toBe(12);expect(r.optimal).toBe(false);verifySchedule(c,r.assignments,r.phase);
 evidence.push({case:'connected-601',status:rejected.status,partialApplied:false},{case:'independent-2400',tasks:2400,assigned:2400,components:r.components,milliseconds:Math.round(performance.now()-at),optimal:r.optimal});persist();
},60000);
it('calculates the full 33-percent owner cohort across four centers and 30 profiles without converting a study into approved dispatch',async()=>{
 const input=capacityScaleFixture();
 const before=contentHash(input),summary=summarizeCapacity(input),baseline=contentHash(summary.baseline),at=performance.now();
 expect(summary.tasks.length).toBeGreaterThan(600);expect(new Set(summary.tasks.map(t=>t.centerId)).size).toBe(4);expect(new Set(summary.tasks.map(t=>t.cropId)).size).toBe(30);
 let solverCalls=0;
 const result=await compareCapacityPlans(input,summary.baseline,{neighbors:{},loans:[],incidents:[]},async c=>{solverCalls++;return calculate(c)});
 expect(solverCalls).toBe(1);
 for(const r of result.results){
  expect(['COMPLETE','PARTIAL'],JSON.stringify(r)).toContain(r.status);expect(r.assignments.length).toBeGreaterThan(0);expect(r.approvalEligible).toBe(false);
  expect(r.assignments.length+r.metrics.requiredUnassigned+r.metrics.conditionalUnassigned).toBe(summary.tasks.length);
  expect(r.calculation?.taskCount).toBe(1277);expect(r.calculation?.components).toBeGreaterThanOrEqual(4);expect(r.calculation?.largestComponent).toBeLessThanOrEqual(600);expect(r.optimal).toBe(false);
 }
 expect(contentHash(input)).toBe(before);expect(contentHash(summary.baseline)).toBe(baseline);
 evidence.push({case:'four-center-33-percent-30-crops',owners:400,participatingOwners:132,cropProfiles:30,tasks:summary.tasks.length,solverCalls,results:result.results.map(r=>({id:r.id,status:r.status,assigned:r.assignments.length,metrics:r.metrics,calculation:r.calculation})),milliseconds:Math.round(performance.now()-at),limitation:'Globally verified feasibility only; no proof of a global optimum, operational approval or field readiness; no records changed'});persist();
},90000);
