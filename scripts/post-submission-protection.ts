import {PrismaClient,Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {localTestDatabaseBase as base} from './disposable-test-db';

const folder='.data/verification/post-submission-20261018';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const previous=JSON.parse(await readFile('.data/verification/ai-role-context-2026-10-18T03-11-47-326Z.json','utf8'));
const approval={baselineMicroUsd:previous.budgetBefore.reserved,capMicroUsd:500000,ceilingMicroUsd:previous.budgetBefore.reserved+500000};
if(approval.baselineMicroUsd!==3671458)throw Error('Unexpected authorization baseline; recheck the original approval, never reset it.');
const protectedNames=['kfarm','kfarm_test','kfarm_centers_e2e','kfarm_centers_e2e_scale_20261017','kfarm_centers_e2e_video_20261018','kfarm_centers_e2e_enfilm_20261018'];
async function readBusiness(client:PrismaClient){return client.$transaction(async tx=>({
 records:await tx.workRecord.findMany({orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),centers:await tx.center.findMany({orderBy:{id:'asc'}}),
 outbox:await tx.outbox.findMany({orderBy:{id:'asc'}}),receipts:await tx.receipt.findMany({orderBy:{id:'asc'}}),audit:await tx.audit.findMany({orderBy:{id:'asc'}}),
}),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});}
const verify=process.argv.includes('--verify'),admin=new PrismaClient({datasourceUrl:base+'postgres'});
try{
 const before=verify?JSON.parse(await readFile(folder+'/protection-before.json','utf8')):null;
 const existing=await admin.$queryRaw<Array<{datname:string}>>`SELECT datname FROM pg_database`;
 const checks:any[]=[];
 await mkdir(folder,{recursive:true});
 for(const name of protectedNames.filter(n=>existing.some(d=>d.datname===n))){
  const client=new PrismaClient({datasourceUrl:base+name});
  try{
   const snapshot=await readBusiness(client),sha256=hash(snapshot);
   checks.push({database:name,sha256,counts:Object.fromEntries(Object.entries(snapshot).map(([k,v])=>[k,v.length])),...(verify?{preserved:before.databases.find((d:any)=>d.database===name)?.sha256===sha256}:{})});
   if(!verify&&name==='kfarm')await writeFile(folder+'/operating-business-backup.json',JSON.stringify({format:'KFARM_BUSINESS_SNAPSHOT_V1',sha256,snapshot}),{flag:'wx',mode:0o600});
  }finally{await client.$disconnect();}
 }
 const operating=new PrismaClient({datasourceUrl:base+'kfarm'});
 let ledger:any;try{ledger={reserved:(await operating.aiBudget.findUniqueOrThrow({where:{id:'nebius-decisions-20261004'}})).total,calls:await operating.aiCall.count(),estimated:(await operating.aiCall.aggregate({_sum:{estimatedMicroUsd:true}}))._sum.estimatedMicroUsd??0};}finally{await operating.$disconnect();}
 const report={at:new Date().toISOString(),approval,ledger,remainingReservedMicroUsd:approval.ceilingMicroUsd-ledger.reserved,databases:checks,...(verify?{allPreserved:checks.length===before.databases.length&&checks.every(c=>c.preserved),newCalls:ledger.calls-before.ledger.calls,newReservedMicroUsd:ledger.reserved-before.ledger.reserved,newEstimatedMicroUsd:ledger.estimated-before.ledger.estimated,approvalTotalReservedMicroUsd:ledger.reserved-approval.baselineMicroUsd}:{} )};
 const file=verify?folder+'/protection-after-'+Date.now()+'.json':folder+'/protection-before.json';
 await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,file}));
 if(verify&&(!report.allPreserved||report.remainingReservedMicroUsd<0))process.exitCode=1;
}finally{await admin.$disconnect();}
