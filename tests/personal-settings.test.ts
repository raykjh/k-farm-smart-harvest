import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {authKey} from '../lib/auth';
import {testSession} from './auth-fixture';
import {POST} from '../app/api/auth/route';
import {GET as accounts} from '../app/api/accounts/route';
import {changeAccount} from '../lib/account-management';
const request=(headers:Record<string,string>,body:unknown)=>new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers,body:JSON.stringify(body)});
it('edits only the signed-in profile with version checks, no credential or role change',async()=>{
 const session=await testSession('CENTER_STAFF');
 try{
  const before=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',session.id)}});
  const settings=await POST(request(session.headers,{action:'personalSettings'}));expect(settings.status).toBe(200);expect(await settings.json()).not.toHaveProperty('passwordHash');
  const input={expectedVersion:before.version,profile:{name:'홍담당',birth:'1970-02-02',phone:'010-0000-0000'}};
  expect((await POST(request(session.headers,{action:'saveProfile',input:{...input,profile:{...input.profile,role:'SUPER_ADMIN'}}}))).status).toBe(400);
  expect((await POST(request({...session.headers,origin:'https://evil.invalid'},{action:'saveProfile',input}))).status).toBe(403);
  expect((await POST(request(session.headers,{action:'saveProfile',input}))).status).toBe(200);
  const after=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',session.id)}});
  expect(after.payload).toEqual({...before.payload as object,...input.profile});expect(after.version).toBe(before.version+1);
  expect((await POST(request(session.headers,{action:'saveProfile',input}))).status).toBe(400);
  expect((await POST(request({}, {action:'saveProfile',input}))).status).not.toBe(200);
 }finally{await db.audit.deleteMany({where:{detail:{path:['actorId'],equals:session.id}}});await session.cleanup()}
});
it('deduplicates recovery requests, exposes them only to account managers and resolves on reset',async()=>{
 const staff=await testSession('CENTER_STAFF'),admin=await testSession('SUPER_ADMIN',null),neighbor=await testSession('CENTER_ADMIN','janggye');
 try{
  const before=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',staff.id)}});
  for(let i=0;i<2;i++)expect((await POST(request(staff.headers,{action:'requestRecovery'}))).status).toBe(200);
  expect(await db.workRecord.count({where:authKey('recoveryRequest',staff.id)})).toBe(1);
  expect(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',staff.id)}})).toEqual(before);
  expect((await accounts(new Request('http://127.0.0.1:3100/api/accounts',{headers:staff.headers}))).status).toBe(403);
  const listing=await (await accounts(new Request('http://127.0.0.1:3100/api/accounts',{headers:admin.headers}))).json();expect(listing.users.find((u:any)=>u.id===staff.id).recoveryRequestedAt).toBeTruthy();
  const other=await (await accounts(new Request('http://127.0.0.1:3100/api/accounts',{headers:neighbor.headers}))).json();expect(other.users.some((u:any)=>u.id===staff.id)).toBe(false);
  await changeAccount(admin.principal,{action:'resetPassword',id:staff.id,expectedVersion:before.version,password:'temporary-example-123'});
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('recoveryRequest',staff.id)}})).payload).toMatchObject({status:'RESOLVED',resolvedBy:admin.id});
  expect((await POST(request(admin.headers,{action:'requestRecovery'}))).status).toBe(400);
 }finally{await db.workRecord.deleteMany({where:authKey('recoveryRequest',staff.id)});await db.audit.deleteMany({where:{OR:[staff.id,admin.id,neighbor.id].map(id=>({detail:{path:['actorId'],equals:id}}))}});await staff.cleanup();await admin.cleanup();await neighbor.cleanup()}
});
