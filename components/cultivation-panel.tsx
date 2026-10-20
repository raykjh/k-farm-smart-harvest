'use client';
import {addressText} from '@/lib/display-language';
import {cropCodes,cropDisplayNames,isLegacyCrop,type SupportedCropCode} from '@/lib/crop-registry';
import CultivationChange from './cultivation-change';
import {useEffect,useState} from 'react';
import {useLanguage} from './language';
import type {FieldEntry} from '@/lib/field-record';
import RegionalContextEditor from './regional-context-editor';
import type {GuidelineContext} from '@/lib/crop-guidelines';
import type {Cultivation} from '@/lib/cultivation';
import FieldCropManager from './field-crop-manager';

export default function CultivationPanel({onSaved,fieldId}:{onSaved?:()=>Promise<void>;fieldId?:string}){
 return fieldId?<FieldCropManager fieldId={fieldId} onSaved={onSaved}/>:<LegacyCultivationPanel onSaved={onSaved}/>;
}
function LegacyCultivationPanel({onSaved,fieldId}:{onSaved?:()=>Promise<void>;fieldId?:string}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [fields,setFields]=useState<FieldEntry[]>([]),[items,setItems]=useState<Cultivation[]>([]),[pnu,setPnu]=useState(fieldId??''),[crop,setCrop]=useState(fieldId?'':'rice');
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[plant,setPlant]=useState(''),[previousId,setPrevious]=useState('');
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[preview,setPreview]=useState<any>(null);
 const [context,setContext]=useState<GuidelineContext>({region:'계북면'}),[showNew,setShowNew]=useState(false),[selectedCycle,setSelectedCycle]=useState('');
 const usesPlantingAnchor=isLegacyCrop(crop)&&!context.catalog,names=cropDisplayNames(locale==='ko');
 async function request(url:string,body?:unknown){
  const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}),d=await r.json();
  if(!r.ok)throw Error(d.error??t('처리하지 못했습니다. 다시 확인해주세요.','Could not complete this request.'));return d;
 }
 async function read(){
  const [f,c]=await Promise.all([request('/api/fields'),request('/api/cultivations')]);
  setFields(f.payload??[]);setItems((c.items??[]).map((r:any)=>r.payload));setLoaded(true);
  if(fieldId){const selected=(f.payload??[]).find((x:FieldEntry)=>x.pnu===fieldId);if(selected?.conditions?.region)setContext(current=>({...current,region:selected.conditions.region}));}
 }
 useEffect(()=>{void read().catch(e=>setError(e.message))},[]);
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await action()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 async function calculate(id:string){
  const value=await request('/api/annual-dispatch?cultivationId='+id);setPreview(value);return value;
 }
 const canApprove=(value:any)=>!!value?.assignments?.length&&value.feasibility?.every((f:any)=>f.status==='CAPACITY_FEASIBLE');
 async function approve(value=preview){
  if(!value)return;
  await request('/api/annual-dispatch',{cultivationId:value.cultivationId,token:value.token,demoAcknowledged:true});
  setPreview(null);await read();await onSaved?.();setMessage(t('작물과 일정을 저장했습니다.','Crop and schedule saved.'));
 }
 async function create(){
  setPreview(null);
  const d=await request('/api/cultivations',{cultivation:{id:crypto.randomUUID(),pnu,crop,start,end,...(previousId?{previousId}:{}),source:'REGISTERED'},context:{...context,region:context.regionalProfile?.region??fields.find(f=>f.pnu===pnu)?.conditions?.region??context.region,anchors:usesPlantingAnchor&&plant?{[crop]:{planting:plant}}:{}}});
  // The draft is durable even when scheduling fails. Reuse it, rather than
  // inviting another create request with a new UUID and an overlapping period.
  setShowNew(false);setSelectedCycle(d.id);await read();
  if(fieldId){const value=await calculate(d.id);if(canApprove(value))await approve(value);else setMessage(t('작물 초안을 저장했습니다. 일정 조건을 확인한 뒤 다시 계산할 수 있습니다.','Crop draft saved. Review the scheduling conditions and calculate again.'));}
  else setMessage(t('재배 건과 계획 초안을 저장했습니다.','Cultivation and plan draft saved.'));
 }
 const active=items.filter(c=>!c.closedAt&&(!pnu||c.pnu===pnu)).sort((a,b)=>b.start.localeCompare(a.start));
 const current=active.find(c=>c.id===selectedCycle)??active.find(c=>c.start<=new Date(Date.now()+9*3600000).toISOString().slice(0,10)&&c.end>=new Date(Date.now()+9*3600000).toISOString().slice(0,10))??active[0];
 const formVisible=!fieldId||loaded&&(!active.length||showNew);
 const content=<>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {fieldId&&!loaded&&!error&&<p role="status">{t('재배 정보를 불러오는 중입니다.','Loading cultivation details.')}</p>}
  {fieldId&&active.length>0&&<div className="field-crop-toolbar">
   <label>{t('재배 계획','Cultivation plan')}<select value={current.id} disabled={busy} onChange={e=>{setSelectedCycle(e.target.value);setPreview(null);setShowNew(false);setError('');setMessage('');}}>{active.map(c=><option key={c.id} value={c.id}>{names[c.crop]} · {c.start} ~ {c.end}</option>)}</select></label>
   <button type="button" disabled={busy} onClick={()=>{setShowNew(v=>!v);setPreview(null);setPrevious(active[0].id);setStart('');setEnd('');}}>{showNew?t('입력 닫기','Close entry'):t('다음 재배 등록','Register next cultivation')}</button>
  </div>}
  {formVisible&&<fieldset disabled={busy} className="field-crop-create">
   <div className={fieldId?'field-crop-form':'actions'}>
    {!fieldId&&<label>{t('농지','Field')}<select value={pnu} onChange={e=>{setPnu(e.target.value);setPrevious('');setPlant('');setPreview(null);const f=fields.find(f=>f.pnu===e.target.value);setContext({region:f?.conditions?.region??''});if(f?.crop)setCrop(f.crop)}}><option value="">{t('농지 선택','Select field')}</option>{fields.map(f=><option key={f.pnu} value={f.pnu}>{addressText(f.address,locale)}</option>)}</select></label>}
    <label>{t('작물','Crop')}<select value={crop} onChange={e=>{setCrop(e.target.value);setPlant('');setPreview(null);setContext({region:context.region});}}>{fieldId&&<option value="">{t('작물을 선택해주세요','Select a crop')}</option>}{cropCodes.map(v=><option key={v} value={v}>{names[v]}</option>)}</select></label>
    <label>{t('재배 시작','Period start')}<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>{t('정리 완료 예정','Expected period end')}<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    {usesPlantingAnchor&&<label>{t('파종·정식 기준일(선택)','Planting anchor (optional)')}<input type="date" value={plant} onChange={e=>setPlant(e.target.value)}/></label>}
    {(!fieldId||active.length>0)&&<label>{t('이전 재배 연결','Previous cultivation')}<select value={previousId} onChange={e=>setPrevious(e.target.value)}><option value="">{t('없음','None')}</option>{active.map(c=><option key={c.id} value={c.id}>{c.start} ~ {c.end} · {names[c.crop]}</option>)}</select></label>}
   </div>
   {crop&&<RegionalContextEditor crop={crop as SupportedCropCode} value={context} onChange={setContext}/>}
   <button type="button" className="field-crop-submit" disabled={!pnu||!crop||!start||!end} onClick={()=>run(create)}>{fieldId?t('작물 선택·일정 등록','Select crop and schedule'):t('재배 등록','Register cultivation')}</button>
  </fieldset>}
  {(!fieldId||!showNew)&&(fieldId?(current?[current]:[]):active).map(c=><section className="field-crop-cycle" key={c.id}>
   <div className="field-crop-cycle-head"><strong>{names[c.crop]} · {c.start} ~ {c.end}</strong><button type="button" disabled={busy} onClick={()=>run(async()=>{await calculate(c.id)})}>{fieldId?t('일정 계산','Calculate schedule'):t('배차 검토','Preview dispatch')}</button></div>
   <CultivationChange id={c.id} crop={c.crop} area={fields.find(f=>f.pnu===c.pnu)?.area??0} expanded={!!fieldId} region={fields.find(f=>f.pnu===c.pnu)?.conditions?.region} onSaved={async()=>{setPreview(null);setMessage('');setError('');await read();await onSaved?.()}}/>
  </section>)}
  {preview&&<section className="field-crop-preview">
   <p>{t('배치 가능','Scheduled')} {preview.assignments.length} · {t('확인 대기','Pending')} {preview.pending.length}</p>
   {!!preview.pending.length&&<details open><summary>{t('확인할 조건','Conditions to review')}</summary>{preview.pending.map((p:any)=><p key={p.id}>{p.reason}</p>)}</details>}
   <button type="button" disabled={busy||!canApprove(preview)} onClick={()=>run(()=>approve())}>{fieldId?t('일정 저장','Save schedule'):t('잠정 배차 저장','Save provisional dispatch')}</button>
  </section>}
 </>;
 return fieldId?<FieldCropManager fieldId={fieldId} onSaved={onSaved}/>:<details className="card section-space"><summary>{t('재배 건 관리','Cultivations')} · {items.length}</summary>{content}</details>;
}
