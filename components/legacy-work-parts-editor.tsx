'use client';
import {useState} from 'react';
import type {legacyWorkGroups} from '@/lib/legacy-work-parts';
import {useLanguage} from './language';
import {Button} from './ui/button';
export type LegacyWorkGroup=ReturnType<typeof legacyWorkGroups>[number];
export function LegacyWorkPartsEditor({group,enabled,save}:{group:LegacyWorkGroup;enabled:boolean;save:(b:object)=>Promise<boolean>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [values,setValues]=useState(()=>Object.fromEntries(group.members.map(m=>[m.id,{area:m.workAreaM2?.toString()??'',setup:m.setupMinutes?.toString()??''}]))),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
 return <details data-testid={'legacy-parts-'+group.key}><summary>{t('기존 부분 작업 연결','Link legacy work parts')} · {group.members[0]?.label} · {group.members.length}{t('회',' parts')}</summary>
 <p>{t('담당자가 회차별 작업량을 확인하여 연결합니다. 일정·예약·실적은 유지하며, 연결 뒤 현장 구역을 별도로 확인해야 합니다.','Confirm each part workload. Dates, bookings and execution history stay unchanged; field-area review is still required afterwards.')}</p>
 {!group.editable&&<p>{t(group.reason,'Incomplete, duplicate, started or completed histories cannot be migrated automatically.')}</p>}
 <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await save({action:'linkLegacyParts',review:{key:group.key,fingerprint:group.fingerprint,note,confirmed,parts:group.members.map(m=>({missionId:m.id,workAreaM2:Number(values[m.id].area),setupMinutes:Number(values[m.id].setup)}))}})}finally{setBusy(false)}}}>
 <fieldset disabled={!enabled||!group.editable||busy}><div className="table-wrap"><table><thead><tr><th>{t('작업','Task')}</th><th>{t('작업면적 m²','Work area m²')}</th><th>{t('준비시간 분','Setup minutes')}</th></tr></thead><tbody>{group.members.map((m,i)=><tr key={m.id}><td>{i+1}. {m.label}<br/>{m.scheduledDate}</td><td><input aria-label={`${t('기존 회차','Legacy part')} ${i+1} m²`} type="number" min="0.01" step="any" required value={values[m.id].area} onChange={e=>{setValues({...values,[m.id]:{...values[m.id],area:e.target.value}});setConfirmed(false)}}/></td><td><input aria-label={`${t('기존 회차','Legacy part')} ${i+1} ${t('준비시간','setup')}`} type="number" min="0" max="480" required value={values[m.id].setup} onChange={e=>{setValues({...values,[m.id]:{...values[m.id],setup:e.target.value}});setConfirmed(false)}}/></td></tr>)}</tbody></table></div>
 <label>{t('이관 확인 근거','Linkage review evidence')}<input required minLength={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('같은 작업의 모든 회차와 작업량을 확인했습니다.','I reviewed every part and workload of the same operation.')}</label>
 <Button type="submit" disabled={!confirmed}>{t('분할 식별정보 연결','Link work-part identities')}</Button></fieldset></form></details>;
}
