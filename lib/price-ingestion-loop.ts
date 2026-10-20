import {db} from './db';
import {importPriceHistory} from './price-reference-store';
const loopState=globalThis as unknown as {kfarmPriceLoop?:ReturnType<typeof setInterval>};
/** Shared daily lease prevents every web/worker process from collecting again. */
export async function collectDailyPrices(now=new Date()){
 if(!process.env.AT_PRICE_SERVICE_KEY)return {status:'NOT_CONFIGURED'};
 const korean=new Date(now.getTime()+9*3600000),today=korean.toISOString().slice(0,10),to=new Date(korean.getTime()-86400000).toISOString().slice(0,10),from=new Date(korean.getTime()-3*86400000).toISOString().slice(0,10),key={workspace:'shared',kind:'referenceIngestionJob',id:'at-daily:'+today};
 const claim=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'price-daily-lease'}))`;
  const row=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),old=row?.payload as any;
  if(old?.status==='SUCCEEDED'||old?.attempts>=3||old?.nextAttemptAt>now.toISOString())return null;
  const payload={status:'RUNNING',attempts:(old?.attempts??0)+1,startedAt:now.toISOString(),nextAttemptAt:new Date(now.getTime()+3600000).toISOString(),from,to};
  const saved=await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload},update:{payload,version:{increment:1},updatedAt:now}});return {payload,version:saved.version};
 });
 if(!claim)return {status:'ALREADY_CLAIMED'};
 try{const results=[];for(const crop of ['rice','potato','pepper'] as const)results.push({crop,...await importPriceHistory({crop,from,to},'scheduled-price-collection')});await db.workRecord.updateMany({where:{...key,version:claim.version},data:{payload:{...claim.payload,status:'SUCCEEDED',finishedAt:new Date().toISOString(),results},updatedAt:new Date()}});return {status:'SUCCEEDED',results};}
 catch{await db.workRecord.updateMany({where:{...key,version:claim.version},data:{payload:{...claim.payload,status:'FAILED',finishedAt:new Date().toISOString(),error:'PROVIDER_COLLECTION_FAILED'},updatedAt:new Date()}});return {status:'FAILED'};}
}
export function startPriceIngestionLoop(){
 if(loopState.kfarmPriceLoop)return;
 const run=()=>void collectDailyPrices().catch(()=>console.error('Daily price collection unavailable; saved references retained.'));
 loopState.kfarmPriceLoop=setInterval(run,15*60000);loopState.kfarmPriceLoop.unref();const first=setTimeout(run,5000);first.unref();
}
