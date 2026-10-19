import {describe,it,expect} from 'vitest';
import {planContinuousProduction,cropPeriod,serviceTerm,type Participation,type ProductionCriteria} from '../lib/continuous-production';
import {registeredDemo} from './registered-demo-fixture';
import {emptyConditions} from '../lib/field-conditions';
import {appendAssignments} from '../lib/delegated-planning';
import {permitted,canConfirmProduction} from '../lib/auth-policy';
import type {FieldEntry} from '../lib/field-record';

// Deliberately synthetic windows: exercise engine contracts, not agronomic advice.
export const field=(n:number):FieldEntry=>({pnu:'527403602311093000'+n,address:'검증 농지 '+n,area:1000,crop:'',mode:'full',group:'',rights:'pending',consultationId:'10000000-0000-4000-8000-00000000000'+n,conditions:{...emptyConditions(),region:'계북면',landUse:'paddy',water:'yes',machineAccess:'yes',laborAvailable:'yes',climate:{rice:'suitable',potato:'unsuitable',pepper:'unsuitable'},evidence:'격리된 검증',checkedOn:'2026-09-01'}});
export const state=()=>({...registeredDemo().state,fields:[],missions:[]});
export const criteria=(start='2027-01-02',end='2027-02-28'):ProductionCriteria=>({profiles:[{id:start,name:'테스트 전용 작업기간',context:{region:'계북면',operations:{rice:Object.fromEntries(['seed','nursery','soil','plant','harvest','finish'].map(code=>[code,{from:start,to:end,laborMinutesPer1000m2:30}]))}}}]});
export const participant=(n:number,receivedAt='2026-09-28T01:00:00.000Z'):Participation=>({pnu:field(n).pnu,consultationId:field(n).consultationId!,receivedAt,status:'ACTIVE',term:{from:'2026-09-28',until:null,continuousConsent:true},changedAt:receivedAt,reason:'검증 동의'});
export const input=()=>({fields:[field(1)],participations:[participant(1)],cycles:[],state:state(),criteria:criteria(),version:1,today:'2026-09-28',names:{},consentedPnus:[field(1).pnu]});

describe('incremental continuous production',()=>{
 it('plans on intake using common tasks, preserves inputs and creates stable cultivation identity',async ()=>{
  const i=input(),before=structuredClone(i),first=(await planContinuousProduction(i)),again=(await planContinuousProduction(i));
  expect(first.items[0].status).toBe('REVIEW');expect(first.items[0].proposal!.dispatch.assignments).toHaveLength(6);
  expect(first.items[0].proposal!.cultivation.id).toBe(again.items[0].proposal!.cultivation.id);expect(i).toEqual(before);
  expect(first.inferenceCalled).toBe(false);
 });
 it('accumulates in receipt order, not PNU order, with no shared equipment, staff or field overlap',async ()=>{
  const i=input();i.fields=[field(1),field(2)];i.participations=[participant(1,'2026-09-28T02:00:00.000Z'),participant(2)];i.consentedPnus=i.fields.map(f=>f.pnu);
  const p=(await planContinuousProduction(i));expect(p.items.map(x=>x.pnu)).toEqual([field(2).pnu,field(1).pnu]);expect(p.items.every(x=>x.status==='REVIEW')).toBe(true);
  const all=p.items.flatMap(x=>x.proposal!.dispatch.assignments);
  for(const a of all)for(const b of all)if(a.taskId!==b.taskId&&a.date===b.date&&a.machineId&&a.machineId===b.machineId)expect(a.startMinute+a.durationMinutes<=b.startMinute||b.startMinute+b.durationMinutes<=a.startMinute).toBe(true);
 });
 it('retains one cultivation across December and January without yearly reset',async ()=>{
  const i=input();i.criteria=criteria('2026-11-01','2027-03-01');const c=(await planContinuousProduction(i)).items[0].proposal!.cultivation;
  expect(c.start).toBe('2026-11-01');expect(c.end).toBe('2027-03-01');
 });
 it('links the next cultivation to previous completion, and does not duplicate an already linked future cycle',async ()=>{
  const i=input(),p=(await planContinuousProduction(i)).items[0].proposal!;
  const s=appendAssignments(i.state,p.plan,p.dispatch);s.missions.forEach(m=>m.status='COMPLETED');
  const future=(await planContinuousProduction({...i,state:s,cycles:[p.cultivation]}));expect(future.items[0].status).toBe('SCHEDULED');expect(future.items[0].proposal).toBeNull();
  const next=(await planContinuousProduction({...i,today:'2027-03-01',state:s,cycles:[p.cultivation],criteria:criteria('2027-04-01','2027-07-01')})).items[0].proposal!;
  expect(next.cultivation.previousId).toBe(p.cultivation.id);expect(next.cultivation.id).not.toBe(p.cultivation.id);
  expect(next.plan.plots[0].tasks[0].predecessorKeys).toContain(`cultivation:${p.cultivation.id}:finish`);
  expect(s.missions).toHaveLength(6);expect(s.missions.every(m=>m.status==='COMPLETED')).toBe(true);
 });
 it('prepares next cycle during current cultivation without changing current field crop',async ()=>{
  const i=input(),p=(await planContinuousProduction(i)).items[0].proposal!,s=appendAssignments(i.state,p.plan,p.dispatch);
  const view=(await planContinuousProduction({...i,today:'2027-01-02',state:s,cycles:[p.cultivation],criteria:criteria('2027-04-01','2027-07-01')}));
  expect(view.items[0].current?.id).toBe(p.cultivation.id);expect(view.items[0].proposal?.cultivation.previousId).toBe(p.cultivation.id);
 });
 it('does not declare an overdue cultivation completed or ignore cancelled work',async ()=>{
  const i=input(),p=(await planContinuousProduction(i)).items[0].proposal!,s=appendAssignments(i.state,p.plan,p.dispatch);
  const result=(await planContinuousProduction({...i,today:'2027-03-01',cycles:[p.cultivation],state:s,criteria:criteria('2027-04-01','2027-07-01')}));expect(result.items[0].status).toBe('BLOCKED');expect(result.items[0].proposal).toBeNull();
  s.missions[0].status='CANCELLED';expect((await planContinuousProduction({...i,today:'2027-01-02',cycles:[p.cultivation],state:s,criteria:criteria('2027-04-01','2027-07-01')})).items[0].proposal).toBeNull();
 });
 it('leaves legacy fields without continuous consent pending and excludes joint participation',async ()=>{
  const i=input();expect((await planContinuousProduction({...i,participations:[]})).items[0].status).toBe('CONSENT_REQUIRED');expect((await planContinuousProduction({...i,consentedPnus:[]})).items[0].proposal).toBeNull();expect((await planContinuousProduction({...i,fields:[{...field(1),mode:'joint'}]})).items).toHaveLength(0);
 });
 it.each(['PAUSED','ENDED'] as const)('%s prevents new plans without removing cultivation history',async status=>{
  const i=input(),p=(await planContinuousProduction(i)).items[0].proposal!;i.participations[0].status=status;
  const r=(await planContinuousProduction({...i,cycles:[p.cultivation]}));expect(r.items[0].status).toBe(status);expect(r.items[0].history).toHaveLength(1);expect(r.items[0].proposal).toBeNull();
 });
 it('honors participation start, expiry and last harvest within term',async ()=>{
  const i=input();i.participations[0].term.from='2026-10-01';expect((await planContinuousProduction(i)).items[0].status).toBe('WAITING_START');
  i.participations[0].term={from:'2026-01-01',until:'2026-09-27',continuousConsent:true};expect((await planContinuousProduction(i)).items[0].status).toBe('EXPIRED');
  i.participations[0].term.until='2027-02-01';expect((await planContinuousProduction(i)).items[0].proposal).toBeNull();
 });
 it('rejects fabricated renewal dates, missing mandatory criteria and impossible resource demand',async ()=>{
  const i=input();expect((await planContinuousProduction({...i,criteria:criteria('2026-01-01','2026-06-30')})).items[0].status).toBe('BLOCKED');
  delete i.criteria.profiles[0].context.operations!.rice!.harvest;expect((await planContinuousProduction(i)).items[0].proposal).toBeNull();
  i.criteria=criteria();i.state.machines=[];expect((await planContinuousProduction(i)).items[0].proposal).toBeNull();
 });
 it('never extends a deadline or accepts invalid participation dates',()=>{
  expect(()=>serviceTerm.parse({from:'2026-02-30',until:null,continuousConsent:true})).toThrow();
  expect(()=>serviceTerm.parse({from:'2026-09-28',until:'2026-09-27',continuousConsent:true})).toThrow();
  expect(()=>serviceTerm.parse({from:'2026-09-28',until:null,continuousConsent:false})).toThrow();
  const p=cropPeriod('rice',criteria().profiles[0].context,'2027-01-05',null);expect(p.start).toBe('2027-01-05');expect(p.end).toBe('2027-02-28');expect(p.context.operations!.rice!.plant.to).toBe('2027-02-28');
 });
 it('lets staff confirm only validated AI drafts without extending consent or other-center permissions',()=>{
  const p={id:'test',username:'test',name:'test',role:'CENTER_STAFF' as const,centerId:'demo',enabled:true};
  expect(permitted(p,'continuous-production','POST',{action:'refresh'})).toBe(true);expect(permitted(p,'continuous-production','POST',{action:'approve'})).toBe(true);expect(permitted({...p,role:'CENTER_ADMIN'},'continuous-production','POST',{action:'approve'})).toBe(true);expect(permitted({...p,centerId:'other'},'continuous-production','GET',null)).toBe(false);
  for(const action of ['criteria','participation','ai-review','rule-review'])expect(permitted(p,'continuous-production','POST',{action})).toBe(false);
  const ai={inferenceCalled:true,integratedPlan:{source:'NEBIUS'}};
  expect(canConfirmProduction(p,ai)).toBe(true);
  for(const view of [null,{}, {...ai,inferenceCalled:false},{...ai,integratedPlan:{source:'RULES'}},{...ai,aiReviewError:{message:'failed'}}])expect(canConfirmProduction(p,view)).toBe(false);
  expect(canConfirmProduction({...p,centerId:'other'},ai)).toBe(false);
  expect(canConfirmProduction({...p,role:'SUPER_ADMIN'},ai)).toBe(false);
  expect(canConfirmProduction({...p,enabled:false},ai)).toBe(false);
 });
});
