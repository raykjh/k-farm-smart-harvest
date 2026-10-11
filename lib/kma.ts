import {z} from 'zod';
export const KMA_SOURCE='https://www.data.go.kr/data/15084084/openapi.do';
const endpoint='https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
export type KmaResult={status:'READY'|'NOT_CONFIGURED'|'UNAVAILABLE';source:'KMA_ULTRA_SHORT_OBSERVATION';sourceUrl:string;fetchedAt:string;observedAt?:string;grid?:{nx:number;ny:number};temperatureC?:number|null;windMs?:number|null;humidityPercent?:number|null;precipitationMm?:number|null;reason?:string};
const item=z.object({baseDate:z.string(),baseTime:z.string(),nx:z.coerce.number(),ny:z.coerce.number(),category:z.string(),obsrValue:z.union([z.string(),z.number()])});
const response=z.object({response:z.object({header:z.object({resultCode:z.string()}),body:z.object({items:z.object({item:z.array(item)})}).optional()})});
export function observationBase(now:Date){
 // Conservative previous-hour query to allow publication delay. Not a forecast timestamp.
 const kst=new Date(now.getTime()+9*3600000-3600000);
 return {date:kst.toISOString().slice(0,10).replaceAll('-',''),time:kst.toISOString().slice(11,13)+'00'};
}
export function parseObservation(raw:unknown,grid:{nx:number;ny:number},base:ReturnType<typeof observationBase>,now:Date):KmaResult{
 const data=response.parse(raw).response;
 if(data.header.resultCode!=='00'||!data.body)throw Error('PROVIDER_ERROR');
 const values=data.body.items.item;
 if(!values.length||values.some(v=>v.nx!==grid.nx||v.ny!==grid.ny||v.baseDate!==base.date||v.baseTime!==base.time))throw Error('LOCATION_OR_TIME_MISMATCH');
 const read=(category:string,min:number,max:number)=>{const matches=values.filter(v=>v.category===category);if(matches.length!==1)return null;const raw=String(matches[0].obsrValue).trim();if(!raw)return null;const n=Number(raw);return Number.isFinite(n)&&n>=min&&n<=max?n:null;};
 const temperatureC=read('T1H',-90,65),windMs=read('WSD',0,150),humidityPercent=read('REH',0,100);
 if([temperatureC,windMs,humidityPercent].every(v=>v===null))throw Error('NO_VALID_VALUES');
 const observedAt=`${base.date.slice(0,4)}-${base.date.slice(4,6)}-${base.date.slice(6,8)}T${base.time.slice(0,2)}:00:00+09:00`;
 const age=now.getTime()-Date.parse(observedAt);
 if(!Number.isFinite(age)||age<0||age>2*3600000)throw Error('STALE_OBSERVATION');
 return {status:'READY',source:'KMA_ULTRA_SHORT_OBSERVATION',sourceUrl:KMA_SOURCE,fetchedAt:now.toISOString(),observedAt,grid,temperatureC,windMs,humidityPercent,precipitationMm:read('RN1',0,1000)};
}
type Config={key?:string;nx?:string;ny?:string};
export function normalizeKmaKey(value:string){
 // Portal offers encoded and decoded keys. Decode once, then URLSearchParams encodes once.
 return value.includes('%')?decodeURIComponent(value.trim()):value.trim();
}
export function createKmaReader(fetcher:typeof fetch=fetch,clock=()=>new Date()){
 let cached:{identity:string;expires:number;value:KmaResult}|undefined;
 let pending:{identity:string;promise:Promise<KmaResult>}|undefined;
 return async(config:Config):Promise<KmaResult>=>{
  const now=clock(),base=observationBase(now),nx=Number(config.nx),ny=Number(config.ny);
  const unavailable=(status:KmaResult['status'],reason:string):KmaResult=>({status,reason,source:'KMA_ULTRA_SHORT_OBSERVATION',sourceUrl:KMA_SOURCE,fetchedAt:now.toISOString()});
  if(!config.key?.trim()||!config.nx||!config.ny||!Number.isInteger(nx)||!Number.isInteger(ny)||nx<1||nx>149||ny<1||ny>253)return unavailable('NOT_CONFIGURED','KEY_OR_GRID_REQUIRED');
  // Secret is only an in-memory identity value; never emitted or logged.
  const identity=JSON.stringify([config.key,nx,ny,base.date,base.time]);
  if(cached?.identity===identity&&cached.expires>now.getTime())return cached.value;
  if(pending?.identity===identity)return pending.promise;
  const promise=(async()=>{
   let result:KmaResult;
   try{
    const url=new URL(endpoint);url.search=new URLSearchParams({serviceKey:normalizeKmaKey(config.key!),pageNo:'1',numOfRows:'100',dataType:'JSON',base_date:base.date,base_time:base.time,nx:String(nx),ny:String(ny)}).toString();
    const r=await fetcher(url,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    if(!r.ok)throw Error('HTTP_ERROR');
    const text=await r.text();if(text.length>100000)throw Error('OVERSIZED_RESPONSE');
    result=parseObservation(JSON.parse(text),{nx,ny},base,clock());
   }catch{result=unavailable('UNAVAILABLE','FETCH_OR_VALIDATION_FAILED');}
   // Negative cache prevents repeated upstream calls on errors. No stale-as-live fallback.
   cached={identity,expires:clock().getTime()+(result.status==='READY'?600000:60000),value:result};return result;
  })();
  pending={identity,promise};try{return await promise}finally{if(pending?.promise===promise)pending=undefined}
 };
}
export const readKma=createKmaReader();
