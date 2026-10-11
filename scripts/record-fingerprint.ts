import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
// Read-only evidence. Never emit rows, credentials, personal details or prompts.
const db=new PrismaClient();
try{
 const protectLegacy=process.argv.includes('--protected-legacy'),newCenters=['janggye','cheoncheon','gyenam'];
 const records=await db.workRecord.findMany({where:protectLegacy?{workspace:{notIn:newCenters.map(id=>'center:'+id)}}:undefined,orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]});
 // Optional existing-center subset proves additive center initialization preserved legacy data.
 const centerFilter=process.argv.find(a=>a.startsWith('--centers='))?.slice(10).split(',');
 const centers=await db.center.findMany({where:centerFilter?{id:{in:centerFilter}}:protectLegacy?{id:{notIn:newCenters}}:undefined,orderBy:{id:'asc'}});
 const outbox=await db.outbox.findMany({orderBy:{id:'asc'}});
 const receipts=await db.receipt.findMany({orderBy:{id:'asc'}});
 const audit=await db.audit.findMany({where:protectLegacy?{centerId:{notIn:newCenters}}:undefined,orderBy:{id:'asc'}});
 const budgets=await db.aiBudget.findMany({orderBy:{id:'asc'}});
 const calls=await db.aiCall.findMany({orderBy:{id:'asc'}});
 const all=process.argv.includes('--business-only')?{records,centers,outbox,receipts,audit}:{records,centers,outbox,receipts,audit,budgets,calls};
 console.log(JSON.stringify({counts:Object.fromEntries(Object.entries(all).map(([k,v])=>[k,v.length])),sha256:createHash('sha256').update(JSON.stringify(all)).digest('hex')}));
}finally{await db.$disconnect()}
