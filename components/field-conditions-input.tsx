'use client';
import {useState} from 'react';
import type {FieldEntry} from '@/lib/field-record';
import {emptyConditions,type FieldConditions} from '@/lib/field-conditions';
import FieldConditionsEditor from './field-conditions-editor';
import {useLanguage} from './language';
import {Button} from './ui/button';

export default function FieldConditionsInput({pnu,onSaved}:{pnu:string;onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [snapshot,setSnapshot]=useState<{version:number;payload:FieldEntry[]}|null>(null),[value,setValue]=useState<FieldConditions>(emptyConditions),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function open(){setBusy(true);setError('');try{
  const r=await fetch('/api/fields',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);
  const field=(d.payload as FieldEntry[]).find(f=>f.pnu===pnu);if(!field)throw Error(t('농지 등록자료를 먼저 연결해주세요.','Link the field registration first.'));
  setSnapshot(d);setValue(field.conditions??emptyConditions());
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 async function save(){if(!snapshot)return;setBusy(true);setError('');try{
  // Submit the version loaded when editing began. Never silently overwrite a
  // concurrent field or owner edit, or change crop / area through this form.
  const payload=snapshot.payload.map(f=>f.pnu===pnu?{...f,conditions:value}:f);
  const r=await fetch('/api/fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:'operations',version:snapshot.version,payload})}),d=await r.json();if(!r.ok)throw Error(d.error);
  setSnapshot(null);await onSaved();
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <section className="field-condition-settings">
  {!snapshot?<Button variant="outline" disabled={busy} onClick={()=>void open()}>{t('농지 조건 수정','Edit field conditions')}</Button>:<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}><FieldConditionsEditor compact value={value} onChange={setValue}/><div className="actions"><Button type="submit">{t('농지 조건 저장','Save field conditions')}</Button><Button type="button" variant="outline" onClick={()=>{setSnapshot(null);setError('')}}>{t('닫기','Close')}</Button></div></fieldset></form>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
