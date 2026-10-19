'use client';
import {useEffect,useState} from 'react';
import type {Principal,Role} from '@/lib/auth';
import {centerRegistry} from '@/lib/center-registry';
import {passwordError,PASSWORD_HELP} from '@/lib/password-policy';
import {LanguageSelector,useLanguage} from './language';
import AccountApplications,{type ListedApplication} from './account-applications';
import Modal from './modal';
import styles from './account-management.module.css';

type ListedUser=Principal&{recordVersion:number;recoveryRequestedAt?:string|null};
type Listing={users:ListedUser[];applications:ListedApplication[]};
const emptyForm={username:'',name:'',birth:'',phone:'',password:'',role:'CENTER_STAFF' as Role,centerId:''};
export default function Accounts(){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [user,setUser]=useState<Principal|null>(null),[data,setData]=useState<Listing|null>(null);
 const [form,setForm]=useState(emptyForm),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [detail,setDetail]=useState<ListedUser|null>(null),[reset,setReset]=useState<ListedUser|null>(null),[resetPassword,setResetPassword]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
 const roleName=(role:Role)=>({SUPER_ADMIN:t('총괄 관리자','Administrator'),CENTER_ADMIN:t('센터 관리자','Center administrator'),CENTER_STAFF:t('센터 담당자','Center staff')})[role];
 const centerName=(id:string|null)=>id?(centerRegistry.find(c=>c.id===id)?.name??id):t('총괄','Central administration');
 const passwordHelp=t(PASSWORD_HELP,'Use 12–128 English letters, numbers or symbols. Spaces and Korean characters are not allowed.');
 async function refresh(){
  const [a,b]=await Promise.all([fetch('/api/auth',{cache:'no-store'}),fetch('/api/accounts',{cache:'no-store'})]);
  const auth=await a.json(),listing=await b.json();if(!a.ok||!b.ok)throw Error(listing.error??t('계정을 조회할 수 없습니다.','Could not load accounts.'));
  setUser(auth.user);setData(listing);if(auth.user.role!=='SUPER_ADMIN')setForm(f=>({...f,centerId:auth.user.centerId}));
 }
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[]);
 async function mutate(body:unknown,password?:string){
  setBusy(true);setError('');setMessage('');
  try{
   if(password!==undefined){const problem=passwordError(password);if(problem)throw Error(problem)}
   const response=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();
   if(!response.ok)throw Error(result.error??t('저장 실패','Save failed'));
   await refresh();setMessage(t('저장했습니다.','Saved.'));return true;
  }catch(e){setError(e instanceof Error?e.message:t('처리 실패','Request failed'));return false}finally{setBusy(false)}
 }
 const canManage=(u:ListedUser)=>user?.role==='SUPER_ADMIN'||user?.role==='CENTER_ADMIN'&&u.role==='CENTER_STAFF'&&u.centerId===user.centerId;
 const clearModal=()=>{setDetail(null);setReset(null);setConfirmDelete(false);setResetPassword('');setError('')};
 const close=()=>{if(!busy)clearModal()};
 const reload=async()=>{close();try{await refresh();setError('')}catch(e){setError(e instanceof Error?e.message:'Error')}};
 const roles=(current?:Role)=>[...new Set<Role>(['CENTER_STAFF',...(user?.role==='SUPER_ADMIN'?['CENTER_ADMIN','SUPER_ADMIN'] as Role[]:[]),...(current?[current]:[])])];
 const feedback=error?<p className={`${styles.message} ${styles.error}`} role="alert">{error}</p>:null;
 return <main className={styles.page}>
  <header className={styles.header}><h1>{t('계정 관리','Accounts')}</h1><div className={styles.actions}>{user?.role!=='SUPER_ADMIN'&&user&&<a className={styles.button} href="/">{t('지원현황','Overview')}</a>}<LanguageSelector/></div></header>
  {user?.role==='SUPER_ADMIN'&&<AccountApplications items={data?.applications??[]} onSaved={refresh}/>}
  <section className={styles.section} aria-labelledby="create-account-heading"><div className={styles.heading}><h2 id="create-account-heading">{t('개인 계정 추가','Add an account')}</h2></div>
   <form className={styles.form} onSubmit={async e=>{e.preventDefault();if(await mutate({action:'create',account:{...form,centerId:form.role==='SUPER_ADMIN'?null:form.centerId}},form.password))setForm({...emptyForm,centerId:user?.role==='SUPER_ADMIN'?'':user?.centerId??''})}}>
    <fieldset className={styles.fieldset} disabled={busy||!user}><div className={styles.grid}>
     <label className={styles.field}><span>{t('아이디','Username')}</span><div><input autoComplete="off" required minLength={3} maxLength={100} value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('이름','Name')}</span><div><input required maxLength={60} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('생년월일','Birth date')}</span><div><input type="date" value={form.birth} onChange={e=>setForm({...form,birth:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('연락처','Phone')}</span><div><input type="tel" autoComplete="off" maxLength={30} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('권한','Role')}</span><div><select value={form.role} onChange={e=>setForm({...form,role:e.target.value as Role})}>{roles().map(r=><option key={r} value={r}>{roleName(r)}</option>)}</select></div></label>
     <label className={styles.field}><span>{t('소속','Affiliation')}</span><div><select aria-label={t('담당 센터','Assigned center')} required={form.role!=='SUPER_ADMIN'} disabled={user?.role!=='SUPER_ADMIN'||form.role==='SUPER_ADMIN'} value={form.role==='SUPER_ADMIN'?'':form.centerId} onChange={e=>setForm({...form,centerId:e.target.value})}><option value="">{form.role==='SUPER_ADMIN'?t('총괄','Central administration'):t('센터 선택','Select a center')}</option>{centerRegistry.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div></label>
     <label className={`${styles.field} ${styles.full}`}><span>{t('임시 비밀번호','Temporary password')}</span><div><input aria-label={t('비밀번호 (12자 이상)','Password (at least 12 characters)')} type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><p className={styles.help}>{passwordHelp}</p></div></label>
    </div><div className={styles.footer}><p>{t('첫 로그인 후 본인이 비밀번호를 변경합니다.','The user must change this password at first sign-in.')}</p><button className={`${styles.button} ${styles.primary}`}>{t('계정 생성','Create account')}</button></div></fieldset>
   </form>
  </section>
  {!detail&&!reset&&feedback}{message&&<p className={styles.message} role="status">{message}</p>}
  <section aria-labelledby="accounts-heading"><div className={styles.heading}><h2 id="accounts-heading">{t('계정 목록','Account list')}<span className={styles.count}>{data?.users.length??0}</span></h2><button className={styles.button} disabled={busy} onClick={()=>void reload()}>{t('새로고침','Refresh')}</button></div>
   <div className={styles.panel}><div className={styles.tableScroll}><table className={styles.table}><thead><tr>{[t('이름','Name'),t('아이디','Username'),t('권한','Role'),t('소속','Affiliation'),t('상태','Status'),t('관리','Actions')].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{data?.users.map(u=><tr key={u.id} data-account-id={u.id}>
    <td><strong>{u.name}</strong></td><td>{u.username}</td><td>{roleName(u.role)}</td><td>{centerName(u.centerId)}</td><td><span className={`${styles.badge} ${u.enabled?'':styles.inactive}`}>{u.enabled?t('사용','Active'):t('중지','Disabled')}</span>{u.recoveryRequestedAt&&<small className={styles.badge}>{t('비밀번호 복구신청','Password recovery requested')}</small>}</td><td><div className={`${styles.actions} ${styles.nowrap}`}>
     {u.id!==user?.id&&canManage(u)&&<button className={styles.button} disabled={busy} onClick={()=>{setReset(u);setError('');setMessage('');setResetPassword('')}}>{t('비밀번호 재설정','Reset password')}</button>}
     <button className={styles.button} disabled={busy} onClick={()=>{setDetail({...u});setError('');setMessage('');setConfirmDelete(false)}}>{t('상세','Details')}</button>
    </div></td></tr>)}</tbody></table></div>{!data?.users.length&&<p className={styles.empty}>{data?t('등록된 계정이 없습니다.','No accounts.'):t('불러오는 중…','Loading…')}</p>}</div>
  </section>
  {detail&&<Modal title={t('계정 상세','Account details')} onClose={close}><div className={styles.dialog}>
   <form onSubmit={async e=>{e.preventDefault();if(await mutate({action:'update',id:detail.id,expectedVersion:detail.recordVersion,profile:{name:detail.name,birth:detail.birth??'',phone:detail.phone??'',role:detail.role,centerId:detail.centerId,enabled:detail.enabled}}))clearModal()}}>
    <fieldset className={styles.fieldset} disabled={busy||(!canManage(detail)&&detail.id!==user?.id)}><div className={styles.grid}>
     <label className={styles.field}><span>{t('아이디','Username')}</span><div><input readOnly value={detail.username}/></div></label>
     <label className={styles.field}><span>{t('이름','Name')}</span><div><input required maxLength={60} value={detail.name} onChange={e=>setDetail({...detail,name:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('생년월일','Birth date')}</span><div><input type="date" value={detail.birth??''} onChange={e=>setDetail({...detail,birth:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('연락처','Phone')}</span><div><input type="tel" maxLength={30} value={detail.phone??''} onChange={e=>setDetail({...detail,phone:e.target.value})}/></div></label>
     <label className={styles.field}><span>{t('권한','Role')}</span><div><select disabled={detail.id===user?.id||user?.role!=='SUPER_ADMIN'} value={detail.role} onChange={e=>setDetail({...detail,role:e.target.value as Role,centerId:e.target.value==='SUPER_ADMIN'?null:detail.centerId??''})}>{roles(detail.role).map(r=><option key={r} value={r}>{roleName(r)}</option>)}</select></div></label>
     <label className={styles.field}><span>{t('소속','Affiliation')}</span><div><select required={detail.role!=='SUPER_ADMIN'} disabled={detail.id===user?.id||user?.role!=='SUPER_ADMIN'||detail.role==='SUPER_ADMIN'} value={detail.centerId??''} onChange={e=>setDetail({...detail,centerId:e.target.value})}><option value="">{detail.role==='SUPER_ADMIN'?t('총괄','Central administration'):t('센터 선택','Select a center')}</option>{centerRegistry.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div></label>
     <label className={`${styles.field} ${styles.full}`}><span>{t('상태','Status')}</span><div><select value={String(detail.enabled)} disabled={detail.id===user?.id} onChange={e=>setDetail({...detail,enabled:e.target.value==='true'})}><option value="true">{t('사용','Active')}</option><option value="false">{t('중지','Disabled')}</option></select></div></label>
    </div></fieldset>{feedback}
    {confirmDelete?<div className={styles.confirm}><strong>{t('이 계정을 삭제할까요?','Delete this account?')}</strong><p>{t('로그인을 차단하고 계정 목록에서 제외합니다. 기존 업무·승인 이력은 보존하며, 동일 아이디는 재사용할 수 없습니다.','Sign-in is blocked and the account is removed from the list. Work and approval history is retained; the username cannot be reused.')}</p><div className={styles.actions}><button className={`${styles.button} ${styles.danger}`} type="button" disabled={busy} onClick={async()=>{if(await mutate({action:'delete',id:detail.id,expectedVersion:detail.recordVersion}))clearModal()}}>{t('삭제 확인','Confirm deletion')}</button><button className={styles.button} type="button" disabled={busy} onClick={()=>setConfirmDelete(false)}>{t('취소','Cancel')}</button></div></div>:
     <div className={styles.dialogFooter}>{detail.id!==user?.id&&canManage(detail)&&<button className={`${styles.button} ${styles.danger}`} type="button" disabled={busy} onClick={()=>setConfirmDelete(true)}>{t('계정 삭제','Delete account')}</button>}<button className={styles.button} type="button" disabled={busy} onClick={close}>{t('닫기','Close')}</button>{(canManage(detail)||detail.id===user?.id)&&<button className={`${styles.button} ${styles.primary}`} disabled={busy}>{t('변경 저장','Save changes')}</button>}</div>}
    {error&&<button type="button" className={styles.button} disabled={busy} onClick={()=>void reload()}>{t('목록 새로고침','Reload list')}</button>}
   </form></div></Modal>}
  {reset&&<Modal title={t('비밀번호 재설정','Reset password')} onClose={close}><form className={styles.dialog} onSubmit={async e=>{e.preventDefault();if(await mutate({action:'resetPassword',id:reset.id,expectedVersion:reset.recordVersion,password:resetPassword},resetPassword))clearModal()}}>
   <p>{reset.name} · {reset.username}</p><label className={`${styles.field} ${styles.full}`}><span>{t('새 임시 비밀번호','New temporary password')}</span><div><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} value={resetPassword} onChange={e=>setResetPassword(e.target.value)}/><p className={styles.help}>{passwordHelp}</p></div></label>
   <p className={styles.help}>{t('기존 로그인과 복구 코드는 무효화됩니다. 사용자는 로그인 후 비밀번호를 변경해야 합니다.','Existing sessions and recovery codes are invalidated. The user must change the password after signing in.')}</p>{feedback}<div className={styles.dialogFooter}><button className={styles.button} type="button" disabled={busy} onClick={close}>{t('취소','Cancel')}</button><button className={`${styles.button} ${styles.primary}`} disabled={busy}>{t('임시 비밀번호 저장','Save temporary password')}</button></div>{error&&<button className={styles.button} type="button" disabled={busy} onClick={()=>void reload()}>{t('목록 새로고침','Reload list')}</button>}
  </form></Modal>}
 </main>;
}
