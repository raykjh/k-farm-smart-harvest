'use client';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {EquipmentDowntime} from '@/lib/equipment-downtime';
import type {Simulation} from '@/lib/simulation';
import type {State} from '@/lib/types';
import {AUTOMATIC_REPLAN_POLICY,type AutomaticReplanResult} from '@/lib/automatic-replanning';
import {changedResourceLabel,scheduleTimeLabel} from '@/lib/schedule-display';
import {useLanguage} from './language';
import {Button} from './ui/button';

type Review={status:string;proposalId?:string;diff:{id:string;date:string}[]};
type Props={ids:string[];day?:string;simulation?:Simulation;preferredDate?:string;state?:State;onClose:()=>void;onSaved:()=>Promise<void>;onUpdated?:()=>Promise<void>;initialResult?:Review|null;laborRecovery?:boolean;simple?:boolean;aiAvailable?:boolean;deferAfter?:string;outage?:EquipmentDowntime;embedded?:boolean;taskSheet?:boolean;disabled?:boolean;children?:ReactNode;formValues?:{reason:string;preferred:string}};
type Receipt={id:string;status:string;policy?:string;input:{ids:string[]};result:AutomaticReplanResult|null;error?:string|null};

export default function AutomaticReplan({ids,day,simulation,preferredDate='',onClose,onSaved,onUpdated,initialResult=null,laborRecovery=false,deferAfter,outage,embedded=false,taskSheet=false,disabled=false,children,formValues}:Props){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [reason,setReason]=useState(taskSheet?'':outage?'장비 고장·수리':laborRecovery?'인력 부족':!embedded&&day?'미완료 작업 재배치':'작업 일정 변경');
 const [preferred,setPreferred]=useState(preferredDate),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [result,setResult]=useState<AutomaticReplanResult|null>(null),[uncertain,setUncertain]=useState(false);
 const requestId=useRef(crypto.randomUUID()),pending=useRef(false),alive=useRef(true),started=useRef(false);
 const context=JSON.stringify([ids,day,deferAfter,outage,simulation]);
 const requestReason=formValues?.reason??reason,requestPreferred=formValues?.preferred??preferred;
 useEffect(()=>{
  let active=true;alive.current=true;started.current=false;requestId.current=crypto.randomUUID();
  // Targets can now change in the same form. Preserve the entered reason/date,
  // but never apply a receipt or result from the previously selected work.
  setResult(null);setUncertain(false);setError('');
  // Retain resource requests across popup closes. This does not start a solve.
  if(ids.length)void fetch('/api/replanning').then(r=>r.ok?r.json():null).then(data=>{
   if(!active||started.current||!data?.requests)return;
   const row=(data.requests as Receipt[]).find(r=>JSON.stringify([...r.input.ids].sort())===JSON.stringify([...ids].sort()));
   // Old resource failures used incomplete equipment metadata and offered a
   // manual conversion. A fresh attempt must use the current resource ledger.
   if(row?.status==='RESOURCE_REQUIRED'&&row.policy===AUTOMATIC_REPLAN_POLICY)setResult(row.result);
   if(row?.status==='PROCESSING'){requestId.current=row.id;setUncertain(true);}
  }).catch(()=>{});
  return()=>{active=false;alive.current=false};
 },[context]);
 async function run(){
  if(pending.current||disabled)return;started.current=true;pending.current=true;setBusy(true);setError('');
  try{
   if(uncertain&&!initialResult){
    // Exact request recovery never repeats AI inference. A saved, still-valid
    // proposal can finish its commit; abandoned pre-proposal work is released.
    const response=await fetch('/api/replanning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'recoverAutomatic',requestId:requestId.current})});
    if(!response.ok)throw Error(t('처리 결과를 조회하지 못했습니다. 다시 확인하세요.','Could not retrieve the result. Check again.'));
    const data=await response.json();
    if(data.status==='APPLIED'||data.status==='RESOURCE_REQUIRED'){setResult(data);setUncertain(false);return;}
    if(data.status==='PROCESSING')throw Error(t('서버에서 처리 중입니다. 잠시 후 결과를 확인하세요.','Still processing on the server. Check the result shortly.'));
    setUncertain(false);requestId.current=crypto.randomUUID();
    if(data.status==='FAILED')throw Error(data.error??t('저장되지 않았습니다. 다시 배치할 수 있습니다.','Not saved. You can try rescheduling again.'));
    // A missing receipt is not an instruction to retry a paid call automatically.
    throw Error(t('저장된 요청이 없습니다. 다시 배치 버튼을 눌러주세요.','No saved request. Press Reschedule again.'));
   }
   if(result)requestId.current=crypto.randomUUID();
   const body=initialResult?.proposalId?{action:'approve',proposalId:initialResult.proposalId}:{action:'automatic',requestId:requestId.current,ids,day,deferAfter,outage,simulation,reason:requestReason,preferred:requestPreferred||undefined};
   setResult(null);setUncertain(true);
   const response=await fetch('/api/replanning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
   if(!response.ok)throw Error(data.error??t('재배치 요청을 확인하세요.','Check the rescheduling request.'));
   if(!alive.current)return;
   setUncertain(false);setResult(initialResult?{status:'APPLIED',requestId:requestId.current,changes:initialResult.diff.length,changeRows:data.changeRows,dates:[...new Set(initialResult.diff.map(d=>d.date))].sort()}:data);
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e))}
  finally{pending.current=false;if(alive.current)setBusy(false)}
 }
 const finish=async()=>{if(pending.current)return;setBusy(true);try{await onSaved();onClose()}catch{setError(t('저장은 완료했지만 화면 갱신에 실패했습니다. 새로고침하세요.','Saved, but the display could not refresh. Reload the page.'))}finally{if(alive.current)setBusy(false)}};
 return <section className={`card section-space replan-manager ${taskSheet?'task-sheet-replan':''}`} role="region" aria-label={t('작업 관리','Task management')} aria-busy={busy}>
  {!embedded&&!taskSheet&&<><div className="card-head"><h3>{t('일정 재배치','Reschedule work')}</h3><Button variant="outline" disabled={busy} onClick={onClose}>{t('닫기','Close')}</Button></div>
  <p>{ids.length}{t('건 · 작업기간 안에서 장비·인력·운송과 기존 일정을 함께 조정합니다.',' tasks · reschedule within work windows, accounting for equipment, labor, transport and existing appointments.')}</p></>}
  {children&&result?.status!=='APPLIED'&&<fieldset disabled={busy||uncertain}>{children}</fieldset>}
  {!formValues&&!initialResult&&result?.status!=='APPLIED'&&<fieldset className="replan-fields" disabled={busy||uncertain}>
   <label>{taskSheet?t('변경 사유를 선택해주세요','Select a reason'):t('변경 사유','Reason')}{taskSheet?<select aria-label={t('변경 사유를 선택해주세요','Select a reason')} value={reason} onChange={e=>setReason(e.target.value)}><option value="">{t('선택해주세요','Select')}</option>{[['기상 부적합','Unsuitable weather'],['장비 문제','Equipment issue'],['기타 변경','Other change']].map(([ko,en])=><option key={ko} value={ko}>{t(ko,en)}</option>)}</select>:<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/>}</label>
   <label>{taskSheet?t('변경희망일을 선택하면 지정일과 가까운날로 변경됩니다.','Choose a preferred date to reschedule on or near that date.'):t('변경 희망일 (선택)','Preferred date (optional)')}<input aria-label={t('변경 희망일 (선택)','Preferred date (optional)')} type="date" min={deferAfter?new Date(Date.parse(deferAfter)+86400000).toISOString().slice(0,10):undefined} value={preferred} onChange={e=>setPreferred(e.target.value)}/>{!taskSheet&&<small>{embedded&&!outage?t('희망일 우선, 어려우면 가까운 날로 배치합니다. 비워두면 내일부터 빈 일정을 찾습니다.','Prefer this date, then nearby dates. Leave blank to find availability from tomorrow.'):t('비워두면 자동 배치합니다. 지정일이 어려우면 작업기간 내 가까운 날을 사용합니다.','Leave blank for automatic placement. If unavailable, use a nearby date within the work window.')}</small>}</label>
  </fieldset>}
  {outage&&!embedded&&<p>{outage.machineId} · {outage.from} ~ {outage.returnOn} {t('복귀 예정','expected return')}</p>}
  {result?.status==='APPLIED'?<div role="status" className="automatic-replan-result" data-testid="automatic-replan-applied">
   <h4>{t('일정 반영 완료','Schedule saved')}</h4>
   <p>{result.changes??0}{t('건 변경',' tasks changed')}{!!result.borrowedMachines?.length&&` · ${t('차용 장비','Borrowed equipment')} ${result.borrowedMachines.length}`}</p>
   {!!result.changeRows?.length?<div className="table-wrap"><table className="schedule-change-results"><thead><tr>{[t('일자','Date'),t('농지','Field'),t('작물','Crop'),t('작업','Task'),t('장비 / 인력','Equipment / labor'),t('변경 내용','Changes')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{result.changeRows.map(row=><tr key={row.id}><td>{row.changed.includes('date')&&<del>{row.before.date}</del>}<strong>{row.after.date??'—'}</strong></td><td>{row.field}</td><td>{operationalText(row.crop,locale)}</td><td>{operationalText(row.task,locale)}</td><td>{row.changed.includes('equipment')&&<del>{changedResourceLabel(row.before,row.after,locale==='ko')}</del>}<strong>{changedResourceLabel(row.after,row.before,locale==='ko')}</strong></td><td>{row.changed.map(v=>({date:t('일자','Date'),equipment:t('장비','Equipment'),time:t('시간','Time'),added:t('추가','Added')}[v])).join(' · ')}{row.changed.includes('time')&&<small className="description">{scheduleTimeLabel(row.before,locale==='ko')} → {scheduleTimeLabel(row.after,locale==='ko')}</small>}</td></tr>)}</tbody></table></div>:!!result.dates?.length&&<p>{result.dates.join(', ')}</p>}
   <p>{t('예약·인력 수요와 변경 안내 기록을 함께 저장했습니다. 실제 참석 확정은 인력 화면에서 확인합니다.','Reservations, labor demand and notification records are saved. Check confirmed attendance in Labor.')}</p>
   <Button disabled={busy} onClick={finish}>{t('완료','Done')}</Button>
  </div>:<>
   {result?.status==='RESOURCE_REQUIRED'&&<div className="automatic-replan-result is-pending" data-testid="automatic-replan-needs" role="status">
    {!!result.loanRequests?.length?<><h4>{t('인접 센터 장비 요청 · 승인 대기','Adjacent equipment requested · awaiting approval')}</h4>{result.loanRequests.map(r=><p key={r.id}>{r.ownerName} · {r.machineId} · {r.from}{r.to!==r.from?` ~ ${r.to}`:''}</p>)}<p>{t('차용 승인 후 다시 적용하세요. 아직 일정은 변경하지 않았습니다.','Apply again after loan approval. The schedule has not changed yet.')}</p></>:<><h4>{t('추가 자원·작업 조건 확인 요청','Resource / work-condition request')}</h4><p>{t('요청을 저장했습니다. 아래 사항을 확보·확인한 뒤 같은 작업을 다시 배치할 수 있습니다. 아직 일정은 변경하지 않았습니다.','Request saved. After securing or verifying the items below, reschedule these tasks again. The schedule has not changed yet.')}</p></>}
    {result.requirements?.filter(r=>!result.loanRequests?.some(loan=>loan.missionIds.includes(r.missionId))).map(r=><article key={r.missionId} className="section-space"><strong>{operationalText(r.task,locale)}</strong><p>{r.from} ~ {r.to}</p><p>{[r.equipment?`${t('장비','Equipment')}: ${r.equipment}`:'',r.people!==null?`${t('인력','People')}: ${r.people}`:'',r.minutes!==null?`${r.minutes}${t('분',' min')}`:''].filter(Boolean).join(' · ')}</p><p>{r.steps.filter(s=>s!=='MANUAL').map(s=>({BORROW:t('인접 센터 장비 확인','Check adjacent equipment'),PROCUREMENT:t('추가 장비 확보 필요','Additional equipment needed'),LABOR:t('작업 인력 확보 필요','Workers needed'),PREREQUISITE:t('선행 작업 결과 확인','Verify prior work results'),WINDOW:t('작업기간 확인','Review work window'),DATA:t('작업 기준 연결 확인','Check work criteria')}[s as Exclude<typeof s,'MANUAL'>])).join(' · ')}</p></article>)}
   </div>}
   <Button disabled={disabled||busy||!uncertain&&!initialResult&&!requestReason.trim()} onClick={run}>{busy?t('배치·저장 중…','Rescheduling and saving…'):uncertain?t('처리 결과 확인','Check result'):embedded?t('일정변경 적용하기','Apply schedule change'):result?t('자원 반영 후 다시 배치','Reschedule after resource updates'):initialResult?t('변경 일정 반영','Apply schedule'):t('일정 재배치','Reschedule')}</Button>
   {!embedded&&!taskSheet&&<small className="description">{t('버튼을 누르면 검증된 일정과 관련 예약·안내 기록을 함께 저장합니다.','Pressing the button saves the validated schedule with its reservations and notification records.')}</small>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
