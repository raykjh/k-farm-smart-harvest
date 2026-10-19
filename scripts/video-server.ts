import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer as createHttpsServer} from 'node:https';
import {request} from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {fourCenterDatabaseUrl} from './disposable-test-db';

// Local TLS keeps the app's existing strict origin and secure-cookie policy intact.
const folder=resolve('.data/video-capture-20261018');
const preparation=JSON.parse(readFileSync(resolve(folder,'preparation.json'),'utf8'));
assert(preparation.complete&&preparation.filmingDatabase==='kfarm_centers_e2e_video_20261018');
const database=process.env.KFARM_VIDEO_DATABASE??preparation.filmingDatabase;
fourCenterDatabaseUrl(database);
const origin='https://127.0.0.1:3101',backendPort=3102;
const live=process.argv.includes('--live');
if(live){assert(process.env.NEBIUS_API_KEY,'Live filming requires the existing server-side key');assert(process.env.NEBIUS_MODEL==='nvidia/Nemotron-3_5-Lightning','Use the reviewed model only');}
const automatic=live&&!process.argv.includes('--controlled-ticks');
const env={...process.env,DATABASE_URL:fourCenterDatabaseUrl(database),
 AI_BUDGET_DATABASE_URL:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm',
 AI_MODE:live?'nebius':'demo',AI_CALL_SCOPE:'decisions',NEBIUS_API_KEY:live?process.env.NEBIUS_API_KEY:'',TAVILY_API_KEY:'',KMA_SERVICE_KEY:'',
 KFARM_APP_ORIGIN:origin,KFARM_PRODUCTION_WORKER:automatic?'1':'0',KFARM_PRODUCTION_AI:live?'1':'0',KFARM_LABOR_WORKER:'0',KFARM_SMS_WORKER:'0'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',process.argv.includes('--dev')?'dev':'start','--hostname','127.0.0.1','--port',String(backendPort)],{env,stdio:'inherit',windowsHide:true});
const proxy=createHttpsServer({key:readFileSync(resolve(folder,'tls/key.pem')),cert:readFileSync(resolve(folder,'tls/cert.pem'))},(req,res)=>{
 if(req.headers.host!=='127.0.0.1:3101'){res.writeHead(403).end('Recording origin only');return;}
 const forward=request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3101'}},up=>{res.writeHead(up.statusCode??502,up.headers);up.pipe(res);});
 forward.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Recording server starting');});req.pipe(forward);
});
proxy.listen(3101,'127.0.0.1',()=>{
 writeFileSync(resolve(folder,database===preparation.filmingDatabase?'server.json':'server-english.json'),JSON.stringify({pid:process.pid,webPid:child.pid,origin,backendPort,database,ai:live?'REVIEWED_NEBIUS_SHARED_LEDGER':'DISABLED_FOR_CAPTURE_TEST',automatic,outbound:'DISABLED',at:new Date().toISOString()},null,2));
 console.log('Recording-only server: '+origin+' (local self-signed TLS, no machine trust-store change)');
});
proxy.on('error',error=>{console.error(error.message);child.kill();process.exitCode=1;});
child.on('exit',code=>{proxy.close();process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{proxy.close();child.kill(signal);});
