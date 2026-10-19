'use client';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useState} from 'react';
import type {State,Mission} from '@/lib/types';
import {isClosedTask} from '@/lib/task-lifecycle';
import {useLanguage} from './language';
import {Button} from './ui/button';
import ScheduleChangeDialog from './schedule-change-dialog';
import {useKoreaDay} from './use-korea-day';
import TaskCancelForm from './task-cancel-form';
import EquipmentMissionPanel from './equipment-mission-panel';
import {historyActor,historyDate} from '@/lib/history-display';
export default function TaskOperations({mission:initialMission,state,initialTab='schedule',onClose,onSaved,onUpdated}:{mission:Mission;state:State;initialTab?:string;onClose:()=>void;onSaved:()=>Promise<void>;onUpdated?:()=>Promise<void>}){
 // The dialog stays open after saving; its original selection is not the latest plan.
 const m=state.missions.find(mission=>mission.id===initialMission.id)??initialMission;
 const today=useKoreaDay();
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [tab,setTab]=useState(isClosedTask(m.status)?'history':initialTab),[report,setReport]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[changes,setChanges]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState('COMPLETED'),[reason,setReason]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;Promise.all(['/api/work-reports','/api/execution-records','/api/work-history'].map(url=>fetch(url).then(r=>{if(!r.ok)throw Error(t('기록을 불러오지 못했습니다.','Could not load records.'));return r.json()}))).then(([r,e,h])=>{if(active){setReport(r);setHistory(e.history??[]);setChanges(h.changes??[])}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[revision,m.id,state.planVersion]);
 const row=report?.rows.find((r:any)=>r.missionId===m.id),closed=isClosedTask(m.status);
 async function changeTab(next:string){
  setTab(next);
  // Rescheduling keeps its saved-result receipt visible until the user leaves it.
  // Refresh here rather than changing its target/date while that receipt is shown.
  if(tab==='schedule'&&next!=='schedule')try{await onUpdated?.();setRevision(v=>v+1)}catch{setError(t('최신 기록을 불러오지 못했습니다. 다시 확인하세요.','Could not refresh the latest records. Please check again.'))}
 }
 async function save(e:React.FormEvent){e.preventDefault();if(!row||result!=='HELD')return;setBusy(true);setError('');try{
  const r=await fetch('/api/execution-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'execution',input:{id:crypto.randomUUID(),missionId:m.id,expectedPlanVersion:state.planVersion,expectedEvidenceId:row.evidenceId??null,status:result,startedAt:null,finishedAt:null,actor:'signed-in operator',reason}})}),d=await r.json();if(!r.ok)throw Error(d.error);await onUpdated?.();setRevision(v=>v+1);setTab('schedule');
 }catch(e){setError(e instanceof Error?e.message:'Error')}finally{setBusy(false)}}
 return <section className="task-management"><h3 className="task-management-title">{operationalText(m.label,locale)}</h3><div className="view-tabs task-management-tabs" aria-label={t('작업 관리 메뉴','Task management menu')}>{(closed?[['history',t('작업 이력','Task history')]]:[['schedule',t('일정변경','Reschedule')],['result',t('작업결과 입력','Record result')],['cancel',t('작업취소','Cancel task')],['history',t('작업 이력','Task history')]]).concat(m.resourceId&&!m.resourceOccupancyOnly?[['work-order',t('작업지시서','Work order')]]:[]).map(([key,name])=><button key={key} aria-pressed={tab===key} aria-controls="task-management-body" onClick={()=>void changeTab(key)}>{name}</button>)}</div>
 <div id="task-management-body" className="task-management-body" key={tab}>
 {tab==='schedule'&&<ScheduleChangeDialog state={state} today={today} eligibleIds={state.missions.filter(x=>!isClosedTask(x.status)).map(x=>x.id)} initialDate={m.scheduledDate} initialIds={[m.id]} taskSheet onClose={onClose} onSaved={onSaved} onUpdated={onUpdated}/>}
 {tab==='work-order'&&<EquipmentMissionPanel mission={m} state={state}/>}
 {tab==='cancel'&&<TaskCancelForm compact missions={[m]} state={state} onSaved={onSaved}/>}
 {tab==='result'&&<form onSubmit={save}><fieldset disabled={busy} className="ledger-form"><label>{t('작업 결과','Work result')}<select aria-label={t('작업 결과','Work result')} value={result} onChange={e=>setResult(e.target.value)}><option value="COMPLETED">{t('완료','Completed')}</option><option value="HELD">{t('미수행 · 재배치 필요','Not performed · reschedule')}</option></select></label>{result==='COMPLETED'?<><div className="work-result-receipt"><strong>{row?.confirmed?t('작업결과 수신 완료','Work result received'):t('작업결과 수신 대기','Awaiting work result')}</strong>{row?.confirmed&&<p>{t('작업시간','Duration')} · {row.executionMinutes??'—'} {t('분','min')}</p>}<p>{t('농지별 작업 이력에 저장됩니다.','Saved in the field work history.')}</p></div><Button type="button" variant="outline" onClick={()=>setRevision(v=>v+1)}>{t('수신 결과 새로고침','Refresh received result')}</Button></>:<><label>{t('미수행 사유','Reason not performed')}<textarea required value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><Button type="submit" disabled={!row||busy||!reason.trim()}>{t('미수행 저장 후 일정변경','Save and reschedule')}</Button></>}</fieldset></form>}
 {tab==='history'&&<><p>{t('현재 작업일','Scheduled date')}: {m.scheduledDate??'—'}</p>{m.cancellation&&<p>{t('취소','Cancelled')} · {historyDate(m.cancellation.confirmedAt)} · {historyActor(m.cancellation.confirmedBy)} · {m.cancellation.reason}</p>}{m.originalScheduledDate&&m.originalScheduledDate!==m.scheduledDate&&<p>{m.originalScheduledDate} → {m.scheduledDate}</p>}{changes.filter(c=>c.before?.id===m.id||c.after?.id===m.id).map((c,i)=><p key={i}>{historyDate(c.approvedAt)} · {c.before?.scheduledDate} → {c.after?.scheduledDate} · {operationalText(c.reason,locale)} · {historyActor(c.actor)}</p>)}{history.filter(r=>r.payload.missionId===m.id).map(r=><p key={r.id}>{historyDate(r.payload.confirmedAt??r.updatedAt)} · {r.payload.assessment} · {r.payload.reason} · {historyActor(r.payload.confirmedBy)}</p>)}</>}{error&&<p role="alert">{error}</p>}
 </div></section>;
}
