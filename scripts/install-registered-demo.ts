import {db} from '../lib/db';
import {insertRegisteredDemo} from '../lib/registered-demo-storage';
import {demoRemoval} from '../lib/demo-data';
import type {State} from '../lib/types';
import type {Prisma} from '@prisma/client';
try{
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-data'))`;
  const rows=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
  const old=rows[0]?.state;if(!old||!demoRemoval(old).safe)throw Error('Mixed or missing data; not replaced');
  await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','removedDemo',${crypto.randomUUID()},1,${JSON.stringify(old)}::jsonb)`;
  const state=await insertRegisteredDemo(tx);
  await tx.center.update({where:{id:'demo'},data:{state:state as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  await tx.outbox.updateMany({where:{centerId:'demo',status:{in:['PENDING','FAILED']}},data:{status:'SUPERSEDED'}});
  await tx.audit.create({data:{centerId:'demo',action:'demo.registered30.install',detail:{fields:30,tasks:state.missions.length,machines:state.machines.length}}});
  console.log(JSON.stringify({fields:30,farmers:30,tasks:state.missions.length,machines:state.machines.length,completed:state.missions.filter(m=>m.status==='COMPLETED').length}));
 },{timeout:20000});
}finally{await db.$disconnect()}
