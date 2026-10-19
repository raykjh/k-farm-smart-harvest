'use client';
import {useEffect,useState} from 'react';
import {LanguageSelector,useLanguage} from './language';
import type {DemoRemovalBlocker} from '@/lib/demo-removal-preflight';
export default function DataSettings({embedded=false,onSaved}:{embedded?:boolean;onSaved?:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [data,setData]=useState<{safe:boolean;fields:number;tasks:number;equipment:number;token:string;blockers:DemoRemovalBlocker[]}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function load(){try{const r=await fetch('/api/demo-data',{cache:'no-store'});if(!r.ok)throw Error();setData(await r.json())}catch{setData(null);setMessage(t('조회 실패','Load failed'))}}
 useEffect(()=>{void load()},[]);
 async function remove(){
  if(!data||!confirm(t(`출처와 연결 상태를 확인한 데모 농지 ${data.fields}개·작업 ${data.tasks}개·장비 ${data.equipment}개 및 해당 데모 상담을 삭제할까요? 직접 저장한 자료는 보존합니다.`,`Remove ${data.fields} verified sample fields, ${data.tasks} tasks, ${data.equipment} machines and their sample consultations? Manually saved records are preserved.`)))return;
  setBusy(true);
  try{
   const r=await fetch('/api/demo-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',token:data.token})}),d=await r.json();
   if(!r.ok)throw Error(d.error);
   setMessage(t('처리 완료','Completed'));await load();await onSaved?.();
  }catch(e){setMessage(e instanceof Error?e.message:'Failed')}finally{setBusy(false)}
 }
 return <div className={embedded?'embedded-panel section-space':'main'}>
  {!embedded&&<><LanguageSelector/><a href="/">← {t('메인','Main')}</a><h1>{t('설정 · 데이터 관리','Settings · Data management')}</h1></>}
  <section className="card"><h2>{t('데모 데이터','Sample data')}</h2>
   <p>{t('새 데모는 화면·설정 확인 후 일반 신청·계획·작업기록 순서로 입력합니다. 날짜가 지났다는 이유로 완료 처리하지 않습니다. 실제 날씨와 지도 연결은 유지합니다.','After screen and settings review, enter new sample data through ordinary applications, planning and work records. Past dates do not imply completion. Live weather and maps stay connected.')}</p>
   <p>{t('예시 농지','Sample fields')} {data?.fields??'—'} · {t('작업','Tasks')} {data?.tasks??'—'} · {t('장비','Equipment')} {data?.equipment??'—'}</p>
   <div className="actions"><button disabled={busy||!data?.safe||!data.fields} onClick={remove}>{t('데모 데이터 삭제','Remove sample data')}</button><button disabled={busy} onClick={load}>{t('새로고침','Refresh')}</button></div>
   {!!data?.blockers?.length&&<div role="status"><p>{t('연결 기록을 함께 정리할 준비가 필요하여 삭제를 막았습니다. 현재 자료는 유지됩니다.','Removal is blocked until linked records can be handled safely. Current data is preserved.')}</p><ul>{data.blockers.map(b=><li key={b.code}>{locale==='ko'?b.ko:b.en} · {b.count}</li>)}</ul></div>}
   <p className="description">{t('출처가 확인되는 기존 예시 자료만 삭제합니다. 직접 저장한 자료·비용 장부는 삭제하지 않으며, 삭제한 계획은 복구용 기록으로 보관합니다.','Only identified generated sample data is removed. Manually saved records and cost accounting are preserved; removed plans are archived for recovery.')}</p>
   {message&&<p role="status">{message}</p>}
  </section>
 </div>;
}
