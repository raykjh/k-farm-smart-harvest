'use client';
import {centerRegistry} from '@/lib/center-registry';
import {useState} from 'react';
import type {AccountApplication} from '@/lib/account-applications';
import {useLanguage} from './language';
import Modal from './modal';
import styles from './account-management.module.css';

export type ListedApplication=Omit<AccountApplication,'passwordHash'>&{recordVersion:number};
export default function AccountApplications({items,onSaved}:{items:ListedApplication[];onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [centers,setCenters]=useState<Record<string,string>>({}),[roles,setRoles]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [selected,setSelected]=useState<ListedApplication|null>(null),[rejecting,setRejecting]=useState(false),[reason,setReason]=useState('');
 const center=(a:ListedApplication)=>centers[a.id]??centerRegistry.find(c=>a.affiliation.includes(c.township))?.id??'';
 const role=(a:ListedApplication)=>roles[a.id]??'CENTER_STAFF';
 const close=()=>{if(!busy){setSelected(null);setRejecting(false);setReason('');setError('')}};
 async function process(a:ListedApplication,action:'approveApplication'|'rejectApplication'){
  setBusy(true);setError('');setMessage('');
  try{
   if(action==='approveApplication'&&!center(a))throw Error(t('소속 센터를 선택하세요.','Select the assigned center.'));
   const r=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:a.id,expectedVersion:a.recordVersion,...(action==='approveApplication'?{role:role(a),centerId:center(a)}:{reason})})}),d=await r.json();
   if(!r.ok)throw Error(d.error);await onSaved();setSelected(null);setRejecting(false);setReason('');setMessage(action==='approveApplication'?t('가입을 승인했습니다.','Application approved.'):t('가입 신청을 거부했습니다.','Application rejected.'));
  }catch(e){setError(e instanceof Error?e.message:t('처리 실패','Request failed'))}finally{setBusy(false)}
 }
 const selectors=(a:ListedApplication)=><><select aria-label={a.username+' '+t('권한','role')} disabled={busy} value={role(a)} onChange={e=>setRoles({...roles,[a.id]:e.target.value})}><option value="CENTER_STAFF">{t('센터 담당자','Center staff')}</option><option value="CENTER_ADMIN">{t('센터 관리자','Center administrator')}</option></select><select aria-label={a.username+' '+t('담당 센터','center')} disabled={busy} value={center(a)} onChange={e=>setCenters({...centers,[a.id]:e.target.value})}><option value="">{t('센터 선택','Select a center')}</option>{centerRegistry.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></>;
 const feedback=error?<p role="alert" className={`${styles.message} ${styles.error}`}>{error}</p>:null;
 return <section className={styles.section} aria-labelledby="applications-heading">
  <div className={styles.heading}><h2 id="applications-heading">{t('회원가입 신청','Account applications')}<span className={styles.count}>{items.length}</span></h2></div>
  <div className={`${styles.panel} ${styles.tableScroll} ${styles.pending}`} data-testid="pending-applications">
   {!items.length?<p className={styles.empty}>{t('대기 중인 신청이 없습니다.','No pending applications.')}</p>:<table className={styles.table}><thead><tr>{[t('신청자','Applicant'),t('신청 소속','Requested affiliation'),t('부여 권한·소속','Role and center'),t('관리','Actions')].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{items.map(a=><tr key={a.id} data-application-id={a.id}>
    <td className={styles.identity}><strong>{a.name}</strong><small>{a.username}</small></td><td>{a.affiliation}</td><td><div className={styles.actions}>{selectors(a)}</div></td><td><div className={`${styles.actions} ${styles.nowrap}`}>
     <button className={styles.button} disabled={busy} onClick={()=>{setSelected(a);setRejecting(false);setReason('');setError('')}}>{t('상세','Details')}</button>
     <button className={`${styles.button} ${styles.primary}`} disabled={busy||!center(a)} onClick={()=>void process(a,'approveApplication')}>{t('승인','Approve')}</button>
     <button className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={()=>{setSelected(a);setRejecting(true);setReason('');setError('')}}>{t('거부','Reject')}</button>
    </div></td></tr>)}</tbody></table>}
  </div>{!selected&&feedback}{message&&<p className={styles.message} role="status">{message}</p>}
  {selected&&<Modal title={rejecting?t('가입 신청 거부','Reject application'):t('가입 신청 상세','Application details')} onClose={close}><div className={styles.dialog}>
   <dl className={styles.detailFacts}>{[[t('이름','Name'),selected.name],[t('아이디','Username'),selected.username],[t('생년월일','Birth date'),selected.birth],[t('연락처','Phone'),selected.phone],[t('신청 소속','Affiliation'),selected.affiliation],[t('신청일','Applied on'),new Date(selected.createdAt).toLocaleDateString(locale==='ko'?'ko-KR':'en-US')]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   {rejecting?<><label className={styles.reason}>{t('거부 사유 (선택)','Reason (optional)')}<textarea maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className={styles.help}>{t('승인 계정은 생성되지 않습니다. 신청자는 정보를 보완해 다시 신청할 수 있습니다.','No account will be created. The applicant can submit an updated application.')}</p></>:<div className={styles.actions}>{selectors(selected)}</div>}
   {feedback}<div className={styles.dialogFooter}><button className={styles.button} disabled={busy} onClick={close}>{t('취소','Cancel')}</button>{rejecting?<button className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={()=>void process(selected,'rejectApplication')}>{t('거부 확인','Confirm rejection')}</button>:<><button className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={()=>setRejecting(true)}>{t('거부','Reject')}</button><button className={`${styles.button} ${styles.primary}`} disabled={busy||!center(selected)} onClick={()=>void process(selected,'approveApplication')}>{t('승인','Approve')}</button></>}</div>
   {error&&<button className={styles.button} disabled={busy} onClick={async()=>{try{await onSaved();close()}catch(e){setError(e instanceof Error?e.message:'Error')}}}>{t('목록 새로고침','Reload list')}</button>}
  </div></Modal>}
 </section>;
}
