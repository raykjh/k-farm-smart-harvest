import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
const url='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
const client=new PrismaClient({datasourceUrl:url});
const exists=await client.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname='kfarm_test'`;
if(!exists.length)await client.$executeRawUnsafe('CREATE DATABASE kfarm_test');
await client.$disconnect();
const r=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'inherit',env:{...process.env,DATABASE_URL:url+'_test'}});
process.exit(r.status??1);
