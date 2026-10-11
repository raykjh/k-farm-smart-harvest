'use client';
import {useEffect,useState} from 'react';
import type {KmaResult} from '@/lib/kma';
import {useLanguage} from './language';
import WeatherForecast from './weather-forecast';
export default function LiveWeather(){
 const {locale}=useLanguage(),ko=locale==='ko';const [data,setData]=useState<KmaResult|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;const load=()=>fetch('/api/weather').then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(active){setData(d);setFailed(false)}}).catch(()=>{if(active){setData(null);setFailed(true)}});void load();const timer=setInterval(load,600000);return()=>{active=false;clearInterval(timer)}},[]);
 const time=(t:string)=>new Date(t).toLocaleString(ko?'ko-KR':'en-GB',{timeZone:'Asia/Seoul'});
 return <><section className="card section-space" data-testid="live-weather"><h2>{ko?'기상청 현재 날씨':'Current KMA weather'}</h2>
 <p className="description">{ko?'실황 관측 자료 · 한국 표준시 · 시연 일정과 별도':'Observed conditions · Korea Standard Time · separate from the simulation schedule'}</p>
 {data?.status==='READY'?<><p>{ko?'기온':'Temperature'}: {data.temperatureC??'—'} °C · {ko?'풍속':'Wind'}: {data.windMs??'—'} m/s · {ko?'습도':'Humidity'}: {data.humidityPercent??'—'} %</p><p className="description">{ko?'관측':'Observed'}: {time(data.observedAt!)} · {ko?'수집':'Fetched'}: {time(data.fetchedAt)} · {ko?'격자':'Grid'}: {data.grid?.nx}, {data.grid?.ny}</p></>:<p className="notice">{data?.status==='NOT_CONFIGURED'?(ko?'연결 대기 — 서버 인증키와 확인된 기상청 격자가 필요합니다.':'Connection pending — a server API key and verified KMA grid are required.'):(failed||data?.status==='UNAVAILABLE')?(ko?'자료 수신 실패 — 실제 날씨를 확인할 수 없습니다.':'Data unavailable — current weather could not be verified.'):(ko?'연결 상태 확인 중':'Checking connection')}</p>}
 <p className="description small">{ko?'농지 현장 센서나 작업 안전 판정이 아닙니다. 이 자료는 2027년 모의 강풍·배차·장비 명령에 자동 적용되지 않습니다. 누락값은 0으로 대체하지 않습니다.':'Not an on-field sensor or safety clearance. These observations do not automatically alter the 2027 simulated wind event, dispatch plan or device commands. Missing values are not replaced with zero.'}</p>
 <a href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noreferrer">{ko?'기상청 공식 API · 출처':'Official KMA API · source'}</a></section><WeatherForecast/></>;
}
