'use client';
import {useState} from 'react';
import {useLanguage} from './language';
import {passwordError,PASSWORD_HELP} from '@/lib/password-policy';
export default function SignupForm(){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [form,setForm]=useState({username:'',name:'',birth:'',affiliation:'',phone:'',password:''}),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[sent,setSent]=useState(false);
 const input=(key:keyof typeof form,label:string,type='text',autoComplete='off')=><label>{label}<input name={key} type={type} required value={form[key]} autoComplete={autoComplete} maxLength={key==='password'?128:100} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
 if(sent)return <p role="status" className="notice">{t('가입 신청이 접수되었습니다. 총괄관리자 승인 후 로그인할 수 있습니다.','Your request was submitted. You can sign in after administrator approval.')}</p>;
 return <form className="signup-form" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setMessage('');try{const error=passwordError(form.password);if(error)throw Error(error);if(form.password!==confirm)throw Error(t('비밀번호가 일치하지 않습니다.','Passwords do not match.'));const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'signup',application:form})}),d=await r.json();if(!r.ok)throw Error(d.error);setForm({...form,password:''});setConfirm('');setSent(true)}catch(e){setMessage(e instanceof Error?e.message:t('신청하지 못했습니다.','Unable to submit.'))}finally{setBusy(false)}}}>
 <p>{t('가입 신청 후 총괄관리자가 소속과 권한을 확인하여 승인합니다.','An administrator will review your affiliation and assign access after you apply.')}</p>
 <fieldset disabled={busy}><div className="registration-grid">{input('username',t('아이디','Username'),'text','username')}{input('name',t('이름','Name'),'text','name')}{input('birth',t('생년월일','Birth date'),'date','bday')}{input('affiliation',t('소속','Affiliation'),'text','organization')}{input('phone',t('연락처','Phone'),'tel','tel')}{input('password',t('비밀번호','Password'),'password','new-password')}<label>{t('비밀번호 확인','Confirm password')}<input type="password" autoComplete="new-password" required maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></div><p className="login-help">{locale==='ko'?PASSWORD_HELP:'12–128 English letters, numbers or symbols. No whitespace.'}</p><button className="login-submit" type="submit">{busy?t('신청 중…','Submitting…'):t('가입 신청','Submit request')}</button></fieldset>{message&&<p role="alert" className="login-error">{message}</p>}
 </form>;
}
