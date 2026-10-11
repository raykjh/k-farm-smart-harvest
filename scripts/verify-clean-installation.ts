// Verifies a source-only installation. Never reuses, resets or deletes a DB.
// Run from a clean export, not the operating checkout. No credentials in output.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {PrismaClient} from '@prisma/client';

const runId=process.argv.find(a=>a.startsWith('--run='))?.slice(6);
assert(runId&&/^[a-z0-9_]{1,30}$/.test(runId),'A unique alphanumeric --run is required');
const database='kfarm_install_e2e_'+runId;
const base='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/';
const reportPath='.data/validation/clean-install-'+runId+'.json';
const held=['lib/demo-parcels.json','data/capacity/four-center-cadastre-2026-10-03.json','data/capacity/four-center-study-2026.json'];
assert(held.every(p=>!existsSync(p))&&!existsSync('.env')&&!existsSync('.env.local'),'Run only from a source-only export without private data or environment files');
assert(!existsSync(reportPath),'Evidence already exists; use a new run ID');
assert(existsSync('.next/BUILD_ID'),'Build the clean source before this verification');
const portCheck=createServer();
await new Promise<void>((resolve,reject)=>{portCheck.once('error',reject);portCheck.listen(3100,'127.0.0.1',()=>portCheck.close(error=>error?reject(error):resolve()))});
const env={...process.env,KFARM_APP_ORIGIN:'',DATABASE_URL:base+database,AI_MODE:'demo',NEBIUS_API_KEY:'',AI_BUDGET_DATABASE_URL:'',KMA_SERVICE_KEY:'',VWORLD_API_KEY:'',TAVILY_API_KEY:'',KFARM_PROVIDER_DATA_DIR:'',KFARM_PRODUCTION_WORKER:'0'};
const admin=new PrismaClient({datasourceUrl:base+'postgres'});
try{
 const existing=await admin.$queryRawUnsafe<{datname:string}[]>('SELECT datname FROM pg_database WHERE datname=$1',database);
 assert(existing.length===0,'Verification database already exists; no reset performed');
 // The identifier contains only the fixed prefix and validated characters.
 await admin.$executeRawUnsafe('CREATE DATABASE '+database);
}finally{await admin.$disconnect()}
const command=(args:string[])=>{
 const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true,timeout:60000});
 assert(result.status===0,'Installation step failed: '+args[0]);return result.stdout;
};
command(['node_modules/prisma/build/index.js','db','push','--skip-generate']);
const initialized=JSON.parse(command(['--import','tsx','scripts/initialize-centers.ts','--apply']));
assert(initialized.applied&&initialized.missing.length===4&&initialized.resourcesCreated===0&&initialized.accountsCreated===0);
const db=new PrismaClient({datasourceUrl:base+database});
let child:ReturnType<typeof spawn>|undefined;
try{
 const before=await db.center.findMany({orderBy:{id:'asc'}});
 assert(before.length===4&&before.every(c=>(c.state as any).fields.length===0&&(c.state as any).missions.length===0));
 assert(await db.workRecord.count()===0);
 const bootstrap=command(['--import','tsx','scripts/auth-bootstrap.ts']);
 const token=/\/login#setup=([a-f0-9]{64})/.exec(bootstrap)?.[1];assert(token);
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env,stdio:'ignore',windowsHide:true});
 let ready=false;
 for(let i=0;i<60;i++){
  assert(child.exitCode===null,'Verification server stopped before readiness');
  try{const response=await fetch('http://127.0.0.1:3100/api/auth',{signal:AbortSignal.timeout(2000)});if(response.status===200){ready=true;break}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert(ready,'Verification server not ready');
 const api=(body:unknown,cookie='')=>fetch('http://127.0.0.1:3100/api/auth',{method:'POST',headers:{origin:'http://127.0.0.1:3100','content-type':'application/json',cookie},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const account={username:'clean-install',name:'Synthetic installation administrator',password:'Aa9!'+randomBytes(18).toString('hex')};
 const setup=await api({action:'setup',token,account});assert(setup.status===200,'Initial account setup failed');
 const cookie=setup.headers.get('set-cookie')?.split(';')[0];assert(cookie);
 assert((await setup.json()).user.role==='SUPER_ADMIN');
 assert(await db.workRecord.count({where:{workspace:'auth',kind:'user'}})===1);
 assert(await db.workRecord.count({where:{workspace:'auth',kind:'bootstrap'}})===0);
 assert((await api({action:'setup',token,account})).status===400,'One-time token was reusable');
 assert((await fetch('http://127.0.0.1:3100/api/accounts',{headers:{cookie}})).status===200);
 assert((await api({action:'logout'},cookie)).status===200);
 assert((await fetch('http://127.0.0.1:3100/api/accounts',{headers:{cookie}})).status===401);
 assert((await api({action:'login',username:account.username,password:account.password,remember:false})).status===200);
 assert(await db.aiCall.count()===0);
 assert(await db.outbox.count()===0);
 const after=await db.center.findMany({orderBy:{id:'asc'}});assert(JSON.stringify(before)===JSON.stringify(after));
 const report={at:new Date().toISOString(),database,freshDatabase:true,providerFilesAbsent:true,actualEnvFilesAbsent:true,schemaInstalled:true,emptyCenters:4,fictionalFarmersSeeded:0,bootstrapThroughBusinessApi:true,bootstrapOneUse:true,authenticatedAccountsView:true,logoutAndLogin:true,businessCentersUnchanged:true,paidCalls:0,sms:0,hardwareCommands:false};
 await mkdir('.data/validation',{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify(report));
}finally{
 if(child&&child.exitCode===null){const stopped=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await stopped;}
 await db.$disconnect();
}
