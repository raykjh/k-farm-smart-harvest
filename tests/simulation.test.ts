import {it,expect} from 'vitest';
import {simulationImpact} from '../lib/simulation';
import {registeredDemo} from './registered-demo-fixture';
import {makeContract} from '../lib/annual-replanning';
import {emptyCenter} from '../lib/center-registry';
import type {Mission} from '../lib/types';
it('strong wind targets drones while drought never cancels all work',()=>{
 const s=registeredDemo().state,drone=s.missions.find(m=>m.resourceId==='JB23DR01')!,ground=s.missions.find(m=>m.resourceId==='JB23TR01')!;
 const e={kind:'WIND' as const,from:'2026-09-11',to:'2026-09-11'};
 expect(simulationImpact(drone,e,e.from)).toBe(true);expect(simulationImpact(ground,e,e.from)).toBe(false);
 expect(simulationImpact(ground,{...e,kind:'RAIN'},e.from)).toBe(true);expect(simulationImpact(drone,{...e,kind:'DROUGHT'},e.from)).toBe(false);
 expect(simulationImpact(drone,e,'2026-09-12')).toBe(false);
 // Older stored tasks without an explicit window keep their legacy behavior.
 expect(simulationImpact({...drone,planningWindow:undefined},e,e.from)).toBe(true);
 expect(simulationImpact({...ground,planningWindow:undefined},e,e.from)).toBe(false);
});
it('new center registrations use explicit operation limits and the same solver contract',()=>{
 const s=emptyCenter('janggye');s.staffCount=4;s.transportCount=2;
 const base={fieldId:'pnu',crop:'쌀',scheduledDate:'2027-06-10',month:6,owner:'장비',status:'PLANNED',start:0,duration:4,deadline:32,priority:5,staff:1,transport:1,predecessorMissionIds:[]} as const;
 const task=(id:string,limit:number)=>({...base,id,label:'작업',batchKey:id,resourceId:id,planningWindow:{from:'2027-06-10',to:'2027-06-13',duration:4,windLimitMs:limit,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}}) as Mission;
 s.missions=[task('DR',5),task('TR',12)];s.machines=s.missions.map(m=>({id:m.id,ownerCenterId:'janggye',type:'검증',name:m.id,status:'AVAILABLE',safetyLock:false,capacityHaHour:1}));
 const event={kind:'WIND' as const,from:'2027-06-10',to:'2027-06-10'},before=JSON.stringify(s);
 const result=makeContract(s,{ids:['DR'],simulation:event},{status:'NOT_CONFIGURED',points:[]} as any,'2026-10-02');
 expect(result.contract.tasks.find(t=>t.id==='DR')!.allowed.every(slot=>slot>=Math.floor(result.contract.tasks[0].original/32)*32+32)).toBe(true);
 const ground=result.contract.tasks.find(t=>t.id==='TR')!;expect(ground.allowed).toContain(ground.original);expect(JSON.stringify(s)).toBe(before);
 expect(simulationImpact(s.missions[1],{...event,kind:'RAIN'},event.from)).toBe(false);
 expect(()=>makeContract(s,{ids:['DR'],simulation:{...event,to:'2027-06-17'}},{status:'NOT_CONFIGURED',points:[]} as any,'2026-10-02')).toThrow('7일');
});
it('simulation excludes blocked days without mutating source',()=>{
 const s=registeredDemo().state,m=s.missions.find(m=>m.resourceId?.includes('DR'))!;m.status='PLANNED';
 const original=JSON.stringify(s);const w={status:'NOT_CONFIGURED',points:[]} as any;
 const r=makeContract(s,{ids:[m.id],preferred:m.scheduledDate,simulation:{kind:'WIND',from:m.scheduledDate!,to:m.scheduledDate!}},w,'2026-08-04');
 expect(r.contract.tasks.find(t=>t.id===m.id)!.allowed.every(slot=>Math.floor(slot/32)!==Math.floor(r.contract.tasks.find(t=>t.id===m.id)!.original/32))).toBe(true);expect(JSON.stringify(s)).toBe(original);
});
