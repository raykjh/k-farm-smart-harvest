import {withAuth} from '@/lib/auth-route';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {environmentRuleSchema,environmentWindows,type WeatherDay} from '@/lib/environment-window';
async function handleGET(){
 try{const rows=await db.workRecord.findMany({where:{workspace:'shared',kind:'climateNormals'}});
 return NextResponse.json({datasets:rows.map(r=>{const p=r.payload as any;return {id:r.id,station:p.stationName,period:p.period,sourceUrl:p.sourceUrl};})},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'기상자료 조회 실패'},{status:503});}
}
async function handlePOST(req:Request){
 if(!['http://127.0.0.1:3100','http://localhost:3100'].includes(req.headers.get('origin')??''))return NextResponse.json({error:'Origin rejected'},{status:403});
 try{
 const b=z.object({datasetId:z.string().min(1),year:z.number().int().min(2000).max(2200),basis:z.enum(['NORMAL','OBSERVED']),rule:environmentRuleSchema}).strict().parse(await req.json());
 const record=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:'shared',kind:'climateNormals',id:b.datasetId}}});
 if(!record)return NextResponse.json({error:'평년자료 미등록'},{status:404});
 const p=record.payload as any;let days:WeatherDay[]=[];
 if(b.basis==='NORMAL')days=p.values.map((d:any)=>({date:`${b.year}-${d.monthDay}`,meanTemperatureC:d.meanC,minTemperatureC:null,soilTemperatureC:null})).filter((d:WeatherDay)=>Number.isFinite(Date.parse(d.date))&&new Date(d.date).toISOString().slice(0,10)===d.date);
 else {const rows=await db.workRecord.findMany({where:{workspace:'shared',kind:'weatherObservation',id:{startsWith:`ASOS:${p.stationId}:${b.year}-`}}});days=rows.map(r=>{const v=r.payload as any;return {date:v.date,meanTemperatureC:v.meanTemperatureC,minTemperatureC:v.minTemperatureC,soilTemperatureC:null};});}
 return NextResponse.json({...environmentWindows(b.rule,days,`${b.year}-01-01`,`${b.year}-12-31`),station:p.stationName,basis:b.basis,period:b.basis==='NORMAL'?p.period:String(b.year),sourceUrl:p.sourceUrl,datasetVersion:record.version,availableDays:days.length,warning:b.basis==='NORMAL'?'평년 기온 기반 후보 · 올해 예보 아님':'관측된 기간의 조건 충족 기록 · 미래 예보 아님'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'환경 조건을 확인하세요.':'계산 실패 · 자료 형식을 확인하세요.'},{status:400});}
}

export const GET=withAuth('environment-windows',handleGET);
export const POST=withAuth('environment-windows',handlePOST);
