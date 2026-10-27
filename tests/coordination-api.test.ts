import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/production-coordination/route';
import {GET as laborGET,POST as laborPOST} from '../app/api/labor-sharing/route';
import {GET as equipmentGET,POST as equipmentPOST} from '../app/api/equipment-missions/route';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {coordinationPolicyKey} from '../lib/production-coordination-store';
import {emptyCoordinationPolicy} from '../lib/production-coordination';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
it('enforces global versus own-center references, rejects stale updates and restores the isolated policy record',async()=>{
 const root=await testSession('SUPER_ADMIN',null),manager=await testSession(),staff=await testSession('CENTER_STAFF'),old=await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}});
 const request=(body:unknown,s:typeof root)=>new NextRequest('http://127.0.0.1:3100/api/production-coordination',{method:'POST',headers:s.headers,body:JSON.stringify(body)});
 const evidence={sourceUrl:'https://example.com/test-only',method:'isolated API test',checkedOn:'2026-01-01',validUntil:'2032-12-31'};
 try{
  const policy=emptyCoordinationPolicy();policy.yields=[{crop:'rice',commodity:'RICE',kgPer1000m2:{low:400,high:500},...evidence}];
  const version=old?.version??0;
  // Staff and managers share center duties, but neither may change national yields.
  expect((await POST(request({version,policy},staff))).status).toBe(409);
  expect((await POST(request({version,policy},root))).status).toBe(200);
  expect((await POST(request({version,policy},root))).status).toBe(409);
  policy.specialties=[{centerId:'janggye',crop:'rice',status:'ESTABLISHED',bonus:3,...evidence}];
  expect((await POST(request({version:version+1,policy},manager))).status).toBe(409);
  policy.specialties[0].centerId='demo';expect((await POST(request({version:version+1,policy},staff))).status).toBe(200);
  policy.yields[0].kgPer1000m2.low=200;expect((await POST(request({version:version+2,policy},manager))).status).toBe(409);
  const r=await GET(new NextRequest('http://127.0.0.1:3100/api/production-coordination?centerId=janggye',{headers:manager.headers}));expect(r.headers.get('Cache-Control')).toBe('no-store');expect(await r.json()).toMatchObject({centerId:'demo',version:version+2,global:false});
 }finally{
  if(old)await db.workRecord.update({where:{workspace_kind_id:coordinationPolicyKey},data:{payload:old.payload as any,version:old.version,updatedAt:old.updatedAt}});else await db.workRecord.deleteMany({where:coordinationPolicyKey});
  await db.audit.deleteMany({where:{action:{in:['auth.request','production.coordination.policy']},OR:[root.id,manager.id,staff.id].flatMap(id=>[{detail:{path:['actorId'],equals:id}},{detail:{path:['actor'],string_contains:id}}])}});
  await root.cleanup();await manager.cleanup();await staff.cleanup();
 }
});
it('requires login and proper center write authority for sharing and equipment delivery',async()=>{
 const staff=await testSession('CENTER_STAFF');
 try{
  for(const [path,get,post] of [['labor-sharing',laborGET,laborPOST],['equipment-missions',equipmentGET,equipmentPOST]] as const){
   const url='http://127.0.0.1:3100/api/'+path;
   expect((await get(new NextRequest(url))).status).toBe(401);
   // An authenticated center operator reaches validation, but this incomplete
   // request cannot create a share or issue an equipment packet.
   expect((await post(new NextRequest(url,{method:'POST',headers:staff.headers,body:JSON.stringify({action:'offer',centerId:'janggye'})}))).status).toBe(409);
  }
 }finally{await staff.cleanup()}
});
