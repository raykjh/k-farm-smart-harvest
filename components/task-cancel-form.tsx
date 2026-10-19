'use client';
import {useState} from 'react';
import type {Mission,State} from '@/lib/types';
import {isClosedTask,cancellationReasons} from '@/lib/task-lifecycle';
import {useLanguage} from './language';
import {Button} from './ui/button';
export default function TaskCancelForm({missions,state,onSaved,compact=false}:{missions:Mission[];state:State;onSaved:()=>Promise<void>;compact?:boolean}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [category,setCategory]=useState('UNNECESSARY'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const targetFields=new Set(missions.map(m=>m.fieldId)),affected=category==='UNNECESSARY'?missions:state.missions.filter(m=>targetFields.has(m.fieldId)&&!isClosedTask(m.status));
 const [requestId]=useState(()=>crypto.randomUUID());
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
  const r=await fetch('/api/task-cancellations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,expectedPlanVersion:state.planVersion,missionIds:missions.map(m=>m.id),category,reason,unperformedConfirmed:confirmed})}),d=await r.json();if(!r.ok)throw Error(d.error);await onSaved();
 }catch(e){setError(e instanceof Error?e.message:'Error')}finally{setBusy(false)}}
 return <form onSubmit={save}><fieldset disabled={busy} className="ledger-form">{!compact&&<><p>{missions.length}{t('건의 작업을 종료하고 장비 예약·인력 배정을 해제합니다. 작업 기록은 삭제하지 않습니다.',' tasks will be closed and their reservations and labor assignments released. Records are retained.')}</p><ul>{missions.map(m=><li key={m.id}>{m.scheduledDate??m.originalScheduledDate} · {m.label}</li>)}</ul></>}<label>{t('취소 구분','Cancellation category')}<select aria-label={t('취소 구분','Cancellation category')} value={category} onChange={e=>{setCategory(e.target.value);setConfirmed(false)}}>{cancellationReasons.map(([v,ko,en])=><option value={v} key={v}>{locale==='ko'?ko:en}</option>)}</select></label><label>{t('취소 사유','Cancellation reason')}<textarea required value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{category==='UNNECESSARY'?t('선택 작업이 수행되지 않았으며 생략·종료하기로 결정했음을 확인합니다.','I confirm the selected work was not performed and has been approved for omission or closure.'):t('해당 농지의 남은 작업 전체를 종료하고 기존 실적은 보관합니다.','Close all remaining work on this field and retain completed records.')}</label>{category!=='UNNECESSARY'&&<p role="status">{targetFields.size}{t('필지 · 남은 작업 ',' fields · remaining tasks ')}{affected.length}{t('건 종료',' closed')} · {category==='WITHDRAWAL'?t('관리 농지에서 제외하며 기존 실적은 보관합니다.','Removed from active fields; history retained.'):t('작물 선택 필요 상태로 전환합니다.','Returns to crop selection.')}</p>}{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={busy||!confirmed||!reason.trim()}>{t('작업 취소 확정','Confirm task cancellation')}</Button></fieldset></form>;
}
