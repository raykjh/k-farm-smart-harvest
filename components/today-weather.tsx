'use client';
import {useEffect,useState} from 'react';
import type {KmaResult} from '@/lib/kma';
import type {ForecastResult} from '@/lib/kma-forecast';
import {summarizeWeatherDay} from '@/lib/weather-day-summary';
import {useLanguage} from './language';
import {useKoreaDay} from './use-korea-day';
import WeatherForecast from './weather-forecast';
import Modal from './modal';
export default function TodayWeather({space}:{space:'sandbox'|'operations'}){
 const [details,setDetails]=useState(false),day=useKoreaDay();
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [current,setCurrent]=useState<KmaResult|null>(null),[forecasts,setForecasts]=useState<{short:ForecastResult;daily?:ForecastResult}|null>(null);
 useEffect(()=>{let active=true;async function load(){
  const [obs,fc]=await Promise.allSettled([fetch('/api/weather',{cache:'no-store'}).then(r=>r.ok?r.json():null),fetch('/api/weather/forecast',{cache:'no-store'}).then(r=>r.ok?r.json():null)]);
  if(!active)return;setCurrent(obs.status==='fulfilled'?obs.value:null);setForecasts(fc.status==='fulfilled'?fc.value:null);
 }void load();const timer=setInterval(load,600000);return()=>{active=false;clearInterval(timer)}},[day]);
 const summary=summarizeWeatherDay(day,forecasts?.daily,forecasts?.short),ready=current?.status==='READY'&&!!current.observedAt&&Date.now()-Date.parse(current.observedAt)>=0&&Date.now()-Date.parse(current.observedAt)<=2*3600000;
 const number=(n:number)=>Number(n.toFixed(1)).toLocaleString(locale==='ko'?'ko-KR':'en-GB');
 const range=(v:{min:number;max:number;complete:boolean}|null,unit:string)=>v?`${number(v.min)}–${number(v.max)} ${unit}${v.complete?'':t(' (일부 시간)',' (partial)')}`:'—';
 const rain=summary.precipitation,rainText=!rain?'—':rain.max===null?`${number(rain.min)} mm ${t('이상','or more')}`:rain.min===rain.max?`${number(rain.min)} mm`:`${number(rain.min)}–${number(rain.max)} mm${rain.exclusiveMax?t(' 미만',' (upper bound excluded)'):''}`;
 const values=[
  {id:'temperature',label:t('현재기온','Temperature now'),value:ready?current.temperatureC:null,unit:'°C',rangeLabel:t('기온범위','Temperature range'),range:range(summary.temperature,'°C')},
  {id:'wind',label:t('풍속','Wind'),value:ready?current.windMs:null,unit:'m/s',rangeLabel:t('풍속범위','Wind range'),range:range(summary.wind,'m/s')},
  {id:'humidity',label:t('습도','Humidity'),value:ready?current.humidityPercent:null,unit:'%',rangeLabel:summary.humidity?t('습도범위','Humidity range'):'',range:range(summary.humidity,'%')},
  {id:'rain',label:t('시간당 강수량','Hourly precipitation'),value:ready?current.precipitationMm:null,unit:'mm',rangeLabel:t('일일 예상 강수량','Expected daily precipitation'),range:rainText},
 ];
 return <section className="card weather weather-summary" data-testid="today-weather">
  <div className="card-head"><h2>{t('오늘 날씨','Today’s weather')}</h2></div>
  <div className="weather-values">{values.map(v=><div className="weather-value" key={v.id} data-testid={'weather-'+v.id}>
   <span className="weather-value-label">{v.label}</span><strong className="weather-value-now" data-testid={v.id==='temperature'?'current-temperature':undefined}>{v.value??'—'} <small>{v.unit}</small></strong>
   <div className="weather-value-range" data-testid={v.id==='temperature'?'weather-day-range':undefined}>{v.rangeLabel&&<><span>{v.rangeLabel}</span><strong>{v.range}</strong></>}</div>
  </div>)}</div>
  <footer className="weather-footer"><span>{t('기준시간','As of')} · {ready?new Date(current.observedAt!).toLocaleTimeString(locale==='ko'?'ko-KR':'en-US',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:true}):'—'}</span><span><b>{t('출처','Source')}</b> : <b>{t('기상청','KMA')}</b> <button className="weather-source-link" onClick={()=>setDetails(true)}>[{t('상세 예보보기','Forecast details')}]</button></span></footer>
  {details&&<Modal title={t('기상청 상세 예보·출처','KMA forecasts and sources')} onClose={()=>setDetails(false)}><p>{t('하루 범위·강수량: 전일 23시 발표 예보에 최신 예보를 반영합니다. 지나간 시간대도 예보값이며 실제 관측 합계가 아닙니다. 24시간 강수 자료가 없으면 일일 합계는 표시하지 않습니다.','Daily ranges and rain combine the previous 23:00 forecast with the latest forecast. Past hours remain forecast values, not observed totals. Daily rain requires all 24 hourly values.')}</p><p>{t('하루 예보 기준','Daily baseline')}: {summary.baselineIssuedAt??'—'} · {t('최신 예보 기준','Latest forecast')}: {summary.latestIssuedAt??'—'}</p><WeatherForecast/></Modal>}
 </section>;
}
