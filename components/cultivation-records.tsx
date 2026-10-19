'use client';
import {useState} from 'react';
import type {Cultivation} from '@/lib/cultivation';
import type {FieldEntry} from '@/lib/field-record';
import {cropDisplayNames,cropCodes} from '@/lib/crop-registry';
import {useReferenceData,LoadState} from './information-shared';
import {useLanguage} from './language';
import {useKoreaDay} from './use-korea-day';

/** Historical and future cycles share one index; edits belong to the field. */
export default function CultivationRecords(){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en,today=useKoreaDay();
 const rows=useReferenceData<{items:{payload:Cultivation}[]}>('/api/cultivations'),fields=useReferenceData<{payload:FieldEntry[]}>('/api/fields');
 const [crop,setCrop]=useState(''),[query,setQuery]=useState('');
 const names=cropDisplayNames(locale==='ko'),address=(pnu:string)=>fields.data?.payload.find(f=>f.pnu===pnu)?.address??pnu;
 const items=(rows.data?.items??[]).map(r=>r.payload).filter(c=>(!crop||crop===c.crop)&&address(c.pnu).includes(query.trim())).sort((a,b)=>b.start.localeCompare(a.start)||a.pnu.localeCompare(b.pnu));
 return <section className="card" data-testid="cultivation-records"><h2>{t('재배기록','Cultivation records')}</h2>
  <div className="actions"><label>{t('작물','Crop')}<select value={crop} onChange={e=>setCrop(e.target.value)}><option value="">{t('전체','All')}</option>{cropCodes.map(c=><option value={c} key={c}>{names[c]}</option>)}</select></label><label>{t('농지 검색','Search fields')}<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
  <LoadState error={rows.error||fields.error} loading={!rows.data&&!rows.error} retry={()=>{rows.retry();fields.retry()}}/>
  {rows.data&&<div className="table-wrap"><table><thead><tr>{[t('농지','Field'),t('작물','Crop'),t('재배 기간','Cultivation period'),t('상태','Status'),t('관리','Manage')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{items.map(c=><tr key={c.id}><td>{address(c.pnu)}</td><td>{names[c.crop]}</td><td>{c.start} ~ {c.end}</td><td>{c.closedAt?t('종료 기록','Closed'):c.end<today?t('지난 재배기간','Past cultivation period'):c.start>today?t('재배 예정','Upcoming cultivation'):t('현재 재배기간','Current cultivation period')}</td><td><a href={`/?tab=fields&field=${encodeURIComponent(c.pnu)}`}>{t('농지 관리','Manage field')}</a></td></tr>)}</tbody></table>{!items.length&&<p>{t('해당 재배기록이 없습니다.','No matching cultivation records.')}</p>}</div>}
 </section>;
}
