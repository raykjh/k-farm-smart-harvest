import {expect,it,vi} from 'vitest';
import {precipitationBounds,summarizeWeatherDay} from '../lib/weather-day-summary';
import {createForecastReader,dailyForecastBase,parseForecast,type ForecastResult} from '../lib/kma-forecast';
const day='2026-09-22',now=new Date(day+'T18:00:00+09:00'),base=dailyForecastBase(now),grid={nx:72,ny:88};
const daily:ForecastResult={status:'READY',kind:'short',sourceUrl:'source',fetchedAt:now.toISOString(),points:Array.from({length:24},(_,h)=>({at:day+'T'+String(h).padStart(2,'0')+':00:00+09:00',temperatureC:10+h,windMs:h%3,humidityPercent:50+h,rainProbabilityPercent:0,precipitation:h===0?'1mm':'강수없음'}))};
it('uses all-day values, overlays newer hours, and calculates total rain',()=>{
 const latest={...daily,points:[{...daily.points[18],temperatureC:35,precipitation:'2mm'}]};
 const s=summarizeWeatherDay(day,daily,latest);expect(s.temperature).toEqual({min:10,max:35,complete:true});expect(s.humidity).toEqual({min:50,max:73,complete:true});expect(s.precipitation).toEqual({min:3,max:3,exclusiveMax:false});
});
it('does not call a partial day or missing rain zero; keeps uncertainty bounds',()=>{
 expect(summarizeWeatherDay(day,null,{...daily,points:daily.points.slice(18)}).precipitation).toBeNull();
 expect(summarizeWeatherDay(day,{...daily,points:daily.points.map((p,i)=>i? p:{...p,precipitation:null})}).precipitation).toBeNull();
 expect(precipitationBounds('1.0mm 미만')).toEqual({min:0,max:1,exclusiveMax:true});
 expect(precipitationBounds('50.0mm 이상')).toEqual({min:50,max:null,exclusiveMax:false});
 expect(precipitationBounds('30.0~50.0mm')).toEqual({min:30,max:50,exclusiveMax:false});
 expect(precipitationBounds('')).toBeNull();expect(precipitationBounds('not rain')).toBeNull();
});
const payload=()=>{const item=daily.points.flatMap(p=>[['TMP',p.temperatureC],['WSD',p.windMs],['REH',p.humidityPercent],['PCP',p.precipitation]].map(([category,fcstValue])=>({baseDate:base.date,baseTime:base.time,...grid,fcstDate:'20260922',fcstTime:p.at.slice(11,13)+'00',category,fcstValue})));return {response:{header:{resultCode:'00'},body:{totalCount:item.length,items:{item}}}}};
it('daily baseline explicitly retains elapsed hours; future forecast freshness stays strict',()=>{
 expect(base).toEqual({date:'20260921',time:'2300'});
 expect(parseForecast(payload(),'short',grid,base,now,true).points).toHaveLength(24);
 expect(()=>parseForecast(payload(),'short',grid,base,now)).toThrow('STALE_RUN');
 expect(()=>parseForecast(payload(),'short',grid,base,new Date('2026-09-23T01:00:00+09:00'),true)).toThrow('DAILY_BASE_MISMATCH');
});
it('caches a validated baseline by date and grid without repeatedly calling upstream',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(payload()))),read=createForecastReader('short',fetcher,()=>now,true),config={key:'test-key',nx:'72',ny:'88'};
 const [a,b]=await Promise.all([read(config),read(config)]);expect(a.points).toHaveLength(24);expect(b.points).toHaveLength(24);await read(config);expect(fetcher).toHaveBeenCalledTimes(1);
});
