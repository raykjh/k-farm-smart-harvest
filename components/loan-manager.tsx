'use client';
import {useRef,useState} from 'react';
import type {EquipmentLoan} from '@/lib/center-sharing';
import type {LoanReview} from '@/lib/loan-lifecycle';
import Modal from './modal';
import {useLanguage} from './language';
import {useKoreaDay} from './use-korea-day';
import {Button} from './ui/button';

export default function LoanManager({loan,centerId,onClose,onSaved}:{loan:EquipmentLoan&{version:number};centerId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en,today=useKoreaDay(),owner=loan.ownerCenterId===centerId;
 const [operation,setOperation]=useState<'CHANGE'|'CANCEL'|'RETURN'>(owner&&loan.status==='CONFIRMED'?'CHANGE':'CANCEL');
 const [from,setFrom]=useState(loan.usableFrom),[to,setTo]=useState(loan.usableUntil),[returnedOn,setReturnedOn]=useState(today),[reason,setReason]=useState('');
 const [review,setReview]=useState<LoanReview|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[committed,setCommitted]=useState(false);
 const [operatorConfirmed,setOperatorConfirmed]=useState(false),[transportConfirmed,setTransportConfirmed]=useState(false);
 const receipt=useRef<object|null>(null);
 const clear=()=>{setReview(null);setConfirmed(false);setOperatorConfirmed(false);setTransportConfirmed(false);setError('');receipt.current=null;};
 const input=()=>({id:loan.id,version:loan.version,operation,reason,...(operation==='CHANGE'?{from,to}:{}),...(operation==='RETURN'?{returnedOn}:{})});
 async function request(body:unknown){const r=await fetch('/api/center-resources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error??t('처리 실패','Request failed'));return d;}
 async function preview(){setBusy(true);setError('');setReview(null);receipt.current=null;try{setReview(await request({action:'previewLoan',...input()}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function apply(){if(!review||review.blockers.length)return;setBusy(true);setError('');
  receipt.current??={action:'manageLoan',...input(),reviewToken:review.token,requestId:crypto.randomUUID(),...(operation==='RETURN'?{returnedConfirmed:confirmed}:{}),...(operation==='CHANGE'?{operatorConfirmed,transportConfirmed}:{})};
  try{await request(receipt.current);setCommitted(true);try{await onSaved();onClose()}catch{setError(t('저장되었습니다. 창을 닫고 목록을 새로고침하세요.','Saved. Close this dialog and refresh the list.'))}}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <Modal title={t('대여 관리','Manage equipment loan')} onClose={()=>{if(!busy)onClose()}}><section data-testid="loan-manager">
 <p><strong>{loan.machineId}</strong> · {loan.usableFrom} ~ {loan.usableUntil}</p>
 {!owner&&<p>{t('사용 기간 변경과 반납 확인은 장비 소유 센터가 처리합니다.','The owning center handles period changes and return confirmation.')}</p>}
 <fieldset disabled={busy||committed}><div className="actions"><label>{t('처리 종류','Action')}<select value={operation} onChange={e=>{setOperation(e.target.value as typeof operation);clear()}}>
 {owner&&loan.status==='CONFIRMED'&&<option value="CHANGE">{t('사용 기간 변경','Change usable period')}</option>}<option value="CANCEL">{t('대여 취소','Cancel loan')}</option>{owner&&loan.status==='CONFIRMED'&&<option value="RETURN">{t('장비 반납 확인','Confirm equipment return')}</option>}</select></label></div>
 {operation==='CHANGE'&&<div className="actions"><label>{t('변경 시작일','New start date')}<input type="date" value={from} onChange={e=>{setFrom(e.target.value);clear()}}/></label><label>{t('변경 종료일','New end date')}<input type="date" min={from} value={to} onChange={e=>{setTo(e.target.value);clear()}}/></label></div>}
 {operation==='RETURN'&&<label>{t('실제 반납일','Actual return date')}<input type="date" min={loan.usableFrom} max={today} value={returnedOn} onChange={e=>{setReturnedOn(e.target.value);clear()}}/></label>}
 <label>{t('처리 사유','Reason')}<input maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);clear()}}/></label>
 <div className="actions"><Button variant="outline" disabled={!reason.trim()} onClick={()=>void preview()}>{busy?t('확인 중…','Checking…'):t('연결 작업·예약 확인','Review linked tasks and bookings')}</Button></div></fieldset>
 {error&&<p role="alert">{error}</p>}
 {review&&<div data-testid="loan-impact"><h3>{t('변경 영향','Change impact')}</h3>
 <p>{t('완료 이력 보존','Completed records preserved')} {review.preservedCompleted} · {t('조정이 필요한 작업','Tasks requiring adjustment')} {review.tasks.filter(x=>x.affected).length} · {t('조정이 필요한 예약','Bookings requiring adjustment')} {review.reservations.filter(x=>x.affected).length}</p>
 {review.blockers.map(b=><p role="alert" key={b}>{b}</p>)}
 {!!review.tasks.length&&<div className="table-wrap"><table><thead><tr>{[t('작업','Task'),t('예정일','Scheduled date'),t('처리','Handling')].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{review.tasks.map(x=><tr key={x.id}><td>{x.label}</td><td>{x.date??'—'}</td><td>{x.affected?t('먼저 재계획 필요','Replan first'):x.status==='COMPLETED'?t('완료 이력 유지','Keep completed record'):t('유지','Unchanged')}</td></tr>)}</tbody></table></div>}
 {!!review.reservations.filter(r=>r.affected).length&&<details><summary>{t('조정이 필요한 예약 보기','View affected bookings')}</summary>{review.reservations.filter(r=>r.affected).map(r=><p key={r.id}>{r.from} ~ {r.to} · {r.id}</p>)}</details>}
 {review.blockers.length>0&&<p>{loan.borrowerCenterId===centerId?<a href="/?tab=schedule">{t('일정표에서 재계획하기','Replan in the schedule')}</a>:t('사용 센터에 연결 작업의 재계획·예약 해제를 요청한 뒤 다시 확인하세요.','Ask the borrowing center to replan or release the affected bookings, then review again.')}</p>}
 <p>{t('완료 이력과 작업계획을 삭제하지 않습니다. 반납해도 장비의 정비·안전 상태는 자동으로 변경되지 않습니다.','Completed records and work plans are retained. Returning a machine does not clear its maintenance or safety state.')}</p>
 {operation==='CHANGE'&&<div className="actions"><label><input type="checkbox" checked={operatorConfirmed} disabled={busy||committed} onChange={e=>{setOperatorConfirmed(e.target.checked);receipt.current=null}}/>{t('변경 기간의 운영담당자를 확인했습니다.','Operator availability for the new period is confirmed.')}</label><label><input type="checkbox" checked={transportConfirmed} disabled={busy||committed} onChange={e=>{setTransportConfirmed(e.target.checked);receipt.current=null}}/>{t('변경 기간의 운송·복귀 조건을 확인했습니다.','Transport and return arrangements for the new period are confirmed.')}</label></div>}
 {operation==='RETURN'&&<label><input type="checkbox" checked={confirmed} disabled={busy||committed} onChange={e=>{setConfirmed(e.target.checked);receipt.current=null}}/>{t('장비가 복귀했으며 인수·점검 상태를 확인했습니다.','The machine has returned and its receipt and inspection state have been checked.')}</label>}
 <Button disabled={busy||committed||review.blockers.length>0||operation==='RETURN'&&!confirmed||operation==='CHANGE'&&(!operatorConfirmed||!transportConfirmed)} onClick={()=>void apply()}>{t('확인한 내용 저장','Save reviewed change')}</Button>
 </div>}</section></Modal>;
}
