'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
import {cropDisplayNames} from '@/lib/crop-registry';
import type {FieldEntry} from '@/lib/field-record';
import type {Cultivation} from '@/lib/cultivation';
import type {CropChangeOption} from '@/lib/crop-change-options';
import CultivationChange from './cultivation-change';
type Choice=Omit<CropChangeOption,'context'>;
export default function FieldCropManager({fieldId,onSaved}:{fieldId:string;onSaved?:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [field,setField]=useState<FieldEntry>(),[cycle,setCycle]=useState<Cultivation>(),[choices,setChoices]=useState<Choice[]>([]),[notes,setNotes]=useState<string[]>([]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[choice,setChoice]=useState(''),[preview,setPreview]=useState<any>(null);
 async function request(url:string,body?:unknown){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error??t('처리 실패','Request failed'));return d;}
 async function read(){const [f,c]=await Promise.all([request('/api/fields'),request('/api/cultivations')]);setField(f.payload.find((x:FieldEntry)=>x.pnu===fieldId));
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),cycles: Cultivation[]=c.items.map((r:any)=>r.payload).filter((x:Cultivation)=>x.pnu===fieldId&&!x.closedAt).sort((a:Cultivation,b:Cultivation)=>b.start.localeCompare(a.start));
  setCycle(cycles.find(x=>x.start<=today&&x.end>=today)??cycles[0]);setLoaded(true);
 }
 useEffect(()=>{void read().catch(e=>setError(e.message));},[fieldId]);
 async function toggle(){if(open){setOpen(false);return;}setBusy(true);setError('');try{const d=await request('/api/crop-change-options?pnu='+fieldId);setChoices(d.choices);setNotes(d.notes);setChoice('');setOpen(true);}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function saved(){setOpen(false);setPreview(null);await read();await onSaved?.();}
 async function register(){const selected=choices.find(c=>c.id===choice);if(!selected||!field)return;setBusy(true);setError('');try{
  const value=await request('/api/cultivations',{candidateId:choice,cultivation:{id:crypto.randomUUID(),pnu:fieldId,crop:selected.crop,start:selected.start,end:selected.end,source:'REGISTERED'}});
  // Reuse the persisted draft if placement is incomplete; never create it twice.
  await read();setOpen(false);setPreview(await request('/api/annual-dispatch?cultivationId='+value.id));
 }catch(e){setError(String(e));}finally{setBusy(false);}}
 async function approve(){setBusy(true);setError('');try{await request('/api/annual-dispatch',{cultivationId:preview.cultivationId,token:preview.token,demoAcknowledged:true});await saved();}catch(e){setError(String(e));}finally{setBusy(false);}}
 const crop=field?.crop||cycle?.crop;
 return <div className="field-crop-management field-season-manager">
  <div className="field-crop-toolbar"><div><span>{t('현재 작물','Current crop')}</span><strong>{!loaded?t('불러오는 중','Loading'):crop?cropDisplayNames(locale==='ko')[crop]:t('작물 선택 대기','Awaiting crop selection')}</strong></div>
   <button type="button" disabled={!loaded||busy} onClick={()=>void toggle()}>{open?t('닫기','Close'):crop?t('작물 변경하기','Change crop'):t('작물 선택하기','Select crop')}</button></div>
  {error&&<p role="alert">{error}</p>}
  {open&&<div className="field-season-selection">
   {notes.map(note=><p key={note} role="status">{note}</p>)}
   {!!choices.length&&(cycle?<CultivationChange key={cycle.id} id={cycle.id} crop={cycle.crop} area={field?.area??0} choices={choices} expanded onSaved={saved}/>:<>
    <label>{t('작물','Crop')}<select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">{t('작물을 선택해주세요','Select a crop')}</option>{(['THIS_YEAR','NEXT_YEAR'] as const).map(season=><optgroup key={season} label={season==='THIS_YEAR'?t('올해 식재 가능','Plant this year'):t('다음 해 식재 가능','Plant next year')}>{choices.filter(c=>c.season===season).map(c=><option key={c.id} value={c.id}>{cropDisplayNames(locale==='ko')[c.crop]} · {c.plantingFrom} ~ {c.plantingTo}</option>)}</optgroup>)}</select></label>
    <button disabled={busy||!choice} onClick={()=>void register()}>{t('작물 선택·일정 등록','Select crop and schedule')}</button>
   </>)}
  </div>}
  {preview&&<section><p>{t('배치 가능','Scheduled')} {preview.assignments.length} · {t('확인 대기','Pending')} {preview.pending.length}</p>{preview.pending.map((p:any)=><p key={p.id}>{p.reason}</p>)}<button disabled={busy||!preview.assignments.length||!preview.feasibility?.every((f:any)=>f.status==='CAPACITY_FEASIBLE')} onClick={()=>void approve()}>{t('일정 저장','Save schedule')}</button></section>}
 </div>;
}
