'use client';
import {useState,useEffect,useRef} from 'react';
import {useLanguage} from './language';
import {centerRegistry} from '@/lib/center-registry';
import type {Principal} from '@/lib/auth';
import Modal from './modal';
import PasswordSettings from './password-settings';
type Data={user:Principal;recordVersion:number;recoveryRequest:{status:string;requestedAt:string}|null};
export default function PersonalSettings(){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [panel,setPanel]=useState<'password'|'profile'|'recovery'|null>(null),[data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [profile,setProfile]=useState({name:'',birth:'',phone:''});
 const [loading,setLoading]=useState(true),loadId=useRef(0);
 async function call(body:unknown){const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error);return d}
 async function load(){const id=++loadId.current;setLoading(true);try{const d=await call({action:'personalSettings'});if(id===loadId.current){setData(d);setProfile({name:d.user.name,birth:d.user.birth??'',phone:d.user.phone??''})}}finally{if(id===loadId.current)setLoading(false)}}
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 async function act(action:'saveProfile'|'requestRecovery'){
  if(!data)return;setBusy(true);setError('');setMessage('');
  try{await call({action,...(action==='saveProfile'?{input:{expectedVersion:data.recordVersion,profile}}:{})});await load();setMessage(action==='saveProfile'?t('저장했습니다.','Saved.'):t('관리자에게 복구신청이 접수되었습니다.','Your recovery request is pending administrator review.'));if(action==='saveProfile')window.dispatchEvent(new Event('kfarm-account-updated'))}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 const title=panel==='password'?t('비밀번호 변경','Change password'):panel==='profile'?t('담당자 정보변경','Edit my profile'):t('비밀번호 복구신청','Request password recovery');
 if(data?.user.judgeAccount)return <section className="personal-settings"><p>{t('체험 계정의 정보와 비밀번호는 관리자가 관리합니다.','The administrator manages this public trial account and its password.')}</p></section>;
 return <section className="personal-settings"><div className="personal-settings-menu">{([['password',t('비밀번호 변경','Change password')],['profile',t('담당자 정보변경','Edit my profile')],['recovery',t('비밀번호 복구신청','Request password recovery')]] as const).map(([id,label])=><button key={id} onClick={()=>{setPanel(id);setError('');setMessage('');void load().catch(e=>setError(e.message))}}>{label}<span aria-hidden="true">›</span></button>)}</div>
 {!panel&&error&&<p role="alert">{error}</p>}
 {panel&&<Modal title={title} onClose={()=>!busy&&setPanel(null)}>
 {panel==='password'?<PasswordSettings/>:panel==='profile'?<form className="personal-profile" onSubmit={e=>{e.preventDefault();void act('saveProfile')}}><fieldset disabled={busy||loading||!data}><div className="personal-profile-grid"><label>{t('아이디','Username')}<input readOnly value={data?.user.username??''}/></label><label>{t('소속','Center')}<input readOnly value={centerRegistry.find(c=>c.id===data?.user.centerId)?.name??t('총괄','Central administration')}/></label><label>{t('이름','Name')}<input required maxLength={60} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label><label>{t('생년월일','Birth date')}<input type="date" value={profile.birth} onChange={e=>setProfile({...profile,birth:e.target.value})}/></label><label>{t('연락처','Phone')}<input type="tel" maxLength={30} value={profile.phone} onChange={e=>setProfile({...profile,phone:e.target.value})}/></label></div><button type="submit">{t('변경 저장','Save changes')}</button></fieldset></form>:data?.user.role==='SUPER_ADMIN'?<PasswordSettings recovery/>:<div className="recovery-request"><p>{data?.user.name} · {data?.user.username}</p><p>{t('관리자가 본인 확인 후 비밀번호를 재설정합니다. 신청만으로 현재 비밀번호나 로그인 상태가 바뀌지 않습니다.','An administrator resets your password after verifying your identity. Requesting recovery does not change your password or session.')}</p>{data?.recoveryRequest?.status==='PENDING'&&<p role="status">{t('복구신청 접수 · 처리 대기','Recovery requested · pending')}</p>}<button disabled={busy||loading||!data||data.recoveryRequest?.status==='PENDING'} onClick={()=>void act('requestRecovery')}>{t('복구신청 접수','Submit recovery request')}</button></div>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </Modal>}
 </section>;
}
