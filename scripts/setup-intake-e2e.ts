import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import {registeredDemo} from '../tests/registered-demo-fixture';
import {serviceRegions} from '../lib/service-regions';
// Dedicated disposable DB only; never selected from a caller-provided URL.
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
const name='kfarm_intake_e2e';
const admin=new PrismaClient({datasourceUrl:base+'postgres'});
try{
 const rows=await admin.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname=${name}`;
 if(!rows.length)await admin.$executeRawUnsafe('CREATE DATABASE kfarm_intake_e2e');
}finally{await admin.$disconnect()}
const schema=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'inherit',env:{...process.env,DATABASE_URL:base+name}});
if(schema.status!==0)process.exit(1);
const test=new PrismaClient({datasourceUrl:base+name});
try{
 if(await test.center.count()||await test.workRecord.count())throw Error('Existing verification DB retained. Use the explicit test fixture reset, not this setup script.');
 const s=registeredDemo().state;s.fields=[];s.missions=[];s.events=[];s.revisions=[];
 await test.center.create({data:{id:'demo',state:s as any}});
 await test.workRecord.create({data:{workspace:'shared',kind:'serviceRegionScope',id:'jangsu-four-myeon',payload:{regions:serviceRegions,status:'PROPOSED'}}});
 console.log('Created kfarm_intake_e2e. Operating DB unchanged. Run with AI_MODE=demo and KFARM_PRODUCTION_WORKER=0.');
}finally{await test.$disconnect()}
