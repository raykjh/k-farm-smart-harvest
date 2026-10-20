import {createHash} from 'node:crypto';
import {db} from './db';
import {fetchAtPrices} from './at-price-client';
import {priceDays,priceQuerySchema,priceSourceUrl,type PriceDay,type PriceQuery} from './price-reference';
export const priceRecordKind='atPriceDay';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readPriceHistory(input:PriceQuery){
 const query=priceQuerySchema.parse(input),ids=priceDays(query).map(d=>`${query.crop}:${d}`);
 const rows=await db.workRecord.findMany({where:{workspace:'shared',kind:priceRecordKind,id:{in:ids}},orderBy:{id:'asc'}});
 const days=rows.map(r=>({...r.payload as unknown as PriceDay,version:r.version}));
 return {query,days,observations:days.flatMap(d=>d.observations),missingDays:priceDays(query).filter(d=>!days.some(s=>s.date===d)),sourceUrl:priceSourceUrl};
}
export async function importPriceHistory(input:PriceQuery,actor:string,options:Parameters<typeof fetchAtPrices>[1]={}){
 const startedAt=new Date().toISOString(),result=await fetchAtPrices(input,options),retrievedAt=new Date().toISOString();
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'price-reference-import'}))`;
  let changed=0,unchanged=0;const revisions:{date:string;revision:string;count:number}[]=[];
  for(const date of priceDays(result.query)){
   const key={workspace:'shared',kind:priceRecordKind,id:`${result.query.crop}:${date}`},previous=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),observations=result.observations.filter(r=>r.date===date),revision=digest(observations),old=previous?.payload as unknown as PriceDay|undefined;
   if(old&&old.retrievedAt>startedAt)throw Error('더 최근의 수집이 저장되었습니다. 다시 조회하세요.');
   revisions.push({date,revision,count:observations.length});
   if(old?.revision===revision){unchanged++;continue;}
   const payload:PriceDay={crop:result.query.crop,date,sourceUrl:priceSourceUrl,retrievedAt,revision,observations,coverage:'PROVIDER_MARKETS',status:observations.length?'OBSERVED':'NO_OBSERVATIONS'};
   await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload:JSON.parse(JSON.stringify(payload))},update:{payload:JSON.parse(JSON.stringify(payload)),version:{increment:1}}});changed++;
  }
  await tx.audit.create({data:{centerId:'global',action:'reference.price.import',detail:{actor,query:result.query,retrievedAt,changed,unchanged,calls:result.calls,providerCount:result.providerCount,revisions}}});
  return {ok:true,changed,unchanged,observations:result.observations.length,calls:result.calls,retrievedAt};
 },{timeout:30000});
}
