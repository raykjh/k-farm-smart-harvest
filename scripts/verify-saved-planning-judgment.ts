// One explicit replay of a saved disposable-DB comparison. Preserve tool
// arguments and computed facts, never credentials or hidden reasoning text.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {db} from '../lib/db';
import {recommendPlanningAlternative,PLANNING_MAX_TOKENS} from '../lib/planning-adviser';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';
const arg=(name:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const run=arg('run'),input=arg('input'),record=arg('record'),live=process.argv.includes('--live');
const folder='.data/validation/20261011-submission-run';
assert(run&&/^[a-z0-9-]{1,60}$/.test(run),'Unique run name required');
assert(!!input!==!!record,'Choose one saved report name or disposable comparison record');
assert(!input||/^[a-z0-9-]{1,60}$/.test(input),'Input must be a local report name');
assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');
assert(!process.env.AI_BUDGET_DATABASE_URL||process.env.AI_BUDGET_DATABASE_URL===process.env.DATABASE_URL);
await mkdir(folder,{recursive:true});
await writeFile(`${folder}/${run}.started`,new Date().toISOString(),{flag:'wx'});
const fixture=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e'});
const report:any={at:new Date().toISOString(),run,live,automaticRetries:0,maxCalls:live?1:0,maxTokens:PLANNING_MAX_TOKENS,
 scope:'Replay of a saved synthetic comparison, not a recreation of the original failed provider response. No business writes, SMS or equipment commands.'};
const realFetch=globalThis.fetch,before=await db.aiCall.count();
try{
 if(input){const prior=JSON.parse(await readFile(`${folder}/${input}.json`,'utf8'));report.comparison=prior.comparison;report.reason=prior.reason;report.inputReport=input;}
 else{const row=await fixture.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'planningDecision',id:record}});report.comparison=(row.payload as any).comparison;report.reason=report.comparison.results.find((r:any)=>r.previewRequest)?.previewRequest.reason??'';report.inputRecord={id:row.id,updatedAt:row.updatedAt};}
 assert(report.comparison.results.length>0,'Saved comparison required');
 report.inputHash=createHash('sha256').update(JSON.stringify([report.comparison,report.reason])).digest('hex');
 report.baseline=await recommendPlanningAlternative(report.comparison,report.reason,'RULES');
 if(live){
  assert.equal(process.env.AI_MODE,'nebius');assert(process.env.NEBIUS_API_KEY);
  const budget=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}});assert(budget.total+10000<=VALIDATION_MICRO_USD);
  globalThis.fetch=async(url,init)=>{const response=await realFetch(url,init);
   if(String(url).startsWith('https://api.tokenfactory.nebius.com/')){
    report.request=JSON.parse(String(init?.body));report.httpStatus=response.status;
    if(response.ok){const p=await response.clone().json();report.provider={usage:p.usage,finishReason:p.choices?.[0]?.finish_reason,toolCalls:p.choices?.[0]?.message?.tool_calls};}
   }return response;};
  report.decision=await recommendPlanningAlternative(report.comparison,report.reason);
  assert.equal(report.decision.source,'NEBIUS');assert.equal(report.decision.rationaleCheck.status,'VERIFIED');assert.equal(report.decision.priorityCheck.status,'ALIGNED');
 }
 report.status='PASS';
}catch(e){report.status='OPERATOR_REVIEW';report.error=e instanceof Error?e.message:String(e);process.exitCode=1;}
finally{
 globalThis.fetch=realFetch;report.paidCalls=await db.aiCall.count()-before;assert(report.paidCalls<=report.maxCalls);
 await writeFile(`${folder}/${run}.json`,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({run,status:report.status,error:report.error,paidCalls:report.paidCalls,provider:report.provider,decision:report.decision}));
 await fixture.$disconnect();await db.$disconnect();
}
