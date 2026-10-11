import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {POST} from '../app/api/auth/route';
import {proxy} from '../proxy';
import {db} from '../lib/db';
import {authKey,createAccount,digest,authenticate} from '../lib/auth';
import {testPrincipal} from './auth-fixture';

afterEach(()=>vi.unstubAllEnvs());
it('uses the actual auth route with a canonical HTTPS origin behind an HTTP reverse proxy',async()=>{
 vi.stubEnv('KFARM_APP_ORIGIN','https://judge.example');
 const username='public-test-'+randomUUID(),password='Aa9!'+randomUUID();let id='',token='';
 const headers={host:'judge.example',origin:'https://judge.example','content-type':'application/json','x-forwarded-proto':'http'};
 try{
  id=(await createAccount({username,password,name:'Synthetic judge',role:'CENTER_STAFF',centerId:'demo'},{...testPrincipal,role:'SUPER_ADMIN',centerId:null})).id;
  const body=JSON.stringify({action:'login',username,password,remember:false});
  expect((await POST(new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers:{...headers,origin:'https://evil.invalid','x-forwarded-host':'judge.example'},body}))).status).toBe(403);
  const response=await POST(new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers,body}));
  expect(response.status).toBe(200);
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toMatch(/; Secure/i);expect(cookie).toMatch(/; HttpOnly/i);expect(cookie).toMatch(/; SameSite=strict/i);
  token=cookie.split(';')[0].split('=')[1];
  expect((await authenticate(new Request('http://127.0.0.1:3100/api/auth',{headers:{cookie:cookie.split(';')[0]}})))?.id).toBe(id);
  const redirected=await proxy(new NextRequest('http://127.0.0.1:3100/',{headers:{host:'judge.example'}}));
  expect(redirected.headers.get('location')).toBe('https://judge.example/login');
  const out=await POST(new Request('http://127.0.0.1:3100/api/auth',{method:'POST',headers:{...headers,cookie:cookie.split(';')[0]},body:JSON.stringify({action:'logout'})}));
  expect(out.status).toBe(200);expect(out.headers.get('set-cookie')).toMatch(/; Secure/i);
  expect(await authenticate(new Request('http://127.0.0.1:3100/api/auth',{headers:{cookie:cookie.split(';')[0]}}))).toBeNull();
 }finally{
  await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'session',id:digest(token)},{kind:'loginLimit',id:digest(username)}]}});
 }
});
