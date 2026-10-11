import {z} from 'zod';
export const environmentRuleSchema=z.object({
 metric:z.enum(['meanTemperatureC','minTemperatureC','soilTemperatureC']),
 lowerC:z.number().min(-50).max(60).nullable(),upperC:z.number().min(-50).max(60).nullable(),
 consecutiveDays:z.number().int().min(1).max(60),
 minimumNightC:z.number().min(-50).max(60).nullable(),
}).strict().refine(v=>(v.lowerC!==null||v.upperC!==null)&&(v.lowerC===null||v.upperC===null||v.lowerC<=v.upperC),'환경 조건의 온도 범위를 확인하세요.');
export type EnvironmentRule=z.infer<typeof environmentRuleSchema>;
export type WeatherDay={date:string;meanTemperatureC:number|null;minTemperatureC:number|null;soilTemperatureC:number|null};
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
/** Missing days/metrics break a run. Never impute soil temperature from air temperature. */
export function environmentWindows(raw:EnvironmentRule,days:WeatherDay[],from:string,to:string){
 const rule=environmentRuleSchema.parse(raw);
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>732*86400000)throw Error('Invalid calculation period');
 const map=new Map<string,WeatherDay>();
 for(const d of days){if(!validDate(d.date)||map.has(d.date))throw Error('Invalid or duplicate weather day');map.set(d.date,d);}
 const windows:{from:string;to:string}[]=[];let run=0,missingDays=0,failedDays=0;
 for(let at=Date.parse(from);at<=Date.parse(to);at+=86400000){
  const date=new Date(at).toISOString().slice(0,10),d=map.get(date),value=d?.[rule.metric],night=d?.minTemperatureC;
  if(value==null||!Number.isFinite(value)||(rule.minimumNightC!==null&&(night==null||!Number.isFinite(night)))){missingDays++;run=0;continue;}
  if((rule.lowerC!==null&&value<rule.lowerC)||(rule.upperC!==null&&value>rule.upperC)||(rule.minimumNightC!==null&&night!<rule.minimumNightC)){failedDays++;run=0;continue;}
  run++;if(run<rule.consecutiveDays)continue;
  const last=windows.at(-1);if(last&&Date.parse(last.to)+86400000===at)last.to=date;else windows.push({from:date,to:date});
 }
 return {windows,missingDays,failedDays,status:windows.length?'CANDIDATE':missingDays?'INSUFFICIENT_DATA':'NO_MATCH',automaticScheduling:false as const};
}
