import {createHash} from 'node:crypto';
import {db} from './db';
export async function importJangsuAnnualNormals(options:{fetcher?:typeof fetch;onProgress?:(count:number)=>void}={}){
 const fetcher=options.fetcher??fetch,values:{monthDay:string;meanC:number}[]=[];
 for(let month=1;month<=12;month++)for(let day=1;day<=new Date(Date.UTC(2025,month,0)).getUTCDate();day++){
  const monthDay=String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  const response=await fetcher('https://data.kma.go.kr/normals/anal8Ajax.do',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({DEPTH1:'KOR_1991_30_v2',DEPTH2:'DD',schStnId:'248',schElmId:'AVG_TA',d_msel:String(month),d_dsel:String(day),startYear:'2021'}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error('기상청 평년자료 수신 실패. 기존 자료를 유지합니다.');
  const data=await response.json(),value=data.dataList?.[0];
  if(data.code!=='00'||value?.stnId!==248||value.col1!=='AVG_TA'||!Number.isFinite(value.val1)||value.val1< -50||value.val1>60||value.ymd!==monthDay.replace('-','월 ')+'일')throw Error('기상청 응답 지점·날짜·온도를 확인하세요. 기존 자료를 유지합니다.');
  values.push({monthDay,meanC:value.val1});options.onProgress?.(values.length);
 }
 const revision=createHash('sha256').update(JSON.stringify(values)).digest('hex'),payload={stationId:'248',stationName:'장수',period:'1991-2020',sourceUrl:'https://data.kma.go.kr/normals/anal8.do',retrievedAt:new Date().toISOString(),coverage:'01-01/12-31',leapDay:'NOT_INCLUDED',values,revision},key={workspace:'shared',kind:'climateNormals',id:'ASOS:248:1991-2020:annual'};
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'climate-reference-import'}))`;
  const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if((previous?.payload as any)?.revision===revision)return {id:key.id,days:values.length,version:previous!.version,unchanged:true};
  const saved=await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload},update:{payload,version:{increment:1},updatedAt:new Date()}});
  await tx.audit.create({data:{centerId:'global',action:'reference.climate.import',detail:{id:key.id,days:values.length,revision,version:saved.version}}});
  return {id:key.id,days:values.length,version:saved.version,unchanged:false};
 });
}
