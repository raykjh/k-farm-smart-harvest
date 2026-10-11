'use client';
import {useEffect,useState} from 'react';
import type {EnvironmentRule} from '@/lib/environment-window';
import {useLanguage} from './language';
export default function EnvironmentRuleEditor({value,onChange}:{value:EnvironmentRule;onChange:(v:EnvironmentRule)=>void}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [datasets,setDatasets]=useState<{id:string;station:string;period:string}[]>([]),[dataset,setDataset]=useState(''),[year,setYear]=useState(new Date().getFullYear()),[basis,setBasis]=useState('NORMAL'),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/environment-windows').then(async r=>{if(!r.ok)throw Error();const d=await r.json();setDatasets(d.datasets);setDataset(d.datasets[0]?.id??'');}).catch(()=>setError(t('기상자료 목록 조회 실패','Weather dataset unavailable')));},[]);
 useEffect(()=>{setResult(null);setError('');},[value,dataset,year,basis]);
 const number=(v:string)=>v===''?null:Number(v);
 async function calculate(){setBusy(true);setError('');setResult(null);try{const r=await fetch('/api/environment-windows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetId:dataset,year,basis,rule:value})}),d=await r.json();if(!r.ok)throw Error(d.error);setResult(d);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <div style={{gridColumn:'1 / -1',padding:12,background:'#f3f7f1'}}>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12}}>
 <label>{t('온도 지표','Temperature metric')}<select value={value.metric} onChange={e=>onChange({...value,metric:e.target.value as EnvironmentRule['metric']})}><option value="meanTemperatureC">{t('일평균 기온','Daily mean air')}</option><option value="minTemperatureC">{t('일최저 기온','Daily minimum air')}</option><option value="soilTemperatureC">{t('지온 (자료 필요)','Soil (data required)')}</option></select></label>
 <label>{t('조건 하한 (℃)','Condition lower (°C)')}<input type="number" step="any" value={value.lowerC??''} onChange={e=>onChange({...value,lowerC:number(e.target.value)})}/></label>
 <label>{t('조건 상한 (℃)','Condition upper (°C)')}<input type="number" step="any" value={value.upperC??''} onChange={e=>onChange({...value,upperC:number(e.target.value)})}/></label>
 <label>{t('연속 충족 일수','Consecutive days')}<input type="number" min="1" max="60" value={value.consecutiveDays} onChange={e=>onChange({...value,consecutiveDays:Number(e.target.value)})}/></label>
 <label>{t('추가 최저기온 하한 (℃)','Additional daily minimum (°C)')}<input type="number" step="any" value={value.minimumNightC??''} onChange={e=>onChange({...value,minimumNightC:number(e.target.value)})}/></label>
 </div><details><summary>{t('지역 기상자료로 기간 계산','Calculate windows from regional weather')}</summary>
 <label>{t('관측소·평년자료','Station / normal dataset')}<select value={dataset} onChange={e=>setDataset(e.target.value)}>{!datasets.length&&<option value="">{t('등록된 자료 없음','No datasets')}</option>}{datasets.map(d=><option key={d.id} value={d.id}>{d.station} · {d.period}</option>)}</select></label>
 <label>{t('계산 연도','Calculation year')}<input type="number" min="2000" max="2200" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
 <label>{t('계산 자료','Weather basis')}<select value={basis} onChange={e=>setBasis(e.target.value)}><option value="NORMAL">{t('평년자료 · 연간 초안 참고','Normals · annual draft')}</option><option value="OBSERVED">{t('해당 연도 관측 · 지난 기간 확인','Year observations · historical check')}</option></select></label>
 <button type="button" disabled={busy||!dataset} onClick={calculate}>{t('조건 충족 기간 계산','Calculate qualifying windows')}</button>
 {error&&<p role="alert">{error}</p>}
 {result&&<div role="status"><p>{result.station} · {result.period} · {result.warning}</p><p>{t('자료 부족 일수','Missing days')}: {result.missingDays}</p>{result.windows.length?<ul>{result.windows.map((w:any)=><li key={w.from}>{w.from} ~ {w.to}</li>)}</ul>:<p>{result.status==='INSUFFICIENT_DATA'?t('필수 기상자료 부족 · 날짜 미확정','Required weather missing; no dates confirmed'):t('조건 충족 기간 없음','No qualifying windows')}</p>}<p>{t('환경 조건만의 후보입니다. 생육·품종·현장 확인 및 자원 배차 전이며 기존 일정을 바꾸지 않습니다.','Environmental candidates only; growth, variety, field checks and resource allocation still required. Existing schedules unchanged.')}</p></div>}
 </details></div>;
}
