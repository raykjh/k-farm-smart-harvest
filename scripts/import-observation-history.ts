export {};
process.loadEnvFile('.env.local');
const {db}=await import('../lib/db');
const now=new Date();
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const end=new Date(today+'T00:00:00+09:00');end.setUTCDate(end.getUTCDate()-1);
const until=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(end);
try{
 const key=process.env.KMA_SERVICE_KEY?.trim();if(!key)throw Error('NOT_CONFIGURED');
 const url=new URL('https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList');
 let decoded=key;try{decoded=decodeURIComponent(key)}catch{}
 url.search=new URLSearchParams({serviceKey:decoded,dataType:'JSON',numOfRows:'366',pageNo:'1',dataCd:'ASOS',dateCd:'DAY',startDt:today.slice(0,4)+'0101',endDt:until.replaceAll('-',''),stnIds:'248'}).toString();
 const r=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!r.ok)throw Error('HTTP_'+r.status);
 const raw=await r.text();let response:any;try{response=JSON.parse(raw).response}catch{throw Error('NON_JSON_OR_AUTHORIZATION_ERROR')}
 if(response?.header?.resultCode!=='00')throw Error('PROVIDER_CODE_'+String(response?.header?.resultCode??'UNKNOWN').replace(/[^A-Z0-9_]/gi,''));
 const rows=response.body?.items?.item;if(!Array.isArray(rows)||!rows.length)throw Error('NO_OBSERVATIONS');
 if(Number(response.body.totalCount)>rows.length)throw Error('INCOMPLETE_RESPONSE');
 const numeric=(v:unknown)=>v===''||v==null?null:Number.isFinite(Number(v))?Number(v):null;
 await db.$transaction(async tx=>{
 for(const row of rows){
  if(String(row.stnId)!=='248'||!/^\d{4}-\d{2}-\d{2}$/.test(row.tm)||row.tm>until||!row.tm.startsWith(today.slice(0,4)))throw Error('INVALID_OBSERVATION');
  const payload={source:'KMA_ASOS',stationId:'248',stationName:'장수',representativeness:'REGIONAL_REFERENCE_NOT_FIELD_SENSOR',date:row.tm,resolution:'DAY',minTemperatureC:numeric(row.minTa),meanTemperatureC:numeric(row.avgTa),maxTemperatureC:numeric(row.maxTa),precipitationMm:numeric(row.sumRn),maxWindMs:numeric(row.maxWs),raw:row,retrievedAt:now.toISOString()};
  await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('shared','weatherObservation',${'ASOS:248:'+row.tm},1,${JSON.stringify(payload)}::jsonb) ON CONFLICT (workspace,kind,id) DO UPDATE SET payload=EXCLUDED.payload,version="WorkRecord".version+1,"updatedAt"=CURRENT_TIMESTAMP`;
 }
 },{timeout:20000});
 console.log(JSON.stringify({status:'IMPORTED',station:248,count:rows.length,from:rows[0].tm,until,missingValues:'NULL_NOT_ZERO'}));
}catch(e){console.log(JSON.stringify({status:'BLOCKED',reason:e instanceof Error&&/^(NOT_CONFIGURED|HTTP_\d+|NON_JSON_OR_AUTHORIZATION_ERROR|PROVIDER_CODE_\w+|NO_OBSERVATIONS|INCOMPLETE_RESPONSE|INVALID_OBSERVATION)$/.test(e.message)?e.message:'REQUEST_OR_STORAGE_FAILED'}));process.exitCode=1}
finally{await db.$disconnect()}
