import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {GET,POST} from '../app/api/equipment-missions/route';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {seedSplitWorkAreas} from './split-work-area-fixture';
type Session=Awaited<ReturnType<typeof testSession>>;
async function call(s:Session,body?:object,status=200){const r=await (body?POST:GET)(new NextRequest('http://127.0.0.1:3100/api/equipment-missions',{method:body?'POST':'GET',headers:s.headers,...(body?{body:JSON.stringify(body)}:{})}));const data=await r.json();expect(r.status,JSON.stringify(data)).toBe(status);return data;}
it('atomically saves reviewed parts, enforces center/role/CAS, prepares distinct packets and preserves corrections',async()=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),admin=await testSession(),other=await testSession('CENTER_ADMIN','janggye'),staff=await testSession('CENTER_STAFF');
 const calls=await db.aiCall.count(),centersBefore=await db.center.findMany(),reservationsBefore=await db.workRecord.findMany({where:{kind:'resourceReservation'}});
 try{
  const {version,reviewedBy,...input}=f.area;
  await call(admin,{action:'area',version:0,area:input});
  const group=(await call(admin)).groups[0],draft=await call(admin,{action:'splitDraft',groupId:f.groupId,fingerprint:group.reviewFingerprint,axis:'EW'});
  expect(draft).toMatchObject({saved:false,approved:false});expect(await db.workRecord.count({where:{kind:'splitWorkArea'}})).toBe(0);
  const save={action:'splitArea',version:0,fingerprint:group.reviewFingerprint,area:{...f.input,parts:draft.parts}};
  await call(staff,save,403);await call(other,save,409);
  await call(admin,{...save,area:{...save.area,parts:[draft.parts[0],{...draft.parts[1],geometry:draft.parts[0].geometry}]}},409);
  expect(await db.workRecord.count({where:{kind:'splitWorkArea'}})).toBe(0);
  const duplicates=await Promise.all([0,1].map(()=>POST(new NextRequest('http://127.0.0.1:3100/api/equipment-missions',{method:'POST',headers:admin.headers,body:JSON.stringify(save)}))));
  expect(duplicates.map(r=>r.status).sort()).toEqual([200,409]);
  await call(admin,save,409);let current=await call(admin);expect(current.groups[0].ready).toBe(true);expect(current.tasks.every((t:any)=>t.ready)).toBe(true);
  const recordBefore=await db.workRecord.findMany({where:{kind:'splitWorkArea'}});
  for(const task of current.tasks){
   expect(task.data.workArea.geometry).not.toEqual(input.geometry);expect(task.data.splitArea.reviewVersion).toBe(1);
   const request={action:'prepare',missionId:task.id,fingerprint:task.fingerprint,requestId:randomUUID()};await call(admin,request);expect((await call(admin,request)).alreadyApplied).toBe(true);
   await call(admin,{...request,action:'localReceipt',requestId:randomUUID()});
  }
  const packets=await db.workRecord.findMany({where:{kind:'equipmentMission'}});expect(packets).toHaveLength(2);expect(packets.every(r=>(r.payload as any).status==='LOCAL_RECEIPT_RECORDED'&&!(r.payload as any).hardwareSent&&!(r.payload as any).executionAuthorized)).toBe(true);
  await call(admin,{action:'splitArea',version:1,fingerprint:group.reviewFingerprint,area:{...f.input,parts:draft.parts,note:'정정된 현장 검토 근거'}});
  expect(await db.workRecord.count({where:{kind:'splitWorkAreaHistory'}})).toBe(1);
  expect((await db.workRecord.findFirstOrThrow({where:{kind:'splitWorkAreaHistory'}})).payload).toEqual(recordBefore[0].payload);
  expect((await call(admin)).tasks.every((t:any)=>t.status==='STALE')).toBe(true);
  await call(admin,{action:'localReceipt',missionId:current.tasks[0].id,fingerprint:current.tasks[0].fingerprint,requestId:randomUUID()},409);
  await call(admin,{action:'area',version:1,area:{...input,note:'전체 구역 현장 재확인'}});
  current=await call(admin);expect(current.groups[0].ready).toBe(false);expect(current.tasks.every((t:any)=>!t.ready&&t.data.workArea===null)).toBe(true);
  expect(await db.center.findMany()).toEqual(centersBefore);expect(await db.workRecord.findMany({where:{kind:'resourceReservation'}})).toEqual(reservationsBefore);expect(await db.aiCall.count()).toBe(calls);
 }finally{await admin.cleanup();await other.cleanup();await staff.cleanup();await f.cleanup();await base.cleanup();}
});
it('preserves completed geometry while allowing remaining areas to be reviewed; refuses envelope rewrites',async()=>{
 const base=await laborCapacityFixture(),f=await seedSplitWorkAreas(),admin=await testSession();
 try{
  const {version,reviewedBy,...input}=f.area;await call(admin,{action:'area',version:0,area:input});const group=(await call(admin)).groups[0];
  await call(admin,{action:'splitArea',version:0,fingerprint:group.reviewFingerprint,area:f.input});
  f.parts[0].status='COMPLETED';await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(f.state))}});
  const current=await call(admin);expect(current.groups[0]).toMatchObject({ready:true,editable:true});expect(current.tasks).toHaveLength(1);expect(current.tasks[0].ready).toBe(true);
  const draft=await call(admin,{action:'splitDraft',groupId:f.groupId,fingerprint:group.reviewFingerprint,axis:'NS'});
  expect(draft.parts[0].geometry).toEqual(f.input.parts[0].geometry);
  await call(admin,{action:'splitArea',version:1,fingerprint:group.reviewFingerprint,area:{...f.input,parts:[{...f.input.parts[0],geometry:f.input.parts[1].geometry},f.input.parts[1]]}},409);
  await call(admin,{action:'area',version:1,area:input},409);
  expect(await db.workRecord.count({where:{kind:'splitWorkAreaHistory'}})).toBe(0);
  expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(f.state);
 }finally{await admin.cleanup();await f.cleanup();await base.cleanup();}
});
