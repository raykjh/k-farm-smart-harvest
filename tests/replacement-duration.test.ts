import {it,expect} from 'vitest';
import {calculateAnnualReplan,makeContract,prepareAnnualReplan,verifyAssignments} from '../lib/annual-replanning';
import {equipmentWork,resourceDuration} from '../lib/replan-resource-options';
import {missionPacket} from '../lib/equipment-mission';
import {replacementDurationFixture,replacementDay as day} from './replacement-duration-fixture';
import {dateSlot} from '../lib/scheduling-engine';
const weather={status:'NOT_CONFIGURED',kind:'short',sourceUrl:'test',points:[]} as any;

it('uses operation area and repeats setup; does not apply the whole field to every split',async()=>{
 const {s,m}=replacementDurationFixture(),before=JSON.stringify(s);
 expect(equipmentWork(s,m)).toMatchObject({areaHa:1,setupSlots:4,basis:'PLAN_AREA_AND_SETUP'});
 const r=await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day);
 expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');expect(r.workSplit).toHaveLength(1);expect(r.workSplit[0].partIds).toHaveLength(2);
 expect(r.diff.map(d=>d.afterDuration)).toEqual([24,24]);expect(new Set(r.diff.map(d=>d.date)).size).toBe(2);
 const prepared=prepareAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day,true);
 expect(prepared.state.missions.filter(t=>r.workSplit[0].partIds.includes(t.id)).map(t=>(t as any).workAreaM2)).toEqual([5000,5000]);
 verifyAssignments(prepared.contract,r.assignments,r.phase!);expect(JSON.stringify(s)).toBe(before);
 expect(missionPacket(prepared.state,'demo',m.id,null,[],day).blockers).toContain('SPLIT_WORK_AREA_REVIEW_REQUIRED');
});
it('recalculates a slower same-day option and keeps workload unchanged on later replacement',async()=>{
 const {s,m}=replacementDurationFixture();m.workAreaM2=2000;m.setupMinutes=30;m.duration=6;m.planningWindow!.duration=6;
 const result=await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day);
 expect(result.status).toBe('FEASIBLE');expect(result.workSplit).toEqual([]);expect(result.diff[0].afterDuration).toBe(10);
 const work=equipmentWork(s,m)!;const later={...m,equipmentWork:work,resourceId:'JSJGTR01',duration:10};
 expect(resourceDuration(s,later,{machine:{...s.machines[0],status:'AVAILABLE'},borrowed:false})).toBe(6);
});
it('preserves downstream order after all parts and protects closed or locked successors',async()=>{
 const {s,m}=replacementDurationFixture();s.missions.push({...m,id:'after',label:'후속 작업',scheduledDate:'2032-09-03',owner:'센터 인력',resourceId:null,staff:1,machineOperators:0,ordinaryWorkers:1,operatorIds:[],duration:1,predecessorMissionIds:[m.id],planningWindow:{...m.planningWindow!,duration:1}} as any);
 const r=await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day);expect(r.status,JSON.stringify(r)).toBe('FEASIBLE');
 const p=prepareAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day,true),tail=r.workSplit[0].partIds.at(-1)!;
 expect((p.state.missions.find(t=>t.id==='after') as any).predecessorMissionIds).toEqual([tail]);
 expect(r.diff.find(d=>d.id==='after')?.dependencyChanged).toBe(true);
 expect(r.assignments.find(a=>a.id==='after')!.start).toBeGreaterThanOrEqual(r.assignments.find(a=>a.id===tail)!.start+24);
 (s.missions.find(t=>t.id==='after') as any).planningLocked=true;
 expect(()=>prepareAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day,true)).toThrow('후속 작업');
});
it('cannot fit multiple days inside a one-day window or use a blocked lender day',async()=>{
 const {s,m}=replacementDurationFixture();m.planningWindow!.to=day;
 const r=await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day);expect(r.status).toBe('NO_FEASIBLE_PLAN');expect(r.assignments).toEqual([]);
 m.planningWindow!.to='2032-09-02';s.centerSharing!.blocks=[{machineId:'JSJGTR01',date:'2032-09-02'}];
 expect((await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day)).status).toBe('NO_FEASIBLE_PLAN');
});
it('rejects tampered part duration and never expands a started mission',async()=>{
 const {s,m}=replacementDurationFixture(),r=await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day);
 expect(r.status).toBe('FEASIBLE');const p=prepareAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day,true);
 expect(()=>verifyAssignments(p.contract,r.assignments.map(a=>({...a,duration:1})),r.phase!)).toThrow();
 (m as any).executionStartedAt=day+'T08:00:00+09:00';expect(()=>makeContract(s,{ids:[m.id]},weather,day)).toThrow('시작 전');
});
it('counts named operators and transport on every day of a split',async()=>{
 const {s,m}=replacementDurationFixture();s.operatorRoster![0].excludedDates=['2032-09-02','2032-09-03'];
 expect((await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day)).status).toBe('NO_FEASIBLE_PLAN');
 s.operatorRoster![0].excludedDates=[];s.transportCount=0;
 expect((await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day)).status).toBe('NO_FEASIBLE_PLAN');
 expect(dateSlot(day)%32).toBe(0);
});
it('does not over-split for a slow alternative or resplit existing parts that still fit a day',async()=>{
 const {s,m}=replacementDurationFixture();
 s.machines.push({...s.machines[1],id:'JSJGTR02',capacityHaHour:0.001});
 s.centerSharing!.offers!.push({...s.centerSharing!.offers![0],id:'slow-alternative',machineId:'JSJGTR02'});
 const result=await calculateAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day);
 expect(result.status,JSON.stringify(result)).toBe('FEASIBLE');expect(result.workSplit[0].partIds).toHaveLength(2);
 expect(result.diff.every(d=>d.afterResource==='JSJGTR01')).toBe(true);
 const prepared=prepareAnnualReplan(s,{ids:[m.id],scope:'PRESERVE'},weather,day,true);
 const child=prepared.splits[0].partIds[1];
 expect(prepareAnnualReplan(prepared.state,{ids:[child],scope:'PRESERVE'},weather,day,true).splits).toEqual([]);
});
