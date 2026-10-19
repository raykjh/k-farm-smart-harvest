import {it,expect} from 'vitest';
import {calculateCurrentSchedule} from './current-solver';
import {verifySchedule,type SchedulingContract,type SchedulingJob} from '../lib/scheduling-engine';

// Small synthetic workloads expose search behavior without agricultural-rate
// claims, DB writes, paid model calls, or any prepared solution fed to the solver.
function batch(count:number,mode:'nearest'|'related'):SchedulingContract{
 const manual=Math.floor(count/4),equipment=count-manual,active=Math.ceil(equipment/24),workers=Math.ceil(manual/24);
 const resources=Array.from({length:active+1},(_,i)=>'machine-'+i);
 const target=mode==='nearest'?4:2,dates=mode==='nearest'?[2,3,4,5,6]:[2];
 const starts=dates.flatMap(d=>Array.from({length:32},(_,i)=>d*32+i));
 const tasks:SchedulingJob[]=Array.from({length:count},(_,i):SchedulingJob=>{
  const hand=i>=equipment,n=hand?i-equipment:i,resource=hand?null:resources[n%active];
  return {id:'target-'+i,original:32+Math.floor(n/(hand?workers:active)),duration:1,allowed:starts,
   selected:true,preferred:target,movable:true,resource,field:'field-'+i,person:null,staff:1,transport:hand?0:1,predecessor:null,
   capacityDemands:hand?{workers:1}:{operators:1},
   options:(hand?[null]:resources).map(resource=>({resource,allowed:starts,borrowed:false,duration:1}))};
 });
 for(const [i,resource] of [...resources,...Array<null>(workers).fill(null)].entries()){
  tasks.push({id:'block-'+i,original:target*32,duration:32,allowed:[2,3,4,5,6].filter(d=>d>=target).map(d=>d*32),
   selected:false,preferred:null,movable:mode==='related',locked:mode==='nearest',resource,field:'block-field-'+i,person:null,
   staff:1,transport:resource?1:0,capacityDemands:resource?{operators:1}:{workers:1},predecessor:null});
 }
 return {tasks,freezeBefore:0,daily:true,explicitPreferred:true,rebuildMode:mode==='nearest'?'PRESERVE':'EXPAND',
  staffCapacity:resources.length+workers,transportCapacity:resources.length,capacityLimits:{operators:resources.length,workers}};
}

it.each([false,true])('places all 120 jobs on the closest free day, reversed input = %s',async reverse=>{
 const c=batch(120,'nearest');if(reverse)c.tasks.reverse();const before=structuredClone(c);
 const r=await calculateCurrentSchedule(c);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 verifySchedule(c,r.assignments,r.phase);expect(c).toEqual(before);
 for(const task of c.tasks){const a=r.assignments.find(a=>a.id===task.id)!;
  if(task.selected)expect(Math.abs(Math.floor(a.start/32)-4)).toBe(1);
  else expect(a).toMatchObject({start:task.original,resource:task.resource});
 }
},20000);

it('places 240 tasks by moving related bookings, without a supplied witness or wider windows',async()=>{
 const c=batch(240,'related'),before=structuredClone(c);
 const r=await calculateCurrentSchedule(c);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');if(r.status!=='FEASIBLE')return;
 verifySchedule(c,r.assignments,r.phase);expect(c).toEqual(before);expect(r.phase).toBe('REBUILD_APPROVED');
 expect(r.assignments).toHaveLength(c.tasks.length);
 for(const a of r.assignments.filter(a=>a.id.startsWith('target-')))expect(Math.floor(a.start/32)).toBe(2);
 expect(r.assignments.some(a=>a.id.startsWith('block-')&&a.start!==64)).toBe(true);
},20000);
