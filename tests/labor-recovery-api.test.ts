import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {POST as capacity,GET as capacityGet} from '../app/api/labor-capacity/route';
import {POST as labor,GET as laborGet} from '../app/api/labor-operations/route';
import {POST as share,GET as shareGet} from '../app/api/labor-sharing/route';
import {GET as recoveryGet} from '../app/api/labor-recovery/route';
import {POST as replan} from '../app/api/replanning/route';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {recordSpace} from '../lib/workspace';
import {dateSlot} from '../lib/scheduling-engine';
import {emptyLaborOps,type LaborOps} from '../lib/labor-operations';
import {syncChangedPlanReservations} from '../lib/plan-reservation-sync';
import {resourceView} from '../lib/center-resources';
import type {State,Mission} from '../lib/types';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const day='2032-09-01';
type Session=Awaited<ReturnType<typeof testSession>>;
const req=(path:string,s:Session,body?:unknown)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{method:body?'POST':'GET',headers:s.headers,...(body?{body:JSON.stringify(body)}:{})});
async function send(fn:(r:NextRequest)=>Promise<Response>,path:string,s:Session,body?:object,status=200){const r=await fn(req(path,s,body)),d=await r.json();expect(r.status,JSON.stringify(d)).toBe(status);return d}
const command=(action:string,id:string,version:number)=>({action,id,version,requestId:randomUUID(),reason:'불가피한 지원 불참 확인'});
import {seedMission} from './labor-recovery-fixture';
it('withdraws booked support atomically, blocks stale approval, keeps the date with another confirmed worker, then reconfirms attendance',async()=>{
 const fixture=await laborCapacityFixture(),owner=await testSession(),receiver=await testSession('CENTER_ADMIN','janggye'),foreign=await testSession('CENTER_ADMIN','gyenam');
 try{
  const ownerState=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;ownerState.staffCount=2;ownerState.crewCapacity!.workers=2;
  await db.center.update({where:{id:'demo'},data:{state:json(ownerState)}});
  const second={...fixture.worker,id:randomUUID(),name:'홍대체'};
  await db.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'laborOperations',id:'current'}},data:{payload:json({...emptyLaborOps(),people:[fixture.worker,second]})}});
  const ids=[randomUUID(),randomUUID()];for(let i=0;i<2;i++){await send(capacity,'labor-capacity',owner,{action:'offer',requestId:ids[i],rosterVersion:1,window:{...fixture.window,workerId:i?second.id:fixture.worker.id}});await send(capacity,'labor-capacity',receiver,command('confirm',ids[i],1));}
  const {m,closed}=await seedMission('janggye',[ids[0]]),ops=await send(laborGet,'labor-operations',receiver);
  await send(labor,'labor-operations',receiver,{action:'open',version:ops.version,requestId:randomUUID(),demandId:m.id,pay:'조건 확인',simpleWorkConfirmed:true});
  const roster=await send(laborGet,'labor-operations',receiver),j=roster.payload.jobs[0],attendanceId=randomUUID();
  const offer={action:'offer',requestId:attendanceId,version:1,borrowerCenterId:'janggye',jobId:j.id,sourceHash:j.sourceHash,workerId:fixture.worker.id,response:'PHONE',travelMinutes:30,distanceKm:5,consent:true};
  await send(share,'labor-sharing',owner,offer);
  const stale=await send(replan,'replanning',receiver,{action:'preview',ids:[m.id],preferred:day,scope:'PRESERVE',decisionSource:'DEVELOPMENT_REVIEW'});
  const withdrawal=command('withdraw',ids[0],2);await send(capacity,'labor-capacity',foreign,withdrawal,409);await send(capacity,'labor-capacity',owner,withdrawal);expect((await send(capacity,'labor-capacity',owner,withdrawal)).alreadyApplied).toBe(true);
  await send(replan,'replanning',receiver,{action:'approve',proposalId:stale.proposalId},409);
  const withdrawn=await send(capacityGet,'labor-capacity',receiver);expect(withdrawn.windows.find((w:any)=>w.id===ids[0]).status).toBe('WITHDRAWN');
  expect((await send(recoveryGet,'labor-recovery',receiver)).issues[0].status).toBe('OPEN');
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'laborShare',id:attendanceId}}})).payload).toMatchObject({status:'CANCELLED'});
  const preview=await send(replan,'replanning',receiver,{action:'preview',ids:[m.id],preferred:day,scope:'PRESERVE',reason:'확정된 다른 지원 인력으로 교체',decisionSource:'DEVELOPMENT_REVIEW'});
  expect(preview.status).toBe('FEASIBLE');expect(preview.diff).toHaveLength(1);expect(preview.assignments[0].laborSupportIds).toEqual([ids[1]]);
  await send(replan,'replanning',receiver,{action:'approve',proposalId:preview.proposalId});
  const saved=(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).state as unknown as State;expect(saved.missions.find(t=>t.id===closed.id)).toEqual(closed);expect(saved.missions.find(t=>t.id===m.id)).toMatchObject({scheduledDate:day,laborSupportIds:[ids[1]]});expect(saved.missions.find(t=>t.id===m.id)?.laborRecoveryRequired).toBeUndefined();
  expect((await send(recoveryGet,'labor-recovery',receiver)).issues[0]).toMatchObject({status:'RESOLVED',resolution:'REPLANNED'});
  expect((await send(laborGet,'labor-operations',receiver)).payload.jobs[0].borrowedNames).toEqual([]);
  await send(share,'labor-sharing',owner,{...offer,requestId:randomUUID(),workerId:second.id});
  expect((await send(laborGet,'labor-operations',receiver)).payload.jobs[0].borrowedNames).toEqual(['홍대체']);
  for(const s of [owner,receiver])expect((await send(capacityGet,'labor-capacity',s)).notices.some((n:any)=>n.event==='WITHDRAWN')).toBe(true);
 }finally{await owner.cleanup();await receiver.cleanup();await foreign.cleanup();await fixture.cleanup()}
});

it('records no-show, uses an on-duty center reserve first and does not consume it twice or add penalty',async()=>{
 const fixture=await laborCapacityFixture(),owner=await testSession();
 try{
  const reserve={...fixture.worker,id:randomUUID(),name:'홍예비',employment:'CENTER_RESERVE',standbyDates:[day]},waiting={...fixture.worker,id:randomUUID(),name:'홍대기'};
  await db.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'laborOperations',id:'current'}},data:{payload:json({...emptyLaborOps(),people:[fixture.worker,waiting,reserve]})}});
  expect((await send(capacityGet,'labor-capacity',owner)).workers.map((p:any)=>p.id)).not.toContain(reserve.id);
  expect((await send(shareGet,'labor-sharing',owner)).workers.map((p:any)=>p.id)).not.toContain(reserve.id);
  const {m}=await seedMission('demo');
  let d=await send(laborGet,'labor-operations',owner);
  const apply=async(body:object)=>{const r=await send(labor,'labor-operations',owner,{...body,version:d.version,requestId:randomUUID()});d=await send(laborGet,'labor-operations',owner);return r};
  await apply({action:'open',demandId:m.id,pay:'조건 확인',simpleWorkConfirmed:true});const j=d.payload.jobs[0];expect(j.invited).not.toContain(reserve.id);
  await apply({action:'response',jobId:j.id,workerId:fixture.worker.id,response:'PHONE'});
  await apply({action:'absence',jobId:j.id,workerId:fixture.worker.id,reason:'당일 무통보 불참 확인'});
  expect(d.payload.jobs[0].assigned).toEqual([reserve.id]);expect(d.payload.jobs[0].responses[reserve.id]).toBe('STANDBY');expect(d.payload.penalties).toEqual([]);
  expect((await send(recoveryGet,'labor-recovery',owner)).issues[0]).toMatchObject({status:'RESOLVED',resolution:'REPLACED'});
  await apply({action:'absence',jobId:j.id,workerId:reserve.id,reason:'예비 인력도 투입 불가 확인'});
  const issues=(await send(recoveryGet,'labor-recovery',owner)).issues;expect(issues.filter((i:any)=>i.status==='OPEN')).toHaveLength(1);
  const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;expect(state.missions.find(t=>t.id===m.id)?.laborRecoveryRequired).toBe(true);
  const view=await resourceView(db,state,'demo');expect(view.laborCapacity?.absences).toHaveLength(1);
  const preview=await send(replan,'replanning',owner,{action:'preview',ids:[m.id],preferred:'2032-09-02',scope:'PRESERVE',decisionSource:'DEVELOPMENT_REVIEW'});expect(preview.status).toBe('FEASIBLE');
  await send(replan,'replanning',owner,{action:'approve',proposalId:preview.proposalId});
  d=await send(laborGet,'labor-operations',owner);expect(d.payload.jobs.find((x:any)=>x.status==='OPEN').responses).toEqual({});expect(d.payload.penalties).toEqual([]);
 }finally{await owner.cleanup();await fixture.cleanup()}
});

it('keeps a withdrawn job attendance unavailable until replacement or an approved reschedule',async()=>{
 const fixture=await laborCapacityFixture(),owner=await testSession(),receiver=await testSession('CENTER_ADMIN','janggye');
 try{
  const windowId=randomUUID();
  await send(capacity,'labor-capacity',owner,{action:'offer',requestId:windowId,rosterVersion:1,window:fixture.window});
  await send(capacity,'labor-capacity',receiver,command('confirm',windowId,1));
  const {m,closed}=await seedMission('janggye',[windowId]),initial=await send(laborGet,'labor-operations',receiver);
  await send(labor,'labor-operations',receiver,{action:'open',version:initial.version,requestId:randomUUID(),demandId:m.id,pay:'조건 확인',simpleWorkConfirmed:true});
  const job=(await send(laborGet,'labor-operations',receiver)).payload.jobs[0],offerId=randomUUID();
  await send(share,'labor-sharing',owner,{action:'offer',requestId:offerId,version:1,borrowerCenterId:'janggye',jobId:job.id,sourceHash:job.sourceHash,workerId:fixture.worker.id,response:'PHONE',travelMinutes:30,distanceKm:5,consent:true});
  const offer=(await send(shareGet,'labor-sharing',owner)).offers.find((s:any)=>s.id===offerId);
  expect(offer.status).toBe('ASSIGNED');
  const cancellation=command('cancel',offerId,offer.version);
  await send(share,'labor-sharing',owner,cancellation);
  expect((await send(share,'labor-sharing',owner,cancellation)).alreadyApplied).toBe(true);
  const issue=(await send(recoveryGet,'labor-recovery',receiver)).issues[0];
  expect(issue).toMatchObject({kind:'SHARE_WITHDRAWAL',status:'OPEN'});
  expect(issue.tasks[0].shortage).toBe(1);
  const state=(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).state as unknown as State;
  expect(state.missions.find(t=>t.id===closed.id)).toEqual(closed);
  expect(state.missions.find(t=>t.id===m.id)?.laborRecoveryRequired).toBe(true);
  const view=await resourceView(db,state,'janggye');
  expect(view.laborCapacity?.incoming[0].excludedIntervals).toContainEqual({startMinute:job.startMinute,endMinute:job.startMinute+job.durationMinutes});
  // The support window itself remains reserved; cancelling one attendance is not
  // permission to free the owner's whole-day capacity or alter the active plan.
  expect((await send(capacityGet,'labor-capacity',owner)).windows[0].status).toBe('CONFIRMED');
  expect((await send(laborGet,'labor-operations',receiver)).payload.jobs[0].borrowedNames).toEqual([]);
  for(const session of [owner,receiver])expect((await send(shareGet,'labor-sharing',session)).notices.some((n:any)=>n.status==='CANCELLED')).toBe(true);
 }finally{await owner.cleanup();await receiver.cleanup();await fixture.cleanup()}
});

it('also opens recovery when borrowed-worker absence is recorded after the planned work ends',async()=>{
 const fixture=await laborCapacityFixture(),owner=await testSession(),receiver=await testSession('CENTER_ADMIN','janggye');
 let later:Session|undefined,clock:ReturnType<typeof vi.spyOn>|undefined;
 try{
  const windowId=randomUUID();
  await send(capacity,'labor-capacity',owner,{action:'offer',requestId:windowId,rosterVersion:1,window:fixture.window});
  await send(capacity,'labor-capacity',receiver,command('confirm',windowId,1));
  const {m,closed}=await seedMission('janggye',[windowId]),initial=await send(laborGet,'labor-operations',receiver);
  await send(labor,'labor-operations',receiver,{action:'open',version:initial.version,requestId:randomUUID(),demandId:m.id,pay:'조건 확인',simpleWorkConfirmed:true});
  const job=(await send(laborGet,'labor-operations',receiver)).payload.jobs[0],offerId=randomUUID();
  await send(share,'labor-sharing',owner,{action:'offer',requestId:offerId,version:1,borrowerCenterId:'janggye',jobId:job.id,sourceHash:job.sourceHash,workerId:fixture.worker.id,response:'PHONE',travelMinutes:30,distanceKm:5,consent:true});
  const offer=(await send(shareGet,'labor-sharing',receiver)).offers.find((s:any)=>s.id===offerId);
  clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse(day+'T16:30:00+09:00'));
  later=await testSession('CENTER_ADMIN','janggye');
  await send(share,'labor-sharing',later,{action:'complete',requestId:randomUUID(),id:offerId,version:offer.version,worked:false});
  expect((await send(recoveryGet,'labor-recovery',later)).issues[0]).toMatchObject({kind:'SHARE_WITHDRAWAL',status:'OPEN',reason:'근무 종료 후 확인된 불참'});
  const state=(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).state as unknown as State;
  expect(state.missions.find(t=>t.id===closed.id)).toEqual(closed);
  expect(state.missions.find(t=>t.id===m.id)?.laborRecoveryRequired).toBe(true);
 }finally{clock?.mockRestore();await later?.cleanup();await owner.cleanup();await receiver.cleanup();await fixture.cleanup()}
});
