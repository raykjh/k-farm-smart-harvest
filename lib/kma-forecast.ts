import {z} from 'zod';
import {KMA_SOURCE,normalizeKmaKey} from './kma';
export type ForecastKind='ultra'|'short';
export type ForecastPoint={at:string;temperatureC:number|null;windMs:number|null;humidityPercent:number|null;rainProbabilityPercent:number|null;precipitation:string|null};
export type ForecastResult={status:'READY'|'NOT_CONFIGURED'|'UNAVAILABLE';kind:ForecastKind;sourceUrl:string;fetchedAt:string;issuedAt?:string;requestedBaseAt?:string;grid?:{nx:number;ny:number};points:ForecastPoint[];reason?:string};
const hour=3600000;
const stamp=(date:string,time:string)=>`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:00+09:00`;
// Conservative publication buffer: do not query a newly issued, possibly incomplete run.
export function forecastBase(kind:ForecastKind,now:Date){
 // Official guide: ultra HH:30 available after HH:45; short available +10 min.
 // Add five minutes of margin to each documented availability time.
 const cutoff=now.getTime()+9*hour-(kind==='ultra'?20:15)*60000;
 const t=new Date(cutoff);
 if(kind==='ultra'){t.setUTCMinutes(30,0,0);if(t.getTime()>cutoff)t.setUTCHours(t.getUTCHours()-1)}
 else {while(t.getUTCHours()%3!==2)t.setUTCHours(t.getUTCHours()-1);t.setUTCMinutes(0,0,0)}
 return {date:t.toISOString().slice(0,10).replaceAll('-',''),time:t.toISOString().slice(11,16).replace(':','')};
}
const row=z.object({baseDate:z.string(),baseTime:z.string(),nx:z.coerce.number(),ny:z.coerce.number(),fcstDate:z.string().regex(/^\d{8}$/),fcstTime:z.string().regex(/^(?:[01]\d|2[0-3])[0-5]\d$/),category:z.string(),fcstValue:z.union([z.string(),z.number()])});
const schema=z.object({response:z.object({header:z.object({resultCode:z.string()}),body:z.object({totalCount:z.coerce.number().int().nonnegative(),items:z.object({item:z.array(row)})}).optional()})});
export function dailyForecastBase(now:Date){return {date:new Date(now.getTime()+9*hour-24*hour).toISOString().slice(0,10).replaceAll('-',''),time:'2300'}}
export function parseForecast(raw:unknown,kind:ForecastKind,grid:{nx:number;ny:number},base:ReturnType<typeof forecastBase>,now:Date,dailyBaseline=false):ForecastResult{
 const r=schema.parse(raw).response,b=r.body;
 if(r.header.resultCode!=='00'||!b||!b.items.item.length||b.totalCount!==b.items.item.length)throw Error('INCOMPLETE_RESPONSE');
 // Live ultra response can report HH00 for an HH30 request. Accept only this
 // same-hour variant, require consistency, and retain BOTH timestamps explicitly.
 const returnedTime=b.items.item[0].baseTime;
 if(returnedTime!==base.time&&!(kind==='ultra'&&returnedTime===base.time.slice(0,2)+'00'))throw Error('BASE_MISMATCH');
 const issuedAt=stamp(base.date,returnedTime),issued=Date.parse(issuedAt);
 if(dailyBaseline&&(kind!=='short'||base.date!==dailyForecastBase(now).date||base.time!=='2300'))throw Error('DAILY_BASE_MISMATCH');
 if(now.getTime()<issued||now.getTime()-issued>(dailyBaseline?25:kind==='ultra'?3:5)*hour)throw Error('STALE_RUN');
 const groups=new Map<string,Map<string,string>>();
 for(const v of b.items.item){
  if(v.nx!==grid.nx||v.ny!==grid.ny||v.baseDate!==base.date||v.baseTime!==returnedTime)throw Error('MISMATCH');
  const at=stamp(v.fcstDate,v.fcstTime),ms=Date.parse(at);
  if(!Number.isFinite(ms)||new Date(ms+9*hour).toISOString().slice(0,10).replaceAll('-','')!==v.fcstDate||ms<=issued||ms-issued>6*24*hour)throw Error('INVALID_TIME');
  const g=groups.get(at)??new Map<string,string>();if(g.has(v.category))throw Error('DUPLICATE');
  g.set(v.category,String(v.fcstValue).trim());groups.set(at,g);
 }
 const points:ForecastPoint[]=[];
 for(const [at,g] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  if(dailyBaseline?at.slice(0,10)!==new Date(now.getTime()+9*hour).toISOString().slice(0,10):Date.parse(at)<=now.getTime())continue;
  const num=(key:string,min:number,max:number)=>{const v=g.get(key);if(!v)return null;const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null};
  const rain=g.get(kind==='ultra'?'RN1':'PCP');
  points.push({at,temperatureC:num(kind==='ultra'?'T1H':'TMP',-90,65),windMs:num('WSD',0,150),humidityPercent:num('REH',0,100),rainProbabilityPercent:num('POP',0,100),precipitation:rain&&rain.length<=40&&/^(?:강수없음|\d+(?:\.\d+)?(?:\s*~\s*\d+(?:\.\d+)?)?\s*(?:mm)?\s*(?:미만|이상)?)$/.test(rain)?rain:null});
 }
 if(!points.some(p=>p.temperatureC!==null||p.windMs!==null||p.humidityPercent!==null))throw Error('NO_FORECAST');
 return {status:'READY',kind,sourceUrl:KMA_SOURCE,fetchedAt:now.toISOString(),issuedAt,requestedBaseAt:stamp(base.date,base.time),grid,points};
}
export function createForecastReader(kind:ForecastKind,fetcher:typeof fetch=fetch,clock=()=>new Date(),dailyBaseline=false){
 let cache:{id:string;expires:number;result:ForecastResult}|undefined,pending:{id:string;promise:Promise<ForecastResult>}|undefined;
 return async(config:{key?:string;nx?:string;ny?:string}):Promise<ForecastResult>=>{
  const now=clock(),base=dailyBaseline?dailyForecastBase(now):forecastBase(kind,now),nx=Number(config.nx),ny=Number(config.ny);
  const fail=(status:ForecastResult['status'],reason:string):ForecastResult=>({status,kind,reason,sourceUrl:KMA_SOURCE,fetchedAt:clock().toISOString(),points:[]});
  if(!config.key?.trim()||!Number.isInteger(nx)||!Number.isInteger(ny)||nx<1||nx>149||ny<1||ny>253)return fail('NOT_CONFIGURED','KEY_OR_GRID_REQUIRED');
  const id=JSON.stringify([config.key,nx,ny,base]);
  // Keys remain server memory only. Negative caching and request coalescing bound retries.
  if(cache?.id===id&&cache.expires>now.getTime())return {...cache.result,points:dailyBaseline?cache.result.points:cache.result.points.filter(p=>Date.parse(p.at)>now.getTime())};
  if(pending?.id===id)return pending.promise;
  const promise=(async()=>{
   let result:ForecastResult;
   try{
    const url=new URL(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${kind==='ultra'?'getUltraSrtFcst':'getVilageFcst'}`);
    url.search=new URLSearchParams({serviceKey:normalizeKmaKey(config.key!),pageNo:'1',numOfRows:'10000',dataType:'JSON',base_date:base.date,base_time:base.time,nx:String(nx),ny:String(ny)}).toString();
    const r=await fetcher(url,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});if(!r.ok)throw Error('HTTP');
    const text=await r.text();if(text.length>2000000)throw Error('OVERSIZED');
    result=parseForecast(JSON.parse(text),kind,{nx,ny},base,clock(),dailyBaseline);
   }catch{result=fail('UNAVAILABLE','FETCH_OR_VALIDATION_FAILED')}
   cache={id,result,expires:clock().getTime()+(result.status==='READY'?(dailyBaseline?24*hour:600000):60000)};return result;
  })();
  pending={id,promise};try{return await promise}finally{if(pending?.promise===promise)pending=undefined}
 };
}
export const readUltraForecast=createForecastReader('ultra');
export const readShortForecast=createForecastReader('short');
// Display-only full-day baseline, separate from future-work forecasts.
export const readDailyForecast=createForecastReader('short',fetch,()=>new Date(),true);
