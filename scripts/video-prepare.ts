import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Prisma,PrismaClient} from '@prisma/client';
import {fourCenterDatabaseUrl,localTestDatabaseBase} from './disposable-test-db';

// Recording preparation only. Sources are read-only and existing DBs are never reset.
export const filmingDatabase='kfarm_centers_e2e_video_20261018';
export const filmingFolder=resolve('.data/video-capture-20261018');
const sourceNames=['kfarm','kfarm_centers_e2e_scale_20261017'] as const;
const restoredNames=['kfarm_centers_e2e_vbak_o_20261018','kfarm_centers_e2e_vbak_s_20261018'];
const canonical=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const json=(v:any)=>JSON.parse(JSON.stringify(v));
async function snapshot(client:PrismaClient){return client.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 return {centers:await tx.center.findMany({orderBy:{id:'asc'}}),records:await tx.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),outbox:await tx.outbox.findMany({orderBy:{id:'asc'}}),receipts:await tx.receipt.findMany({orderBy:{id:'asc'}}),audit:await tx.audit.findMany({orderBy:{id:'asc'}}),budgets:await tx.aiBudget.findMany({orderBy:{id:'asc'}}),calls:await tx.aiCall.findMany({orderBy:{id:'asc'}})};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});}
function counts(s:any){return {tables:Object.fromEntries(Object.entries(s).map(([k,v])=>[k,(v as any[]).length])),inventory:s.records.filter((r:any)=>r.kind==='fields'&&r.id==='current').reduce((n:number,r:any)=>n+(Array.isArray(r.payload)?r.payload.length:0),0),plannedFields:s.centers.reduce((n:number,c:any)=>n+c.state.fields.length,0),missions:s.centers.reduce((n:number,c:any)=>n+c.state.missions.length,0),cultivations:s.records.filter((r:any)=>r.kind==='cultivation').length};}
const admin=new PrismaClient({datasourceUrl:localTestDatabaseBase+'postgres'});
const clients=sourceNames.map(name=>new PrismaClient({datasourceUrl:localTestDatabaseBase+name}));
const evidence:any={version:'KFARM_VIDEO_PREPARATION_V1',at:new Date().toISOString(),filmingDatabase,folder:filmingFolder,sources:[],outboundMessages:0,modelCalls:0};
async function fresh(name:string){
 const url=fourCenterDatabaseUrl(name);assert.notEqual(name,sourceNames[1]);
 const exists=await admin.$queryRaw<Array<{datname:string}>>`SELECT datname FROM pg_database WHERE datname=${name}`;
 assert.equal(exists.length,0,'Destination already exists; no overwrite or reset');
 await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
 const p=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url},encoding:'utf8',windowsHide:true});
 assert.equal(p.status,0,'New DB schema initialization failed; source DBs unchanged');
 return new PrismaClient({datasourceUrl:url});
}
async function restore(client:PrismaClient,s:any){
 const tables=[
  ['Center','centers','id text,version int,state jsonb,"updatedAt" timestamp(3)','id,version,state,"updatedAt"'],
  ['WorkRecord','records','workspace text,kind text,id text,version int,payload jsonb,"updatedAt" timestamp(3)','workspace,kind,id,version,payload,"updatedAt"'],
  ['Outbox','outbox','id text,"centerId" text,"farmerId" text,"planVersion" int,body text,status text,acknowledgement text,attempts int,"availableAt" timestamp(3),"sentAt" timestamp(3),"createdAt" timestamp(3)','id,"centerId","farmerId","planVersion",body,status,acknowledgement,attempts,"availableAt","sentAt","createdAt"'],
  ['Receipt','receipts','id text,operation text,result jsonb,"createdAt" timestamp(3)','id,operation,result,"createdAt"'],
  ['Audit','audit','id text,"centerId" text,action text,detail jsonb,"createdAt" timestamp(3)','id,"centerId",action,detail,"createdAt"'],
  ['AiBudget','budgets','id text,total int,daily int,day date','id,total,daily,day'],
  ['AiCall','calls','id text,model text,"reservedMicroUsd" int,status text,"promptTokens" int,"completionTokens" int,"estimatedMicroUsd" int,"createdAt" timestamp(3)','id,model,"reservedMicroUsd",status,"promptTokens","completionTokens","estimatedMicroUsd","createdAt"'],
 ];
 await client.$transaction(async tx=>{for(const [table,key,definition,cols] of tables)for(let i=0;i<s[key].length;i+=300){
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM jsonb_to_recordset($1::jsonb) AS x(${definition})`,JSON.stringify(s[key].slice(i,i+300)));
 }},{timeout:120000});
}

try{
 assert(process.argv.includes('--prepare'),'Explicit --prepare is required');
 await mkdir(filmingFolder);await mkdir(resolve(filmingFolder,'backups'));
 // Restrict backups, local credentials and TLS keys to this Windows user and SYSTEM.
 const sid=spawnSync('powershell.exe',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).stdout.trim();
 assert(/^S-1-5-/.test(sid));
 const acl=spawnSync('icacls.exe',[filmingFolder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});assert.equal(acl.status,0,'Unable to protect local backup directory');
 const saved:Awaited<ReturnType<typeof snapshot>>[]=[];
 for(let i=0;i<sourceNames.length;i++){
  const s=await snapshot(clients[i]),fingerprint=hash(s),file=resolve(filmingFolder,'backups',sourceNames[i]+'.json');saved.push(s);
  await writeFile(file,JSON.stringify({format:'KFARM_APPLICATION_SNAPSHOT_V1',at:new Date().toISOString(),database:sourceNames[i],sha256:fingerprint,snapshot:s}),{flag:'wx',mode:0o600});
  const reread=JSON.parse(await readFile(file,'utf8'));assert.equal(hash(reread.snapshot),fingerprint);
  const target=await fresh(restoredNames[i]);
  try{await restore(target,reread.snapshot);assert.equal(hash(await snapshot(target)),fingerprint,'Restored rows differ');}finally{await target.$disconnect();}
  evidence.sources.push({database:sourceNames[i],sha256:fingerprint,backup:file,restoreDatabase:restoredNames[i],restoreVerified:true,...counts(s)});
  console.log(JSON.stringify({stage:'backup-restored',database:sourceNames[i],...counts(s),sha256:fingerprint}));
 }
 const target=await fresh(filmingDatabase);
 try{
  process.env.DATABASE_URL=fourCenterDatabaseUrl(filmingDatabase);
  const [{centerRegistry,emptyCenter},{demoResourceState},{emptyLaborOps},{recordSpace},{db},{authKey,digest,createAccount}]=await Promise.all([import('../lib/center-registry'),import('../lib/registered-demo'),import('../lib/labor-operations'),import('../lib/workspace'),import('../lib/db'),import('../lib/auth')]);
  try{
   for(const center of centerRegistry){
    const state=emptyCenter(center.id);state.ruleVersion='VIDEO_RECORDING_20261018';state.demoResourceBatchId='video-resources-20261018';
    state.machines=demoResourceState().machines.map(m=>({...m,id:m.id.replace('JB23',center.prefix),ownerCenterId:center.id}));
    state.crewCapacity={operators:2,workers:8};state.staffCount=10;state.transportCount=2;
    state.operatorRoster=Array.from({length:2},(_,i)=>({id:randomUUID(),name:`홍운영${i+1}`,active:true,kinds:['TR','DR','RP','PS','CB','PD','SP','TV'] as any,weekdays:[0,1,2,3,4,5,6],from:'2026-10-18',until:'2027-12-31',excludedDates:[],startMinute:480,endMinute:960,evidence:'Fictional recording resource'}));
    await target.center.create({data:{id:center.id,state:json(state)}});
    const space=recordSpace(center.id);
    const criteria=saved[1].records.filter(r=>r.workspace===space&&['centerGeography','centerSettings','productionCriteria'].includes(r.kind));
    assert.equal(criteria.length,3,'Required established regional inputs missing');
    for(const r of criteria)await target.workRecord.create({data:{workspace:space,kind:r.kind,id:r.id,version:r.version,payload:json(r.payload)}});
    const surnames=['민수','영자','순희','정수','경자','성호','영수','정희'];
    await target.workRecord.create({data:{workspace:space,kind:'laborOperations',id:'current',payload:json({...emptyLaborOps(),reserveRoster:{count:3,profiles:Object.fromEntries([1,2,3].map(i=>[String(i),{name:`홍상근${i}`,phone:`000-0000-92${String(i).padStart(2,'0')}`}]))},people:surnames.map((suffix,i)=>({id:randomUUID(),name:'홍'+suffix,birth:`${1950+i}-03-15`,phone:`000-0000-91${String(i+1).padStart(2,'0')}`,address:center.township,registeredFarmer:false,usesApp:false,active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:[]}))})}});
   }
   const setup=randomBytes(32).toString('hex');
   await target.workRecord.create({data:{...authKey('bootstrap','initial'),payload:{hash:digest(setup),expiresAt:Date.now()+600000}}});
   const credentials:any[]=[];
   const masterPassword=randomBytes(18).toString('base64url')+'!9';
   const master=await createAccount({username:'film-admin',name:'촬영 총괄 담당자',password:masterPassword,role:'SUPER_ADMIN',centerId:null},null,setup,false);
   credentials.push({username:master.username,password:masterPassword,centerId:null,role:master.role});
   for(const center of centerRegistry){
    const password=randomBytes(18).toString('base64url')+'!9';
    const u=await createAccount({username:'film-'+(center.id==='demo'?'gyebuk':center.id),name:center.township+' 촬영 담당자',password,role:'CENTER_ADMIN',centerId:center.id},master,undefined,false);
    credentials.push({username:u.username,password,centerId:u.centerId,role:u.role});
   }
   await writeFile(resolve(filmingFolder,'credentials.json'),JSON.stringify({origin:'https://127.0.0.1:3101',database:filmingDatabase,accounts:credentials},null,2),{flag:'wx',mode:0o600});
   const selected=JSON.parse(await readFile('.data/intake-scale-20261017/cadastre.json','utf8'));
   await writeFile(resolve(filmingFolder,'cadastre.json'),JSON.stringify(selected),{flag:'wx',mode:0o600});
   const init=await snapshot(target);assert.equal(counts(init).inventory,0);assert.equal(counts(init).missions,0);
   await writeFile(resolve(filmingFolder,'backups/filming-initial.json'),JSON.stringify({format:'KFARM_APPLICATION_SNAPSHOT_V1',database:filmingDatabase,sha256:hash(init),snapshot:init}),{flag:'wx',mode:0o600});
   evidence.initial={...counts(init),sha256:hash(init),accounts:credentials.map(({password,...c})=>c),resourcePerCenter:{machines:16,operators:2,casualWorkers:8,reserveSlots:3,transport:2},cadastreAvailable:300,registeredParcels:0};
  }finally{await db.$disconnect();}
 }finally{await target.$disconnect();}
 for(let i=0;i<clients.length;i++){const after=await snapshot(clients[i]);evidence.sources[i].unchanged=hash(after)===evidence.sources[i].sha256;assert(evidence.sources[i].unchanged,'Source changed while preparing recording');}
 evidence.complete=true;await writeFile(resolve(filmingFolder,'preparation.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log(JSON.stringify({stage:'prepared',database:filmingDatabase,origin:'https://127.0.0.1:3101',initial:evidence.initial,sourcesUnchanged:true,paidModelCalls:0}));
}catch(e){await writeFile(resolve(filmingFolder,'preparation-error.json'),JSON.stringify({at:new Date().toISOString(),error:e instanceof Error?e.message:String(e),evidence},null,2)).catch(()=>{});throw e;}
finally{await Promise.all([admin,...clients].map(x=>x.$disconnect()));}
