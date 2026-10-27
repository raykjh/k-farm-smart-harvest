import {it,expect,beforeAll} from 'vitest';
import {workloadObservations,calibrateWorkload,type WorkloadObservation} from '../lib/workload-history';
import {calculateProduction} from '../lib/production-service';
import {jointSource} from './integrated-plan-fixture';
import type {AnnualPlan} from '../lib/annual-plan';
import type {ReportEvidence} from '../lib/work-report';
import {emptyLaborOps,type LaborJob} from '../lib/labor-operations';

let plan:AnnualPlan,operation:string;
beforeAll(async()=>{
 const s=jointSource('demo',1),v=await calculateProduction(s,undefined,{choices:[{pnu:s.fields[0].pnu,crop:'potato',profileId:s.criteria.profiles[0].id}]});
 plan=v.items[0].proposal!.plan;operation=plan.plots[0].tasks.find(t=>t.kind==='PROCESS'&&!t.requirements.machineCode)!.operationCode;
});
function fixture(elapsedValues=[75,78,80,82,85]){
 const ops=emptyLaborOps(),plans:AnnualPlan[]=[],history:ReportEvidence[]=[];
 elapsedValues.forEach((elapsed,i)=>{
  const p=structuredClone(plan),t=p.plots[0].tasks.find(t=>t.operationCode===operation)!;
  t.id=`historical-${i}`;t.window={from:'2026-06-01',to:'2026-06-20',basis:'SYNTHETIC'};p.plots[0].tasks=[t];p.plots[0].pnu=`historical-field-${i}`;
  plans.push(p);const date=`2026-06-${String(i+1).padStart(2,'0')}`,start=`${date}T08:00:00+09:00`,end=new Date(Date.parse(start)+elapsed*60000).toISOString();
  history.push({missionId:t.id,plannedDate:date,source:'DEMO_SIMULATION',assessment:'SIMULATED_COMPLETED',simulatedStartedAt:start,simulatedFinishedAt:end,confirmedBy:'Synthetic staff',confirmedAt:end,missionSnapshot:{id:t.id,resourceId:null,scheduledDate:date}} as ReportEvidence);
  ops.jobs.push({id:`job-${i}`,missionId:t.id,task:'Synthetic task',address:'Synthetic location',date,startMinute:480,durationMinutes:90,count:1,workCode:operation,sourceHash:'synthetic-source',pay:'synthetic only',status:'COMPLETED',invited:['person'],responses:{person:'PHONE'},distances:{},manual:null,worked:['person'],assigned:['person'],reserveWorked:[],completedAt:end} satisfies LaborJob);
 });return {ops,plans,history};
}
it('requires confirmed worker results and execution timestamps rather than trusting a completion flag',()=>{
 const f=fixture();expect(workloadObservations(f.plans,f.history,f.ops,'2026-10-26')).toHaveLength(5);
 f.ops.jobs[0].worked=[];f.history[1].simulatedFinishedAt=null;f.history[2].assessment='SIMULATED_HELD';f.history[3].confirmedAt='2027-01-01T00:00:00Z';
 expect(workloadObservations(f.plans,f.history,f.ops,'2026-10-26')).toHaveLength(1);
});
it('uses the first effective correction and excludes invalid dates, future knowledge and out-of-window work',()=>{
 const f=fixture();f.history.unshift({...f.history[0],assessment:'SIMULATED_HELD'});f.history[2].confirmedAt='invalid';f.ops.jobs[2].date='2026-07-01';
 const observations=workloadObservations(f.plans,f.history,f.ops,'2026-10-26');
 expect(observations.map(o=>o.id)).not.toContain('historical-0');expect(observations).toHaveLength(2);
});
it('calibrates only comparable prior-season manual work and avoids counting setup twice',()=>{
 const f=fixture(),s=jointSource('demo',1),observations=workloadObservations(f.plans,f.history,f.ops,s.today);
 const old=s.criteria.profiles[0].context,before=JSON.stringify(old),c=calibrateWorkload(old,s.fields[0],'potato',s.today,observations,'DEMO_SIMULATION');
 expect(c.evidence).toEqual([expect.objectContaining({operation,samples:5,fields:5,oldMinutesPer1000m2:60,newMinutesPer1000m2:80})]);
 expect(c.context.operations!.potato![operation]).toMatchObject({laborMinutesPer1000m2:80,setupMinutes:0});expect(JSON.stringify(old)).toBe(before);
});
it('keeps real and simulated outcomes separate and falls back on small or unrelated samples',()=>{
 const f=fixture(),s=jointSource('demo',1),obs=workloadObservations(f.plans,f.history,f.ops,s.today);
 for(const [rows,origin] of [[obs.slice(0,4),'DEMO_SIMULATION'],[obs,'ACTUAL'],[obs.map(o=>({...o,conditionsKey:'other'})),'DEMO_SIMULATION'],[obs.map(o=>({...o,crew:2})),'DEMO_SIMULATION'],[obs.map(o=>({...o,completedOn:'2027-12-01'})),'DEMO_SIMULATION']] as [WorkloadObservation[],WorkloadObservation['origin']][])expect(calibrateWorkload(s.criteria.profiles[0].context,s.fields[0],'potato',s.today,rows,origin).evidence).toEqual([]);
});
it('updates the next-year work rate while preserving the minimum half-day booking',async()=>{
 const f=fixture(),s=jointSource('demo',1);s.criteria.profiles[0].dataOrigin='DEMO';
 const choices=[{pnu:s.fields[0].pnu,crop:'potato' as const,profileId:s.criteria.profiles[0].id}];
 const base=await calculateProduction(s,undefined,{choices});s.workloadObservations=workloadObservations(f.plans,f.history,f.ops,s.today);
 const before=JSON.stringify(s),improved=await calculateProduction(s,undefined,{choices});
 const duration=(v:typeof base)=>{const p=v.items[0].proposal!,id=p.plan.plots[0].tasks.find(t=>t.operationCode===operation)!.id;return p.dispatch.assignments.find(a=>a.taskId===id)!.durationMinutes;};
 expect(duration(base)).toBe(240);expect(duration(improved)).toBe(240);expect(JSON.stringify(s)).toBe(before);
 const requirement=improved.items[0].proposal!.plan.plots[0].tasks.find(t=>t.operationCode===operation)!.requirements;
 expect(requirement).toMatchObject({laborMinutesPer1000m2:80,setupMinutes:0});
});
it('extends the booking beyond a half day when observations require it, without treating slot rounding as an observed prediction',async()=>{
 const f=fixture([275,280,290,300,305]),s=jointSource('demo',1);s.criteria.profiles[0].dataOrigin='DEMO';s.criteria.profiles[0].context.operations!.potato![operation].laborMinutesPer1000m2=180;
 const choices=[{pnu:s.fields[0].pnu,crop:'potato' as const,profileId:s.criteria.profiles[0].id}];
 const base=await calculateProduction(s,undefined,{choices});s.workloadObservations=workloadObservations(f.plans,f.history,f.ops,s.today);
 const revised=await calculateProduction(s,undefined,{choices});
 const duration=(v:typeof base)=>{const p=v.items[0].proposal!,task=p.plan.plots[0].tasks.find(t=>t.operationCode===operation)!;return p.dispatch.assignments.find(a=>a.taskId===task.id)!.durationMinutes;};
 expect(duration(base)).toBe(240);expect(duration(revised)).toBe(300);
 const r=revised.items[0].proposal!.plan.plots[0].tasks.find(t=>t.operationCode===operation)!.requirements;
 expect(r).toMatchObject({laborMinutesPer1000m2:290,setupMinutes:0});
 const subsequent=[285,300,310],error=(forecast:number)=>subsequent.reduce((n,v)=>n+Math.abs(v-forecast),0)/subsequent.length;
 expect(error(290)).toBeLessThan(error(210)*0.9);
});
