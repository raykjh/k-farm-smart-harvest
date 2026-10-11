import type {ForecastPoint,ForecastResult} from './kma-forecast';
type Bounds={min:number;max:number|null;exclusiveMax:boolean};
export function precipitationBounds(raw:string|null|undefined):Bounds|null{
 if(raw==='강수없음')return {min:0,max:0,exclusiveMax:false};
 if(!raw)return null;
 const m=raw.trim().match(/^(\d+(?:\.\d+)?)(?:\s*~\s*(\d+(?:\.\d+)?))?\s*(?:mm)?\s*(미만|이상)?$/);
 if(!m)return null;const a=Number(m[1]),b=m[2]?Number(m[2]):a;
 if(b<a)return null;
 return {min:m[3]==='미만'?0:a,max:m[3]==='이상'?null:b,exclusiveMax:m[3]==='미만'};
}
export function summarizeWeatherDay(day:string,daily?:ForecastResult|null,latest?:ForecastResult|null){
 const byTime=new Map<string,ForecastPoint>();
 for(const forecast of [daily,latest])if(forecast?.status==='READY')for(const p of forecast.points){
  if(p.at.slice(0,10)!==day||p.at.slice(14,16)!=='00')continue;
  const old=byTime.get(p.at);byTime.set(p.at,old?{...p,temperatureC:p.temperatureC??old.temperatureC,windMs:p.windMs??old.windMs,humidityPercent:p.humidityPercent??old.humidityPercent,precipitation:p.precipitation??old.precipitation}:p);
 }
 const points=[...byTime.values()],complete=points.length===24&&new Set(points.map(p=>p.at.slice(11,13))).size===24;
 const range=(key:'temperatureC'|'windMs'|'humidityPercent')=>{const values=points.map(p=>p[key]).filter((v):v is number=>v!=null&&Number.isFinite(v));return values.length?{min:Math.min(...values),max:Math.max(...values),complete:complete&&values.length===24}:null};
 const rain=points.map(p=>precipitationBounds(p.precipitation));
 const precipitation:Bounds|null=complete&&rain.every((v):v is Bounds=>v!==null)?{min:rain.reduce((s,v)=>s+v.min,0),max:rain.some(v=>v.max===null)?null:rain.reduce((s,v)=>s+v.max!,0),exclusiveMax:rain.some(v=>v.exclusiveMax)}:null;
 return {temperature:range('temperatureC'),wind:range('windMs'),humidity:range('humidityPercent'),precipitation,hours:points.length,baselineIssuedAt:daily?.status==='READY'?daily.issuedAt:undefined,latestIssuedAt:latest?.status==='READY'?latest.issuedAt:undefined};
}
