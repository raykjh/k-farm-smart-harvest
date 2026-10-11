import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
const admin=new PrismaClient({datasourceUrl:base+'postgres'});
try{const rows=await admin.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname='kfarm_centers_e2e'`;if(!rows.length)await admin.$executeRawUnsafe('CREATE DATABASE kfarm_centers_e2e');}finally{await admin.$disconnect()}
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'inherit',env:{...process.env,DATABASE_URL:base+'kfarm_centers_e2e'}});
if(result.status!==0)process.exit(1);
console.log('Dedicated four-center test schema ready; no operating records modified.');
