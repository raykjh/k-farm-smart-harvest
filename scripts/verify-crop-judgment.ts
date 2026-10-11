// One explicit diagnostic call. Only numeric candidate facts and tool arguments
// are retained; never persist credentials, people, reasoning text or model prose.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {db} from '../lib/db';
import {adviseOperatingCrop,cropPriorities,type OperatingCropFacts,type CropPriority} from '../lib/operating-crop-adviser';
import {VALIDATION_BUDGET_ID,VALIDATION_MICRO_USD} from '../lib/ai-budget';
const live=process.argv.includes('--live');
const run=process.argv.find(a=>a.startsWith('--run='))?.slice(6);
const priority=(process.argv.find(a=>a.startsWith('--priority='))?.slice(11)??'MIN_LABOR') as CropPriority;
assert(cropPriorities.includes(priority),'Unsupported priority');
const reverseBody=process.argv.includes('--reverse-body'),reverseSchema=process.argv.includes('--reverse-schema');
assert(!(reverseBody&&reverseSchema),'Change candidate-body order and schema order separately');
assert(run&&/^[a-z0-9-]{1,60}$/.test(run),'Explicit unique run name required');
assert.equal(process.env.DATABASE_URL,'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm');
const folder='.data/validation/20261011-submission-run';
await mkdir(folder,{recursive:true});await writeFile(`${folder}/${run}.started`,new Date().toISOString(),{flag:'wx'});
const fixtureDb=new PrismaClient({datasourceUrl:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e'});
const report:any={at:new Date().toISOString(),run,live,automaticRetries:0,actualSms:false,equipmentCommands:false,reverseBody,reverseSchema};
const before=await db.aiCall.count(),realFetch=globalThis.fetch;
try{
 const row=await fixtureDb.workRecord.findFirstOrThrow({where:{workspace:'sandbox',kind:'continuousProduction',id:'current'}});
 const item=(row.payload as any).items[0];
 const facts=item.candidateFacts as OperatingCropFacts[];assert.equal(facts.length,2);
 report.facts=facts;report.priority=priority;
 report.baseline=await adviseOperatingCrop(facts,false,priority);
 if(live){
  assert.equal(process.env.AI_MODE,'nebius');assert(process.env.NEBIUS_API_KEY);
  const budget=await db.aiBudget.findUniqueOrThrow({where:{id:VALIDATION_BUDGET_ID}});assert(budget.total+10000<=VALIDATION_MICRO_USD);
  globalThis.fetch=async(input,init)=>{
   // Diagnostic-only order perturbations. Business facts and the production
   // validator are unchanged; vary exactly one wire representation at a time.
   const request=JSON.parse(String(init?.body));
   if(reverseBody){const user=request.messages.find((m:any)=>m.role==='user');const payload=JSON.parse(user.content);payload.candidates.reverse();user.content=JSON.stringify(payload);}
   if(reverseSchema){
    const schema=request.tools[0].function.parameters.properties;
    for(const field of [schema.candidateId,schema.evidence.items.properties.candidateId,schema.rejections.items.properties.candidateId])field.enum.reverse();
   }
   const response=await realFetch(input,{...init,body:JSON.stringify(request)});
   if(response.ok){const p=await response.clone().json();report.provider={usage:p.usage,finishReason:p.choices?.[0]?.finish_reason,toolCalls:p.choices?.[0]?.message?.tool_calls};}
   return response;};
  report.decision=await adviseOperatingCrop(facts,true,priority);
  assert.equal(report.decision.source,'NEBIUS');
  assert.equal(report.decision.candidateId,report.baseline.candidateId);
 }
 report.status='PASS';
}catch(e){report.status='OPERATOR_REVIEW';report.error=e instanceof Error?e.message:String(e);process.exitCode=1;}
finally{
 globalThis.fetch=realFetch;report.paidCalls=await db.aiCall.count()-before;assert(report.paidCalls<=(live?1:0));
 report.latestCall=live?await db.aiCall.findFirst({orderBy:{createdAt:'desc'}}):undefined;
 await writeFile(`${folder}/${run}.json`,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify(report,null,2));await fixtureDb.$disconnect();await db.$disconnect();
}
