import {expect,it} from 'vitest';
import {NextRequest} from 'next/server';
import {Prisma} from '@prisma/client';
import {db} from '../lib/db';
import {GET,POST} from '../app/api/demo-data/route';
import {testSession} from './auth-fixture';
import {demoRemovalFixture} from './demo-removal-fixture';
import {clearedState} from '../lib/demo-data';
import {fieldEntry} from '../lib/field-record';

const orderedRecords=()=>db.workRecord.findMany({where:{workspace:{not:'auth'}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]});
async function capture(){return {centers:await db.center.findMany({orderBy:{id:'asc'}}),records:await orderedRecords(),outbox:await db.outbox.findMany({orderBy:{id:'asc'}}),receipts:await db.receipt.findMany({orderBy:{id:'asc'}}),audits:await db.audit.findMany({orderBy:{id:'asc'}})}}
async function fixture(){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated DB only');
 const before=await capture(),f=demoRemovalFixture();
 // Preserve PostgreSQL JSON text exactly; a Prisma read/write round trip can
 // round historical fractional values that these tests do not own.
 const recordJson=await db.$queryRaw<{workspace:string;kind:string;id:string;value:string}[]>`SELECT workspace,kind,id,payload::text AS value FROM "WorkRecord" WHERE workspace<>'auth'`;
 const centerJson=await db.$queryRaw<{id:string;value:string}[]>`SELECT id,state::text AS value FROM "Center"`;
 await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{not:'auth'}}});await tx.center.deleteMany();await tx.outbox.deleteMany();await tx.receipt.deleteMany();
  await tx.center.create({data:{id:'demo',version:1,state:JSON.parse(JSON.stringify(f.b.state))}});
  await tx.center.create({data:{id:'gyenam',version:2,state:JSON.parse(JSON.stringify(clearedState()))}});
  await tx.workRecord.createMany({data:f.snapshot.records as any});
 });
 return {...f,async cleanup(){await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{not:'auth'}}});if(before.records.length)await tx.workRecord.createMany({data:before.records as any});
  await tx.center.deleteMany();if(before.centers.length)await tx.center.createMany({data:before.centers as any});
  if(recordJson.length)await tx.$executeRaw(Prisma.sql`UPDATE "WorkRecord" w SET payload=b.value::jsonb FROM (VALUES ${Prisma.join(recordJson.map(r=>Prisma.sql`(${r.workspace},${r.kind},${r.id},${r.value})`))}) AS b(workspace,kind,id,value) WHERE w.workspace=b.workspace AND w.kind=b.kind AND w.id=b.id`);
  if(centerJson.length)await tx.$executeRaw(Prisma.sql`UPDATE "Center" c SET state=b.value::jsonb FROM (VALUES ${Prisma.join(centerJson.map(r=>Prisma.sql`(${r.id},${r.value})`))}) AS b(id,value) WHERE c.id=b.id`);
  await tx.outbox.deleteMany();if(before.outbox.length)await tx.outbox.createMany({data:before.outbox});
  await tx.receipt.deleteMany();if(before.receipts.length)await tx.receipt.createMany({data:before.receipts as any});
  await tx.audit.deleteMany({where:{id:{notIn:before.audits.map(a=>a.id)}}});
 },{timeout:30000});expect(await capture()).toEqual(before)}};
}

it.each([false,true])('rejects the retired snapshot import without writes (empty=%s)',async empty=>{
 const f=await fixture(),s=await testSession();
 try{
  if(empty)await db.$transaction(async tx=>{
   await tx.workRecord.deleteMany({where:{workspace:'sandbox'}});
   await tx.center.update({where:{id:'demo'},data:{state:JSON.parse(JSON.stringify(clearedState()))}});
  });
  const preview=await GET(new NextRequest('http://127.0.0.1:3100/api/demo-data',{headers:s.headers}));expect(preview.status).toBe(200);
  const info=await preview.json();expect(info).toMatchObject({inputMethod:'ORDINARY_WORKFLOW',legacyInsertEnabled:false});
  const before=await capture(),ledger=await db.aiBudget.findMany(),calls=await db.aiCall.count();
  const response=await POST(new NextRequest('http://127.0.0.1:3100/api/demo-data',{method:'POST',headers:s.headers,body:JSON.stringify({action:'insert',token:info.token})}));
  expect(response.status).toBe(410);expect((await response.json()).code).toBe('LEGACY_DEMO_IMPORT_RETIRED');
  const after=await capture(),{audits:priorAudits,...priorBusiness}=before,{audits,...nextBusiness}=after;
  expect(nextBusiness).toEqual(priorBusiness);
  expect(audits.filter(a=>!priorAudits.some(b=>b.id===a.id)).every(a=>a.action==='auth.request')).toBe(true);
  expect(await db.aiBudget.findMany()).toEqual(ledger);expect(await db.aiCall.count()).toBe(calls);
 }finally{await s.cleanup();await f.cleanup()}
});

it('rejects stale confirmation and linked-record removal without changing any business rows',async()=>{
 const f=await fixture(),s=await testSession();
 const request=(action:string,token:string)=>new NextRequest('http://127.0.0.1:3100/api/demo-data',{method:'POST',headers:s.headers,body:JSON.stringify({action,token})});
 try{
  const preview=await GET(new NextRequest('http://127.0.0.1:3100/api/demo-data',{headers:s.headers}));expect(preview.status).toBe(200);const old=await preview.json();expect(old.safe).toBe(true);
  await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:'foreign-reservation',payload:{centerId:'gyenam',resourceId:f.b.state.machines[0].id,taskId:'foreign-task'}}});
  await db.workRecord.create({data:{workspace:'sandbox',kind:'taskExecutionAssessment',id:'execution',payload:{taskId:f.b.state.missions[0].id,status:'SIMULATED_COMPLETED'}}});
  await db.outbox.create({data:{id:'delivery',centerId:'demo',farmerId:f.b.state.fields[0].farmerId,planVersion:1,body:'Synthetic test notice',status:'DELIVERED'}});
  const before=await capture(),ledger=await db.aiBudget.findMany(),calls=await db.aiCall.count();
  const stale=await POST(request('remove',old.token));expect(stale.status).toBe(409);
  const fresh=await GET(new NextRequest('http://127.0.0.1:3100/api/demo-data',{headers:s.headers})),info=await fresh.json();
  expect(info.safe).toBe(false);expect(info.blockers.map((b:any)=>b.code)).toEqual(expect.arrayContaining(['SHARED','WORKFLOW','NOTICE']));
  const response=await POST(request('remove',info.token));expect(response.status).toBe(409);expect((await response.json()).code).toBe('DEMO_REMOVAL_BLOCKED');
  const after=await capture(),{audits:beforeAudits,...beforeBusiness}=before,{audits,...afterBusiness}=after;
  expect(afterBusiness).toEqual(beforeBusiness);
  expect(audits).toEqual(expect.arrayContaining(beforeAudits));
  expect(audits.filter(a=>!beforeAudits.some(b=>b.id===a.id)).every(a=>a.action==='auth.request')).toBe(true);
  expect(await db.aiBudget.findMany()).toEqual(ledger);expect(await db.aiCall.count()).toBe(calls);
 }finally{await s.cleanup();await f.cleanup()}
});

it('archives a pristine batch and retains manual registrations, center configuration, accounts and AI accounting',async()=>{
 const f=await fixture(),s=await testSession();
 try{
  const manual=fieldEntry.parse({pnu:'5274036023900009999',address:'합성 수동 등록',area:2000,crop:'',mode:'full',rights:'pending',group:''});
  await db.workRecord.update({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}},data:{payload:[...f.b.fields,manual] as any}});
  await db.workRecord.createMany({data:[{workspace:'sandbox',kind:'consultation',id:'manual-record',payload:{farmer:{name:'수동 가상인'}}},{workspace:'sandbox',kind:'centerSettings',id:'current',payload:{location:null}},{workspace:'sandbox',kind:'labor',id:'current',payload:{people:[]}}]});
  const accounts=await db.workRecord.findMany({where:{workspace:'auth'},orderBy:[{kind:'asc'},{id:'asc'}]}),ledger=await db.aiBudget.findMany(),calls=await db.aiCall.count(),foreign=await db.center.findUnique({where:{id:'gyenam'}});
  const preview=await GET(new NextRequest('http://127.0.0.1:3100/api/demo-data',{headers:s.headers})),info=await preview.json();expect(info.safe).toBe(true);
  const response=await POST(new NextRequest('http://127.0.0.1:3100/api/demo-data',{method:'POST',headers:s.headers,body:JSON.stringify({action:'remove',token:info.token})}));expect(response.status,await response.text()).toBe(200);
  expect((await db.center.findUniqueOrThrow({where:{id:'demo'}})).state).toEqual(clearedState());
  expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'sandbox',kind:'fields',id:'current'}}})).payload).toEqual([manual]);
  expect(await db.workRecord.count({where:{workspace:'sandbox',kind:'consultation'}})).toBe(1);
  expect(await db.workRecord.count({where:{workspace:'sandbox',kind:{in:['removedDemo','removedDemoRecords','centerSettings','labor']}}})).toBe(4);
  expect(await db.center.findUnique({where:{id:'gyenam'}})).toEqual(foreign);
  expect(await db.workRecord.findMany({where:{workspace:'auth'},orderBy:[{kind:'asc'},{id:'asc'}]})).toEqual(accounts);
  expect(await db.aiBudget.findMany()).toEqual(ledger);expect(await db.aiCall.count()).toBe(calls);
 }finally{await s.cleanup();await f.cleanup()}
});
