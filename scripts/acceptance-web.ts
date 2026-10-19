import {spawn} from 'node:child_process';
import {acceptanceDatabaseUrl} from './disposable-test-db';

// This runner never changes .env files or initializes a database. E2E fixtures
// separately verify the exact disposable DB before creating synthetic inputs.
const database=process.argv.find(a=>a.startsWith('--database='))?.slice(11);
const databaseUrl=acceptanceDatabaseUrl(database);
const live=process.argv.includes('--live-decisions');
if(live&&(database!=='kfarm_centers_e2e'||process.env.AI_MODE!=='nebius'||!process.env.NEBIUS_API_KEY||process.env.DATABASE_URL!=='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'))throw Error('Live acceptance needs the existing key and operating cost ledger; business DB must be disposable');
const env={...process.env,KFARM_APP_ORIGIN:'',DATABASE_URL:databaseUrl,
 AI_MODE:live?'nebius':'demo',AI_CALL_SCOPE:'decisions',AI_BUDGET_DATABASE_URL:live?process.env.DATABASE_URL:'',NEBIUS_API_KEY:live?process.env.NEBIUS_API_KEY:'',KMA_SERVICE_KEY:'',VWORLD_API_KEY:'',TAVILY_API_KEY:'',KFARM_PRODUCTION_WORKER:'0',KFARM_LABOR_WORKER:'0',KFARM_SMS_WORKER:'0'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>child.kill(signal));
