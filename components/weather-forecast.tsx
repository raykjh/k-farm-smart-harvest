'use client';
import {useEffect,useState} from 'react';
import type {ForecastResult} from '@/lib/kma-forecast';
import {useLanguage} from './language';
export default function WeatherForecast(){
 const {locale}=useLanguage(),ko=locale==='ko';
 const [data,setData]=useState<{ultra:ForecastResult;short:ForecastResult}|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;const load=async()=>{try{const r=await fetch('/api/weather/forecast');if(!r.ok)throw Error();const value=await r.json();if(active){setData(value);setFailed(false)}}catch{if(active){setData(null);setFailed(true)}}};void load();const timer=setInterval(load,600000);return()=>{active=false;clearInterval(timer)}},[]);
 const time=(value:string)=>new Date(value).toLocaleString(ko?'ko-KR':'en-GB',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const rain=(value:string|null)=>{if(value===null)return '—';if(ko)return value;return value.replace('강수없음','No precipitation').replace('미만','(less than)').replace('이상','or more')};
 return <section className="card section-space" data-testid="weather-forecast"><h2>{ko?'기상청 시간별 예보':'KMA hourly forecasts'}</h2>
 <p className="description">{ko?'센터에 설정된 기상청 격자 · 한국 표준시 · 발표 지연을 고려한 예보 조회':'Configured center KMA grid · Korea Standard Time · publication buffer applied'}</p>
 {(['ultra','short'] as const).map(kind=>{const r=data?.[kind];return <div key={kind} data-testid={`forecast-${kind}`}>
 <h3>{kind==='ultra'?(ko?'초단기예보':'Ultra-short forecast'):(ko?'단기예보':'Short-range forecast')}</h3>
 {r?.status==='READY'?<><p className="description">{ko?'응답 기준시각':'Response base time'}: {time(r.issuedAt!)} · {ko?'수집':'Fetched'}: {time(r.fetchedAt)} · {ko?'격자':'Grid'}: {r.grid?.nx}, {r.grid?.ny}</p>
 {r.requestedBaseAt&&r.requestedBaseAt!==r.issuedAt&&<p className="description">{ko?'요청 발표시각':'Requested issuance'}: {time(r.requestedBaseAt)}</p>}
 <details open={kind==='ultra'}><summary>{ko?`향후 시간별 예보 ${r.points.length}개 보기`:`View ${r.points.length} upcoming hourly forecasts`}</summary>
 <div style={{overflowX:'auto',maxHeight:420}} tabIndex={0} role="region" aria-label={ko?'시간별 예보 표':'Hourly forecast table'}><table style={{width:'100%',minWidth:600}}><thead><tr>{(ko?['예보 대상 시각','기온 (℃)','풍속 (m/s)','습도 (%)','강수확률 (%)','1시간 강수량 (mm)']:['Forecast time','Temp (°C)','Wind (m/s)','Humidity (%)','Rain chance (%)','1-hour rain (mm)']).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{r.points.map(p=><tr key={p.at}><td>{time(p.at)}</td><td>{p.temperatureC??'—'}</td><td>{p.windMs??'—'}</td><td>{p.humidityPercent??'—'}</td><td>{p.rainProbabilityPercent??'—'}</td><td>{rain(p.precipitation)}</td></tr>)}</tbody></table></div></details></>:<p className="notice">{r?.status==='NOT_CONFIGURED'?(ko?'연결 대기 — 인증키와 격자를 확인하세요.':'Connection pending — check the key and grid.'):(failed||r?.status==='UNAVAILABLE')?(ko?'예보 수신 실패 — 이 예보는 사용할 수 없습니다.':'Forecast unavailable — do not use this forecast.'):(ko?'예보 확인 중':'Loading forecast')}</p>}
 </div>})}
 <p className="description small">{ko?'예보는 관측값이나 장비 작업 허가가 아닙니다. —는 미제공·검증 불가이며 0이 아닙니다. 제공된 시각과 항목만 표시하며 중간값을 보간하지 않습니다. 일정 변경과 장비 작업 시작은 별도 운영 절차를 따릅니다.':'Forecasts are not observations or equipment clearance. — means missing or unverified, not zero. Only supplied times and values are shown, without interpolation. Schedule changes and equipment starts follow the operating approval process.'}</p>
 <a href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noreferrer">{ko?'출처: 기상청 단기예보 조회서비스':'Source: KMA forecast service'}</a>
 </section>;
}
