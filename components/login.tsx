'use client';
import {useEffect,useState} from 'react';
import {Sprout} from 'lucide-react';
import {LanguageSelector,useLanguage} from './language';
import {passwordError,PASSWORD_HELP} from '@/lib/password-policy';
import PasswordSettings from './password-settings';
import Modal from './modal';
import SignupForm from './signup-form';

export default function Login(){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[token,setToken]=useState(''),[remember,setRemember]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[panel,setPanel]=useState<'signup'|'recovery'|null>(null);
 useEffect(()=>{const hash=new URLSearchParams(window.location.hash.slice(1));if(hash.has('setup')){setToken(hash.get('setup')??'');window.history.replaceState(null,'','/login')}},[]);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setMessage('');
  try{
   if(token){const error=passwordError(password);if(error)throw Error(error)}
   const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(token?{action:'setup',token,account:{username,password,name}}:{action:'login',username,password,remember})}),d=await r.json();
   if(!r.ok)throw Error(d.error||t('로그인하지 못했습니다.','Unable to sign in.'));
   window.location.href=d.user.mustChangePassword?'/password':d.user.role==='SUPER_ADMIN'?'/accounts':'/';
  }catch(e){setMessage(e instanceof Error?e.message:t('연결을 확인해주세요.','Check your connection.'))}finally{setBusy(false)}
 }
 return <main className="login-page"><div className="login-language"><LanguageSelector/></div><section className="login-panel" aria-labelledby="login-title">
  <header className="login-brand"><span className="login-mark"><Sprout size={29}/></span><h1>K-Farm<span>: Smart Harvest</span></h1></header>
  <h2 id="login-title">{token?t('최초 총괄 계정 설정','Administrator setup'):t('로그인','Sign in')}</h2>
  <form onSubmit={submit} className="login-form"><fieldset disabled={busy}>
   <div className="login-inputs"><label className="login-field"><span className="sr-only">{t('아이디','Username')}</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={100} placeholder={t('아이디','Username')} value={username} onChange={e=>setUsername(e.target.value)}/></label>
   {token&&<label className="login-field"><span className="sr-only">{t('이름','Name')}</span><input name="name" required autoComplete="name" placeholder={t('이름','Name')} value={name} onChange={e=>setName(e.target.value)}/></label>}
   <label className="login-field"><span className="sr-only">{t('비밀번호','Password')}</span><input name="password" type="password" autoComplete={token?'new-password':'current-password'} required minLength={token?12:undefined} maxLength={128} placeholder={t('비밀번호','Password')} value={password} onChange={e=>setPassword(e.target.value)}/></label></div>
   {token&&<p className="login-help">{PASSWORD_HELP}</p>}
   <button className="login-submit" type="submit">{busy?t('확인 중…','Signing in…'):token?t('총괄 계정 만들기','Create administrator'):t('로그인','Sign in')}</button>
   {!token&&<div className="login-options"><label title={t('최대 8시간 유지됩니다. 공용 PC에서는 선택하지 마세요.','Keeps you signed in for up to 8 hours. Do not use on shared computers.')}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>{t('로그인 유지','Keep me signed in')}</label><small>{remember?t('최대 8시간 · 개인 PC에서만','Up to 8 hours · private computers only'):''}</small></div>}
  </fieldset>{message&&<p className="login-error" role="alert">{message}</p>}</form>
  {!token&&<div className="login-links"><button type="button" onClick={()=>setPanel('signup')}>{t('회원가입','Sign up')}</button><span aria-hidden="true">|</span><button type="button" onClick={()=>setPanel('recovery')}>{t('비밀번호 찾기','Forgot password')}</button></div>}
 </section>
 {panel==='signup'&&<Modal title={t('회원가입 신청','Request an account')} onClose={()=>setPanel(null)}><SignupForm/></Modal>}
 {panel==='recovery'&&<Modal title={t('비밀번호 찾기','Forgot password')} onClose={()=>setPanel(null)}><p>{t('센터 담당자·관리자는 총괄관리자에게 비밀번호 재설정을 요청해주세요.','Center staff and administrators should ask the administrator to reset their password.')}</p><details className="login-recovery"><summary>{t('총괄계정 복구 코드로 재설정','Reset an administrator account with a recovery code')}</summary><PasswordSettings recovery/></details></Modal>}
 </main>;
}
