export {};
process.loadEnvFile('.env.local');
const {db}=await import('../lib/db');
const date=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const until=date(new Date(Date.now()-86400000)),year=until.slice(0,4);
try{
 let key=process.env.KMA_SERVICE_KEY?.trim();if(!key)throw Error('NO_KEY');try{key=decodeURIComponent(key)}catch{}
 const all:any[]=[];
 for(let page=1;page<=10;page++){
 const url=new URL('https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList');
 url.search=new URLSearchParams({serviceKey:key,dataType:'JSON',numOfRows:'999',pageNo:String(page),dataCd:'ASOS',dateCd:'HR',startDt:year+'0101',startHh:'00',endDt:until.replaceAll('-',''),endHh:'23',stnIds:'248'}).toString();
 const r=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error('HTTP_'+r.status);
 const data=(await r.json()).response;if(data?.header?.resultCode!=='00')throw Error('PROVIDER_ERROR');
 const rows=data.body?.items?.item;if(!Array.isArray(rows)||!rows.length)throw Error('EMPTY_PAGE');all.push(...rows);
 if(all.length>=Number(data.body.totalCount))break;if(page===10)throw Error('TRUNCATED');
 }
 const keys=new Set(all.map(r=>r.tm));if(keys.size!==all.length)throw Error('DUPLICATE');
 const number=(v:any)=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 await db.$transaction(async tx=>{
 for(const r of all){if(String(r.stnId)!=='248'||!r.tm.startsWith(year)||!/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(r.tm)||r.tm.slice(0,10)>until)throw Error('INVALID_ROW');
 const payload={source:'KMA_ASOS',stationId:'248',stationName:'장수',resolution:'HOUR',observedAt:r.tm.replace(' ','T')+':00+09:00',temperatureC:number(r.ta),precipitationMm:number(r.rn),windMs:number(r.ws),quality:{temperature:r.taQcflg,precipitation:r.rnQcflg,wind:r.wsQcflg},raw:r};
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('shared','weatherHourly',${'ASOS:248:'+r.tm},1,${JSON.stringify(payload)}::jsonb) ON CONFLICT (workspace,kind,id) DO NOTHING`;
 }
 },{timeout:120000});
 console.log(JSON.stringify({status:'IMPORTED',count:all.length,first:all[0].tm,last:all.at(-1).tm,missingRain:all.filter(r=>r.rn==='').length}));
}catch(e){console.log(JSON.stringify({status:'BLOCKED',reason:e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'REQUEST_OR_STORAGE_ERROR'}));process.exitCode=1}finally{await db.$disconnect()}
