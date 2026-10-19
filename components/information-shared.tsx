'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {useLanguage,LanguageSelector} from './language';
import WorkspaceSidebar from './workspace-sidebar';
import {useKoreaDay} from './use-korea-day';
import {centerRegistry} from '@/lib/center-registry';
import type {Principal} from '@/lib/auth';
import styles from './information.module.css';

export function useReferenceData<T>(url:string){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError(false);setData(null);
  fetch(url,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const value=await r.json();if(!controller.signal.aborted)setData(value)}).catch(()=>{if(!controller.signal.aborted)setError(true)});
  return()=>controller.abort();
 },[url,revision]);
 return {data,error,retry:()=>setRevision(n=>n+1)};
}
export function useInfoSelection(key:string,fallback:string){
 const [selected,setSelected]=useState(fallback);
 useEffect(()=>{const read=()=>setSelected(new URLSearchParams(location.search).get(key)??fallback);read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read)},[key,fallback]);
 const select=(value:string)=>{const url=new URL(location.href);url.searchParams.set(key,value);history.pushState(null,'',url);setSelected(value)};
 return [selected,select] as const;
}
export function InformationShell({kind,children}:{kind:'crop-info'|'equipment-info'|'temperature-info';children:ReactNode}){
 const {locale}=useLanguage(),ko=locale==='ko',day=useKoreaDay(),{data}=useReferenceData<{user:Principal|null}>('/api/auth');
 const center=centerRegistry.find(c=>c.id===data?.user?.centerId);
 const englishCenter=({demo:'Gyebuk',janggye:'Janggye',cheoncheon:'Cheoncheon',gyenam:'Gyenam'} as Record<string,string>)[center?.id??''];
 return <div className={`shell ${styles.shell}`}><WorkspaceSidebar active={kind} globalOnly={data?.user?.role==='SUPER_ADMIN'}/><div className="content"><header className="topbar"><strong className="center-name">{center?(ko?center.name:`${englishCenter} Agriculture Support Center`):ko?'K-Farm 기준정보':'K-Farm reference library'}</strong><time dateTime={day}>{day}</time><LanguageSelector/></header><main className={`main ${styles.main}`}><div className={`page-heading ${styles.pageHeading}`}><div><p className={styles.eyebrow}>{ko?'기준정보':'Reference library'}</p><h1>{kind==='crop-info'?(ko?'작물정보':'Crop information'):kind==='temperature-info'?(ko?'기온정보':'Temperature information'):(ko?'장비정보':'Equipment information')}</h1></div><button className={styles.button} onClick={()=>window.print()}>{ko?'인쇄 / PDF 저장':'Print / Save PDF'}</button></div>{children}</main></div></div>;
}
export function Facts({rows}:{rows:[string,ReactNode][]}){return <dl className={styles.facts}>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
export function LoadState({error,retry,loading}:{error:boolean;retry:()=>void;loading:boolean}){
 const {locale}=useLanguage(),ko=locale==='ko';
 return error?<div role="alert" className={styles.error}>{ko?'자료를 불러오지 못했습니다.':'Could not load the data.'} <button className={styles.button} onClick={retry}>{ko?'다시 불러오기':'Retry'}</button></div>:loading?<p role="status">{ko?'자료를 불러오는 중…':'Loading…'}</p>:null;
}
export function SourceLink({href,children}:{href:string;children:ReactNode}){return <a href={href} target="_blank" rel="noreferrer" className={styles.sourceLink}>{children} ↗</a>}
