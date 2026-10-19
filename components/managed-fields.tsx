'use client';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useState} from 'react';
import type {State} from '@/lib/types';
import type {ProductionItem} from '@/lib/continuous-production';
import {cropEnglishName} from '@/lib/crop-registry';
import {productionStatusLabel} from '@/lib/production-display';
import {isClosedTask} from '@/lib/task-lifecycle';
import {useKoreaDay} from './use-korea-day';
import {useLanguage} from './language';
import FieldParcelMap from './field-parcel-map';
import FieldManagement from './field-management';
import ContinuousProductionPanel from './continuous-production-panel';
import Modal from './modal';
import {Button} from './ui/button';

export default function ManagedFields({state,onRefresh,onRegister}:{state:State;onRefresh:()=>Promise<void>;onRegister:()=>void}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en,today=useKoreaDay();
 const [managedId,setManagedId]=useState<string|null>(null),[planning,setPlanning]=useState(false),[planningBusy,setPlanningBusy]=useState(false);
 const [production,setProduction]=useState<ProductionItem[]>([]),[error,setError]=useState(''),[reviewRevision,setReviewRevision]=useState(0);
 const fields=state.fields.filter(f=>f.serviceStatus!=='WITHDRAWN');
 const crop=(value:string)=>locale==='ko'?value:cropEnglishName(value);
 useEffect(()=>{
  const params=new URLSearchParams(location.search);
  const review=params.get('section')==='planning'||params.get('section')==='production';
  setManagedId(review?null:params.get('field'));
  setPlanning(review);
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  // The field list reads the stored review. Browsing is not a planning command.
  void fetch('/api/continuous-production',{cache:'no-store',signal:controller.signal}).then(async r=>{
   const data=await r.json();if(!r.ok)throw Error(data.error);setProduction(data.view?.items??[]);setError('');
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e))});
  return()=>controller.abort();
 },[state,reviewRevision]);
 function showPlanning(open:boolean){
  if(planningBusy)return;
  setPlanning(open);const url=new URL(location.href);
  if(open){setManagedId(null);url.searchParams.delete('field');url.searchParams.set('section','planning')}else{url.searchParams.delete('section');setReviewRevision(v=>v+1)}
  history.replaceState(null,'',url);
 }
 function showField(id:string|null){setManagedId(id);const url=new URL(location.href);if(id)url.searchParams.set('field',id);else{url.searchParams.delete('field');setReviewRevision(v=>v+1)}history.replaceState(null,'',url)}
 return <div data-testid="ops-fields">
  <section className="card"><div className="card-head"><h2>{t(state.name.replace('농업지원센터','농지 지도'),'Managed field map')}</h2><Button onClick={onRegister}>＋ {t('신규 농지 등록','Register new field')}</Button></div><FieldParcelMap fields={fields}/></section>
  <section className="card section-space">
   <div className="card-head"><h2>{t('관리 농지','Managed fields')}</h2><Button variant="outline" onClick={()=>showPlanning(true)}>{t('AI 계획·일괄 확정','AI planning / batch approval')}</Button></div>
   {error&&<p role="alert">{t('생산계획 조회 실패: ','Could not load production plans: ')}{error}</p>}
   <div className="table-wrap"><table className="managed-fields-table"><thead><tr>{[t('농지','Field'),t('면적','Area'),t('현재 작물','Current crop'),t('다음 작업','Next task'),t('계획 상태','Plan status'),t('장비 진입','Machine access'),t('관리','Manage')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{fields.map(f=>{
    const item=production.find(i=>i.pnu===f.id),next=state.missions.filter(m=>m.fieldId===f.id&&m.scheduledDate&&m.scheduledDate>=today&&!isClosedTask(m.status)).sort((a,b)=>a.scheduledDate!.localeCompare(b.scheduledDate!)||a.start-b.start)[0];
    return <tr key={f.id} data-testid={'managed-field-'+f.id}>
     <td>{f.address}<br/><small>{f.name}</small></td><td>{f.area.toLocaleString()} m²</td>
     <td>{!f.crop||f.serviceStatus==='CROP_REQUIRED'?t('작물 선택 대기','Awaiting crop selection'):crop(f.crop)}</td>
     <td>{next?<><time dateTime={next.scheduledDate}>{next.scheduledDate}</time><br/>{operationalText(next.label,locale)}</>:'—'}</td>
     <td>{item?productionStatusLabel(item.status,locale==='ko'):'—'}</td>
     <td>{f.machineAccess==='yes'?t('가능','Available'):f.machineAccess==='no'?t('불가능','Unavailable'):t('미확인','Unknown')}</td>
     <td><Button variant="outline" onClick={()=>showField(f.id)}>{t('관리','Manage')}</Button></td>
    </tr>;
   })}</tbody></table></div>
  </section>
  {fields.filter(f=>f.id===managedId).map(f=><Modal key={f.id} className="field-management-modal" title={t('농지 관리','Field management')} onClose={()=>showField(null)}><FieldManagement field={f} onSaved={onRefresh}/></Modal>)}
  {planning&&<Modal className="field-planning-modal" title={t('AI 계획·일괄 확정','AI planning / batch approval')} onClose={()=>showPlanning(false)}><ContinuousProductionPanel onSaved={onRefresh} onBusy={setPlanningBusy}/></Modal>}
 </div>;
}
