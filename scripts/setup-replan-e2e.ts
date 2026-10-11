import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
const admin=new PrismaClient({datasourceUrl:base+'postgres'});
try{if(!(await admin.$queryRaw<any[]>`SELECT datname FROM pg_database WHERE datname='kfarm_replan_e2e'`).length)await admin.$executeRawUnsafe('CREATE DATABASE kfarm_replan_e2e');}finally{await admin.$disconnect()}
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'inherit',env:{...process.env,DATABASE_URL:base+'kfarm_replan_e2e'}});
process.exitCode=result.status??1;
