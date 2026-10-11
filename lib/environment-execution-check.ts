import {z} from 'zod';
import type {ForecastResult} from './kma-forecast';
import {environmentWindows,type WeatherDay} from './environment-window';
export const growthReviewSchema=z.object({reviewer:z.string().trim().min(1).max(100),checkedOn:z.iso.date(),validUntil:z.iso.date(),note:z.string().trim().min(1).max(2000),ready:z.boolean()}).strict().refine(v=>v.checkedOn<=v.validUntil);
export type GrowthReview=z.infer<typeof growthReviewSchema>;
export function checkEnvironmentExecution(assignments:{date:string;startMinute:number;durationMinutes:number;taskId:string}[],plan:any,forecast:ForecastResult,review:GrowthReview,now=new Date()){
 const today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
 if(!growthReviewSchema.safeParse(review).success||!review.ready||review.checkedOn>today||review.validUntil<today)throw Error('유효한 생육·현장 준비 확인이 필요합니다.');
 if(forecast.status!=='READY'||!forecast.issuedAt||now.getTime()-Date.parse(forecast.issuedAt)>5*3600000||Date.parse(forecast.issuedAt)>now.getTime())throw Error('최신 단기예보 확인이 필요합니다.');
 for(const a of assignments){
  if(a.date>review.validUntil)throw Error('생육 확인 유효기간을 벗어난 작업입니다.');
  const task=plan.plots.flatMap((p:any)=>p.tasks).find((t:any)=>t.id===a.taskId),req=task?.requirements;
  const plot=plan.plots.find((p:any)=>p.tasks.some((t:any)=>t.id===a.taskId));
  const environmental=plot?.environmental?.operations.find((o:any)=>o.code===task?.operationCode);
  if(environmental?.rule){
   const days:WeatherDay[]=[];
   for(const date of [...new Set(forecast.points.map(p=>p.at.slice(0,10)))]){
    const values=forecast.points.filter(p=>p.at.slice(0,10)===date);const hours=new Set(values.map(p=>p.at.slice(11,13)));
    const complete=hours.size===24&&values.length===24&&values.every(p=>p.temperatureC!==null);
    days.push({date,meanTemperatureC:complete?values.reduce((n,p)=>n+p.temperatureC!,0)/24:null,minTemperatureC:complete?Math.min(...values.map(p=>p.temperatureC!)):null,soilTemperatureC:null});
   }
   const start=new Date(Date.parse(a.date)-(environmental.rule.consecutiveDays-1)*86400000).toISOString().slice(0,10);
   if(!environmentWindows(environmental.rule,days,start,a.date).windows.some(w=>w.from<=a.date&&a.date<=w.to))throw Error('예보에서 온도 조건을 충족하는지 확인되지 않았습니다. 지온·지난 관측 등 부족 자료를 보강하세요.');
  }
  if(!req||req.windLimitMs==null)throw Error('작업 풍속 한계 검토가 필요합니다.');
  for(let m=a.startMinute;m<a.startMinute+a.durationMinutes;m+=15){
   const hour=Math.floor(m/60),at=`${a.date}T${String(hour).padStart(2,'0')}:00:00+09:00`;
   const p=forecast.points.find(p=>p.at===at);
   if(!p||p.windMs===null||req.rainSensitive&&p.precipitation===null)throw Error('예보 범위 밖·누락 시간은 실행 승인할 수 없습니다.');
   if(p.windMs>=req.windLimitMs||req.rainSensitive&&!['강수없음','0','0mm'].includes(p.precipitation!))throw Error('강풍·강수 조건으로 작업 승인이 보류되었습니다.');
  }
 }
}
