import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {seedReplacementDuration} from './replacement-duration-db-fixture';
import {replacementDay as day} from './replacement-duration-fixture';
import {recordSpace} from '../lib/workspace';
import type {State} from '../lib/types';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {POST as resources,GET as resourcesGet} from '../app/api/center-resources/route';
import {POST as replan} from '../app/api/replanning/route';
import {POST as labor,GET as laborGet} from '../app/api/labor-operations/route';
type Session=Awaited<ReturnType<typeof testSession>>;
async function call(handler:(r:NextRequest)=>Promise<Response>,path:string,s:Session,body?:object,expected=200){
 const r=await handler(new NextRequest('http://127.0.0.1:3100/api/'+path,{method:body?'POST':'GET',headers:s.headers,...(body?{body:JSON.stringify(body)}:{})})),data=await r.json();
 expect(r.status,JSON.stringify(data)).toBe(expected);return data;
}
it('approves duration-based split, reserves every day, preserves source/history and reconfirms each attendance without duplication',async()=>{
 const extraKinds=['equipmentFailure','resourceImpact','centerResourceNotice'];
 const extra=await db.workRecord.findMany({where:{kind:{in:extraKinds}}}),f=await laborCapacityFixture(),receiver=await testSession(),owner=await testSession('CENTER_ADMIN','janggye');
 const calls=await db.aiCall.count();
 try{
  const {m,closed,offer}=await seedReplacementDuration(f.worker),lenderBefore=await db.center.findUniqueOrThrow({where:{id:'janggye'}});
  const editLabor=async(body:object)=>call(labor,'labor-operations',receiver,{...body,version:(await call(laborGet,'labor-operations',receiver)).version,requestId:randomUUID()});
  await editLabor({action:'open',demandId:m.id,pay:'격리 검증용 근무 조건',simpleWorkConfirmed:true});
  const oldJob=(await call(laborGet,'labor-operations',receiver)).payload.jobs[0];
  await editLabor({action:'response',jobId:oldJob.id,workerId:f.worker.id,response:'PHONE'});
  await call(resources,'center-resources',receiver,{action:'failure',machineId:m.resourceId,from:day,expectedRepairOn:'2032-09-08'});
  await call(resources,'center-resources',owner,{action:'sharingOffer',offer});
  const before=await db.center.findUniqueOrThrow({where:{id:'demo'}});
  const request={action:'preview',ids:[m.id],preferred:day,scope:'PRESERVE',reason:'처리능력이 낮은 대체 장비로 기간 내 분할',decisionSource:'DEVELOPMENT_REVIEW'};
  const proposal=await call(replan,'replanning',receiver,request);
  expect(proposal.status,JSON.stringify(proposal)).toBe('FEASIBLE');expect(proposal.diff).toHaveLength(2);
  expect(proposal.diff.map((d:any)=>d.afterDuration)).toEqual([24,24]);expect(new Set(proposal.diff.map((d:any)=>d.date)).size).toBe(2);
  expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);
  await call(resources,'center-resources',owner,{action:'sharingOffer',offer:{...offer,version:1,enabled:false}});
  await call(replan,'replanning',receiver,{action:'approve',proposalId:proposal.proposalId},409);
  expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
  await call(resources,'center-resources',owner,{action:'sharingOffer',offer:{...offer,version:2}});
  const fresh=await call(replan,'replanning',receiver,request);
  const child=fresh.workSplit[0].partIds[1];
  // Force a late reservation conflict to prove child + loan writes roll back.
  await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:'conflict-child',payload:{id:'conflict-child',centerId:'demo',taskId:child,resourceId:'JSJGTR01',from:'2032-09-02T00:00:00.000Z',to:'2032-09-02T01:00:00.000Z'}}});
  const conflict=await call(replan,'replanning',receiver,{action:'approve',proposalId:fresh.proposalId},409);
  expect(conflict.error).toContain('기존 일정과 예약이 다릅니다');
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(0);
  expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(before);
  await db.workRecord.delete({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:'conflict-child'}}});
  await call(replan,'replanning',receiver,{action:'approve',proposalId:fresh.proposalId});
  expect((await call(replan,'replanning',receiver,{action:'approve',proposalId:fresh.proposalId})).alreadyApplied).toBe(true);
  const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as unknown as State;
  expect(saved.missions).toHaveLength(3);expect(saved.missions.find(t=>t.id===closed.id)).toEqual(closed);
  for(const id of [m.id,child])expect(saved.missions.find(t=>t.id===id)).toMatchObject({resourceId:'JSJGTR01',duration:24,status:'PLANNED',workAreaM2:5000,equipmentWork:{areaHa:0.5}});
  expect(await db.center.findUniqueOrThrow({where:{id:'janggye'}})).toEqual(lenderBefore);
  expect(await db.workRecord.count({where:{kind:'equipmentLoan'}})).toBe(2);
  const reservations=await db.workRecord.findMany({where:{kind:'resourceReservation'}});expect(reservations).toHaveLength(2);
  for(const r of reservations)expect(r.payload).toMatchObject({resourceId:'JSJGTR01',centerId:'demo'});
  const audit=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace('demo'),kind:'taskPlanChange',id:fresh.proposalId+':'+m.id}}});
  expect(audit.payload).toMatchObject({before:{id:m.id,resourceId:'JB23TR01',workAreaM2:10000},after:{id:m.id,workAreaM2:5000,splitChildIds:[child]}});
  const laborAfter=await call(laborGet,'labor-operations',receiver),renewed=laborAfter.payload.jobs.filter((j:any)=>j.status==='OPEN');
  expect(laborAfter.demands).toHaveLength(2);expect(renewed).toHaveLength(2);
  expect(laborAfter.payload.jobs.find((j:any)=>j.id===oldJob.id).status).toBe('STALE');
  for(const job of renewed){
   expect(job.responses).toEqual({});expect(job.assigned).toEqual([]);expect(job.invited).toContain(f.worker.id);
   expect(laborAfter.payload.notices.some((n:any)=>n.jobId===job.id&&n.type==='RECONFIRM')).toBe(true);
   await editLabor({action:'response',jobId:job.id,workerId:f.worker.id,response:'PHONE'});
  }
  expect((await call(laborGet,'labor-operations',receiver)).payload.jobs.filter((j:any)=>j.status==='OPEN').every((j:any)=>j.assigned.includes(f.worker.id))).toBe(true);
  for(const session of [receiver,owner])expect((await call(resourcesGet,'center-resources',session)).notices.filter((n:any)=>n.event==='CONFIRMED')).toHaveLength(2);
  expect(await db.outbox.count({where:{id:{startsWith:'replan:'+fresh.proposalId+':'}}})).toBe(1);expect(await db.aiCall.count()).toBe(calls);
  const dir='.data/validation/20261003-replacement-duration';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/api-result.json',JSON.stringify({checkedAt:new Date().toISOString(),database:'kfarm_test',parts:2,partDurationMinutes:360,oldTaskIdPreserved:true,preChangeAudit:true,perDayEquipmentReservations:true,perPartAttendanceReconfirmed:true,staleApprovalRejected:true,duplicateApprovalDeduplicated:true,transactionConflictRolledBack:true,lenderAndCompletedWorkPreserved:true,farmerOutboxRecords:1,paidAiCalls:0,actualSms:false,hardwareCommands:false},null,2));
 }finally{await receiver.cleanup();await owner.cleanup();await f.cleanup();await db.workRecord.deleteMany({where:{kind:{in:extraKinds}}});if(extra.length)await db.workRecord.createMany({data:extra as any});}
},60000);
