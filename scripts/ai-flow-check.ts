// Read-only operational verification; only the AI budget ledger is updated.
import assert from 'node:assert/strict';
import {db} from '../lib/db';
import {propose} from '../lib/ai';
import {jobs,validate} from '../lib/scheduler';
import type {State} from '../lib/types';
import {verifiedSummary} from '../lib/ai-facts';
try{
 const before=await db.center.findUniqueOrThrow({where:{id:'demo'}});
 const outboxBefore=await db.outbox.count();
 const s=structuredClone(before.state) as unknown as State;
 assert(s.events.length>0,'Strong-wind scenario required');
 process.env.AI_MODE='nebius';
 const result=await propose(s);
 assert.equal(result.source,'NEBIUS');assert(result.feasible);
 assert(result.trace.some(t=>t.tool==='inspect_impact'));
 assert(result.trace.some(t=>t.tool==='solve_schedule'));
 assert(result.summary.trim().length>0,'Missing final explanation');
 assert.equal(result.summary,verifiedSummary(s,result),'Explanation differs from verified facts');
 const proposed=jobs(s).map(m=>({...m,start:result.diff.find(d=>d.missionId===m.id)?.after??m.start}));
 validate(s,proposed);
 assert(!result.diff.some(d=>d.missionId==='B-2'),'Ground task changed');
 const after=await db.center.findUniqueOrThrow({where:{id:'demo'}});
 assert.deepEqual(after,before);assert.equal(await db.outbox.count(),outboxBefore);
 console.log(JSON.stringify({passed:true,source:result.source,changed:result.diff.length,groups:result.groups,trace:result.trace,summary:result.summary,centerUnchanged:true,outboxUnchanged:true,budget:await db.aiBudget.findUnique({where:{id:'nebius-primary'}})},null,2));
}catch(e){console.error(e instanceof Error?e.message:'Flow verification failed');process.exitCode=1;}
finally{await db.$disconnect();}
