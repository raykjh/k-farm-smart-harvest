import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import {registeredDemo} from '../tests/registered-demo-fixture';
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
const name='kfarm_ui_e2e';
const admin=new PrismaClient({datasourceUrl:base+'postgres'});
try{const rows=await admin.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname=${name}`;if(!rows.length)await admin.$executeRawUnsafe('CREATE DATABASE kfarm_ui_e2e');}finally{await admin.$disconnect()}
const schema=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'inherit',env:{...process.env,DATABASE_URL:base+name}});if(schema.status!==0)process.exit(1);
// This dedicated UI test database is disposable; no operation touches kfarm.
const test=new PrismaClient({datasourceUrl:base+name});
try{
 await test.$transaction([test.outbox.deleteMany(),test.receipt.deleteMany(),test.audit.deleteMany(),test.workRecord.deleteMany(),test.center.deleteMany()]);
 const s=registeredDemo().state;s.fields=[];s.missions=[];s.events=[];s.revisions=[];
 await test.center.create({data:{id:'demo',state:s as any}});
 console.log('UI verification fixture ready: kfarm_ui_e2e; AI_MODE must remain demo');
}finally{await test.$disconnect()}
