import {db} from '../lib/db';
import {judgeLoginDefaults} from '../lib/judge-access';
import {judgeAccessConfig} from '../lib/judge-access-config';
import {assertJudgeAiLedgerReady,PRICE_REVIEW_EXPIRES_AT} from '../lib/ai-budget';

// Read-only: never provisions accounts, changes a ledger, calls a model, or starts workers.
try{
 if(!judgeAccessConfig())throw Error('Judge access is not configured.');
 const checks:{name:string;ready:boolean}[]=[];
 checks.push({name:'public-account-and-prefill',ready:!!await judgeLoginDefaults()});
 checks.push({name:'live-model-configured',ready:process.env.AI_MODE==='nebius'&&!!process.env.NEBIUS_API_KEY});
 checks.push({name:'price-review-current',ready:Date.now()<Date.parse(PRICE_REVIEW_EXPIRES_AT)});
 try{await assertJudgeAiLedgerReady();checks.push({name:'existing-approved-ai-ledger',ready:true})}catch{checks.push({name:'existing-approved-ai-ledger',ready:false})}
 checks.push({name:'automatic-planning-enabled',ready:process.env.KFARM_PRODUCTION_WORKER==='1'&&process.env.KFARM_PRODUCTION_AI==='1'});
 checks.push({name:'automatic-labor-enabled',ready:process.env.KFARM_LABOR_WORKER==='1'});
 const ready=checks.every(c=>c.ready);console.log(JSON.stringify({status:ready?'CONFIGURATION_READY_NOT_RUNTIME_PROOF':'NOT_READY',checks,paidCalls:0,dataChanged:false}));if(!ready)process.exitCode=1;
}catch{console.error('Judge readiness check failed. Check isolated DB connectivity and deployment settings; no data was changed.');process.exitCode=1}
finally{await db.$disconnect();const g=globalThis as unknown as {aiLedger?:{client:{$disconnect():Promise<void>}}};await g.aiLedger?.client.$disconnect()}
