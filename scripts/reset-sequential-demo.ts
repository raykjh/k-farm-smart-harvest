import {PrismaClient,Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Explicit local maintenance only. No endpoint may invoke this script.
const url=new URL(process.env.DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/kfarm'||!process.argv.includes('--backup-restore-reset'))throw Error('Explicit operating-local backup/restore/reset command required');
const source=new PrismaClient(),adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=new PrismaClient({datasourceUrl:adminUrl.href});
const tables=['WorkRecord','Center','Outbox','Receipt','Audit','AiBudget','AiCall'] as const;
const order={WorkRecord:'workspace,kind,id',Center:'id',Outbox:'id',Receipt:'id',Audit:'id',AiBudget:'id',AiCall:'id'};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function snapshot(tx:Prisma.TransactionClient){
 const result:Record<string,any[]>={};
 for(const table of tables)result[table]=await tx.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY ${order[table]}`);
 return result;
}
const keep=new Set(['centerGeography','centerSettings','productionCriteria','demoResourceBatch','climateNormals','weatherHourly','weatherObservation','resourceLinkRepair','productionCoordinationPolicy','laborPolicy','regionalCropProfile']);
const remove=new Set(['annualPlan','annualPlanMigration','automaticReplan','consultation','continuousProduction','cultivation','cultivationMigration','demoManifest','fieldParticipation','fields','historicalReplay','labor','laborDemand','operationMigration','planningDecision','registrationReceipt','removedDemo','replanning','seasonBackup','smsMessage','taskExecutionAssessment','taskPlanChange','taskPlanSnapshot','resourceReservation','cultivationPlan','annualReservation','productionApproval','integratedPlan','productionAutoJob','demoInputBatch','registrationOrigin','laborOperations','laborOperationsReceipt','equipmentLoan','equipmentSharingOffer','laborSupport','equipmentWorkOrder','operatingLedger']);
let target:PrismaClient|undefined;
try{
 const before=await source.$transaction(snapshot,{isolationLevel:'RepeatableRead',timeout:60000});
 for(const r of before.WorkRecord)if(r.workspace!=='auth'&&!keep.has(r.kind)&&!remove.has(r.kind))throw Error('Review unknown record kind before reset: '+r.kind);
 const stamp=new Date().toISOString().replace(/[-:.TZ]/g,''),dir=resolve('.data','backups','sequential-demo-'+stamp);
 mkdirSync(dir,{recursive:true});
 const file=resolve(dir,'application-snapshot.json'),beforeHash=hash(before);
 writeFileSync(file,JSON.stringify({format:'KFARM_APPLICATION_SNAPSHOT_V2',at:new Date().toISOString(),sha256:beforeHash,tables:before}),{flag:'wx',mode:0o600});
 const targetName='kfarm_restore_seq_'+stamp;
 if(!/^kfarm_restore_seq_\d+$/.test(targetName))throw Error('Invalid restore target');
 await admin.$executeRawUnsafe(`CREATE DATABASE "${targetName}"`);
 const targetUrl=new URL(url);targetUrl.pathname='/'+targetName;
 const schema=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:targetUrl.href},encoding:'utf8',windowsHide:true});
 if(schema.status!==0)throw Error('Restore schema creation failed; operating data unchanged');
 target=new PrismaClient({datasourceUrl:targetUrl.href});
 await target.$transaction(async tx=>{
  for(const table of tables)for(let i=0;i<before[table].length;i+=250){
   await tx.$executeRawUnsafe(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,JSON.stringify(before[table].slice(i,i+250)));
  }
 },{timeout:120000});
 const restored=await target.$transaction(snapshot,{isolationLevel:'RepeatableRead',timeout:60000});
 if(hash(restored)!==beforeHash)throw Error('Restored snapshot mismatch; operating data unchanged');
 const result=await source.$transaction(async tx=>{
  for(const table of tables)await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN SHARE ROW EXCLUSIVE MODE`);
  const fresh=await snapshot(tx);if(hash(fresh)!==beforeHash)throw Error('Source changed after backup; not reset');
  const deleted=await tx.workRecord.deleteMany({where:{workspace:{not:'auth'},kind:{in:[...remove]}}});
  const outbox=await tx.outbox.deleteMany(),receipts=await tx.receipt.deleteMany();
  for(const c of fresh.Center){
   const state={...c.state,fields:[],missions:[],events:[],revisions:[],registered:false,planned:false,planVersion:c.state.planVersion+1};
   delete state.productionLedger;delete state.laborCapacity;
   if(state.centerSharing)state.centerSharing={centerId:c.id,neighborCenterIds:state.centerSharing.neighborCenterIds??[],loans:[]};
   await tx.center.update({where:{id:c.id},data:{state,version:{increment:1}}});
  }
  const after=await snapshot(tx);
  for(const table of ['AiBudget','AiCall'] as const)if(hash(fresh[table])!==hash(after[table]))throw Error('Accounting changed');
  if(hash(fresh.WorkRecord.filter(r=>r.workspace==='auth'))!==hash(after.WorkRecord.filter(r=>r.workspace==='auth')))throw Error('Accounts changed');
  const result={backup:file,restoreDatabase:targetName,sha256:beforeHash,restoreVerified:true,deletedRecords:deleted.count,deletedOutbox:outbox.count,deletedReceipts:receipts.count,removedFields:fresh.Center.reduce((n,c)=>n+c.state.fields.length,0),removedTasks:fresh.Center.reduce((n,c)=>n+c.state.missions.length,0),retainedAccounts:after.WorkRecord.filter(r=>r.workspace==='auth'&&r.kind==='user').length,retainedAiCalls:after.AiCall.length,retainedBudgets:after.AiBudget.map(b=>({id:b.id,total:b.total})),scope:'Seven application tables; server roles/configuration not included'};
  await tx.audit.create({data:{centerId:'global',action:'demo.sequential.reset',detail:result}});
  return result;
 },{timeout:120000});
 writeFileSync(resolve(dir,'reset-evidence.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result));
}finally{await source.$disconnect();await admin.$disconnect();await target?.$disconnect()}
