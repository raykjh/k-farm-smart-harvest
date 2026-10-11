import type {Prisma} from '@prisma/client';
import {environmentPlanningSchema,type EnvironmentBundle} from './environment-planning';
import {regionalStandardSchema} from './regional-crop-standard';
export async function loadEnvironmentBundle(tx:Prisma.TransactionClient,raw:unknown):Promise<EnvironmentBundle|undefined>{
 if(raw===undefined)return undefined;
 const selection=environmentPlanningSchema.parse(raw);
 const record=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'shared',kind:'climateNormals',id:selection.datasetId}}});
 if(!record)throw Error('평년자료 미등록');
 const data=record.payload as any;
 const rows=await tx.workRecord.findMany({where:{workspace:'reference',kind:'regionalCropStandard'}});
 const days=[];
 for(let year=Number(selection.from.slice(0,4));year<=Number(selection.to.slice(0,4));year++)for(const v of data.values){
  const date=`${year}-${v.monthDay}`;
  if(Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)days.push({date,meanTemperatureC:v.meanC,minTemperatureC:null,soilTemperatureC:null});
 }
 return {selection,days,standards:rows.map(r=>({id:r.id,version:r.version,updatedAt:r.updatedAt.toISOString(),profile:regionalStandardSchema.parse(r.payload)})),dataset:{id:record.id,version:record.version,station:data.stationName,period:data.period,sourceUrl:data.sourceUrl}};
}
