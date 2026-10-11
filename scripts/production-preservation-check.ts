import {db} from '../lib/db';
import {createHash} from 'node:crypto';
// Read-only, non-PII evidence before/after an application restart.
const records=await db.workRecord.findMany({where:{workspace:'sandbox',kind:{in:['fields','consultation','cultivation','cultivationPlan','annualReservation','laborDemand','taskExecutionAssessment','fieldParticipation']}},orderBy:[{kind:'asc'},{id:'asc'}]});
const centers=await db.center.findMany({orderBy:{id:'asc'}});
const outbox=await db.outbox.findMany({orderBy:{id:'asc'}});
console.log(JSON.stringify({records:records.length,cultivations:records.filter(r=>r.kind==='cultivation').length,missions:centers.reduce((n,c)=>n+((c.state as any).missions?.length??0),0),outbox:outbox.length,hash:createHash('sha256').update(JSON.stringify({records,centers,outbox})).digest('hex')}));
if(process.argv.includes('--status')){
 const row=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'sandbox',kind:'continuousProduction',id:'current'}}}),p=row?.payload as any;
 console.log(JSON.stringify({calculatedAt:p?.calculatedAt??null,fields:p?.items?.length??0,statuses:p?.items?.reduce((all:Record<string,number>,i:any)=>{all[i.status]=(all[i.status]??0)+1;return all},{})??{}}));
}
await db.$disconnect();
