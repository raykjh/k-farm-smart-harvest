'use client';
import {useEffect,useState} from 'react';
import type {SmsMessageView} from '@/lib/sms-policy';
import {useLanguage} from './language';
import {Button} from './ui/button';
import Modal from './modal';

export default function SmsManagement(){
 const {locale}=useLanguage(),ko=locale==='ko',t=(a:string,b:string)=>ko?a:b;
 const [items,setItems]=useState<SmsMessageView[]>([]),[filter,setFilter]=useState('ALL'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<string|null>(null);
 const labels={QUEUED:t('발송 대기','Queued'),BLOCKED:t('연락처 확인','Contact needed'),FAILED:t('실패','Failed'),SIMULATED:t('모의 발송 완료','Simulation complete'),SUPERSEDED:t('변경·취소로 제외','Superseded')};
 async function load(){const r=await fetch('/api/messages',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error??'Load failed');setItems(d.items);}
 async function run(body:object){setBusy(true);setError('');try{const r=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error??'Request failed');await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 useEffect(()=>{void load().catch(e=>setError(String(e)))},[]);
 const time=(v:string)=>new Intl.DateTimeFormat(ko?'ko-KR':'en-US',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(v));
 const canRun=(m:SmsMessageView)=>['QUEUED','FAILED'].includes(m.status)&&m.attempts<3&&Date.parse(m.scheduledAt)<=Date.now();
 const visible=items.filter(m=>m.recipient.type==='WORKER'&&(filter==='ALL'?m.status!=='SUPERSEDED':m.status===filter)).sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt));
 const m=items.find(m=>m.id===selected);
 return <section className="card section-space" data-testid="sms-management"><div className="card-head"><h2>{t('문자 관리','Text messages')}</h2><Button disabled={busy} onClick={()=>run({action:'prepare'})}>{t('발송 예정 점검','Refresh scheduled messages')}</Button></div>
  <p role="status">{t('발송업체 미연결 · 실제 문자 발송과 비용은 발생하지 않습니다.','Provider not connected. No real messages or charges.')}</p>
  <p>{t('7일 전 배정 안내 · 2일 전 미확답자 교체 · 문자·전화 참석 확인','7-day allocation; replace unconfirmed workers 2 days before; confirm by SMS or phone')}</p>
  <div className="view-tabs">{[['ALL',t('전체','All')],['QUEUED',t('발송 대기','Queued')],['FAILED',t('실패','Failed')],['SUPERSEDED',t('변경·취소 이력','Superseded')]].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
  {error&&<p role="alert">{error}</p>}<div className="table-wrap"><table><thead><tr>{[t('발송 예정','Scheduled'),t('대상','Recipient'),t('안내','Notice'),t('상태','Status'),t('관리','Manage')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(m=><tr key={m.id}><td>{time(m.scheduledAt)}</td><td>{m.recipient.name}<small className="description">{m.recipient.type==='OWNER'?t('소유주','Owner'):t('인력','Worker')}</small></td><td>{m.category==='WORK_PLANNED'?t('작업 예정','Upcoming work'):m.category==='WORK_CHANGED'?t('작업 변경·취소','Work changes'):t('배정·참석 안내','Allocation / attendance')}</td><td>{labels[m.status]}{m.attempts>0&&` · ${m.attempts}${t('회',' attempts')}`}</td><td><Button variant="outline" onClick={()=>setSelected(m.id)}>{t('상세','Details')}</Button></td></tr>)}</tbody></table></div>{!visible.length&&<p>{t('표시할 문자가 없습니다.','No messages to show.')}</p>}
  {m&&<Modal title={t('문자 상세','Message details')} onClose={()=>!busy&&setSelected(null)}><section className="sms-detail"><dl><dt>{t('수신자','Recipient')}</dt><dd>{m.recipient.name} · {m.recipient.phone||t('연락처 없음','No contact')}</dd><dt>{t('발송 예정','Scheduled')}</dt><dd>{time(m.scheduledAt)}</dd><dt>{t('상태','Status')}</dt><dd>{labels[m.status]}</dd></dl><p className="sms-body">{m.body}</p>{m.attemptHistory.length>0&&<section aria-label={t('처리 이력','Attempt history')}><h3>{t('처리 이력','Attempt history')}</h3>{m.attemptHistory.map(a=><p key={a.attempt}>{a.attempt}{t('회',' attempt')} · {time(a.at)} · {labels[a.status]}</p>)}</section>}{m.lastError&&<p role="alert">{m.lastError}</p>}<div className="actions"><Button disabled={busy||!canRun(m)} onClick={()=>run({action:'simulate',id:m.id,requestId:crypto.randomUUID(),fail:false})}>{m.status==='FAILED'?t('모의 재시도','Simulate retry'):t('모의 발송 확인','Simulate delivery')}</Button><Button variant="outline" disabled={busy||!canRun(m)} onClick={()=>run({action:'simulate',id:m.id,requestId:crypto.randomUUID(),fail:true})}>{t('실패 검증','Simulate failure')}</Button></div><p className="description">{t('실제 발송·문자 답장 수신은 연결 전입니다. 참석 확답은 인력관리에서 담당자가 기록합니다.','Live delivery and inbound replies are not connected. Record confirmed replies in Labor.')}</p></section></Modal>}
 </section>;
}
