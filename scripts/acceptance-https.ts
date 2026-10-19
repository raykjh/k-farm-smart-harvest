// Local TLS/reverse-proxy verification only. Never binds externally, reads a
// provider key, or uses the operating DB. The certificate is private test data.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer as httpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {acceptanceDatabaseUrl} from './disposable-test-db';

const run=process.argv.find(v=>v.startsWith('--run='))?.slice(6),openssl=process.argv.find(v=>v.startsWith('--openssl='))?.slice(10)??'openssl';
assert(run&&/^[a-z0-9-]{1,50}$/.test(run),'Explicit unique --run required');
const backendPort=Number(process.argv.find(v=>v.startsWith('--backend-port='))?.slice(15)??3100);
const database=process.argv.find(v=>v.startsWith('--db='))?.slice(5)??'kfarm_centers_e2e';
assert([3100,3101].includes(backendPort),'Only the two local test backend ports are permitted');
const databaseUrl=acceptanceDatabaseUrl(database);
async function vacant(port:number){const s=tcpServer();await new Promise<void>((ok,fail)=>{s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(e=>e?fail(e):ok()))})}
await vacant(backendPort);await vacant(3443);
const parent=resolve('.data/https-acceptance'),folder=resolve(parent,run);await mkdir(parent,{recursive:true});await mkdir(folder);
const cert=resolve(folder,'certificate.pem'),key=resolve(folder,'private-key.pem');
execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
const origin='https://127.0.0.1:3443';
const env={...process.env,KFARM_APP_ORIGIN:origin,DATABASE_URL:databaseUrl,SOLVER_URL:'http://127.0.0.1:8101',AI_MODE:'demo',AI_CALL_SCOPE:'decisions',AI_BUDGET_DATABASE_URL:'',NEBIUS_API_KEY:'',KMA_SERVICE_KEY:'',VWORLD_API_KEY:'',TAVILY_API_KEY:'',KFARM_PRODUCTION_WORKER:'0',KFARM_LABOR_WORKER:'0',KFARM_SMS_WORKER:'0'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(backendPort)],{env,stdio:'inherit',windowsHide:true});
const proxy=httpsServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
 if(req.headers.host!=='127.0.0.1:3443'){res.writeHead(403);res.end('Unexpected test host');return;}
 const upstream=httpRequest({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,connection:'close','x-forwarded-proto':'https'}},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res)});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local test backend unavailable')});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
proxy.listen(3443,'127.0.0.1',()=>console.log('Local HTTPS acceptance: '+origin+'; disposable DB; no provider calls.'));
proxy.on('error',()=>{child.kill();process.exitCode=1});
child.on('exit',code=>{proxy.close();process.exitCode=code??1});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{proxy.close();child.kill(signal)});
