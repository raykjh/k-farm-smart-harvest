'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
export default function PlanChangeLog({version,onDelivered}:{version:number;onDelivered?:()=>Promise<void>}){
 const {locale}=useLanguage(),ko=locale==='ko';const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[delivered,setDelivered]=useState<number|null>(null);
 const load=async()=>{const r=await fetch('/api/work-history');if(!r.ok)throw Error('조회 실패 / Unavailable');setData(await r.json())};
 useEffect(()=>{load().catch(e=>setError(e.message))},[version]);
 async function deliver(){setBusy(true);setError('');setDelivered(null);try{const r=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deliver',key:crypto.randomUUID()})}),result=await r.json();if(!r.ok)throw Error(result.error||'모의 처리 실패 / Mock failed');setDelivered(result.result.delivered);await load();await onDelivered?.()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <details className="card section-space"><summary>{ko?'일정 변경·모의 알림 이력':'Plan changes and mock notifications'}</summary>{error&&<p role="alert">{error}</p>}{delivered!==null&&<p role="status">{ko?`알림 ${delivered}건 수신 처리됨`:`${delivered} notifications delivered`}</p>}<p>{ko?'실제 문자 발송 없이 모의 수신 처리를 확인합니다.':'Mock delivery only; no real SMS.'}</p>{data?.changes?.map((c:any,i:number)=><p key={i}>{c.after?.label} · {c.before?.scheduledDate} → {c.after?.scheduledDate} · {c.approvedAt}{c.simulation&&' · '+(ko?'가상 상황':'Simulation')}</p>)}<button disabled={busy||!data?.notices?.some((n:any)=>['PENDING','FAILED'].includes(n.status))} onClick={deliver}>{ko?'대기 알림 모의 수신 처리':'Simulate pending deliveries'}</button>{data?.notices?.map((n:any)=><p key={n.id}>{n.body} · {n.status}</p>)}</details>
}
