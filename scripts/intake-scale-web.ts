import {spawn} from 'node:child_process';
import {fourCenterDatabaseUrl} from './disposable-test-db';
// Isolated review server. No automatic inference or outbound integrations.
const live=process.argv.includes('--live');
const maps=process.argv.includes('--maps');
if(live&&(!process.env.NEBIUS_API_KEY||process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'))throw Error('Existing credential and shared ledger required');
const env={...process.env,DATABASE_URL:fourCenterDatabaseUrl('kfarm_centers_e2e_scale_20261017'),AI_BUDGET_DATABASE_URL:live?process.env.DATABASE_URL:'',AI_MODE:live?'nebius':'demo',AI_CALL_SCOPE:'decisions',NEBIUS_API_KEY:live?process.env.NEBIUS_API_KEY:'',KMA_SERVICE_KEY:'',VWORLD_API_KEY:maps?process.env.VWORLD_API_KEY:'',TAVILY_API_KEY:'',KFARM_APP_ORIGIN:'',KFARM_PRODUCTION_WORKER:'0',KFARM_PRODUCTION_AI:'0',KFARM_LABOR_WORKER:'0',KFARM_SMS_WORKER:'0'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1});for(const sig of ['SIGINT','SIGTERM'] as const)process.on(sig,()=>child.kill(sig));
