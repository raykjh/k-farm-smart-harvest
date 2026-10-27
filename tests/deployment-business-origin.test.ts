import {it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {replacementDurationFixture} from './replacement-duration-fixture';
vi.mock('../lib/kma-forecast',()=>({readShortForecast:async()=>({status:'NOT_CONFIGURED',points:[],kind:'short',sourceUrl:'ISOLATED_TEST'})}));
import {GET,POST} from '../app/api/replanning/route';
afterEach(()=>vi.unstubAllEnvs());
const origin='https://judge.example',host='judge.example';

it('reaches all formerly loopback-only mutation validators at the canonical origin without weakening the shared guard',async()=>{
 const f=await laborCapacityFixture(),center=await testSession(),admin=await testSession('SUPER_ADMIN',null);
 vi.stubEnv('KFARM_APP_ORIGIN',origin);
 const loaders={
  'annual-plan':()=>import('../app/api/annual-plan/route'),
  'annual-dispatch':()=>import('../app/api/annual-dispatch/route'),
  consultations:()=>import('../app/api/consultations/route'),
  cultivations:()=>import('../app/api/cultivations/route'),
  'delegated-planning':()=>import('../app/api/delegated-planning/route'),
  demo:()=>import('../app/api/demo/route'),
  'demo-data':()=>import('../app/api/demo-data/route'),
  'environment-plan':()=>import('../app/api/environment-plan/route'),
  'environment-windows':()=>import('../app/api/environment-windows/route'),
  'execution-records':()=>import('../app/api/execution-records/route'),
  fields:()=>import('../app/api/fields/route'),
  labor:()=>import('../app/api/labor/route'),
  incidents:()=>import('../app/api/incidents/route'),
  'labor-operations':()=>import('../app/api/labor-operations/route'),
  operations:()=>import('../app/api/operations/route'),
  'regional-crop-standards':()=>import('../app/api/regional-crop-standards/route'),
  replanning:()=>import('../app/api/replanning/route'),
  'task-schedule':()=>import('../app/api/task-schedule/route'),
  workspace:()=>import('../app/api/workspace/route'),
 };
 const before=await db.center.findMany({orderBy:{id:'asc'}}),calls=await db.aiCall.count(),outbox=await db.outbox.count();
 try{
  for(const [path,load] of Object.entries(loaders)){
   const route=await load(),session=path==='regional-crop-standards'?admin:center;
   const action=['replanning','task-schedule'].includes(path)?'preview':'__origin_probe__';
   const request=(headers:Record<string,string>)=>new NextRequest(`http://127.0.0.1:3100/api/${path}`,{method:'POST',headers,body:JSON.stringify({action})});
   const good=await route.POST(request({...session.headers,origin,host}));
   expect(path==='demo'?[410]:[400,409],path+': '+await good.text()).toContain(good.status);
   const bad=await route.POST(request({...session.headers,host,origin:'https://evil.invalid','x-forwarded-host':host}));expect(bad.status,path).toBe(403);
   expect((await route.POST(request(session.headers))).status,path+' rejects localhost in canonical mode').toBe(403);
  }
  expect(await db.center.findMany({orderBy:{id:'asc'}})).toEqual(before);expect(await db.aiCall.count()).toBe(calls);expect(await db.outbox.count()).toBe(outbox);
 }finally{await center.cleanup();await admin.cleanup();await f.cleanup()}
},60000);

it('saves an actual automatic plan and replays its receipt on the canonical origin while retaining center scope',async()=>{
 const f=await laborCapacityFixture(),session=await testSession(),other=await testSession('CENTER_ADMIN','gyenam');vi.stubEnv('KFARM_APP_ORIGIN',origin);
 try{
  const {s,m}=replacementDurationFixture();s.fields[0].area=1000;s.machines=s.machines.slice(0,1);s.machines.push({...s.machines[0],id:'JB23TR02',status:'AVAILABLE'});s.centerSharing=undefined;
  await db.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(s))}});
  const body={action:'automatic',requestId:randomUUID(),ids:[m.id],reason:'Canonical origin integration'},headers={...session.headers,origin,host};
  const call=()=>POST(new NextRequest('http://127.0.0.1:3100/api/replanning',{method:'POST',headers,body:JSON.stringify(body)}));
  const response=await call();expect(response.status,await response.text()).toBe(200);
  const saved=await db.center.findUniqueOrThrow({where:{id:'demo'}});expect((saved.state as any).missions.find((v:any)=>v.id===m.id).resourceId).toBe('JB23TR02');
  const repeat=await call();expect(repeat.status).toBe(200);expect(await db.center.findUniqueOrThrow({where:{id:'demo'}})).toEqual(saved);
  const read=(headers:Record<string,string>)=>GET(new NextRequest('http://127.0.0.1:3100/api/replanning',{headers}));
  const good=await read({cookie:session.headers.cookie,host});expect(good.status).toBe(200);expect((await good.json()).requests[0].status).toBe('APPLIED');
  expect((await read({...headers,origin:'https://evil.invalid'})).status).toBe(403);
  expect((await read({...headers,host:'evil.invalid','x-forwarded-host':host})).status).toBe(403);
  const foreign=await read({cookie:other.headers.cookie,host});expect(foreign.status).toBe(200);expect((await foreign.json()).requests).toEqual([]);
 }finally{await other.cleanup();await session.cleanup();await f.cleanup()}
},60000);
