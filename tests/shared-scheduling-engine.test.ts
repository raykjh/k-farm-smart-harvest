import {it,expect,vi} from 'vitest';
import {previewAnnualDispatch} from '../lib/annual-dispatch';
import {calculateAnnualReplan} from '../lib/annual-replanning';
import {appendAssignments} from '../lib/delegated-planning';
import {dateSlot,solveSchedule,verifySchedule,SCHEDULING_ENGINE_VERSION,type SchedulingContract} from '../lib/scheduling-engine';
import {emptyCenter} from '../lib/center-registry';
import type {AnnualPlan} from '../lib/annual-plan';
import type {Mission} from '../lib/types';

const today='2027-05-01',first='2027-05-02',second='2027-05-03';
const weather={status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'isolated test'} as any;
const state=()=>({...emptyCenter('demo'),staffCount:1,transportCount:1,machines:[{id:'TR01',ownerCenterId:'demo',name:'test tractor',type:'tractor',status:'AVAILABLE' as const,safetyLock:false,capacityHaHour:0.0125}]});
function plot(id:string,to=second,predecessorKeys:string[]=[]){return {pnu:id,address:id,area:1000,crop:'rice',mode:'full',consultationId:'farmer-'+id,tasks:[{
 id,operationKey:id,operationCode:'soil',occurrence:1,name:'경운',kind:'PROCESS',predecessorKeys,window:{from:first,to},
 requirements:{machineCode:'TR',owner:'장비',staff:1,transport:1,setupMinutes:0,windLimitMs:10,rainSensitive:false},
}]};}
const plan=(plots:any[])=>({year:2027,plots}) as AnnualPlan;

it('places a flexible job after a tight-window job instead of losing feasible work to first-fit order',async()=>{
 const s=state(),p=plan([plot('flexible'),plot('tight',first)]),before=JSON.stringify({s,p});
 const r=await previewAnnualDispatch(p,s,today);
 expect(r.engineVersion).toBe(SCHEDULING_ENGINE_VERSION);expect(r.optimal).toBe(true);
 expect(r.assignments.map(a=>[a.taskId,a.date])).toEqual([['flexible',second],['tight',first]]);
 expect(r.feasibility.every(f=>f.status==='CAPACITY_FEASIBLE')).toBe(true);
 expect(JSON.stringify({s,p})).toBe(before);
});

it('retains saved initial bookings and uses the same engine for a later wind reschedule',async()=>{
 const s=state(),p=plan([plot('field')]);
 s.machines[0]={...s.machines[0],id:'DR01',type:'drone'};
 p.plots[0].tasks[0].requirements.machineCode='DR';p.plots[0].tasks[0].requirements.windLimitMs=5;
 const initial=await previewAnnualDispatch(p,s,today),saved=appendAssignments(s,p,initial);
 const original=JSON.stringify(saved);
 expect((await previewAnnualDispatch(p,saved,today)).assignments).toHaveLength(0);
 const r=await calculateAnnualReplan(saved,{ids:['field'],scope:'PRESERVE',simulation:{kind:'WIND',from:first,to:first}},weather,today);
 expect(r.status).toBe('FEASIBLE');expect(r.contractVersion).toBe(SCHEDULING_ENGINE_VERSION);
 expect(r.diff[0]).toMatchObject({id:'field',date:second});expect(JSON.stringify(saved)).toBe(original);
});

it('keeps fixed occupancy and selects equipment-specific duration that actually fits',async()=>{
 const s=state(),p=plan([plot('field',first)]);
 s.missions=[{id:'fixed',fieldId:'other',owner:'센터 인력',status:'PLANNED',scheduledDate:first,start:0,duration:16,staff:1,transport:0,resourceId:null} as Mission];
 const before=structuredClone(s.missions);
 expect((await previewAnnualDispatch(p,s,today)).assignments).toHaveLength(0);
 s.machines.push({...s.machines[0],id:'TR02',capacityHaHour:0.025});
 const next=await previewAnnualDispatch(p,s,today);
 expect(next.assignments[0]).toMatchObject({machineId:'TR02',startMinute:720,durationMinutes:240});
 expect(s.missions).toEqual(before);
 p.plots[0].area=2000;
 expect((await previewAnnualDispatch(p,s,today)).feasibility[0].status).toBe('INCOMPLETE');
});

it('resolves prerequisites independently of input order and never admits a descendant alone',async()=>{
 const s=state(),a=plot('before'),b=plot('after',second,['before']);b.pnu=a.pnu;
 const r=await previewAnnualDispatch(plan([b,a]),s,today);
 expect(r.assignments.find(a=>a.taskId==='before')!.date).toBe(first);
 expect(r.assignments.find(a=>a.taskId==='after')!.date).toBe(second);
 b.tasks[0].window.to=first;a.tasks[0].window.to=first;
 const partial=await previewAnnualDispatch(plan([b,a]),s,today);
 expect(partial.assignments.map(a=>a.taskId)).toEqual(['before']);expect(partial.feasibility.some(f=>f.status==='INCOMPLETE')).toBe(true);
 a.tasks[0].predecessorKeys=['after'];
 expect((await previewAnnualDispatch(plan([b,a]),s,today)).assignments).toHaveLength(0);
});

it('uses consultation identity to avoid double booking a farmer across newly registered fields',async()=>{
 const a=plot('a',first),b=plot('b',first);b.consultationId=a.consultationId;
 for(const p of [a,b])Object.assign(p.tasks[0].requirements,{machineCode:null,owner:'농부',staff:0,transport:0,laborMinutesPer1000m2:480});
 const r=await previewAnnualDispatch(plan([a,b]),state(),today);
 expect(r.assignments).toHaveLength(1);expect(r.feasibility.some(f=>f.status==='INCOMPLETE')).toBe(true);
});

it('normalizes legacy farmer work to ordinary center labor before and after persistence',async()=>{
 const s=state(),p=plan([plot('joint')]);s.staffCount=2;s.transportCount=0;
 Object.assign(p.plots[0].tasks[0].requirements,{machineCode:null,owner:'농부',staff:2,transport:0,laborMinutesPer1000m2:60});
 const initial=await previewAnnualDispatch(p,s,today);
 expect(initial.assignments[0]).toMatchObject({staff:2,transport:0,owner:'센터 인력',durationMinutes:240});
 const saved=appendAssignments(s,p,initial),r=await calculateAnnualReplan(saved,{ids:['joint'],preferred:second,scope:'PRESERVE'},weather,today);
 expect(r.status).toBe('FEASIBLE');expect(r.diff[0].date).toBe(second);
 s.staffCount=0;Object.assign(p.plots[0].tasks[0].requirements,{owner:'센터 인력',staff:1});
 expect((await previewAnnualDispatch(p,s,today)).assignments).toHaveLength(0);
});

it('validates chosen duration, fixed jobs and prerequisite presence independently of solver output',()=>{
 const job={id:'new',field:'p',person:null,resource:'TR',staff:1,transport:0,original:32,duration:4,allowed:[32],selected:true,preferred:null,predecessor:null,optional:true,options:[{resource:'TR',allowed:[32],duration:8,borrowed:false}]};
 const fixed={...job,id:'fixed',field:'other',resource:null,original:0,allowed:[0],duration:4,options:undefined,optional:false,locked:true};
 const c:SchedulingContract={tasks:[fixed,job],purpose:'INITIAL',freezeBefore:0,daily:false,staffCapacity:1,transportCapacity:1};
 const a=[{id:'fixed',start:0,resource:null},{id:'new',start:32,resource:'TR',duration:8}];
 expect(()=>verifySchedule(c,a,'INITIAL_DISPATCH')).not.toThrow();
 expect(()=>verifySchedule(c,[a[1]],'INITIAL_DISPATCH')).toThrow('작업 집합');
 expect(()=>verifySchedule(c,[a[0],{...a[1],duration:4}],'INITIAL_DISPATCH')).toThrow('조건');
 c.tasks.push({...job,id:'after',original:40,allowed:[40],options:undefined,predecessor:'new'});
 expect(()=>verifySchedule(c,[a[0],{id:'after',start:40}],'INITIAL_DISPATCH')).toThrow('순서');
 expect(()=>verifySchedule({...c,purpose:'REPLAN'},a,'INITIAL_DISPATCH')).toThrow('단계');
});

it('fails closed on an offline or stale common solver; never falls back to a second scheduling algorithm',async()=>{
 const s=state(),before=JSON.stringify(s),mock=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));
 try{
  await expect(previewAnnualDispatch(plan([plot('a')]),s,today)).rejects.toThrow('offline');
  mock.mockResolvedValue(Response.json({status:'FEASIBLE',contractVersion:'annual-replan-v3'}));
  await expect(previewAnnualDispatch(plan([plot('a')]),s,today)).rejects.toThrow('재시작');
  expect(JSON.stringify(s)).toBe(before);
 }finally{mock.mockRestore()}
});

it('the common HTTP engine accounts for lending-center daily pools during initial placement too',async()=>{
 const tasks=[0,1].map(i=>({id:String(i),field:String(i),person:null,resource:'old',staff:1,transport:1,original:32+i*4,duration:4,allowed:[],selected:true,preferred:null,predecessor:null,optional:true,
  options:[{resource:'loan'+i,allowed:[32+i*4],duration:4,borrowed:true,pools:[{day:1,id:'neighbor:day',capacity:1}]}]}));
 const r=await solveSchedule({tasks,purpose:'INITIAL',freezeBefore:0,daily:false,staffCapacity:2,transportCapacity:2});
 expect(r.status).toBe('FEASIBLE');if(r.status==='FEASIBLE')expect(r.assignments).toHaveLength(1);
});
