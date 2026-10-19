'use client';
import {cropCodes,cropDisplayNames,type SupportedCropCode} from '@/lib/crop-registry';
import {useState} from 'react';
import {useLanguage} from './language';
import RegionalContextEditor from './regional-context-editor';
import type {GuidelineContext,CropCode} from '@/lib/crop-guidelines';
import type {CropChangeOption} from '@/lib/crop-change-options';
export default function CultivationChange({id,crop,area,onSaved,expanded=false,region,choices}:{id:string;crop:string;area:number;onSaved:()=>Promise<void>;expanded?:boolean;region?:string;choices?:Omit<CropChangeOption,'context'>[]}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [nextCrop,setCrop]=useState(crop),[nextArea,setArea]=useState(area),[draft,setDraft]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [context,setContext]=useState<GuidelineContext|undefined>(),[cost,setCost]=useState(''),[consent,setConsent]=useState('');
 const [candidateId,setCandidate]=useState('');
 const candidate=choices?.find(c=>c.id===candidateId);
 async function run(action:'preview'|'save'|'approve'){
  setBusy(true);setError('');try{
   const r=await fetch('/api/cultivation-change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,crop:choices?candidate?.crop:nextCrop,area:choices?area:nextArea,...(choices?{candidateId}:{context}),action,token:action!=='preview'?draft.token:undefined,...(action==='approve'?{review:{cost,consent}}:{})})}),d=await r.json();
   if(!r.ok)throw Error(d.error);setDraft(d);if(d.saved)await onSaved();
  }catch(e){setError(String(e));setDraft(null);}finally{setBusy(false);}
 }
 return <details open={expanded||undefined} className={choices?'field-season-change':undefined}><summary>{choices?t('변경 작물 선택','Choose replacement crop'):t('농지·작물 변경안','Field and crop change')}</summary>
  {!expanded&&<p>{t('완료 기록은 보존하고 예정 작업의 변경 영향을 검토합니다. 승인 전에는 기존 계획을 변경하지 않습니다.','Completed records are preserved. Review future work before applying changes.')}</p>}
  <fieldset disabled={busy}>
   {choices?<>
    <label>{t('변경 작물','New crop')}<select value={candidateId} onChange={e=>{setCandidate(e.target.value);setDraft(null);}}><option value="">{t('작물을 선택해주세요','Select a crop')}</option>{(['THIS_YEAR','NEXT_YEAR'] as const).map(season=><optgroup key={season} label={season==='THIS_YEAR'?t('올해 식재 가능','Plant this year'):t('다음 해 식재 가능','Plant next year')}>{choices.filter(c=>c.season===season).map(c=><option key={c.id} value={c.id}>{cropDisplayNames(locale==='ko')[c.crop]} · {c.plantingFrom} ~ {c.plantingTo}</option>)}</optgroup>)}</select></label>
    {candidate&&<p>{t('파종·정식','Planting')} {candidate.plantingFrom} ~ {candidate.plantingTo}</p>}
   </>:<>
    <label>{t('변경 작물','New crop')}<select value={nextCrop} onChange={e=>{setCrop(e.target.value);setContext(undefined);setDraft(null);}}>{cropCodes.map(v=><option key={v} value={v}>{cropDisplayNames(locale==='ko')[v]}</option>)}</select></label>
    <label>{t('변경 면적 (㎡)','New area (m²)')}<input min={1} type="number" value={nextArea} onChange={e=>{setArea(Number(e.target.value));setDraft(null);}}/></label>
    <details><summary>{t('대체 작물 작업 기준 보완','Replacement work criteria')}</summary><RegionalContextEditor crop={nextCrop as SupportedCropCode} value={context??{region}} onChange={v=>{setContext(v);setDraft(null);}}/></details>
   </>}
   <button disabled={!!choices&&!candidate} onClick={()=>run('preview')}>{choices?t('변경 일정 확인','Review replacement schedule'):t('변경 영향·재계획 계산','Calculate change and replan')}</button>
  </fieldset>
  {error&&<p role="alert">{error}</p>}
  {draft&&<>
   <p>{t('작업 '+draft.tasks+'건 · 배차 후보 '+draft.dispatch.assignments.length+'건 · 확인 대기 '+draft.dispatch.pending.length+'건','Tasks '+draft.tasks+' · Assignments '+draft.dispatch.assignments.length+' · Pending '+draft.dispatch.pending.length)}</p>
   {draft.impact&&<section aria-label={t('변경 영향','Change impact')}>
    <p>{t('완료 보존','Completed kept')} {draft.impact.preserved.length} · {t('예정 작업 교체','Future replaced')} {draft.impact.removed.length} · {t('예약','Reservations')} {draft.impact.reservations.length} · {t('인력 모집','Labor jobs')} {draft.impact.labor.length}</p>
    <details><summary>{t('영향 내역','Impact details')}</summary>
     {draft.impact.preserved.map((m:any)=><p key={m.id}>{t('보존','Keep')} · {m.date} · {m.name}</p>)}
     {draft.impact.removed.map((m:any)=><p key={m.id}>{t('기존 일정 해제','Release')} · {m.date} · {m.name} · {m.resourceId??t('인력','Labor')}</p>)}
     {draft.impact.reservations.map((r:any)=><p key={r.id}>{r.resourceId} · {r.from} ~ {r.to}</p>)}
     {draft.impact.labor.map((j:any)=><p key={j.id}>{j.date} · {t('배정 인력','Assigned workers')}: {j.assigned.join(', ')||'—'}</p>)}
     {draft.dispatch.assignments.map((a:any)=><p key={a.taskId}>{t('변경 후','After')} · {a.date} · {a.machineId??a.owner} · {a.durationMinutes}{t('분',' min')}</p>)}
    </details>
    <p>{t('비용은 미산정입니다. 기발생 실비·취소 비용·추가 비용을 확인하세요.','Cost is not calculated. Review incurred, cancellation and additional costs.')}</p>
    <label>{t('비용 검토 기록','Cost review')}<textarea disabled={busy} value={cost} onChange={e=>setCost(e.target.value)}/></label>
    <label>{t('소유주 동의·위임 근거','Owner consent or delegation')}<textarea disabled={busy} value={consent} onChange={e=>setConsent(e.target.value)}/></label>
   </section>}
   {draft.blockers?.map((p:string)=><p role="alert" key={p}>{p}</p>)}
   {draft.dispatch.pending.map((p:any)=><p key={p.id}>{p.reason}</p>)}
   {draft.saved?<p role="status">{draft.approvedPlan?t('변경계획을 승인했습니다. 예약·인력 재확인·알림 대기 기록을 갱신했습니다.','Change approved. Reservations, reconfirmation and pending notifications updated.'):t('변경 초안을 저장했습니다. 배차 승인은 별도입니다.','Change draft saved. Dispatch requires separate approval.')}</p>:draft.approvedPlan?<button disabled={busy||!!draft.blockers?.length||!cost.trim()||!consent.trim()} onClick={()=>{if(confirm(t('변경계획을 일괄 승인할까요? 실제 문자·장비는 실행하지 않습니다.','Approve changes? No real SMS or equipment.')))void run('approve')}}>{t('변경계획 일괄 승인','Approve change plan')}</button>:<button disabled={busy} onClick={()=>run('save')}>{t('변경 초안 저장','Save change draft')}</button>}
  </>}
 </details>;
}
