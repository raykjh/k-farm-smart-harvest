'use client';
import {useEffect,useState} from 'react';
import type {Field} from '@/lib/types';
import type {FieldEntry} from '@/lib/field-record';
import {emptyConditions} from '@/lib/field-conditions';
import {useLanguage} from './language';
import {Button} from './ui/button';
export default function FieldAccessInput({field,onSaved}:{field:Field;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [value,setValue]=useState(field.machineAccess??'unknown'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>setValue(field.machineAccess??'unknown'),[field.machineAccess]);
 async function save(){setBusy(true);setError('');try{
  const response=await fetch('/api/fields',{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error);
  const entries=data.payload as FieldEntry[];if(!entries.some(f=>f.pnu===field.id))throw Error(t('먼저 농지 등록자료를 연결해주세요.','Link the registered field record first.'));
  // Preserve every other field and condition; version check protects concurrent edits.
  const payload=entries.map(f=>f.pnu===field.id?{...f,conditions:{...(f.conditions??emptyConditions()),machineAccess:value}}:f);
  const result=await fetch('/api/fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:'operations',version:data.version,payload})}),body=await result.json();if(!result.ok)throw Error(body.error);await onSaved();
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <div className="field-access-input"><select disabled={busy} aria-label={field.address+' '+t('장비 진입','Machine access')} value={value} onChange={e=>{setValue(e.target.value as typeof value);setError('')}}><option value="unknown">{t('미확인','Unknown')}</option><option value="yes">{t('가능','Available')}</option><option value="no">{t('불가능','Unavailable')}</option></select>{value!==(field.machineAccess??'unknown')&&<Button variant="outline" disabled={busy} onClick={save}>{t('저장','Save')}</Button>}{error&&<p role="alert">{error}</p>}</div>;
}
