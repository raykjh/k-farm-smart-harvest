import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {seedMission} from './labor-recovery-fixture';
import {emptyLaborOps,type LaborOps} from '../lib/labor-operations';
import {refreshCenterAttendance} from '../lib/labor-attendance-store';
import {POST,GET} from '../app/api/labor-operations/route';
it('runs T-7 allocation and T-2 replacement once, persists operator review, and preserves completed work',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2032-08-24T09:00:00+09:00'));
 const fixture=await laborCapacityFixture(),session=await testSession(),key={workspace:'sandbox',kind:'laborOperations',id:'current'};
 try{
  const workers=[1,2,3].map(i=>({...fixture.worker,id:`00000000-0000-4000-8000-00000000000${i}`,name:'홍가상'+i}));
  await db.workRecord.update({where:{workspace_kind_id:key},data:{payload:JSON.parse(JSON.stringify({...emptyLaborOps(),people:workers}))}});
  const {m,closed}=await seedMission('demo');
  const get=async()=>{const r=await GET(new NextRequest('http://127.0.0.1:3100/api/labor-operations',{headers:session.headers}));expect(r.status).toBe(200);return r.json()};
  let view=await get();
  const post=async(body:object,expected=200)=>{const r=await POST(new NextRequest('http://127.0.0.1:3100/api/labor-operations',{method:'POST',headers:session.headers,body:JSON.stringify({...body,requestId:randomUUID(),version:view.version})}));const data=await r.json();expect(r.status,JSON.stringify(data)).toBe(expected);view=await get();return data};
  await post({action:'open',demandId:m.id,pay:'격리검증 조건',simpleWorkConfirmed:true,attendancePolicy:'SEVEN_TWO'});
  let j=view.payload.jobs[0];expect(j.invited).toEqual([]);
  expect(await refreshCenterAttendance('demo','2032-08-25T00:00:00+09:00')).toBe(true);
  view=await get();j=view.payload.jobs[0];expect(j.attendance.proposed).toEqual([workers[0].id]);expect(j.assigned).toEqual([]);
  const afterFirst=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}});
  expect(await refreshCenterAttendance('demo','2032-08-25T00:01:00+09:00')).toBe(false);
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}})).version).toBe(afterFirst.version);
  vi.setSystemTime(new Date('2032-08-26T09:00:00+09:00'));
  await post({action:'response',jobId:j.id,workerId:workers[1].id,response:'PHONE'});expect(view.payload.jobs[0].assigned).toEqual([]);
  expect(await refreshCenterAttendance('demo','2032-08-30T00:00:00+09:00')).toBe(true);
  view=await get();j=view.payload.jobs[0];expect(j.assigned).toEqual([workers[1].id]);expect(j.attendance.expired).toEqual([workers[0].id]);
  vi.setSystemTime(new Date('2032-08-30T09:00:00+09:00'));await post({action:'reviewAttendance',jobId:j.id});
  expect(view.payload.jobs[0].attendance.reviewedAt).toBeTruthy();
  await post({action:'response',jobId:j.id,workerId:workers[0].id,response:'PHONE'},409);
  expect((view.payload as LaborOps).penalties).toEqual([]);
  const state=(await db.center.findUniqueOrThrow({where:{id:'demo'}})).state as any;expect(state.missions.find((t:any)=>t.id===closed.id)).toEqual(closed);
  expect((await db.outbox.findMany({where:{centerId:'demo'}})).some(n=>n.status==='SENT')).toBe(false);
 }finally{await session.cleanup();await fixture.cleanup();vi.useRealTimers()}
});
