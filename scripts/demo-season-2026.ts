import {db} from '../lib/db';
import {demoSeason2026} from '../lib/demo-season';
import type {State} from '../lib/types';
import {Prisma} from '@prisma/client';
await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Center" WHERE id='demo' FOR UPDATE`;
 const row=await tx.center.findUniqueOrThrow({where:{id:'demo'}});const old=row.state as unknown as State;
 if(!old.fields.every(f=>f.source==='DEMO_ASSUMPTION'))throw Error('Mixed fields: migration blocked');
 await tx.$executeRaw`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload") VALUES ('sandbox','seasonBackup',${crypto.randomUUID()},1,${JSON.stringify(old)}::jsonb)`;
 const state=demoSeason2026(old);
 await tx.center.update({where:{id:'demo'},data:{state:state as unknown as Prisma.InputJsonValue,version:{increment:1}}});
 await tx.audit.create({data:{centerId:'demo',action:'demo.season2026',detail:{missions:state.missions.length,completed:state.missions.filter(m=>m.status==='COMPLETED').length}}});
 console.log(JSON.stringify({missions:state.missions.length,completed:state.missions.filter(m=>m.status==='COMPLETED').length,remaining:state.missions.filter(m=>m.status!=='COMPLETED').length}));
});
await db.$disconnect();
