'use client';
import {useEffect,useState} from 'react';
import {messageStatuses,type MessageStatus,type ManagedSms} from '@/lib/sms-management';
import {useLanguage} from './language';
import {Button} from './ui/button';

export default function SmsManagement(){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [items,setItems]=useState<ManagedSms[]>([]),[draft,setDraft]=useState<Record<string,MessageStatus>>({});
 const [workDate,setWorkDate]=useState(''),[sendDate,setSendDate]=useState(''),[status,setStatus]=useState('ALL');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const labels:Record<MessageStatus,string>={QUEUED:t('발송대기','Queued'),FAILED:t('실패','Failed'),SENT:t('발송완료','Sent'),ATTENDING:t('참석확인','Attending'),DECLINED:t('미참석확인','Not attending'),NO_RESPONSE:t('무응답','No response')};
 async function load(){const r=await fetch('/api/messages',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setItems(d.items);setDraft({});}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 async function save(m:ManagedSms,action:'review'|'resend'){
  setBusy(true);setError('');setMessage('');
  try{
   const body={action,id:m.id,version:m.version,requestId:crypto.randomUUID(),...(action==='review'?{laborVersion:m.laborVersion,status:draft[m.id]??m.managementStatus}:{})};
   const r=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();
   if(!r.ok){await load();throw Error(d.error);}
   await load();
   setMessage(d.delivery==='WAITING_PROVIDER'?t('재발송 요청을 저장했습니다. 발송업체 연결 후 전송할 수 있습니다.','Resend requested. Delivery awaits the messaging provider connection.'):t('저장했습니다.','Saved.'));
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 const visible=items.filter(m=>(!workDate||m.workDate===workDate)&&(!sendDate||m.sendDate===sendDate)&&(status==='ALL'||m.managementStatus===status)).sort((a,b)=>b.workDate.localeCompare(a.workDate)||b.scheduledAt.localeCompare(a.scheduledAt));
 return <section className="card section-space" data-testid="sms-management">
  <h2>{t('문자 관리','Text messages')}</h2>
  <div className="registration-grid">
   <label>{t('작업일자','Work date')}<input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)}/></label>
   <label>{t('발송일자','Send date')}<input type="date" value={sendDate} onChange={e=>setSendDate(e.target.value)}/></label>
   <label>{t('상태','Status')}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">{t('전체','All')}</option>{messageStatuses.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
  </div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <div className="table-wrap"><table><thead><tr>{[t('작업일자','Work date'),t('발송일자','Send date'),t('대상','Recipient'),t('상태','Status'),t('관리','Manage')].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>{visible.map(m=><tr key={m.id}><td>{m.workDate||'—'}</td><td>{m.sendDate}</td><td>{m.recipient.name}</td><td><select aria-label={`${m.recipient.name} ${t('상태','status')}`} disabled={busy||!m.editable} value={draft[m.id]??m.managementStatus} onChange={e=>setDraft({...draft,[m.id]:e.target.value as MessageStatus})}>{messageStatuses.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></td><td><div className="actions"><Button disabled={busy||!m.editable||!draft[m.id]||draft[m.id]===m.managementStatus} onClick={()=>void save(m,'review')}>{t('저장','Save')}</Button><Button variant="outline" disabled={busy||!m.editable||m.status==='SUPERSEDED'} onClick={()=>void save(m,'resend')}>{t('재발송','Resend')}</Button></div></td></tr>)}</tbody>
  </table></div>{!visible.length&&<p>{t('표시할 문자가 없습니다.','No messages to show.')}</p>}
 </section>;
}
