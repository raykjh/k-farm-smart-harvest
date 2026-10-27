import {aiBudgetDb} from './ai-budget-ledger';
import {randomUUID} from 'node:crypto';

// Conservative reservation, NOT an invoice. Never refund unknown/failed requests.
// One account, one persistent ledger; do not reset when keys or processes change.
export const APPROVED_MODEL='nvidia/Nemotron-3_5-Lightning';
export const INPUT_USD_PER_MILLION=0.06;
export const OUTPUT_USD_PER_MILLION=0.24;
export const TOTAL_MICRO_USD=20_000_000; // Leave $5 of the verified $25 untouched.
export const DAILY_MICRO_USD=null; // Removed explicitly by the user on 2026-10-11.
export const MAX_REQUEST_RESERVATION_MICRO_USD=500_000; // User-approved per-call ceiling, 2026-10-20.
export const DEVELOPMENT_PRIMARY_CEILING_MICRO_USD=10_000_000;
export const MAX_PLANNING_OUTPUT_TOKENS=131_072;
export const JOINT_PLAN_OUTPUT_TOKENS=32_768;
export const PLANNING_REQUEST_TIMEOUT_MS=120_000;
// Rates rechecked on the official public model page on 2026-10-19 (not balance).
// https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference
// Bounded judging-period review, not a price/uptime guarantee or extra allowance.
export const PRICE_REVIEWED_AT='2026-10-19';
export const PRICE_REVIEW_EXPIRES_AT='2026-12-17T00:00:00Z';
export const VALIDATION_BUDGET_ID='nebius-decisions-20261004';
// User approved an additional $15 through submission, with no daily cap.
// Existing ledger already held $0.200000 at approval: preserve it, do not reset.
export const SUBMISSION_BASELINE_MICRO_USD=200_000;
export const SUBMISSION_ADDITIONAL_MICRO_USD=15_000_000;
export const VALIDATION_MICRO_USD=SUBMISSION_BASELINE_MICRO_USD+SUBMISSION_ADDITIONAL_MICRO_USD;
export type AiPurpose='schedule-decision'|'crop-decision'|'connection-check'|'request-diagnostic';
export type AiRequestProfile='production'|'planning'|'diagnostic';
export type AiUsage={callId:string;reservedMicroUsd:number;promptTokens?:number;completionTokens?:number;estimatedMicroUsd?:number};

// Count all historical account reservations toward the development threshold.
// Judging is an explicit server setting; no request body can select this phase.
// Both phases still obey the existing decision slice and lifetime allowance.
export function effectivePrimaryCeiling(){
 const phase=process.env.KFARM_AI_SPENDING_PHASE||'development';
 if(phase==='development')return Math.min(TOTAL_MICRO_USD,DEVELOPMENT_PRIMARY_CEILING_MICRO_USD);
 if(phase==='judging')return TOTAL_MICRO_USD;
 throw Error('Invalid AI spending phase');
}

// Optional server-side stop for a separately approved verification slice. It can
// only LOWER the existing persistent ceiling, never reset or enlarge an allowance.
export function effectiveValidationCeiling(){
 const raw=process.env.KFARM_AI_RESERVATION_CEILING_MICRO_USD;
 if(raw===undefined||raw==='')return VALIDATION_MICRO_USD;
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)throw Error('Invalid restricted AI reservation ceiling');
 return Math.min(VALIDATION_MICRO_USD,Number(raw));
}

export function validateRequest(body:Record<string,unknown>,profile:AiRequestProfile='production'){
 if(!['production','planning','diagnostic'].includes(profile))throw new Error('Unknown AI request profile');
 if(body.model!==APPROVED_MODEL)throw new Error('AI model not approved for this budget');
 const outputLimit=profile==='planning'?MAX_PLANNING_OUTPUT_TOKENS:profile==='diagnostic'?4096:1200;
 if(!Number.isInteger(body.max_tokens)||Number(body.max_tokens)<1||Number(body.max_tokens)>outputLimit)throw new Error('AI output limit exceeded');
 if(body.n!==undefined&&body.n!==1)throw new Error('Multiple AI completions are disabled');
 if(body.stream!==undefined&&body.stream!==false)throw new Error('Streaming is disabled for usage accounting');
 if(body.reasoning_effort!==undefined&&body.reasoning_effort!=='none'&&!(profile!=='production'&&body.reasoning_effort==='low'))throw new Error('Unreviewed reasoning budget');
 const allowed=['model','messages','tools','tool_choice','max_tokens','temperature','top_p','seed','n','stream','reasoning_effort'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))throw new Error('Unreviewed AI request parameter');
 const requestBytes=Buffer.byteLength(JSON.stringify(body),'utf8');
 if(requestBytes>16_000)throw new Error(`AI request exceeds conservative input budget (${requestBytes}/16000 bytes)`);
}

export function reservationMicroUsd(body:Record<string,unknown>,profile:AiRequestProfile='production'){
 validateRequest(body,profile);
 // UTF-8 bytes upper estimate + protocol allowance, 4x safety margin, $0.005 floor.
 return Math.max(5_000,Math.ceil(((Buffer.byteLength(JSON.stringify(body),'utf8')+2048)*INPUT_USD_PER_MILLION+Number(body.max_tokens)*OUTPUT_USD_PER_MILLION)*4));
}

export function usageEstimate(usage:unknown){
 const u=usage as {prompt_tokens?:number;completion_tokens?:number}|undefined;
 if(!u||!Number.isSafeInteger(u.prompt_tokens)||!Number.isSafeInteger(u.completion_tokens)||u.prompt_tokens!<0||u.completion_tokens!<0)return null;
 return {promptTokens:u.prompt_tokens!,completionTokens:u.completion_tokens!,estimatedMicroUsd:Math.ceil(u.prompt_tokens!*INPUT_USD_PER_MILLION+u.completion_tokens!*OUTPUT_USD_PER_MILLION)};
}

// A restored judge business DB must never silently become a fresh paid allowance.
// Explicit deployment approval is separate from merely enabling public login.
export async function assertJudgeAiLedgerReady(){
 let database='';try{database=decodeURIComponent(new URL(process.env.DATABASE_URL??'').pathname.slice(1))}catch{}
 if(!/^kfarm_judge(?:_|$)/.test(database)&&process.env.KFARM_JUDGE_ACCESS!=='1')return;
 if(process.env.KFARM_JUDGE_AI_APPROVED!=='1'||!process.env.AI_BUDGET_DATABASE_URL||!process.env.KFARM_AI_RESERVATION_CEILING_MICRO_USD)throw Error('Judge AI requires approved spending, the existing ledger and an explicit reservation ceiling.');
 const ceiling=effectiveValidationCeiling();
 const rows=await aiBudgetDb().aiBudget.findMany({where:{id:{in:['nebius-primary',VALIDATION_BUDGET_ID]}}});
 if(rows.length!==2||rows.some(r=>!Number.isSafeInteger(r.total)||r.total<0))throw Error('Existing AI ledger is missing or invalid; no fresh allowance was created.');
 if(rows.find(r=>r.id===VALIDATION_BUDGET_ID)!.total>=ceiling)throw Error('Approved judge AI allowance is exhausted.');
}

export async function reserveBudget(amount:number){
 if(!Number.isSafeInteger(amount)||amount<1||amount>MAX_REQUEST_RESERVATION_MICRO_USD)throw new Error('Invalid AI budget reservation');
 await assertJudgeAiLedgerReady();
 const ceiling=effectiveValidationCeiling();
 const primaryCeiling=effectivePrimaryCeiling();
 // Provisioned with the database schema, never auto-created/reset by a request.
 return aiBudgetDb().$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO "AiBudget" ("id","total","daily","day") VALUES ('nebius-primary',0,0,CURRENT_DATE) ON CONFLICT DO NOTHING`;
  const changed=await tx.$executeRaw`UPDATE "AiBudget" SET
   "total"="total"+${amount},
   "daily"=(CASE WHEN "day"=CURRENT_DATE THEN "daily" ELSE 0 END)+${amount},
   "day"=CURRENT_DATE
   WHERE "id"='nebius-primary' AND "total"+${amount}<=${primaryCeiling}`;
  if(changed!==1)throw new Error(`AI budget exhausted: $${(primaryCeiling/1e6).toFixed(2)} cumulative reservation ceiling reached; request blocked before network call`);
  await tx.$executeRaw`INSERT INTO "AiBudget" ("id","total","daily","day") VALUES (${VALIDATION_BUDGET_ID},0,0,CURRENT_DATE) ON CONFLICT DO NOTHING`;
  const validation=await tx.$executeRaw`UPDATE "AiBudget" SET "total"="total"+${amount},"daily"="daily"+${amount}
   WHERE "id"=${VALIDATION_BUDGET_ID} AND "total"+${amount}<=${ceiling}`;
  if(validation!==1)throw new Error(`AI validation budget exhausted: $${(ceiling/1e6).toFixed(2)} ceiling reached`);
 });
}

export async function budgetedCompletion(body:Record<string,unknown>,purpose?:AiPurpose){
 if(process.env.AI_MODE!=='nebius'||!process.env.NEBIUS_API_KEY)throw new Error('Live AI is disabled or API key is missing');
 if(process.env.AI_CALL_SCOPE==='decisions'&&!purpose)throw new Error('Only explicit AI decision calls are enabled');
 // Manual review expiry prevents using a stale price assumption indefinitely.
 if(Date.now()>Date.parse(PRICE_REVIEW_EXPIRES_AT))throw new Error('AI price review expired; live calls blocked');
 const profile:AiRequestProfile=purpose==='request-diagnostic'?'diagnostic':purpose==='schedule-decision'||purpose==='crop-decision'?'planning':'production';
 if(profile==='diagnostic'&&process.env.KFARM_AI_REQUEST_DIAGNOSTIC!=='1')throw new Error('AI request diagnostic is disabled');
 validateRequest(body,profile);
 const reserved=reservationMicroUsd(body,profile);
 await reserveBudget(reserved); // DB failure must fail closed, before any network activity.
 const db=aiBudgetDb();
 const id=randomUUID();
 await db.aiCall.create({data:{id,reservedMicroUsd:reserved,model:APPROVED_MODEL}});
 let response:Response;
 try{response=await fetch('https://api.tokenfactory.nebius.com/v1/chat/completions',{
  method:'POST',headers:{Authorization:`Bearer ${process.env.NEBIUS_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(profile==='planning'?PLANNING_REQUEST_TIMEOUT_MS:45000),redirect:'error',
 });}catch{throw new Error('Nebius connection failed; reserved budget retained. No automatic retry.');}
 if(!response.ok){await db.aiCall.update({where:{id},data:{status:`HTTP_${response.status}`}});throw new Error(`Nebius request failed (${response.status}); reserved budget retained`);}
 const payload=await response.json();
 const estimate=usageEstimate(payload.usage);
 await db.aiCall.update({where:{id},data:{status:estimate?'USAGE_RECORDED':'USAGE_UNKNOWN',...(estimate??{})}});
 return {...payload,kfarmUsage:{callId:id,reservedMicroUsd:reserved,...(estimate??{})} satisfies AiUsage};
}
