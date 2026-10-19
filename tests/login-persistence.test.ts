import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {createAccount,authKey,authenticate,digest} from '../lib/auth';
import {testSession} from './auth-fixture';
import {POST} from '../app/api/auth/route';
it('remember me changes browser persistence, not the server eight-hour expiration; logout revokes it',async()=>{
 const admin=await testSession('SUPER_ADMIN',null),username='persist-'+randomUUID(),password='Persistent-'+randomUUID();let id='';
 try{
  const u=await createAccount({username,password,name:'Session test',role:'CENTER_STAFF',centerId:'demo'},admin.principal);id=u.id;
  for(const remember of [false,true]){
   const before=Date.now(),response=await POST(new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'},body:JSON.stringify({action:'login',username,password,remember})}));expect(response.status).toBe(200);
   const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('HttpOnly');expect(cookie.toLowerCase()).toContain('samesite=strict');
   if(remember)expect(cookie).toContain('Max-Age=28800');else expect(cookie).not.toContain('Max-Age');
   const token=cookie.match(/kfarm_session=([^;]+)/)![1],row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('session',digest(token))}}),expiresAt=(row.payload as any).expiresAt;
   expect(expiresAt-before).toBeGreaterThanOrEqual(8*3600000);expect(expiresAt-before).toBeLessThan(8*3600000+10000);
   const request=new Request('http://localhost',{headers:{cookie:'kfarm_session='+token}});expect((await authenticate(request))?.id).toBe(id);
   await POST(new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100',cookie:'kfarm_session='+token},body:JSON.stringify({action:'logout'})}));expect(await authenticate(request)).toBeNull();
  }
 }finally{await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'session',payload:{path:['userId'],equals:id}},{kind:'loginLimit',id:digest(username)}]}});await db.audit.deleteMany({where:{detail:{path:['userId'],equals:id}}});await admin.cleanup()}
});
