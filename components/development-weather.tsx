'use client';
import {useState,useEffect} from 'react';
import type {State} from '@/lib/types';
import type {IncidentKind} from '@/lib/incident';
import ReplanManager from './replan-manager';
import {useLanguage} from './language';
import {Button} from './ui/button';
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export default function DevelopmentWeather({state,onRefresh}:{state:State;onRefresh:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [day,setDay]=useState(today()),[kind,setKind]=useState<IncidentKind>('WIND'),[machineId,setMachine]=useState(''),[jobId,setJob]=useState(''),[workerId,setWorker]=useState(''),[data,setData]=useState<any>({events:[],jobs:[]}),[result,setResult]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){const r=await fetch('/api/incidents',{cache:'no-store'});if(!r.ok)throw Error('사건 조회 실패');setData(await r.json())}
 useEffect(()=>{void load().catch(e=>setError(String(e)))},[]);
 const reset=()=>{setResult(null);setError('')};
 async function inject(){setBusy(true);setError('');setResult(null);try{
  const r=await fetch('/api/incidents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),kind,day,...(kind==='BREAKDOWN'?{machineId}:kind==='ABSENCE'?{jobId,workerId}:{})})}),d=await r.json();if(!r.ok)throw Error(d.error);await onRefresh();await load();setResult(d);
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <details className="card section-space" data-testid="incident-console"><summary>{t('개발용 상황 발생','Inject development event')}</summary><p>{t('버튼은 사건만 입력합니다. 현재 저장자료와 공통 계산·승인 경로로 대응합니다. 실제 기상 관측은 덮어쓰지 않습니다. 고장은 장비 상태, 불참은 배정 상태를 실제 저장하며 별도 복구가 필요합니다.','Injects an event into current records and shared planning/approval paths, without overwriting observations. Breakdown and absence persist equipment/allocation changes; they are not temporary previews.')}</p>
 <fieldset disabled={busy} style={{border:0}}><label>{t('대상 날짜','Target date')}<input type="date" value={day} onChange={e=>{setDay(e.target.value);reset()}}/></label><label>{t('발생 상황','Event')}<select aria-label={t('발생 상황','Event')} value={kind} onChange={e=>{setKind(e.target.value as IncidentKind);reset()}}>{[['WIND','강풍','Strong wind'],['RAIN','폭우','Heavy rain'],['DROUGHT','가뭄','Drought'],['BREAKDOWN','장비 고장','Equipment breakdown'],['ABSENCE','배정 인력 불참','Assigned worker absence']].map(([v,ko,en])=><option key={v} value={v}>{t(ko,en)}</option>)}</select></label>
 {kind==='BREAKDOWN'&&<label>{t('고장 대상 장비','Failed equipment')}<select aria-label={t('고장 대상 장비','Failed equipment')} value={machineId} onChange={e=>{setMachine(e.target.value);reset()}}><option value="">—</option>{state.machines.map(m=><option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}</select></label>}
 {kind==='ABSENCE'&&<><label>{t('인력 작업','Labor task')}<select aria-label={t('인력 작업','Labor task')} value={jobId} onChange={e=>{setJob(e.target.value);setWorker('');reset()}}><option value="">—</option>{data.jobs.filter((j:any)=>j.date===day).map((j:any)=><option key={j.id} value={j.id}>{j.task}</option>)}</select></label><label>{t('불참 배정자','Absent worker')}<select aria-label={t('불참 배정자','Absent worker')} value={workerId} onChange={e=>{setWorker(e.target.value);reset()}}><option value="">—</option>{data.jobs.find((j:any)=>j.id===jobId)?.workers.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></>}
 <Button disabled={!day||(kind==='BREAKDOWN'&&!machineId)||(kind==='ABSENCE'&&(!jobId||!workerId))} onClick={inject}>{t('상황 발생 · 대응 계산','Inject event and calculate response')}</Button></fieldset>
 {error&&<p role="alert">{error}</p>}{result&&<><p role="status">{result.source==='NEBIUS'?t('AI 실호출 · 공통 계산 엔진','Live AI · common engine'):t('규칙·공통 계산 엔진 · AI 실호출 아님','Rules / common engine · not a live AI call')} · {result.status}</p><p>{result.summary??result.reason}</p>{result.shortage!==undefined&&<p>{t('미충원','Unfilled')}: {result.shortage}</p>}<p>{t('영향 작업','Affected tasks')} {result.ids?.length??0} · {t('영향 범위 밖','Outside event scope')} {result.unchanged?.length??0}</p>
 {result.ids?.length>0&&<ReplanManager key={result.eventId} ids={result.ids} day={day} simulation={kind==='WIND'||kind==='RAIN'?{kind,from:day,to:day}:undefined} state={state} initialResult={result.proposalId?result:null} onClose={()=>setResult(null)} onSaved={async()=>{setResult(null);await onRefresh();await load()}}/>}</>}
 <details><summary>{t('최근 주입 사건','Recent injected events')}</summary>{data.events.map((e:any)=><p key={e.id}>{e.input.day} · {e.input.kind} · {e.status} · {e.result?.source??'—'} · {e.result?.status??'—'}</p>)}</details></details>;
}
