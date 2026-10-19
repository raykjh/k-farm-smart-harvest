import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fourCenterDatabaseUrl,localTestDatabaseBase} from './disposable-test-db';
const database=process.env.KFARM_FOUR_CENTER_DATABASE??'';
if(!/^kfarm_centers_e2e_role_(offline|live)_20261018[a-z]$/.test(database))throw Error('Dedicated post-submission verification DB required');
const live=process.argv.includes('--live');
if(live!==database.includes('_live_'))throw Error('Mode and isolated database must match');
if(live&&!process.env.NEBIUS_API_KEY)throw Error('Existing API key required');
const protection=JSON.parse(await readFile('.data/verification/post-submission-20261018/protection-before.json','utf8'));
const ceiling=protection.approval.ceilingMicroUsd;
if(ceiling!==4171458)throw Error('Keep the original $0.50 slice, including prior calls');
const env={...process.env,DATABASE_URL:fourCenterDatabaseUrl(database),AI_BUDGET_DATABASE_URL:localTestDatabaseBase+'kfarm',
 AI_MODE:live?'nebius':'demo',AI_CALL_SCOPE:'decisions',NEBIUS_API_KEY:live?process.env.NEBIUS_API_KEY:'',KFARM_AI_RESERVATION_CEILING_MICRO_USD:String(ceiling),
 KMA_SERVICE_KEY:'',VWORLD_API_KEY:'',TAVILY_API_KEY:'',KFARM_APP_ORIGIN:'',KFARM_PRODUCTION_WORKER:'0',KFARM_PRODUCTION_AI:'0',KFARM_LABOR_WORKER:'0',KFARM_SMS_WORKER:'0'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env,stdio:'inherit',windowsHide:true});
console.log(JSON.stringify({database,ai:live?'NEBIUS':'DISABLED',workers:false,externalDelivery:false,webPid:child.pid,reservationCeilingMicroUsd:ceiling}));
child.on('exit',code=>{process.exitCode=code??1});for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>child.kill(signal));
