import {it,expect,vi} from 'vitest';
import {calculateCurrentSchedule as calculate} from './current-solver';
import {solveSchedule,verifySchedule,type SchedulingContract,type SchedulingJob} from '../lib/scheduling-engine';
function contract(n:number):SchedulingContract{
 const tasks:SchedulingJob[]=Array.from({length:n},(_,i)=>({id:'job-'+i,original:i*64,allowed:[i*64],duration:1,resource:'shared-machine',field:'field-'+i,person:null,staff:1,transport:1,optional:true,selected:true,preferred:null,predecessor:i?'job-'+(i-1):null}));
 return {tasks,purpose:'INITIAL',daily:false,freezeBefore:0,staffCapacity:1,transportCapacity:1};
}
it('calculates and independently verifies 1,200 jobs without ignoring shared resources or seasonal dependencies',async()=>{
 const c=contract(1200);c.staffCapacity=10;c.transportCapacity=10;
 c.tasks=c.tasks.map((t,i)=>{const month=Math.floor(i/100),within=i%100,start=month*30*32+Math.floor(within/10)*3;return {...t,original:start,allowed:[start,start+1],duration:2,resource:'machine-'+(within%10),predecessor:i>=100?'job-'+(i-100):null}});
 const r=await calculate(c);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 expect(r.assignments).toHaveLength(1200);expect(r.components).toBe(12);expect(r.optimal).toBe(false);
 expect(()=>verifySchedule(c,r.assignments,r.phase)).not.toThrow();
},45000);
it('propagates an unassigned prerequisite across components rather than scheduling its descendants',async()=>{
 const c=contract(601);c.tasks[0].allowed=[];
 const r=await calculate(c);expect(r.status).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 expect(r.assignments).toEqual([]);expect(r.unassigned).toHaveLength(601);
},45000);
it('refuses to row-chunk 601 mutually overlapping jobs, returning no partially applicable plan',async()=>{
 const c=contract(601);c.tasks=c.tasks.map(t=>({...t,allowed:[0],original:0,predecessor:null}));
 const r=await calculate(c);expect(r.status).toBe('NO_FEASIBLE_PLAN');if(r.status==='NO_FEASIBLE_PLAN')expect(r.reason).toContain('600');
});

function centers():SchedulingContract{
 const c=contract(700);c.staffCapacity=0;c.transportCapacity=0;c.capacityLimits={};
 c.tasks=c.tasks.map((t,i)=>{const center=Math.floor(i/175),n=i%175,start=Math.floor(n/10);c.capacityLimits![`center${center}:workers`]=10;
  return {...t,predecessor:null,original:start,allowed:[start],duration:1,staff:0,transport:0,
   resource:`center${center}-machine-${n%10}`,capacityDemands:{[`center${center}:workers`]:1},locked:n===0,optional:n!==0};});
 return c;
}
it('keeps 700 same-day jobs feasible only with disjoint real resource pools and preserves fixed assignments',async()=>{
 const c=centers(),before=structuredClone(c),r=await calculate(c);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 expect(r.assignments).toHaveLength(700);expect(r.components).toBe(4);expect(r.largestComponent).toBe(175);verifySchedule(c,r.assignments,r.phase);
 for(const t of c.tasks.filter(t=>t.locked))expect(r.assignments.find(a=>a.id===t.id)).toMatchObject({start:t.original,resource:t.resource,duration:t.duration});
 expect(c).toEqual(before);c.capacityLimits!['center0:workers']=0;
 const failed=await calculate(c);expect(failed.status).toBe('NO_FEASIBLE_PLAN');expect('assignments' in failed).toBe(false);
},45000);
it('does not split a shared backup machine across centers to evade the connected-group safety limit',async()=>{
 const c=centers();c.tasks=c.tasks.map(t=>({...t,allowed:[],options:[{resource:t.resource,allowed:[t.original],borrowed:false},{resource:'common-backup',allowed:[t.original],borrowed:true}]}));
 const r=await calculate(c);expect(r.status).toBe('NO_FEASIBLE_PLAN');expect(r.largestComponent).toBe(700);expect('assignments' in r).toBe(false);
});
it('requires the new resource-time capability from the HTTP solver before using a large result',async()=>{
 const old=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({status:'NO_FEASIBLE_PLAN',contractVersion:'shared-schedule-v1',capacityPoolsVersion:'qualified-pools-v1',largeScheduleVersion:'time-components-v1',reason:'old server'}));
 try{await expect(solveSchedule(centers())).rejects.toThrow('재시작')}finally{old.mockRestore()}
});
