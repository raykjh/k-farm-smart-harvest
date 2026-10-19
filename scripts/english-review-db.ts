import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {fourCenterDatabaseUrl,localTestDatabaseBase} from './disposable-test-db';
const filming=process.argv.includes('--filming');
const target=filming?'kfarm_centers_e2e_enfilm_20261018':'kfarm_centers_e2e_english_20261018';
const admin=new PrismaClient({datasourceUrl:localTestDatabaseBase+'postgres'});
const db=new PrismaClient({datasourceUrl:fourCenterDatabaseUrl(target)});
try {
 const exists=await admin.$queryRaw<Array<{datname:string}>>`SELECT datname FROM pg_database WHERE datname=${target}`;
 assert.equal(exists.length,0,'English review DB already exists; do not reset');
 const sourceFile=filming?'.data/video-capture-20261018/backups/filming-initial.json':'.data/video-capture-20261018/full-take-01/final-filming-snapshot.json';
 const source=JSON.parse(await readFile(sourceFile,'utf8'));
 const data=source.snapshot??source;
 assert(data.centers?.length===4&&data.records?.length>0,'Unexpected source snapshot');
 await admin.$executeRawUnsafe(`CREATE DATABASE "${target}"`);
 const p=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:fourCenterDatabaseUrl(target)},encoding:'utf8',windowsHide:true});
 assert.equal(p.status,0,'Schema preparation failed');
 for(const [model,key] of [['center','centers'],['workRecord','records'],['outbox','outbox'],['receipt','receipts'],['audit','audit']]) {
  for(let i=0;i<data[key].length;i+=100)await (db as any)[model].createMany({data:data[key].slice(i,i+100)});
 }
 await mkdir('.data/english-review-20261018',{recursive:true});
 await writeFile('.data/english-review-20261018/'+(filming?'filming-preparation.json':'preparation.json'),JSON.stringify({target,source:sourceFile,at:new Date().toISOString(),sourceModified:false,aiCalls:0,centers:await db.center.count(),records:await db.workRecord.count()},null,2),{flag:'wx'});
 console.log('Isolated English review DB prepared; no source writes or AI calls.');
} finally {await db.$disconnect();await admin.$disconnect();}
