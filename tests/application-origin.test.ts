import {afterEach,expect,it,vi} from 'vitest';
import {applicationOrigins,applicationRedirect,secureSessionCookie,setupApplicationOrigin,validApplicationOrigin,validApplicationRequest} from '../lib/application-origin';

afterEach(()=>vi.unstubAllEnvs());
it('allows originless reads only on the canonical Host, never originless mutations',()=>{
 vi.stubEnv('KFARM_APP_ORIGIN','https://judge.example');
 const r=(method:string,headers:Record<string,string>)=>new Request('http://127.0.0.1:3100/api/workspace',{method,headers});
 for(const method of ['GET','HEAD']){
  expect(validApplicationRequest(r(method,{host:'judge.example'}))).toBe(true);
  expect(validApplicationRequest(r(method,{host:'judge.example',origin:'https://judge.example'}))).toBe(true);
  expect(validApplicationRequest(r(method,{host:'judge.example',origin:'https://evil.invalid'}))).toBe(false);
  expect(validApplicationRequest(r(method,{host:'evil.invalid','x-forwarded-host':'judge.example'}))).toBe(false);
  expect(validApplicationRequest(r(method,{}))).toBe(false);
 }
 for(const method of ['POST','PUT','PATCH','DELETE']){
  expect(validApplicationRequest(r(method,{host:'judge.example'}))).toBe(false);
  expect(validApplicationRequest(r(method,{host:'judge.example',origin:'https://judge.example'}))).toBe(true);
 }
 vi.stubEnv('KFARM_APP_ORIGIN','not-a-url');
 expect(validApplicationRequest(r('GET',{host:'127.0.0.1:3100'}))).toBe(false);
});
const request=(origin:string,host:string,forwarded='https')=>new Request('http://127.0.0.1:3100/api/auth',{headers:{origin,host,'x-forwarded-proto':forwarded,'x-forwarded-host':'judge.example'}});

it('keeps the two matching local origin and host pairs without enabling a remote host',()=>{
 vi.stubEnv('KFARM_APP_ORIGIN','');
 expect(validApplicationOrigin(request('http://127.0.0.1:3100','127.0.0.1:3100'))).toBe(true);
 expect(validApplicationOrigin(request('http://localhost:3100','localhost:3100'))).toBe(true);
 expect(validApplicationOrigin(request('http://localhost:3100','127.0.0.1:3100'))).toBe(false);
 expect(validApplicationOrigin(request('https://judge.example','judge.example'))).toBe(false);
 expect(secureSessionCookie(request('http://localhost:3100','localhost:3100'))).toBe(false);
 expect(setupApplicationOrigin()).toBe('http://127.0.0.1:3100');
});

it('allows only the configured HTTPS pair and uses Secure cookies behind TLS termination',()=>{
 vi.stubEnv('KFARM_APP_ORIGIN','https://judge.example');
 expect(applicationOrigins()).toEqual(['https://judge.example']);
 const req=request('https://judge.example','judge.example','http');
 expect(validApplicationOrigin(req)).toBe(true);expect(secureSessionCookie(req)).toBe(true);
 expect(setupApplicationOrigin()).toBe('https://judge.example');
 expect(applicationRedirect('/login',req).href).toBe('https://judge.example/login');
 expect(validApplicationOrigin(request('http://127.0.0.1:3100','127.0.0.1:3100'))).toBe(false);
});

it.each([
 ['https://judge.example.evil.invalid','judge.example'],
 ['https://evil.invalid','judge.example'],
 ['https://judge.example','evil.invalid'],
 ['http://judge.example','judge.example'],
 ['https://judge.example:444','judge.example'],
 ['https://judge.example','judge.example:444'],
 ['null','judge.example'],
 ['https://judge.example','127.0.0.1:3100'],
])('rejects mismatched origin %s and host %s even with forged forwarded headers',(origin,host)=>{
 vi.stubEnv('KFARM_APP_ORIGIN','https://judge.example');
 expect(validApplicationOrigin(request(origin,host))).toBe(false);
});

it.each(['http://judge.example','https://user:password@judge.example','https://judge.example/path','https://judge.example?x=1','https://judge.example#x','https://*.example','not-a-url','https://judge.example,https://other.example'])('fails closed on invalid deployment configuration %s',configured=>{
 vi.stubEnv('KFARM_APP_ORIGIN',configured);
 expect(applicationOrigins()).toEqual([]);
 expect(validApplicationOrigin(request('http://localhost:3100','localhost:3100'))).toBe(false);
 expect(validApplicationOrigin(request('https://judge.example','judge.example'))).toBe(false);
 expect(()=>setupApplicationOrigin()).toThrow('KFARM_APP_ORIGIN');
});

it('accepts a trailing slash and an explicit nondefault HTTPS port',()=>{
 vi.stubEnv('KFARM_APP_ORIGIN','https://judge.example:444/');
 expect(validApplicationOrigin(request('https://judge.example:444','judge.example:444'))).toBe(true);
 expect(setupApplicationOrigin()).toBe('https://judge.example:444');
});
