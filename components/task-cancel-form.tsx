'use client';
import {useState} from 'react';
import type {Mission,State} from '@/lib/types';
import {cancellationReasons} from '@/lib/task-lifecycle';
import {useLanguage} from './language';
import {Button} from './ui/button';
export default function TaskCancelForm({missions,state,onSaved}:{missions:Mission[];state:State;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [category,setCategory]=useState('UNNECESSARY'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
  const r=await fetch('/api/task-cancellations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,expectedPlanVersion:state.planVersion,missionIds:missions.map(m=>m.id),category,reason,unperformedConfirmed:confirmed})}),d=await r.json();if(!r.ok)throw Error(d.error);await onSaved();
 }catch(e){setError(e instanceof Error?e.message:'Error')}finally{setBusy(false)}}
 return <form onSubmit={save}><fieldset disabled={busy} className="ledger-form"><p>{missions.length}{t('건의 작업을 종료하고 장비 예약·인력 배정을 해제합니다. 작업 기록은 삭제하지 않습니다.',' tasks will be closed and their reservations and labor assignments released. Records are retained.')}</p><ul>{missions.map(m=><li key={m.id}>{m.scheduledDate??m.originalScheduledDate} · {m.label}</li>)}</ul><label>{t('취소 구분','Cancellation category')}<select aria-label={t('취소 구분','Cancellation category')} value={category} onChange={e=>setCategory(e.target.value)}>{cancellationReasons.map(([v,ko,en])=><option value={v} key={v}>{locale==='ko'?ko:en}</option>)}</select></label><label>{t('취소 사유','Cancellation reason')}<textarea required value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('선택 작업이 수행되지 않았으며 생략·종료하기로 결정했음을 확인합니다.','I confirm the selected work was not performed and has been approved for omission or closure.')}</label>{category==='WITHDRAWAL'&&<p>{t('선택한 작업만 종료합니다. 위탁 계약 전체의 해지·비용 정산을 자동 처리하지 않습니다.','Only the selected tasks are closed. This does not automatically terminate the entire contract or settle costs.')}</p>}{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={busy||!confirmed||!reason.trim()}>{t('작업 취소 확정','Confirm task cancellation')}</Button></fieldset></form>;
}
