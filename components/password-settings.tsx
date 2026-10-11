'use client';
import {passwordError,PASSWORD_HELP} from '@/lib/password-policy';
import {useEffect,useState} from 'react';
export default function PasswordSettings({recovery=false}:{recovery?:boolean}){
 const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[username,setUsername]=useState('admin'),[inputCode,setInputCode]=useState(''),[code,setCode]=useState(''),[role,setRole]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!recovery)fetch('/api/auth').then(r=>r.json()).then(d=>setRole(d.user?.role??'')).catch(()=>{})},[recovery]);
 async function submit(action:string){setBusy(true);setMessage('');try{
  if(action!=='recoveryCode'){const error=passwordError(password);if(error)throw Error(error)}
  if(action!=='recoveryCode'&&password!==confirm)throw Error('새 비밀번호가 일치하지 않습니다.');
  const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,currentPassword:current,newPassword:password,username,code:inputCode})});const d=await r.json();if(!r.ok)throw Error(d.error);
  setCurrent('');setPassword('');setConfirm('');setInputCode('');
  if(d.code){setCode(d.code);setMessage('복구 코드를 안전한 별도 장소에 보관하세요. 이전 코드는 무효입니다.');}
  else window.location.href=d.user.role==='SUPER_ADMIN'?'/accounts':'/';
 }catch(e){setMessage(e instanceof Error?e.message:'처리 실패')}finally{setBusy(false)}}
 function download(){const blob=new Blob(['K-Farm one-time recovery code\n'+code+'\nKeep offline. Anyone holding this code can reset the super administrator password.'],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='kfarm-recovery-code.txt';a.click();URL.revokeObjectURL(url)}
 return <section className="card"><h2>{recovery?'총괄 계정 복구 / Account recovery':'비밀번호 변경 / Change password'}</h2><form onSubmit={e=>{e.preventDefault();void submit(recovery?'recover':'changePassword')}}>{recovery?<><p><label>총괄 아이디 <input required value={username} onChange={e=>setUsername(e.target.value)}/></label></p><p><label>일회성 복구 코드 <input required autoComplete="off" value={inputCode} onChange={e=>setInputCode(e.target.value.trim())}/></label></p></>:<p><label>현재 비밀번호 <input required type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)}/></label></p>}<p><label>새 비밀번호 (12자 이상) <input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label></p><p><label>새 비밀번호 확인 <input required type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></p><p>{PASSWORD_HELP}</p><p>변경 시 다른 로그인 세션은 모두 종료됩니다.</p><button disabled={busy}>{recovery?'계정 복구':'비밀번호 변경'}</button></form>{!recovery&&role==='SUPER_ADMIN'&&<><h3>오프라인 복구 코드</h3><p>현재 비밀번호 입력 후 발급하세요. 재발급하면 이전 코드는 사용할 수 없습니다.</p><button disabled={busy||!current} onClick={()=>submit('recoveryCode')}>복구 코드 발급·재발급</button></>}{message&&<p role="status">{message}</p>}{code&&<div><p>이 화면을 떠나면 코드를 다시 조회할 수 없습니다.</p><code style={{overflowWrap:'anywhere'}}>{code}</code><p><button onClick={download}>복구 코드 파일 저장</button></p>{recovery&&<a href="/login">로그인으로 이동</a>}</div>}</section>
}
