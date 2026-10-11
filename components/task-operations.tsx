'use client';
import {useEffect,useState} from 'react';
import type {State,Mission} from '@/lib/types';
import {isClosedTask} from '@/lib/task-lifecycle';
import {useLanguage} from './language';
import {Button} from './ui/button';
import ReplanManager from './replan-manager';
import TaskCancelForm from './task-cancel-form';
export default function TaskOperations({mission:m,state,initialTab='schedule',onClose,onSaved}:{mission:Mission;state:State;initialTab?:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [tab,setTab]=useState(isClosedTask(m.status)?'history':initialTab),[report,setReport]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[changes,setChanges]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState('COMPLETED'),[reason,setReason]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 useEffect(()=>{let active=true;Promise.all(['/api/work-reports','/api/execution-records','/api/work-history'].map(url=>fetch(url).then(r=>{if(!r.ok)throw Error(t('기록을 불러오지 못했습니다.','Could not load records.'));return r.json()}))).then(([r,e,h])=>{if(active){setReport(r);setHistory(e.history??[]);setChanges(h.changes??[])}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
 const row=report?.rows.find((r:any)=>r.missionId===m.id),closed=isClosedTask(m.status);
 async function save(e:React.FormEvent){e.preventDefault();if(!row)return;setBusy(true);setError('');try{
  const r=await fetch('/api/execution-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'execution',input:{id:crypto.randomUUID(),missionId:m.id,expectedPlanVersion:state.planVersion,expectedEvidenceId:row.evidenceId??null,status:result,startedAt:result==='COMPLETED'?start+':00+09:00':null,finishedAt:result==='COMPLETED'?end+':00+09:00':null,actor:'signed-in operator',reason}})}),d=await r.json();if(!r.ok)throw Error(d.error);await onSaved();
 }catch(e){setError(e instanceof Error?e.message:'Error')}finally{setBusy(false)}}
 return <section><h3>{m.label}</h3><div className="view-tabs">{(closed?[['history',t('작업 이력','Task history')]]:[['schedule',t('일정변경','Reschedule')],['result',t('작업결과 입력','Record result')],['cancel',t('작업취소','Cancel task')],['history',t('작업 이력','Task history')]]).map(([key,name])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{name}</button>)}</div>
 {tab==='schedule'&&<ReplanManager state={state} ids={[m.id]} preferredDate={m.scheduledDate} onClose={onClose} onSaved={onSaved}/>}
 {tab==='cancel'&&<TaskCancelForm missions={[m]} state={state} onSaved={onSaved}/>}
 {tab==='result'&&<form onSubmit={save}><fieldset disabled={busy} className="ledger-form"><label>{t('작업 결과','Work result')}<select aria-label={t('작업 결과','Work result')} value={result} onChange={e=>setResult(e.target.value)}><option value="COMPLETED">{t('완료','Completed')}</option><option value="HELD">{t('미수행 · 재배치 필요','Not performed · reschedule')}</option></select></label>{result==='COMPLETED'&&<><label>{t('작업 시작 (한국시간)','Started (KST)')}<input required type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>{t('작업 종료 (한국시간)','Finished (KST)')}<input required type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label></>}<label>{t('결과 확인 내용','Result confirmation')}<textarea required value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><Button type="submit" disabled={!row||busy||!reason.trim()}>{t('작업결과 저장','Save result')}</Button></fieldset></form>}
 {tab==='history'&&<><p>{t('현재 작업일','Scheduled date')}: {m.scheduledDate??'—'}</p>{m.cancellation&&<p>{t('취소','Cancelled')} · {m.cancellation.confirmedAt} · {m.cancellation.confirmedBy} · {m.cancellation.reason}</p>}{m.originalScheduledDate&&m.originalScheduledDate!==m.scheduledDate&&<p>{m.originalScheduledDate} → {m.scheduledDate}</p>}{changes.filter(c=>c.before?.id===m.id||c.after?.id===m.id).map((c,i)=><p key={i}>{c.approvedAt} · {c.before?.scheduledDate} → {c.after?.scheduledDate} · {c.reason} · {c.actor}</p>)}{history.filter(r=>r.payload.missionId===m.id).map(r=><p key={r.id}>{r.payload.confirmedAt??r.updatedAt} · {r.payload.assessment} · {r.payload.reason} · {r.payload.confirmedBy}</p>)}</>}{error&&<p role="alert">{error}</p>}
 </section>;
}
