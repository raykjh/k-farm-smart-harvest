import {PrismaClient,Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// A read-only consistent application snapshot, plus a fresh local restore DB.
// Never overwrite an existing database, and never print private rows or secrets.
const expected=process.argv.find(v=>v.startsWith('--expected='))?.slice(11);
if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw Error('Supply the verified operating fingerprint');
const source=new PrismaClient();
const read=(db:PrismaClient)=>db.$transaction(async tx=>({
 records:await tx.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),
 centers:await tx.center.findMany({orderBy:{id:'asc'}}),outbox:await tx.outbox.findMany({orderBy:{id:'asc'}}),
 receipts:await tx.receipt.findMany({orderBy:{id:'asc'}}),audit:await tx.audit.findMany({orderBy:{id:'asc'}}),
 budgets:await tx.aiBudget.findMany({orderBy:{id:'asc'}}),calls:await tx.aiCall.findMany({orderBy:{id:'asc'}}),
}),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const differences=(a:any,b:any,path=''):Array<{path:string,expectedType:string,actualType:string}>=>(hash(a)===hash(b))?[]:a&&b&&typeof a==='object'&&typeof b==='object'?Array.from(new Set([...Object.keys(a),...Object.keys(b)])).flatMap(k=>differences(a[k],b[k],path+'.'+k)).slice(0,5):[{path,expectedType:typeof a,actualType:typeof b}];
const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'');
const targetName='kfarm_restore_verify_'+stamp;
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
const admin=new PrismaClient({datasourceUrl:base+'postgres'}),target=new PrismaClient({datasourceUrl:base+targetName});
try{
 if(process.argv.includes('--inspect-existing')){
  const databases=await admin.$queryRaw<Array<{datname:string}>>`SELECT datname FROM pg_database WHERE starts_with(datname, 'kfarm_restore_verify_') ORDER BY datname DESC`;
  const existing=databases[0]?.datname;if(!existing||!/^kfarm_restore_verify_\d+$/.test(existing))throw Error('No verification DB');
  const restoredDb=new PrismaClient({datasourceUrl:base+existing});
  try{
   const saved=JSON.parse(readFileSync(resolve('.data/backups/20261003-operational-completion/operating-application-snapshot.json'),'utf8'));
   const restored=JSON.parse(JSON.stringify(await read(restoredDb)));
   const comparison=Object.entries(saved.snapshot).map(([table,value])=>{
    const rows=value as Array<Record<string,unknown>>,other=restored[table] as Array<Record<string,unknown>>;
    const first=rows.findIndex((row,index)=>hash(row)!==hash(other[index]));
    return {table,expected:rows.length,actual:other.length,equal:hash(rows)===hash(other),semanticEqual:hash(canonical(rows))===hash(canonical(other)),firstMismatch:first,fields:first<0?[]:Object.keys(rows[first]).filter(field=>hash(rows[first][field])!==hash(other[first]?.[field]))};
   });
   const differing=saved.snapshot.records.findIndex((r:any,i:number)=>hash(canonical(r))!==hash(canonical(restored.records[i])));
   console.log(JSON.stringify({database:existing,comparison,differences:differing<0?[]:differences(saved.snapshot.records[differing],restored.records[differing])}));
   const activity=await admin.$queryRaw`SELECT datname,state,wait_event_type,wait_event,EXTRACT(EPOCH FROM (now()-query_start))::int AS seconds FROM pg_stat_activity WHERE datname='kfarm_test'`;
   console.log(JSON.stringify({testDatabaseActivity:activity}));
  }finally{await restoredDb.$disconnect()}
  process.exitCode=0;
 }else{
 const snapshot=await read(source);if(hash(snapshot)!==expected)throw Error('Source changed; do not assume a consistent baseline');
 const dir=resolve('.data/backups/20261003-operational-completion');mkdirSync(dir,{recursive:true});
 const file=resolve(dir,'operating-application-snapshot.json');
 if(process.argv.includes('--from-backup')){
  const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.format!=='KFARM_APPLICATION_SNAPSHOT_V1'||saved.sha256!==expected||hash(saved.snapshot)!==expected)throw Error('Backup does not match the protected baseline');
  Object.assign(snapshot,saved.snapshot);
 }else writeFileSync(file,JSON.stringify({format:'KFARM_APPLICATION_SNAPSHOT_V1',at:new Date().toISOString(),sha256:expected,snapshot}),{flag:'wx',mode:0o600});
 if(!/^kfarm_restore_verify_\d+$/.test(targetName))throw Error('Unsafe verification target');
 await admin.$executeRawUnsafe(`CREATE DATABASE "${targetName}"`);
 const schema=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:base+targetName},encoding:'utf8',windowsHide:true});
 if(schema.status!==0)throw Error('Verification schema initialization failed');
 await target.$transaction(async tx=>{
  // Pass JSON text directly: Prisma's JSON number encoding can round a floating
  // value by one ULP. A backup restore must not silently alter stored values.
  for(let i=0;i<snapshot.records.length;i+=500)await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload,"updatedAt") SELECT workspace,kind,id,version,payload,"updatedAt" FROM jsonb_to_recordset(${JSON.stringify(snapshot.records.slice(i,i+500))}::jsonb) AS x(workspace text,kind text,id text,version int,payload jsonb,"updatedAt" timestamp(3))`;
  await tx.$executeRaw`INSERT INTO "Center" (id,version,state,"updatedAt") SELECT id,version,state,"updatedAt" FROM jsonb_to_recordset(${JSON.stringify(snapshot.centers)}::jsonb) AS x(id text,version int,state jsonb,"updatedAt" timestamp(3))`;
  await tx.outbox.createMany({data:snapshot.outbox});
  await tx.$executeRaw`INSERT INTO "Receipt" (id,operation,result,"createdAt") SELECT id,operation,result,"createdAt" FROM jsonb_to_recordset(${JSON.stringify(snapshot.receipts)}::jsonb) AS x(id text,operation text,result jsonb,"createdAt" timestamp(3))`;
  await tx.$executeRaw`INSERT INTO "Audit" (id,"centerId",action,detail,"createdAt") SELECT id,"centerId",action,detail,"createdAt" FROM jsonb_to_recordset(${JSON.stringify(snapshot.audit)}::jsonb) AS x(id text,"centerId" text,action text,detail jsonb,"createdAt" timestamp(3))`;
  await tx.aiBudget.createMany({data:snapshot.budgets});await tx.aiCall.createMany({data:snapshot.calls});
 },{timeout:60000});
 const restored=await read(target),restoredHash=hash(restored);if(restoredHash!==expected)throw Error('Restored rows did not match');
 const evidence={file,database:targetName,sha256:restoredHash,counts:Object.fromEntries(Object.entries(restored).map(([k,v])=>[k,v.length])),scope:'7 application tables; NOT a full PostgreSQL role/config backup'};
 writeFileSync(resolve(dir,'restore-verification.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log(JSON.stringify(evidence));
 }
}finally{await source.$disconnect();await target.$disconnect();await admin.$disconnect()}
