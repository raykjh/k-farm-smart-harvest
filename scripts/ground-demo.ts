import {db} from '../lib/db';
import {annualMissions} from '../lib/seed';
import {solve,snapshot} from '../lib/scheduler';
import {weatherBlocked} from '../lib/weather';
import {replan} from '../lib/service';
import {randomUUID} from 'node:crypto';
import type {State} from '../lib/types';
// Explicit local demo upgrade. Archive old state and notices; never delete history.
if(process.env.DATABASE_URL&&!process.env.DATABASE_URL.endsWith('127.0.0.1:55432/kfarm'))throw new Error('Local demo only');
const row=await db.center.findUniqueOrThrow({where:{id:'demo'}});const old=row.state as unknown as State;
if(old.ruleVersion==='DEMO_WEATHER_2'){console.log('Ground scenario already prepared.');await db.$disconnect();process.exit(0)}
const s=structuredClone(old);s.events=[];s.revisions=[];s.ruleVersion='DEMO_WEATHER_2';s.missions=annualMissions(s);
const calculated=await solve(s);if(!calculated.feasible)throw new Error('Baseline infeasible');
for(const d of calculated.diff)s.missions.find(m=>m.id===d.missionId)!.start=d.after;
s.planVersion=old.planVersion+1;s.events=[{id:'wind-ground-demo',start:0,end:32,windMs:9,source:'DEMO_ASSUMPTION'}];
for(const m of s.missions)if(m.resourceId&&weatherBlocked(s,m))m.status='HELD';
await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Center" WHERE id='demo' FOR UPDATE`;
 const latest=await tx.center.findUniqueOrThrow({where:{id:'demo'}});if(snapshot(latest.state as unknown as State)!==snapshot(old))throw new Error('State changed; upgrade aborted');
 await tx.audit.create({data:{centerId:'demo',action:'ARCHIVE_BEFORE_GROUND_DEMO',detail:{previousState:row.state,reason:'User requested drone delay / ground continuation comparison'}}});
 await tx.outbox.updateMany({where:{centerId:'demo'},data:{status:'SUPERSEDED'}});
 await tx.center.update({where:{id:'demo'},data:{state:s,version:{increment:1}}});
});
await replan(randomUUID());console.log('Ground comparison ready; previous state archived; batch approval pending.');await db.$disconnect();
