import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Prisma,PrismaClient} from '@prisma/client';
import {localTestDatabaseBase} from './disposable-test-db';

const folder=resolve('.data/video-capture-20261018');
const preparation=JSON.parse(await readFile(resolve(folder,'preparation.json'),'utf8'));
const canonical=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
async function snapshot(name:string){
 assert(['kfarm','kfarm_centers_e2e_scale_20261017','kfarm_centers_e2e_video_20261018'].includes(name));
 const client=new PrismaClient({datasourceUrl:localTestDatabaseBase+name});
 try{return await client.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  return {centers:await tx.center.findMany({orderBy:{id:'asc'}}),records:await tx.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),outbox:await tx.outbox.findMany({orderBy:{id:'asc'}}),receipts:await tx.receipt.findMany({orderBy:{id:'asc'}}),audit:await tx.audit.findMany({orderBy:{id:'asc'}}),budgets:await tx.aiBudget.findMany({orderBy:{id:'asc'}}),calls:await tx.aiCall.findMany({orderBy:{id:'asc'}})};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});}finally{await client.$disconnect();}
}
const sources=[];
for(const source of preparation.sources){
 const now=await snapshot(source.database),backup=JSON.parse(await readFile(source.backup,'utf8'));
 assert.equal(hash(backup.snapshot),source.sha256,'Backup checksum differs');
 const currentHash=hash(now);
 sources.push({database:source.database,unchanged:currentHash===source.sha256,sha256:currentHash,aiCallCount:now.calls.length,tableRows:Object.fromEntries(Object.entries(now).map(([k,v])=>[k,v.length]))});
}
const current=await snapshot(preparation.filmingDatabase);
const initial=JSON.parse(await readFile(resolve(folder,'backups/filming-initial.json'),'utf8'));
const initialBusiness=initial.snapshot.records.filter((r:any)=>r.workspace!=='auth');
const currentBusiness=current.records.filter((r:any)=>r.workspace!=='auth');
assert.equal(hash(current.centers),hash(initial.snapshot.centers),'Recording changed center business state');
// Authentication activity may create account/session records and login audits; farm business rows must be intact.
assert.equal(hash(currentBusiness),hash(initialBusiness),'Recording changed business records');
const result={at:new Date().toISOString(),sources,filming:{database:preparation.filmingDatabase,centers:current.centers.length,registeredFields:current.centers.reduce((n,c)=>n+(c.state as any).fields.length,0),tasks:current.centers.reduce((n,c)=>n+(c.state as any).missions.length,0),outbox:current.outbox.length,aiCalls:current.calls.length,businessUnchanged:true},paidCallsThisPreparation:0};
await writeFile(resolve(folder,'preservation-final.json'),JSON.stringify(result,null,2));
assert(sources.every(s=>s.unchanged),'A source DB changed since the preparation snapshot; inspect before filming');
console.log(JSON.stringify(result));
