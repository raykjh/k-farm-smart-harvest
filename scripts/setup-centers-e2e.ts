import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import {fourCenterDatabase,fourCenterDatabaseUrl,localTestDatabaseBase} from './disposable-test-db';
const database=fourCenterDatabase(process.argv.find(a=>a.startsWith('--database='))?.slice(11));
const admin=new PrismaClient({datasourceUrl:localTestDatabaseBase+'postgres'});
try{
 const rows=await admin.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname=${database}`;
 if(rows.length&&process.argv.includes('--fresh'))throw Error('Test database already exists; choose a new name. No schema or records changed.');
 // The identifier has passed the strict fixed-prefix, lowercase-name check.
 if(!rows.length)await admin.$executeRawUnsafe('CREATE DATABASE '+database);
}finally{await admin.$disconnect()}
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'inherit',env:{...process.env,DATABASE_URL:fourCenterDatabaseUrl(database)}});
if(result.status!==0)process.exit(1);
console.log('Dedicated four-center test schema ready: '+database+'; no operating records modified.');
