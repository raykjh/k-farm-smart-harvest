'use client';
import type {Worker} from '@/lib/labor-operations';
import {useLanguage} from './language';
export default function LaborRegistrationForm({person,onChange}:{person:Worker;onChange:(person:Worker)=>void}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 return <div className="labor-person-fields">{([['name',t('이름','Name'),'text'],['birth',t('생년월일','Birth date'),'date'],['phone',t('연락처','Phone'),'tel'],['address',t('주소','Address'),'text']] as const).map(([key,label,type])=><label key={key}>{label}<input required type={type} maxLength={key==='address'?200:key==='name'?60:30} value={person[key]} onChange={e=>onChange({...person,[key]:e.target.value})}/></label>)}</div>;
}
