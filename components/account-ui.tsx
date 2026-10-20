'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
export {default as Login} from './login';
export {default as Accounts} from './accounts';
import type {Principal} from '@/lib/auth';
export function AccountBar(){
 const {locale}=useLanguage(),[user,setUser]=useState<Principal|null>(null);
 useEffect(()=>{const reload=()=>{fetch('/api/auth',{cache:'no-store'}).then(r=>r.json()).then(d=>setUser(d.user)).catch(()=>{})};reload();window.addEventListener('kfarm-account-updated',reload);return()=>window.removeEventListener('kfarm-account-updated',reload)},[]);
 if(!user)return null;
 return <div className="account-bar"><span>{user.name} · {(locale==='ko'?{SUPER_ADMIN:'총괄 관리자',CENTER_ADMIN:'센터 담당자 · 계정 관리',CENTER_STAFF:'센터 담당자'}:{SUPER_ADMIN:'Administrator',CENTER_ADMIN:'Center operator · accounts',CENTER_STAFF:'Center staff'})[user.role]}</span>{!user.judgeAccount&&user.role!=='CENTER_STAFF'&&<a href="/accounts">{locale==='ko'?'계정 관리':'Accounts'}</a>}<button onClick={async()=>{const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});if(r.ok)window.location.href='/login'}}>{locale==='ko'?'로그아웃':'Sign out'}</button></div>
}
