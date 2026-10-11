'use client';
import {centerRegistry} from '@/lib/center-registry';
import {useState} from 'react';
import type {AccountApplication} from '@/lib/account-applications';
import {useLanguage} from './language';
type Application=Omit<AccountApplication,'passwordHash'>;
export default function AccountApplications({items,onSaved}:{items:Application[];onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [centers,setCenters]=useState<Record<string,string>>({});
 const [roles,setRoles]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <section className="card section-space"><h2>{t('회원가입 신청','Account applications')}</h2>{!items.length?<p>{t('대기 중인 신청이 없습니다.','No pending applications.')}</p>:<div className="table-wrap"><table><thead><tr>{['아이디','이름','생년월일','소속','연락처','권한','관리'].map((v,i)=><th key={v}>{t(v,['Username','Name','Birth date','Affiliation','Phone','Role','Actions'][i])}</th>)}</tr></thead><tbody>{items.map(a=><tr key={a.id}><td>{a.username}</td><td>{a.name}</td><td>{a.birth}</td><td>{a.affiliation}</td><td>{a.phone}</td><td><select aria-label={a.username+' 권한'} disabled={busy} value={roles[a.id]??'CENTER_STAFF'} onChange={e=>setRoles({...roles,[a.id]:e.target.value})}><option value="CENTER_STAFF">{t('센터 담당자','Center staff')}</option><option value="CENTER_ADMIN">{t('센터 관리자','Center administrator')}</option></select><select aria-label={a.username+' 담당 센터'} value={centers[a.id]??'demo'} onChange={e=>setCenters({...centers,[a.id]:e.target.value})}>{centerRegistry.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></td><td><button disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{const r=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approveApplication',id:a.id,role:roles[a.id]??'CENTER_STAFF',centerId:centers[a.id]??'demo'})}),d=await r.json();if(!r.ok)throw Error(d.error);await onSaved()}catch(e){setMessage(e instanceof Error?e.message:t('승인 실패','Approval failed'))}finally{setBusy(false)}}}>{t('승인','Approve')}</button></td></tr>)}</tbody></table></div>}{message&&<p role="alert">{message}</p>}</section>;
}
