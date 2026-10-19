import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {createAccount,authKey,login,digest,authenticate,changePassword,type User} from '../lib/auth';
import {issueRecoveryCode,recoverAccount} from '../lib/account-recovery';
import {testSession} from './auth-fixture';
import {POST as accountsPost} from '../app/api/accounts/route';
import {GET as fields} from '../app/api/fields/route';
import {NextRequest} from 'next/server';
it('blocks temporary sessions and lets authorized administrator reset subordinate only',async()=>{
 const admin=await testSession(),staff=await testSession('CENTER_STAFF');
 try{
 const record=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',staff.id)}});
 await db.workRecord.update({where:{workspace_kind_id:authKey('user',staff.id)},data:{payload:{...(record.payload as User),mustChangePassword:true}}});
 expect((await fields(new NextRequest('http://127.0.0.1:3100/api/fields',{headers:staff.headers}))).status).toBe(403);
 const response=await accountsPost(new Request('http://127.0.0.1:3100/api/accounts',{method:'POST',headers:admin.headers,body:JSON.stringify({action:'resetPassword',id:staff.id,password:'Temporary-reset-password'})}));expect(response.status).toBe(200);
 expect(await authenticate(new Request('http://localhost',{headers:staff.headers}))).toBeNull();
 const updated=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',staff.id)}})).payload as User;expect(updated.mustChangePassword).toBe(true);expect(updated.credentialVersion).toBe(1);
 }finally{await admin.cleanup();await staff.cleanup();await db.audit.deleteMany({where:{detail:{path:['actorId'],equals:admin.id}}})}
});
it('temporary password changes revoke sessions; one-time recovery rotates and revokes',async()=>{
 const admin=await testSession('SUPER_ADMIN',null),username='recovery-'+randomUUID(),password='Initial-'+randomUUID(),next='Next-'+randomUUID(),third='Recovery-'+randomUUID();let id='';
 try{
 const user=await createAccount({username,password,name:'Recovery test',role:'SUPER_ADMIN',centerId:null},admin.principal);id=user.id;expect(user.mustChangePassword).toBe(true);
 const session=await login(username,password),request=new Request('http://localhost',{headers:{cookie:`kfarm_session=${session.token}`}});
 await expect(changePassword(user,{currentPassword:password,newPassword:password})).rejects.toThrow();
 const changed=await changePassword(user,{currentPassword:password,newPassword:next});expect(changed.mustChangePassword).toBe(false);expect(await authenticate(request)).toBeNull();
 await expect(login(username,password)).rejects.toThrow();
 const code=await issueRecoveryCode(changed,next);const live=await login(username,next);const result=await recoverAccount({username,code,newPassword:third});
 expect(result.code).not.toBe(code);expect(await authenticate(new Request('http://localhost',{headers:{cookie:`kfarm_session=${live.token}`}}))).toBeNull();
 await expect(recoverAccount({username,code,newPassword:next})).rejects.toThrow();
 expect((await login(username,third)).user.mustChangePassword).toBe(false);
 const stored=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('recovery',id)}})).payload as any;expect(stored.hash).toBe(digest(result.code));expect(JSON.stringify(stored)).not.toContain(result.code);
 }finally{
 await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'recovery',id},{kind:'session',payload:{path:['userId'],equals:id}},{kind:{in:['loginLimit','recoveryLimit']},id:digest(username)}]}});
 await db.audit.deleteMany({where:{OR:[{detail:{path:['actorId'],equals:id}},{detail:{path:['userId'],equals:id}}]}});
 await admin.cleanup();
 }
});
