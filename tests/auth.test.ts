import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {db} from '../lib/db';
import {authenticate,authKey,createAccount,login,digest,asPrincipal,passwordMatches} from '../lib/auth';
import {permitted} from '../lib/auth-policy';
import {testSession,testPrincipal} from './auth-fixture';
import {GET as fields} from '../app/api/fields/route';
import {POST as records} from '../app/api/execution-records/route';
import {POST as authPost} from '../app/api/auth/route';
import {POST as accountsPost} from '../app/api/accounts/route';
it('denies anonymous, other center and staff approval even with forged actor/header',async()=>{
 const staff=await testSession('CENTER_STAFF'),other=await testSession('CENTER_ADMIN','another-center'),admin=await testSession();
 try{
 expect((await fields(new NextRequest('http://127.0.0.1:3100/api/fields'))).status).toBe(401);
 expect((await fields(new NextRequest('http://127.0.0.1:3100/api/fields',{headers:other.headers}))).status).toBe(403);
 expect((await records(new NextRequest('http://127.0.0.1:3100/api/execution-records',{method:'POST',headers:{...staff.headers,'x-role':'SUPER_ADMIN'},body:JSON.stringify({kind:'snapshot',input:{actor:'forged'}})}))).status).toBe(403);
 expect((await records(new NextRequest('http://127.0.0.1:3100/api/execution-records',{method:'POST',headers:{...admin.headers,origin:'https://evil.example'},body:'{}'}))).status).toBe(403);
 expect(permitted({...testPrincipal,role:'SUPER_ADMIN',centerId:null},'fields','GET',null)).toBe(false);
 expect(permitted({...testPrincipal,role:'CENTER_STAFF'},'replanning','POST',{action:'preview'})).toBe(true);
 expect(permitted({...testPrincipal,role:'CENTER_STAFF'},'replanning','POST',{action:'approve'})).toBe(false);
 }finally{await staff.cleanup();await other.cleanup();await admin.cleanup()}
});
it('hashes passwords, rotates sessions, blocks disabled accounts and logout invalidates server token',async()=>{
 const name='test-'+randomUUID(),password='long-test-password-'+randomUUID();let uid='';const tokens:string[]=[];
 try{
 const u=await createAccount({username:name,password,name:'Test',role:'CENTER_STAFF',centerId:'demo'},{...testPrincipal,role:'SUPER_ADMIN',centerId:null});uid=u.id;
 const stored=(await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:authKey('user',uid)}})).payload as any;expect(stored.passwordHash).not.toContain(password);expect(await passwordMatches(password,stored.passwordHash)).toBe(true);
 const session=await login(name,password);tokens.push(session.token);const request=new Request('http://127.0.0.1:3100/api/auth',{headers:{cookie:`kfarm_session=${session.token}`}});expect((await authenticate(request))?.id).toBe(uid);
 const out=await authPost(new Request(request.url,{method:'POST',headers:{cookie:`kfarm_session=${session.token}`,host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'},body:JSON.stringify({action:'logout'})}));expect(out.status).toBe(200);expect(await authenticate(request)).toBeNull();
 const second=await login(name,password);tokens.push(second.token);
 await db.workRecord.update({where:{workspace_kind_id:authKey('user',uid)},data:{payload:{...stored,enabled:false}}});
 expect(await authenticate(new Request(request.url,{headers:{cookie:`kfarm_session=${second.token}`}}))).toBeNull();
 }finally{await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id:uid},{kind:'session',id:{in:tokens.map(digest)}},{kind:'loginLimit',id:digest(name)}]}})}
});
it('enforces staff account creation boundary',async()=>{
 const session=await testSession('CENTER_ADMIN');try{
 const response=await accountsPost(new Request('http://127.0.0.1:3100/api/accounts',{method:'POST',headers:session.headers,body:JSON.stringify({action:'create',account:{username:'escalation-test',name:'test',password:'a-very-long-test-password',role:'SUPER_ADMIN',centerId:null}})}));expect(response.status).toBe(400);
 }finally{await session.cleanup()}
});
it('all business route exports are guarded',()=>{
 const files=readdirSync('app/api',{recursive:true,withFileTypes:true}).filter(f=>f.name==='route.ts');
 for(const f of files){const path=`${f.parentPath}/${f.name}`;if(/[/\\](auth|accounts)[/\\]/.test(path))continue;const code=readFileSync(path,'utf8');expect(code,path).toContain('withAuth(');expect(code,path).not.toMatch(/export (?:async )?function (GET|POST|PUT|DELETE|PATCH)/);}
});
