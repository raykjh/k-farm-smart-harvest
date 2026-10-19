import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {submitApplication,approveApplication,publicApplication,type AccountApplication} from '../lib/account-applications';
import {authKey,authenticate,login,digest} from '../lib/auth';
import {testSession} from './auth-fixture';
import {GET as accountsGet} from '../app/api/accounts/route';
import {POST as authPost} from '../app/api/auth/route';

it('pending applications cannot sign in; only a supervisor can assign a center role and approval is atomic',async()=>{
 const admin=await testSession('SUPER_ADMIN',null),staff=await testSession('CENTER_STAFF'),username='apply-'+randomUUID(),password='Application-'+randomUUID();let id='',userId='';
 try{
  const input={username,password,name:'Signup test',birth:'1980-01-01',affiliation:'계북면 농업지원센터',phone:'000-0000-0000'};
  await expect(submitApplication({...input,role:'SUPER_ADMIN'})).rejects.toThrow();
  await submitApplication(input);
  const rows=await db.workRecord.findMany({where:{workspace:'auth',kind:'application'}}),application=rows.map(r=>r.payload as AccountApplication).find(a=>a.username===username)!;id=application.id;
  expect(application.status).toBe('PENDING');expect(application.passwordHash).not.toContain(password);expect(JSON.stringify(publicApplication(application))).not.toContain('passwordHash');
  await expect(login(username,password)).rejects.toThrow();
  expect((await db.workRecord.findMany({where:{workspace:'auth',kind:'user'}})).some(r=>(r.payload as any).username===username)).toBe(false);
  const principal=(await authenticate(new Request('http://localhost',{headers:admin.headers})))!,staffPrincipal=(await authenticate(new Request('http://localhost',{headers:staff.headers})))!;
  const listing=await accountsGet(new Request('http://localhost',{headers:admin.headers}));const listed=await listing.json();expect(listed.applications.some((a:any)=>a.id===id)).toBe(true);expect(JSON.stringify(listed)).not.toContain(application.passwordHash);
  expect((await accountsGet(new Request('http://localhost',{headers:staff.headers}))).status).toBe(403);
  await expect(approveApplication(staffPrincipal,{id,role:'CENTER_STAFF',centerId:'demo'})).rejects.toThrow();
  await expect(approveApplication(principal,{id,role:'SUPER_ADMIN',centerId:'demo'})).rejects.toThrow();
  const approvals=await Promise.allSettled([approveApplication(principal,{id,role:'CENTER_STAFF',centerId:'demo'}),approveApplication(principal,{id,role:'CENTER_ADMIN',centerId:'demo'})]);
  expect(approvals.filter(a=>a.status==='fulfilled')).toHaveLength(1);const user=(approvals.find(a=>a.status==='fulfilled') as PromiseFulfilledResult<any>).value;userId=user.id;
  expect((await login(username,password)).user.id).toBe(userId);expect(user.birth).toBe(input.birth);expect(user.phone).toBe(input.phone);
  const approved=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('application',id)}})).payload as AccountApplication;expect(approved.passwordHash).toBe('');
  await expect(submitApplication(input)).rejects.toThrow('사용 중');
 }finally{
  await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'application',id},{kind:'user',id:userId},{kind:'session',payload:{path:['userId'],equals:userId}},{kind:'loginLimit',id:digest(username)},{kind:'signupLimit',id:'public'}]}});
  await db.audit.deleteMany({where:{detail:{path:['actorId'],equals:admin.id}}});await admin.cleanup();await staff.cleanup();
 }
});

it('public signup rejects cross-origin requests before writing',async()=>{
 const r=await authPost(new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers:{host:'127.0.0.1:3100',origin:'https://other.example'},body:JSON.stringify({action:'signup'})}));expect(r.status).toBe(403);
});
