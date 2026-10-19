'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
import LaborOperationsPanel from './labor-operations-panel';
import SmsManagement from './sms-management';
export default function LaborWorkspace(){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [tab,setTab]=useState('roster');
 useEffect(()=>{setTab(new URLSearchParams(location.search).get('section')==='messages'?'messages':'roster')},[]);
 function select(id:string){setTab(id);const url=new URL(location.href);url.searchParams.set('tab','labor');if(id==='messages')url.searchParams.set('section',id);else url.searchParams.delete('section');history.replaceState(null,'',url)}
 return <><div className="view-tabs" role="tablist" aria-label={t('인력 메뉴','Labor sections')}>{[['roster',t('인력·배정','Workers and assignments')],['messages',t('문자 관리','Text messages')]].map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>select(id)}>{label}</button>)}</div>{tab==='messages'?<SmsManagement/>:<LaborOperationsPanel embedded/>}</>;
}
