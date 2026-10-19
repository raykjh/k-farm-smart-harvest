import {it,expect} from 'vitest';
import {makeContract,dateSlot,slotDate} from '../lib/annual-replanning';
import {compareReplanAlternatives} from '../lib/planning-decision';
import {applyDowntimeForPlanning,equipmentDownOn} from '../lib/equipment-downtime';
import {machineAvailableToCenter} from '../lib/center-sharing';
import {registeredDemo} from './registered-demo-fixture';
import {resourceTradeoffCase,tradeoffDay} from '../scripts/fixtures/resource-tradeoff-cases';
import type {Mission} from '../lib/types';
import type {ForecastResult} from '../lib/kma-forecast';
const weather={status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'fixture://none',fetchedAt:'2032-09-01'} as ForecastResult;
const day='2032-09-01';
const options=[{id:'gaps',label:'빈자리',scope:'PRESERVE',allowBorrowing:false},{id:'related',label:'관련 일정',scope:'EXPAND',allowBorrowing:false},{id:'adjacent',label:'인접 차용',scope:'EXPAND',allowBorrowing:true}] as const;
function fixture(){
 const s=registeredDemo().state;s.machines=[s.machines.find(m=>m.id==='JB23DR01')!];s.staffCount=1;s.transportCount=1;
 const task=(id:string,index:number,date:string,to='2032-09-03'):Mission=>({id,fieldId:s.fields[index].id,crop:'쌀',label:id,scheduledDate:date,month:9,owner:'장비',resourceId:'JB23DR01',status:'PLANNED',start:0,duration:32,deadline:32,priority:5,batchKey:id,staff:1,transport:1,...{predecessorMissionIds:[],planningWindow:{from:day,to,duration:32,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'}}});
 s.missions=[task('selected',0,day),task('other',1,'2032-09-02'),{...task('past',2,'2032-08-01'),status:'COMPLETED'}];s.missions[1].planningWindow!.from='2032-09-02';return s;
}
it('honors an explicit lower date boundary even when an earlier preferred day is supplied',()=>{
 for(const original of [day,'2032-09-02']){
  const s=fixture();s.missions=s.missions.filter(m=>m.id!=='other');s.missions[0].scheduledDate=original;
  const c=makeContract(s,{ids:['selected'],day:original,deferAfter:original,preferred:day},weather,day).contract;
  const allowed=c.tasks.find(t=>t.id==='selected')!.options!.flatMap(o=>o.allowed);
  expect(allowed.length).toBeGreaterThan(0);expect(allowed.every(slot=>slot>=dateSlot(original)+32)).toBe(true);
 }
});
it('future source work with no preferred date searches from tomorrow, not after its original date',async()=>{
 const s=fixture();s.missions=s.missions.filter(m=>m.id!=='other');s.missions[0].scheduledDate='2032-09-03';
 const input={ids:['selected'],day:'2032-09-03',deferAfter:day,scope:'PRESERVE' as const};
 const c=makeContract(s,input,weather,day).contract,task=c.tasks.find(t=>t.id==='selected')!;
 expect(task.preferred).toBe(dateSlot('2032-09-02')/32);
 expect([...new Set(task.options!.flatMap(o=>o.allowed).map(slotDate))]).toEqual(['2032-09-02']);
 const r=await compareReplanAlternatives(s,input,options,weather,day);
 expect(r.results[0].result!.diff.find(d=>d.id==='selected')?.date).toBe('2032-09-02');
});
it('does not leave a tomorrow task on its source day when automatic date change is requested',()=>{
 const s=fixture();s.missions=s.missions.filter(m=>m.id!=='other');s.missions[0].scheduledDate='2032-09-02';
 const c=makeContract(s,{ids:['selected'],day:'2032-09-02',deferAfter:day},weather,day).contract;
 expect([...new Set(c.tasks[0].options!.flatMap(o=>o.allowed).map(slotDate))]).toEqual(['2032-09-03']);
});
it('uses the preferred date first and the closest free date if that date is occupied',async()=>{
 const s=fixture();s.missions=s.missions.filter(m=>m.id!=='other');
 const input={ids:['selected'],day,deferAfter:day,preferred:'2032-09-02',scope:'PRESERVE' as const};
 let r=await compareReplanAlternatives(s,input,options,weather,day);
 expect(r.results[0].result!.diff.find(d=>d.id==='selected')?.date).toBe('2032-09-02');
 s.missions.push({...s.missions[0],id:'occupied',fieldId:s.fields[1].id,scheduledDate:'2032-09-02',...{planningLocked:true}});
 r=await compareReplanAlternatives(s,input,options,weather,day);
 expect(r.results[0].result!.diff.find(d=>d.id==='selected')?.date).toBe('2032-09-03');
 expect(r.results[0].result!.diff.some(d=>d.id==='occupied')).toBe(false);
});
it('tries local gaps first and rearranges related local work only if gaps cannot meet the work window',async()=>{
 const s=fixture(),before=JSON.stringify(s);
 let r=await compareReplanAlternatives(s,{ids:['selected'],day,deferAfter:day,searchMode:'LOCAL_FIRST'},options,weather,day);
 expect(r.results.map(r=>r.id)).toEqual(['gaps']);expect(r.results[0].metrics?.otherChangedTasks).toBe(0);
 s.missions[0].planningWindow!.to='2032-09-02';
 r=await compareReplanAlternatives(s,{ids:['selected'],day,deferAfter:day,searchMode:'LOCAL_FIRST'},options,weather,day);
 expect(r.results.map(r=>r.status),JSON.stringify(r.results)).toEqual(['NO_FEASIBLE_PLAN','FEASIBLE']);
 expect(r.results[1].result!.diff.find(d=>d.id==='selected')?.date).toBe('2032-09-02');
 expect(r.results[1].result!.diff.find(d=>d.id==='other')?.date).toBe('2032-09-03');
 expect(r.results[1].result!.diff.some(d=>d.id==='past')).toBe(false);
 s.missions[0].planningWindow!.to='2032-09-03';expect(JSON.stringify(s)).toBe(before);
});
it('uses only preauthorized adjacent equipment when local schedules cannot fit; unknown adjacency stays infeasible',async()=>{
 const c=resourceTradeoffCase('equipment');c.state.missions=c.state.missions.filter(m=>m.id!=='fixed-equipment');
 const selected=c.state.missions.find(m=>m.id==='selected')!;selected.planningWindow!.to=tradeoffDay;
 const outage={machineId:'JB23DR01',from:tradeoffDay,returnOn:'2032-09-08'},request={ids:['selected'],outage,searchMode:'LOCAL_FIRST' as const};
 const original=JSON.stringify(c.state);
 let r=await compareReplanAlternatives(c.state,request,options,c.weather,c.asOf);
 expect(r.results.map(r=>r.status),JSON.stringify(r.results)).toEqual(['NO_FEASIBLE_PLAN','NO_FEASIBLE_PLAN','FEASIBLE']);
 expect(r.results[2].result!.diff[0]).toMatchObject({date:tradeoffDay,afterResource:'JSCCDR01'});
 expect(JSON.stringify(c.state)).toBe(original);
 c.state.centerSharing!.neighborCenterIds=[];
 r=await compareReplanAlternatives(c.state,request,options,c.weather,c.asOf);expect(r.nonDominatedIds).toEqual([]);
});
it('blocks an entire multi-day repair period, preserves historical work and rejects partial, locked or lent-out selections',()=>{
 const s=fixture(),outage={machineId:'JB23DR01',from:day,returnOn:'2032-09-08'},ids=['selected','other'];
 expect(()=>applyDowntimeForPlanning(s,outage,['selected'])).toThrow('모든');
 const projected=applyDowntimeForPlanning(s,outage,ids),machine=projected.machines[0];
 expect(machineAvailableToCenter(machine,'2032-09-07')).toBe(false);expect(equipmentDownOn(machine,'2032-09-08')).toBe(false);
 expect(s.machines[0].downtimes).toBeUndefined();expect(projected.missions.at(-1)).toEqual(s.missions.at(-1));
 for(const m of s.missions.filter(m=>ids.includes(m.id)))m.planningWindow!.to='2032-09-09';
 const contract=makeContract(s,{ids,outage},weather,day).contract;
 expect(contract.tasks.filter(t=>t.selected).every(t=>t.options!.flatMap(o=>o.allowed).every(a=>slotDate(a)>='2032-09-08'))).toBe(true);
 (s.missions[0] as any).executionStartedAt=day+'T09:00:00+09:00';expect(()=>applyDowntimeForPlanning(s,outage,ids)).toThrow('시작');delete (s.missions[0] as any).executionStartedAt;
 s.centerSharing={centerId:'demo',neighborCenterIds:['janggye'],loans:[{id:'existing',machineId:outage.machineId,ownerCenterId:'demo',borrowerCenterId:'janggye',usableFrom:day,usableUntil:day,status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true}]};
 expect(()=>applyDowntimeForPlanning(s,outage,ids)).toThrow('확정 차용');
});
