'use client';
import {useEffect,useRef,useState} from 'react';
import type {ManualReviewIssue,ManualWorkAlternative} from '@/lib/replan-manual-fallback';
import {useLanguage} from './language';
import {Button} from './ui/button';

type View={version:number;missionId:string;task:string;areaM2:number;issue:ManualReviewIssue|null;standard:ManualWorkAlternative|null};
const empty={workers:'',minutesPer1000m2:'',setupMinutes:'',transport:'',sourceRef:''};
export default function ManualAlternativeEditor({missionId,onClose,onSaved,onBusy}:{missionId:string;onClose:()=>void;onSaved:(split:boolean)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [view,setView]=useState<View|null>(null),[form,setForm]=useState(empty),[confirmed,setConfirmed]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),saved=useRef(false);
 useEffect(()=>{let alive=true;void fetch('/api/replanning/manual-alternative?missionId='+encodeURIComponent(missionId)).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(!alive)return;setView(data);if(data.standard)setForm(Object.fromEntries(Object.keys(empty).map(k=>[k,String(data.standard[k])])) as typeof empty)}).catch(e=>{if(alive)setError(String(e.message))}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[missionId]);
 const minutes=view&&form.minutesPer1000m2!==''&&form.setupMinutes!==''?Math.ceil((view.areaM2/1000*Number(form.minutesPer1000m2)+Number(form.setupMinutes))/15)*15:null;
 const invalid=!view||!!view.issue||!confirmed||Object.values(form).some(v=>!v.trim());
 async function save(){
  if(invalid||pending.current||saved.current)return;pending.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const response=await fetch('/api/replanning/manual-alternative',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveManualAlternative',missionId,version:view.version,standard:{workers:Number(form.workers),minutesPer1000m2:Number(form.minutesPer1000m2),setupMinutes:Number(form.setupMinutes),transport:Number(form.transport),sourceRef:form.sourceRef,simpleWorkConfirmed:confirmed}})}),data=await response.json();
   if(!response.ok)throw Error(data.error??t('저장하지 못했습니다.','Could not save.'));
   saved.current=true;
   try{await onSaved(data.requiresDailySplit)}catch{setError(t('기준은 저장됐습니다. 화면을 새로고침한 뒤 재배치하세요.','Standard saved. Refresh the screen before rescheduling.'))}
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{pending.current=false;setBusy(false);onBusy(false)}
 }
 const issueMessage=view?.issue?({FIELD:t('농지와 작업면적을 먼저 확인하세요.','Verify the parcel and work area first.'),PARTICIPATION:t('센터 인력 위탁은 완전 위탁형에서만 가능합니다.','Center labor is available only for fully delegated work.'),PROTECTED:t('이미 시작·완료·취소되었거나 잠긴 작업은 변경할 수 없습니다.','Started, completed, cancelled or locked work cannot be changed.'),SPECIALIST:t('방제·운전·운송 등 전문 작업은 일반 인력으로 전환할 수 없습니다.','Spraying, driving and other specialist work cannot be assigned to general labor.')}[view.issue]):null;
 return <section className="manual-alternative-editor" aria-label={t('인력 대체 기준','Manual work standard')}>
  <div className="card-head"><h4>{t('인력 대체 기준','Manual work standard')}</h4><Button variant="outline" disabled={busy} onClick={onClose}>{t('기준 닫기','Close standard')}</Button></div>
  {loading?<p>{t('불러오는 중…','Loading…')}</p>:view&&<>
   <p>{view.task} · {view.areaM2.toLocaleString()} m²</p>
   {issueMessage?<p role="status">{issueMessage}</p>:<fieldset disabled={busy||saved.current}>
    <div className="registration-grid">
     {([['workers',t('한 조 인원 (명)','Workers per crew'),1,50],['minutesPer1000m2',t('1,000 m²당 한 조 작업시간 (분)','Crew minutes per 1,000 m²'),1,20000],['setupMinutes',t('준비시간 (분)','Setup minutes'),0,480],['transport',t('운송차량 (대)','Transport vehicles'),0,10]] as const).map(([key,label,min,max])=><label className="registration-input" key={key}>{label}<input type="number" min={min} max={max} step="1" value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    </div>
    <label className="registration-input">{t('확인 근거·작업 방법','Reviewed method and reference')}<textarea rows={2} maxLength={2000} value={form.sourceRef} onChange={e=>setForm({...form,sourceRef:e.target.value})}/></label>
    <label className="manual-standard-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('전문 자격이 필요하지 않은 작업이며 인력 대체 방법과 작업량 기준을 확인했습니다.','I have reviewed the manual method and work rate; this work does not require specialist qualifications.')}</label>
    {minutes!==null&&Number.isFinite(minutes)&&<p>{t('이 작업 예상시간','Estimated crew time')}: {minutes}{t('분',' min')}{minutes>480&&' · '+t('하루를 넘습니다. 작업을 나누는 검토가 필요합니다.','Exceeds one workday; daily work packages need review.')}</p>}
    <p className="description">{t('기준 저장만으로 일정이나 인원은 바뀌지 않습니다. 재배치 시 작업기간과 확보된 인력을 다시 확인합니다.','Saving this standard does not change a schedule or create staff. Rescheduling rechecks work windows and available workers.')}</p>
    <Button disabled={invalid||busy||saved.current} onClick={save}>{busy?t('저장 중…','Saving…'):t('기준 저장','Save standard')}</Button>
   </fieldset>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
