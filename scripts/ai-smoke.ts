// Run with: node --env-file=.env --env-file=.env.local --import tsx scripts/ai-smoke.ts
import {budgetedCompletion,APPROVED_MODEL} from '../lib/ai-budget';
import {db} from '../lib/db';
try {
 const result=await budgetedCompletion({model:APPROVED_MODEL,messages:[{role:'user',content:'Reply with OK only.'}],max_tokens:64,reasoning_effort:'none',temperature:0},'connection-check');
 const success=result.choices?.[0]?.finish_reason!=='length'&&result.choices?.[0]?.message?.content?.trim()==='OK';
 console.log(JSON.stringify({success,model:result.model,usage:result.usage??null}));
 if(!success)process.exitCode=1;
}catch(e){console.error(e instanceof Error?e.message:'AI smoke failed');process.exitCode=1;}
finally{await db.$disconnect();}
