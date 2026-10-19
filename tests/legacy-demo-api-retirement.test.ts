import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import {testSession} from './auth-fixture';
import {POST as workspace} from '../app/api/workspace/route';
import {GET as demoGet,POST as demo} from '../app/api/demo/route';
import {GET as operationsGet,POST as operations} from '../app/api/operations/route';

async function snapshot(){return {
 centers:await db.center.findMany({orderBy:{id:'asc'}}),
 records:await db.workRecord.findMany({where:{workspace:{not:'auth'}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),
 notices:await db.outbox.findMany({orderBy:{id:'asc'}}),receipts:await db.receipt.findMany({orderBy:{id:'asc'}}),
 calls:await db.aiCall.findMany({orderBy:{id:'asc'}}),budgets:await db.aiBudget.findMany({orderBy:{id:'asc'}}),
};}
const request=(path:string,headers:Record<string,string>,body?:object)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});

it.each([false,true])('refuses the cached workspace injector without creating or changing data (empty=%s)',async empty=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Disposable DB only');
 const original=await db.center.findUnique({where:{id:'demo'}}),raw=await db.$queryRaw<{value:string}[]>`SELECT state::text AS value FROM "Center" WHERE id='demo'`,session=await testSession();
 try{
  if(empty)await db.center.deleteMany({where:{id:'demo'}});
  else await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:emptyCenter('demo') as any},update:{state:emptyCenter('demo') as any}});
  const before=await snapshot(),r=await workspace(request('workspace',session.headers,{action:'injectDemo',workspace:'sandbox'}));
  expect(r.status).toBe(410);expect((await r.json()).code).toBe('LEGACY_DEMO_WORKFLOW_RETIRED');expect(await snapshot()).toEqual(before);
 }finally{
  if(original){await db.center.upsert({where:{id:'demo'},create:original as any,update:original as any});await db.$executeRaw`UPDATE "Center" SET state=${raw[0].value}::jsonb WHERE id='demo'`;}
  else await db.center.deleteMany({where:{id:'demo'}});
  await session.cleanup();
 }
});

it('retires both fixed-plan endpoints while preserving authentication and read-only history',async()=>{
 const session=await testSession(),other=await testSession('CENTER_ADMIN','gyenam');
 const original=await db.center.findUnique({where:{id:'demo'}}),raw=await db.$queryRaw<{value:string}[]>`SELECT state::text AS value FROM "Center" WHERE id='demo'`;
 try{
  await db.center.upsert({where:{id:'demo'},create:{id:'demo',state:emptyCenter('demo') as any},update:{state:emptyCenter('demo') as any}});
  const before=await snapshot();
  for(const [path,handler] of [['demo',demo],['operations',operations]] as const){
   for(const action of ['register','choose','plan','wind','replan','approve','lock']){
    const r=await handler(request(path,session.headers,{action,key:randomUUID()}));
    expect(r.status,path+': '+action).toBe(410);expect((await r.json()).code).toBe('LEGACY_DEMO_WORKFLOW_RETIRED');
   }
   expect((await handler(request(path,{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'},{action:'plan',key:randomUUID()}))).status).toBe(401);
   expect((await handler(request(path,{...session.headers,origin:'https://invalid.example'},{action:'plan',key:randomUUID()}))).status).toBe(403);
  }
  expect((await demo(request('demo',other.headers,{action:'plan',key:randomUUID()}))).status).toBe(403);
  const a=await demoGet(request('demo',session.headers)),b=await operationsGet(request('operations',session.headers));
  expect(a.status).toBe(200);expect(b.status).toBe(200);expect(await a.json()).toEqual(await b.json());
  expect(await snapshot()).toEqual(before);
 }finally{
  if(original){await db.center.upsert({where:{id:'demo'},create:original as any,update:original as any});await db.$executeRaw`UPDATE "Center" SET state=${raw[0].value}::jsonb WHERE id='demo'`;}
  else await db.center.deleteMany({where:{id:'demo'}});
  await session.cleanup();await other.cleanup();
 }
});

it('keeps initialization and notice records, but retires owner delivery without sending',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Disposable DB only');
 const original=await db.center.findUnique({where:{id:'gyenam'}}),raw=await db.$queryRaw<{value:string}[]>`SELECT state::text AS value FROM "Center" WHERE id='gyenam'`;
 const outbox=await db.outbox.findMany(),session=await testSession('CENTER_ADMIN','gyenam');
 try{
  await db.center.deleteMany({where:{id:'gyenam'}});await db.outbox.deleteMany();
  const before=await snapshot();
  const init=await workspace(request('workspace',session.headers,{action:'initialize'}));expect(init.status).toBe(200);
  const saved=await db.center.findUniqueOrThrow({where:{id:'gyenam'}});expect(saved.state).toEqual(emptyCenter('gyenam'));
  expect(await snapshot()).toEqual({...before,centers:[...before.centers,saved].sort((a,b)=>a.id.localeCompare(b.id))});
  expect((await workspace(request('workspace',session.headers,{action:'initialize'}))).status).toBe(409);
  expect(await db.center.findUniqueOrThrow({where:{id:'gyenam'}})).toEqual(saved);
  const own=randomUUID(),foreign=randomUUID();
  await db.outbox.createMany({data:[
   {id:own,centerId:'gyenam',farmerId:'synthetic-owner',planVersion:1,body:'Isolated local delivery'},
   {id:foreign,centerId:'demo',farmerId:'synthetic-neighbor',planVersion:1,body:'Isolated other-center notice'},
  ]});
  const notices=await db.outbox.findMany({orderBy:{id:'asc'}}),key=randomUUID();
  const first=await operations(request('operations',session.headers,{action:'deliver',key}));
  expect(first.status).toBe(200);expect((await first.json()).result).toEqual({delivered:0,attempted:0,provider:'OWNER_SMS_DISABLED'});
  const delivered=await db.outbox.findUniqueOrThrow({where:{id:own}});expect(delivered).toMatchObject({status:'RECORDED_ONLY',attempts:0});expect(delivered.sentAt).toBeNull();
  expect(await db.outbox.findUniqueOrThrow({where:{id:foreign}})).toEqual(notices.find(n=>n.id===foreign));
  const again=await operations(request('operations',session.headers,{action:'deliver',key}));
  expect(again.status).toBe(200);expect((await again.json()).result).toEqual({delivered:0,attempted:0,provider:'OWNER_SMS_DISABLED'});
  expect(await db.outbox.findUniqueOrThrow({where:{id:own}})).toEqual(delivered);
  expect(await snapshot()).toEqual({...before,centers:[...before.centers,saved].sort((a,b)=>a.id.localeCompare(b.id)),notices:notices.map(n=>n.id===own?delivered:n)});
 }finally{
  await db.outbox.deleteMany();if(outbox.length)await db.outbox.createMany({data:outbox});
  if(original){await db.center.upsert({where:{id:'gyenam'},create:original as any,update:original as any});await db.$executeRaw`UPDATE "Center" SET state=${raw[0].value}::jsonb WHERE id='gyenam'`;}
  else await db.center.deleteMany({where:{id:'gyenam'}});
  await session.cleanup();
 }
});

it('the legacy installers exit before loading a database or creating a fixed-date scenario',()=>{
 for(const file of ['scripts/seed.ts','scripts/ground-demo.ts','scripts/install-registered-demo.ts']){
  const source=readFileSync(file,'utf8');expect(source).not.toMatch(/(?:import\s|require\()/);
  const r=spawnSync(process.execPath,['--import','tsx',file],{encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,DATABASE_URL:'not-a-database-url',NEBIUS_API_KEY:''}});
  expect(r.status,file).toBe(1);expect(r.stderr,file).toContain('RETIRED');expect(r.stdout,file).not.toContain('initialized');
 }
});
