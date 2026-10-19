import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,passwordHash,digest} from '../lib/auth';
import {fourCenterDatabaseUrl} from '../scripts/disposable-test-db';
const origin='https://127.0.0.1:3443';
test.skip(process.env.KFARM_E2E_ORIGIN!==origin,'Explicit local TLS acceptance required');
test('real HTTPS login issues a secure cookie, scopes the center, rejects forged origins and logs out',async({browser},info)=>{
 if(process.env.DATABASE_URL!==fourCenterDatabaseUrl())throw Error('Disposable TLS acceptance DB required');
 const backendPort=Number(process.env.KFARM_E2E_BACKEND_PORT??3100);
 if(![3100,3101].includes(backendPort))throw Error('Explicit local test backend port required');
 const id=randomUUID(),username='tls-'+id,password='Aa9!'+randomUUID();
 const context=await browser.newContext({ignoreHTTPSErrors:true});
 await db.workRecord.create({data:{...authKey('user',id),payload:{id,username,name:'가상 HTTPS 검증 담당자',role:'CENTER_ADMIN',centerId:'demo',enabled:true,passwordHash:await passwordHash(password)}}});
 try{
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage();await page.goto(origin+'/login');await page.getByLabel('아이디',{exact:true}).fill(username);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'로그인',exact:true}).click();
  await expect(page).toHaveURL(origin+'/');await expect(page.getByText('가상 HTTPS 검증 담당자 · 센터 관리자',{exact:true})).toBeVisible();
  const cookie=(await context.cookies()).find(c=>c.name==='kfarm_session')!;expect(cookie).toMatchObject({secure:true,httpOnly:true,sameSite:'Strict'});
  const current=await context.request.get(origin+'/api/auth');expect(current.status()).toBe(200);expect((await current.json()).user.centerId).toBe('demo');
  const denied=await context.request.post(origin+'/api/replanning',{headers:{origin:'https://evil.invalid','x-forwarded-host':'127.0.0.1:3443'},data:{action:'automatic'}});expect(denied.status()).toBe(403);
  expect((await context.request.get(origin+'/api/workspace',{headers:{origin:'https://evil.invalid'}})).status()).toBe(403);
  const direct=await context.request.get(`http://127.0.0.1:${backendPort}/api/workspace`,{headers:{cookie:cookie.name+'='+cookie.value,'x-forwarded-host':'127.0.0.1:3443','x-forwarded-proto':'https'}});expect(direct.status()).toBe(403);
  await page.screenshot({path:info.outputPath('https-center-session.png')});await page.getByRole('button',{name:'로그아웃',exact:true}).click();await expect(page).toHaveURL(origin+'/login');
  expect((await (await context.request.get(origin+'/api/auth')).json()).user).toBeNull();
  await info.attach('https-auth-boundary',{body:JSON.stringify({origin,backendPort,localSelfSignedTls:true,realBrowserLogin:true,secureHttpOnlyCookie:true,centerScoped:true,forgedOriginDenied:true,directBackendDenied:true,logout:true,externalDeployment:false}),contentType:'application/json'});
 }finally{
  await context.close();await db.workRecord.deleteMany({where:{workspace:'auth',OR:[{kind:'user',id},{kind:'session',payload:{path:['userId'],equals:id}},{kind:'loginLimit',id:digest(username)}]}});await db.audit.deleteMany({where:{detail:{path:['actorId'],equals:id}}});
 }
});
