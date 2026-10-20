'use client';
import {useEffect,useRef,useState} from 'react';
import {operationalText} from '@/lib/operational-i18n';
import {centerRegistry} from '@/lib/center-registry';
import {centerText,equipmentText} from '@/lib/display-language';
import {useLanguage} from './language';
import {Button} from './ui/button';
import CenterResources from './center-resources';
type Booking={id:string;centerId:string;label:string;from:string;to:string;version:number;centerVersion:number;canCancel:boolean};
type Review={status:string;results:{centerId:string;status:string;changes?:number;error?:string}[]};
type Schedule={owned:boolean;ownerVersion:number;items:Booking[];review:Review|null};
export default function EquipmentSchedule({machineId,onRefresh}:{machineId:string;onRefresh:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [data,setData]=useState<Schedule|null>(null),[cancel,setCancel]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const request=useRef<string|null>(null);
 async function load(){const r=await fetch('/api/equipment-schedule?machineId='+encodeURIComponent(machineId),{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setCancel([]);}
 useEffect(()=>{request.current=null;void load().catch(e=>setError(e.message))},[machineId]);
 function toggle(id:string){request.current=null;setCancel(old=>old.includes(id)?old.filter(v=>v!==id):[...old,id]);}
 async function apply(){
  if(!data)return;setBusy(true);setError('');setMessage('');
  request.current??=crypto.randomUUID();
  try{
   const r=await fetch('/api/equipment-schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machineId,ownerVersion:data.ownerVersion,requestId:request.current,cancel:data.items.filter(r=>cancel.includes(r.id)).map(({id,version,centerVersion})=>({id,version,centerVersion}))})}),d=await r.json();
   if(!r.ok){request.current=null;await load();await onRefresh();throw Error(d.error);}
   request.current=null;await load();await onRefresh();
   setMessage(d.review&&d.review.status!=='COMPLETE'?t('예약 변경을 저장했습니다. 일정 재검토가 대기 중입니다.','Reservation changes saved. Schedule review is pending.'):d.review?t('일정 검토·적용을 완료했습니다.','Schedule review completed.'):t('예약 변경을 저장했습니다.','Reservation changes saved.'));
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 const time=(value:string)=>new Intl.DateTimeFormat(locale==='ko'?'ko-KR':'en-GB',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
 const name=(id:string)=>centerText(centerRegistry.find(c=>c.id===id)?.name??id,locale);
 return <section className="section-space" data-testid="equipment-schedule">
  <div className="card-head"><h3>{t('예약 현황','Reservations')}</h3><Button disabled={busy||!data||!data.owned&&!cancel.length} onClick={()=>void apply()}>{busy?t('적용 중','Applying'):t('일정 적용','Apply schedule')}</Button></div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <div className="table-wrap"><table><thead><tr>{[t('사용 센터','Using center'),t('작업','Work'),t('예약 시간','Reserved time'),t('취소','Cancel')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data?.items.map(r=><tr key={r.id} style={cancel.includes(r.id)?{opacity:0.55,textDecoration:'line-through'}:undefined}><td>{name(r.centerId)}</td><td>{operationalText(r.label,locale)}</td><td>{time(r.from)} — {time(r.to)}</td><td><Button variant="outline" disabled={busy||!r.canCancel} aria-label={t(`${r.label} 예약 ${cancel.includes(r.id)?'취소 선택 해제':'취소 선택'}`,`${cancel.includes(r.id)?'Undo cancellation':'Cancel reservation'} ${r.label}`)} aria-pressed={cancel.includes(r.id)} onClick={()=>toggle(r.id)}>{cancel.includes(r.id)?t('되돌리기','Undo'):'×'}</Button></td></tr>)}</tbody></table></div>
  {data&&!data.items.length&&<p>{t('등록된 예약이 없습니다.','No reservations.')}</p>}
  {data?.review?.results.filter(r=>r.error).map((r,i)=><p role="status" key={i}>{name(r.centerId)} · {r.error}</p>)}
  <CenterResources machineId={machineId} onSaved={async()=>{await load();await onRefresh();}}/>
 </section>;
}
