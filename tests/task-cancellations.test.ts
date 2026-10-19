import {it,expect,beforeEach,beforeAll,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {POST} from '../app/api/task-cancellations/route';
import {testSession,testPrincipal} from './auth-fixture';
import {cancelLinkedReservation} from '../lib/reservation-operations';
import {registeredDemo} from './registered-demo-fixture';
import {missionReservation} from '../lib/plan-reservation-sync';
import {jobs} from '../lib/scheduler';
import {makeContract} from '../lib/annual-replanning';
import {buildWorkReport,summarizeWorkReport} from '../lib/work-report';
import {saveExecution} from '../lib/execution-records';
import {emptyLaborOps} from '../lib/labor-operations';
let session:Awaited<ReturnType<typeof testSession>>,staff:Awaited<ReturnType<typeof testSession>>;
const fixture=()=>{const s=registeredDemo().state;s.missions=s.missions.slice(0,2).map((m,i)=>({...m,id:'cancel-test-'+i,scheduledDate:'2099-05-01',originalScheduledDate:undefined,start:i*8,status:'PLANNED' as const,resourceId:i===0?'JB23DR01':null,owner:i===0?'장비' as const:'센터 인력' as const,staff:1,duration:4,predecessorMissionIds:[]}));return s};
beforeAll(async()=>{if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB required');session=await testSession();staff=await testSession('CENTER_STAFF')});
afterAll(async()=>{await session.cleanup();await staff.cleanup()});
beforeEach(async()=>{
 await db.workRecord.deleteMany({where:{OR:[{workspace:'sandbox',kind:{in:['taskCancellation','taskExecutionAssessment','laborOperations','annualReservation','laborDemand']}},{workspace:'shared',kind:{in:['resourceReservation','cancelledReservation']}}]}});
 await db.outbox.deleteMany({where:{centerId:'demo'}});
 await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:fixture() as any},update:{state:fixture() as any}});
});
const body=(missionIds=['cancel-test-0'])=>({requestId:randomUUID(),expectedPlanVersion:1,missionIds,category:'UNNECESSARY',reason:'불필요한 방제 생략 확인',unperformedConfirmed:true});
const call=(b:any,headers=session.headers)=>POST(new NextRequest('http://127.0.0.1:3100/api/task-cancellations',{method:'POST',headers,body:JSON.stringify(b)}));
it('closes tasks atomically, releases bookings and labor, retains snapshots and deduplicates retries',async()=>{
 const s=fixture(),booking=missionReservation('demo',s.missions[0])!;
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 const labor=emptyLaborOps();labor.people=[{id:'worker',name:'홍근로',usesApp:true} as any];labor.jobs=[{id:'job',missionId:'cancel-test-1',task:'수확',address:'계북면',date:'2099-05-01',startMinute:600,durationMinutes:60,count:1,workCode:'harvest',sourceHash:'old',pay:'test',status:'OPEN',invited:['worker'],responses:{worker:'PHONE'},distances:{worker:1},assigned:['worker'],manual:null,worked:[]}];
 await db.workRecord.create({data:{workspace:'sandbox',kind:'laborOperations',id:'current',payload:labor as any}});
 const b=body(s.missions.map(m=>m.id));expect((await call(b)).status).toBe(200);
 const saved=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 expect(saved.missions.map((m:any)=>m.status)).toEqual(['CANCELLED','CANCELLED']);
 expect(saved.missions[0]).toMatchObject({id:s.missions[0].id,scheduledDate:'2099-05-01',resourceId:'JB23DR01',cancellation:{reason:b.reason}});
 expect(saved.fields).toEqual(s.fields);expect(saved.machines).toEqual(s.machines);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation',id:booking.id}})).toBe(0);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'cancelledReservation',id:booking.id}})).toBe(1);
 const ops=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'laborOperations',id:'current'}}})).payload as any;
 expect(ops.jobs[0]).toMatchObject({status:'STALE',assigned:[]});expect(ops.notices.some((n:any)=>n.type==='CANCELLED')).toBe(true);
 expect(jobs(saved)).toHaveLength(0);expect(missionReservation('demo',saved.missions[0])).toBeNull();
 const summary=summarizeWorkReport(buildWorkReport(saved,[],'2100-01-01').rows);expect(summary).toMatchObject({cancelled:2,unfinished:0,overdue:0,confirmed:0});
 expect((await call(b)).status).toBe(200);expect(await db.outbox.count({where:{centerId:'demo'}})).toBe(1);
 expect((await call({...b,reason:'changed'})).status).toBe(409);
 await expect(saveExecution({id:randomUUID(),missionId:s.missions[0].id,expectedPlanVersion:2,expectedEvidenceId:null,status:'HELD',startedAt:null,finishedAt:null,actor:'test',reason:'overwrite'})).rejects.toThrow('취소된 작업');
 expect(()=>makeContract(saved,{ids:['cancel-test-0']},{status:'NOT_CONFIGURED',points:[]} as any,'2026-09-22')).toThrow('미완료');
});
it('requires authority, version and explicit no-work confirmation',async()=>{
 expect((await call(body(),staff.headers)).status).toBe(403);
 expect((await call({...body(),expectedPlanVersion:0})).status).toBe(409);
 expect((await call({...body(),unperformedConfirmed:false})).status).toBe(409);
 expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(fixture());
});
it('keeps the last reserved date when closing a task after booking release',async()=>{
 const s=fixture();s.missions[0].originalScheduledDate='2099-04-20';
 await db.center.update({where:{id:'demo'},data:{state:s as any}});
 const r=missionReservation('demo',s.missions[0])!;
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:r.id,payload:r}});
 await db.$transaction(tx=>cancelLinkedReservation(tx,r.id,1,'재배정 검토',testPrincipal));
 const waiting=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 expect(waiting.missions[0]).toMatchObject({status:'HELD',originalScheduledDate:'2099-04-20'});expect(waiting.missions[0].scheduledDate).toBeUndefined();
 expect((await call({...body(),expectedPlanVersion:2})).status).toBe(200);
 const closed=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;
 expect(closed.missions[0]).toMatchObject({status:'CANCELLED',scheduledDate:'2099-05-01',originalScheduledDate:'2099-04-20',resourceId:null});
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation'}})).toBe(0);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'cancelledReservation',id:r.id}})).toBe(1);
 expect(await db.outbox.count({where:{centerId:'demo',status:'SUPERSEDED'}})).toBe(0);
 // Owner notices remain historical records; only worker SMS may be queued.
 expect(await db.outbox.count({where:{centerId:'demo',status:'PENDING'}})).toBe(0);
 expect(await db.outbox.count({where:{centerId:'demo',status:'RECORDED_ONLY'}})).toBe(2);
});
it('does not cancel completed, started, safety-locked or already-worked jobs',async()=>{
 for(const change of ['COMPLETED','STARTED','LOCK','LABOR']){
  const s=fixture();if(change==='COMPLETED')s.missions[0].status='COMPLETED' as any;if(change==='STARTED')Object.assign(s.missions[0],{executionStartedAt:'2026-09-22T09:00:00+09:00'});if(change==='LOCK')s.machines.find(m=>m.id==='JB23DR01')!.safetyLock=true;
  await db.center.update({where:{id:'demo'},data:{state:s as any}});
  if(change==='LABOR')await db.workRecord.create({data:{workspace:'sandbox',kind:'laborOperations',id:'current',payload:{jobs:[{missionId:'cancel-test-0',status:'COMPLETED',worked:['worker']}]}}});
  expect((await call(body())).status).toBe(409);expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(s);
 }
});
it('requires linked successors to be addressed, and rolls back mismatched reservations',async()=>{
 const s=fixture();Object.assign(s.missions[1],{predecessorMissionIds:['cancel-test-0']});await db.center.update({where:{id:'demo'},data:{state:s as any}});
 expect((await call(body())).status).toBe(409);
 const booking=missionReservation('demo',s.missions[0])!;booking.to='2099-05-01T10:00:00Z';
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 expect((await call(body(s.missions.map(m=>m.id)))).status).toBe(409);
 expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(s);expect(await db.workRecord.count({where:{kind:'taskCancellation'}})).toBe(0);
});
