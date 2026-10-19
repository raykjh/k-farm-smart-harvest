'use client';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useState} from 'react';
import type {buildWorkReport} from '@/lib/work-report';
import type {State} from '@/lib/types';
import {useLanguage} from './language';
export default function EquipmentWorkLog({machineId,state}:{machineId:string;state:State}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [report,setReport]=useState<ReturnType<typeof buildWorkReport>|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;void fetch('/api/work-reports',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(live)setReport(d)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[machineId]);
 const rows=(report?.rows??[]).filter(r=>r.equipmentId===machineId).sort((a,b)=>(b.plannedDate??'').localeCompare(a.plannedDate??''));
 return <section className="section-space" data-testid="equipment-work-log"><h3>{t('운용 기록지','Equipment operating log')}</h3>{error&&<p role="alert">{error}</p>}<div className="table-wrap"><table><thead><tr>{[t('일자','Date'),t('농지','Field'),t('작물 / 작업','Crop / task'),t('상태','Status'),t('실제 작업시간','Recorded duration')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.missionId}><td>{r.plannedDate}</td><td><a href={`/?tab=fields&field=${r.fieldId}`}>{state.fields.find(f=>f.id===r.fieldId)?.address??r.fieldId}</a></td><td>{operationalText(r.crop,locale)} · {operationalText(r.task,locale)}</td><td>{r.confirmed?t('완료','Completed'):r.status==='CANCELLED'?t('취소','Cancelled'):t('예정 / 결과 대기','Planned / awaiting result')}</td><td>{r.executionMinutes===null?'—':r.executionMinutes+t('분',' min')}</td></tr>)}</tbody></table></div>{report&&!rows.length&&<p>{t('운용 기록이 없습니다.','No operating records.')}</p>}</section>;
}
