import {afterEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,authenticate,createAccount,type User,type Principal} from '../lib/auth';
import {changeAccount} from '../lib/account-management';
import {approveApplication,rejectApplication,submitApplication,type AccountApplication} from '../lib/account-applications';
import {GET,POST} from '../app/api/accounts/route';
import {testSession} from './auth-fixture';

const sessions:Awaited<ReturnType<typeof testSession>>[]=[],applications:string[]=[],extraUsers:string[]=[],extraRecords:string[]=[];
async function session(role:User['role']='SUPER_ADMIN',centerId:string|null=null){const s=await testSession(role,centerId);sessions.push(s);return s}
async function account(id:string){return db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',id)}})}
function profile(u:Principal){return {name:u.name,role:u.role,centerId:u.centerId,enabled:u.enabled,birth:u.birth??'',phone:u.phone??''}}
async function pending(){
 const id=randomUUID(),a:AccountApplication={id,username:'pending-'+id,name:'Synthetic applicant',birth:'1985-03-04',phone:'000-0000-0000',affiliation:'장계면 농업지원센터',passwordHash:'unusable-test-hash',status:'PENDING',createdAt:new Date().toISOString()};
 await db.workRecord.create({data:{...authKey('application',id),payload:a}});applications.push(id);return a;
}
afterEach(async()=>{
 const ids=[...sessions.map(s=>s.id),...extraUsers];
 await db.audit.deleteMany({where:{OR:ids.map(id=>({detail:{path:['actorId'],equals:id}}))}});
 for(const s of sessions)await s.cleanup();
 await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'application',id:{in:applications}},{kind:'user',id:{in:extraUsers}},...extraUsers.map(id=>({kind:'session',payload:{path:['userId'],equals:id}}))]}});
 await db.workRecord.deleteMany({where:{workspace:'sandbox',kind:'account-test-history',id:{in:extraRecords}}});
 sessions.length=0;applications.length=0;extraUsers.length=0;extraRecords.length=0;
});

it('edits profiles with version checks and revokes sessions and recovery when role or center changes',async()=>{
 const admin=await session(),staff=await session('CENTER_STAFF','demo'),before=await account(staff.id);
 await db.workRecord.create({data:{...authKey('recovery',staff.id),payload:{hash:'test'}}});
 const changed=await changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:before.version,profile:{...profile(before.payload as User),name:'Updated',birth:'1988-02-29',phone:'000-0000-0000'}});
 expect(changed.user.recordVersion).toBe(before.version+1);expect(changed.user).not.toHaveProperty('passwordHash');
 expect(await authenticate(new Request('http://localhost',{headers:staff.headers}))).not.toBeNull();
 await expect(changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:before.version,profile:profile(before.payload as User)})).rejects.toMatchObject({status:409});
 await changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:changed.user.recordVersion,profile:{...profile(changed.user),role:'CENTER_ADMIN',centerId:'janggye'}});
 expect(await authenticate(new Request('http://localhost',{headers:staff.headers}))).toBeNull();
 expect(await db.workRecord.count({where:authKey('recovery',staff.id)})).toBe(0);
});

it('center managers can edit their staff, not other centers, managers or role escalation',async()=>{
 const admin=await session('CENTER_ADMIN','demo'),staff=await session('CENTER_STAFF','demo'),other=await session('CENTER_STAFF','janggye'),manager=await session('CENTER_ADMIN','demo');
 for(const target of [other,manager])await expect(changeAccount(admin.principal,{action:'delete',id:target.id,expectedVersion:1})).rejects.toMatchObject({status:403});
 const row=await account(staff.id),p=profile(row.payload as User);
 await expect(changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:1,profile:{...p,role:'SUPER_ADMIN',centerId:null}})).rejects.toMatchObject({status:403});
 await expect(changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:1,profile:{...p,centerId:'janggye'}})).rejects.toMatchObject({status:403});
 await expect(changeAccount(staff.principal,{action:'delete',id:other.id,expectedVersion:1})).rejects.toMatchObject({status:403});
 expect((await changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:1,profile:{...p,name:'Updated staff'}})).ok).toBe(true);
 const listing=await (await GET(new Request('http://localhost',{headers:admin.headers}))).json();
 expect(listing.users.some((u:User)=>u.id===other.id)).toBe(false);
});

it('self deletion, suspension and demotion are prohibited, but self profile updates work',async()=>{
 const admin=await session(),p=profile((await account(admin.id)).payload as User);
 for(const action of ['delete','disable'])await expect(changeAccount(admin.principal,{action,id:admin.id,expectedVersion:1})).rejects.toMatchObject({status:403});
 for(const changed of [{...p,enabled:false},{...p,role:'CENTER_ADMIN',centerId:'demo'}])await expect(changeAccount(admin.principal,{action:'update',id:admin.id,expectedVersion:1,profile:changed})).rejects.toMatchObject({status:403});
 expect((await changeAccount(admin.principal,{action:'update',id:admin.id,expectedVersion:1,profile:{...p,name:'Updated administrator'}})).ok).toBe(true);
});

it('deletion hides the account and revokes access without erasing work history or releasing the username',async()=>{
 const admin=await session(),staff=await session('CENTER_STAFF','demo'),record=await account(staff.id),id=randomUUID();extraRecords.push(id);
 await db.workRecord.create({data:{workspace:'sandbox',kind:'account-test-history',id,payload:{actorId:staff.id,completed:true}}});
 await db.workRecord.create({data:{...authKey('recovery',staff.id),payload:{hash:'test'}}});
 await changeAccount(admin.principal,{action:'delete',id:staff.id,expectedVersion:record.version});
 const deleted=(await account(staff.id)).payload as User;
 expect(deleted.enabled).toBe(false);expect(deleted.deletedAt).toBeTruthy();expect(deleted.passwordHash).toBe('');
 expect(await authenticate(new Request('http://localhost',{headers:staff.headers}))).toBeNull();
 expect(await db.workRecord.count({where:authKey('recovery',staff.id)})).toBe(0);
 expect((await (await GET(new Request('http://localhost',{headers:admin.headers}))).json()).users.some((u:User)=>u.id===staff.id)).toBe(false);
 expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'account-test-history',id}})).toBe(1);
 await expect(changeAccount(admin.principal,{action:'delete',id:staff.id,expectedVersion:record.version})).rejects.toMatchObject({status:404});
 await expect(createAccount({username:deleted.username,name:'Reused',password:'Synthetic-Password-993',role:'CENTER_STAFF',centerId:'demo'},admin.principal)).rejects.toThrow('이미 사용');
});

it('concurrent update and deletion do not silently overwrite one another',async()=>{
 const admin=await session(),staff=await session('CENTER_STAFF','demo'),row=await account(staff.id);
 const results=await Promise.allSettled([
  changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:row.version,profile:{...profile(row.payload as User),name:'Concurrent'}}),
  changeAccount(admin.principal,{action:'delete',id:staff.id,expectedVersion:row.version}),
 ]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});

it('rejection clears credentials, creates no user and permits a fresh application',async()=>{
 const admin=await session(),a=await pending();
 await rejectApplication(admin.principal,{id:a.id,expectedVersion:1,reason:'Affiliation needs correction'});
 const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('application',a.id)}});
 expect(row.payload).toMatchObject({status:'REJECTED',passwordHash:'',rejectedBy:admin.id});
 expect(await db.workRecord.count({where:{workspace:'auth',kind:'user',payload:{path:['username'],equals:a.username}}})).toBe(0);
 await expect(approveApplication(admin.principal,{id:a.id,expectedVersion:1,role:'CENTER_STAFF',centerId:'demo'})).rejects.toMatchObject({status:409});
 await submitApplication({username:a.username,name:a.name,birth:a.birth,phone:a.phone,affiliation:a.affiliation,password:'Corrected-Application-893'});
 const next=await db.workRecord.findMany({where:{workspace:'auth',kind:'application',payload:{path:['username'],equals:a.username}}});applications.push(...next.map(r=>r.id));
 expect(next).toHaveLength(2);
 await db.workRecord.deleteMany({where:authKey('signupLimit','public')});
});

it('approval and rejection race admits only one outcome; pending names cannot bypass review',async()=>{
 const admin=await session(),a=await pending();
 await expect(createAccount({username:a.username,name:'Bypass',password:'Pending-Password-441',role:'CENTER_STAFF',centerId:'demo'},admin.principal)).rejects.toThrow('승인 대기');
 const results=await Promise.allSettled([
  approveApplication(admin.principal,{id:a.id,expectedVersion:1,role:'CENTER_STAFF',centerId:'janggye'}),
  rejectApplication(admin.principal,{id:a.id,expectedVersion:1}),
 ]);
 for(const r of results)if(r.status==='fulfilled'&&'id' in r.value)extraUsers.push(r.value.id);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const listing=await (await GET(new Request('http://localhost',{headers:admin.headers}))).json();
 expect(listing.applications.some((v:AccountApplication)=>v.id===a.id)).toBe(false);
});

it('revalidates actor authority, validates profile input and checks request origin',async()=>{
 const admin=await session(),staff=await session('CENTER_STAFF','demo'),row=await account(staff.id),p=profile(row.payload as User);
 for(const patch of [{birth:'2025-02-30'},{phone:'letters-only'},{role:'FARMER'},{centerId:'unknown'}])await expect(changeAccount(admin.principal,{action:'update',id:staff.id,expectedVersion:1,profile:{...p,...patch}})).rejects.toThrow();
 expect((await POST(new Request('http://127.0.0.1:3100/api/accounts',{method:'POST',headers:{...admin.headers,origin:'https://evil.invalid'},body:JSON.stringify({action:'delete',id:staff.id,expectedVersion:1})}))).status).toBe(403);
 const actor=(await account(admin.id)).payload as User;
 await db.workRecord.update({where:{workspace_kind_id:authKey('user',admin.id)},data:{payload:{...actor,enabled:false}}});
 await expect(changeAccount(admin.principal,{action:'delete',id:staff.id,expectedVersion:1})).rejects.toThrow('권한이 변경');
 expect((await account(staff.id)).version).toBe(1);
});
