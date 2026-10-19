'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
export default function PlanChangeLog({version}:{version:number}){
 const {locale}=useLanguage(),ko=locale==='ko';const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetch('/api/work-history').then(async r=>{if(!r.ok)throw Error('조회 실패 / Unavailable');const d=await r.json();if(active)setData(d)}).catch(e=>active&&setError(e.message));return()=>{active=false}},[version]);
 return <details className="card section-space"><summary>{ko?'일정 변경·이전 안내 기록':'Plan changes and previous notice records'}</summary>{error&&<p role="alert">{error}</p>}<a href="/?tab=labor&section=messages">{ko?'문자 관리':'Text messages'}</a>{data?.changes?.map((c:any,i:number)=><p key={i}>{c.after?.label} · {c.before?.scheduledDate} → {c.after?.scheduledDate} · {c.approvedAt}{c.simulation&&' · '+(ko?'가상 상황':'Simulation')}</p>)}{data?.notices?.map((n:any)=><p key={n.id}>{n.body} · {n.status}</p>)}</details>;
}
