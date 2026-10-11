'use client';
import {useEffect,useRef,useState} from 'react';
import type {Simulation} from '@/lib/simulation';
import type {State} from '@/lib/types';
import type {compareReplanAlternatives,ReplanAlternative} from '@/lib/planning-decision';
import type {PlanningRecommendation} from '@/lib/planning-adviser';
import type {DecisionPriority} from '@/lib/planning-priority';
import {useLanguage} from './language';
import {Button} from './ui/button';

type Comparison=Omit<Awaited<ReturnType<typeof compareReplanAlternatives>>,'source'|'inferenceCalled'>&{source:string;inferenceCalled:boolean;recommendation?:PlanningRecommendation;baseline?:PlanningRecommendation;decisionId?:string};
type Candidate=Comparison['results'][number];
type Review={status:string;proposalId?:string;phase?:string;reason?:string;warnings?:string[];decision?:{selectionBasis?:'VERIFIED_AI'|'RULE_BASELINE'|'OPERATOR_REVIEW'};diff:{id:string;sourceId?:string;added?:boolean;label?:string;address?:string;before:number;after:number;date:string;beforeDuration?:number;afterDuration?:number;split?:{part:number;parts:number};beforeResource?:string|null;afterResource?:string|null;beforeLaborSupport?:string[];afterLaborSupport?:string[]}[]};
const emptyReplacement={failedId:'',replacementId:'',availableFrom:'',availableUntil:'',arrivalConfirmed:false,compatibilityConfirmed:false,note:''};
const slotDay=(slot:number)=>new Date(Date.UTC(2026,0,1+Math.floor(slot/32))).toISOString().slice(0,10);

export default function ReplanManager({ids,day,simulation,preferredDate='',state,onClose,onSaved,initialResult=null,laborRecovery=false}:{ids:string[];day?:string;simulation?:Simulation;preferredDate?:string;state?:State;onClose:()=>void;onSaved:()=>Promise<void>;initialResult?:Review|null;laborRecovery?:boolean}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [reason,setReason]=useState(''),[preferred,setPreferred]=useState(preferredDate);
 const [useAi,setUseAi]=useState(false);
 const [resourceTradeoffs,setResourceTradeoffs]=useState(false);
 const [decisionPriority,setDecisionPriority]=useState<DecisionPriority>('DEFAULT');
 const [replacement,setReplacement]=useState(emptyReplacement);
 const [comparison,setComparison]=useState<Comparison|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [result,setResult]=useState<Review|null>(initialResult),[busy,setBusy]=useState<'compare'|'preview'|'approve'|null>(null),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null),requestId=useRef(0),reviewHeading=useRef<HTMLHeadingElement>(null);
 const context=JSON.stringify([ids,day,simulation,preferredDate,state?.planVersion,state?.ruleVersion]);
 useEffect(()=>{
  setComparison(null);setSelected(null);setResult(initialResult);setError('');setBusy(null);
  return ()=>{requestId.current++;pending.current?.abort();pending.current=null};
 },[context,initialResult]);
 useEffect(()=>{if(selected&&result)reviewHeading.current?.focus()},[selected,result]);
 const invalidate=()=>{setComparison(null);setSelected(null);setResult(null);setError('')};
 const changeReplacement=(patch:Partial<typeof replacement>)=>{setReplacement(v=>({...v,...patch}));invalidate()};
 const title=(id:string,fallback:string)=>id==='local'?t('현재 자원 유지','Keep assigned resources'):id==='equipment'?t('장비 대체·차용','Equipment substitution / borrowing'):id==='labor'?t('확정 인력 지원','Confirmed labor support'):id==='existing'?t('현재 장비 유지','Keep current equipment'):id==='preserve'?t('빈자리만 사용','Use available gaps'):id==='expand'?t('충돌 관련 일정 재배치','Rebuild related schedules'):fallback;
 const detail=(id:string)=>id==='local'?t('현재 배정 장비와 센터 인력으로 배치. 기존 확정 지원은 유지','Use assigned machines and local staff; keep existing support commitments'):id==='equipment'?t('확인된 대체·차용 장비를 검토하며 새 인력 지원은 추가하지 않음','Consider authorized equipment substitutes, without new labor support'):id==='labor'?t('현재 장비를 유지하며 참석·작업시간이 확정된 지원 인력만 검토','Keep assigned machines; consider only confirmed support people and hours'):id==='existing'?t('대체 장비 없이 현재 장비 상태로 가능한지 비교','Compare feasibility without the replacement'):id==='preserve'?t('다른 작업을 옮기지 않고 배치','Keep all other tasks in place'):t('센터 내 충돌 관련 작업을 각 작업기간 안에서 함께 조정','Rearrange only this center’s related tasks within their work windows');
 const metricTitle=(metric:string)=>({otherChangedTasks:t('다른 작업 변경','Other tasks moved'),resourceChanges:t('장비 변경 작업','Resource changes'),shiftDays:t('이동 일수 합계','Total days moved'),preferredDistanceDays:t('희망일 차이 합계','Total preferred-date gap'),borrowedEquipmentMinutes:t('차용 장비 작업시간','Borrowed equipment work'),supportPersonMinutes:t('지원 인력 작업시간','Support labor work')}[metric]??metric);
 const metricUnit=(metric:string)=>metric==='supportPersonMinutes'?t('인·분',' person-min'):metric.endsWith('Minutes')?t('분',' min'):metric.endsWith('Days')?t('일',' days'):t('건',' tasks');
 const rejectionTitle=(reason:string|null)=>({PRIORITY:t('우선순위 비교','Priority comparison'),SCOPE_TIEBREAK:t('지표 동률 · 변경 범위 비교','Tied metrics · scope comparison'),ID_TIEBREAK:t('지표·범위 동률 · 식별자 순','Tied metrics and scope · ID order'),INFEASIBLE:t('조건상 배치 불가','Not feasible under the constraints'),NOT_VERIFIED:t('조건 미확인 · 배치 불가로 단정하지 않음','Unverified conditions · not proven infeasible')}[reason??'']??t('제외 사유 미제출','Rejection reason missing'));
 const issueTitle=(code:string)=>({MISSING_RATIONALE:t('선택·제외 사유가 없거나 계약 형식이 다릅니다.','Selection/rejection reasons are missing or use an unsupported contract.'),WRONG_SELECTION_REASON:t('단독 후보인지 비교 선택인지 잘못 설명했습니다.','The single-candidate/comparative selection claim is incorrect.'),MISSING_REJECTION:t('제외한 후보의 설명이 빠졌습니다.','A rejected candidate has no explanation.'),DUPLICATE_REJECTION:t('같은 후보를 중복 설명했습니다.','A rejected candidate is duplicated.'),UNKNOWN_REJECTION:t('비교 대상이 아닌 후보를 제외 사유에 넣었습니다.','An unknown or selected candidate appears in the rejections.'),WRONG_REJECTION_REASON:t('제외 사유가 계산 결과와 맞지 않습니다.','The rejection reason does not match the computed facts.'),WRONG_DECISIVE_METRIC:t('처음 차이가 나는 우선 지표를 잘못 지정했습니다.','The first differing priority metric is incorrect.'),MISSING_COMPARISON_EVIDENCE:t('선택안과 제외안 양쪽의 지표 근거가 필요합니다.','Evidence must cite the decisive metric for both candidates.'),PRIORITY_CONTRADICTION:t('더 높은 우선순위에서 불리한 안을 선택했습니다.','The selected candidate is worse on the decisive priority.'),TIEBREAK_CONTRADICTION:t('동률일 때의 선택 기준을 지키지 않았습니다.','The tie-breaking rule was not followed.'),INVALID_EVIDENCE:t('근거 지표가 계산 자료와 일치하지 않습니다.','Evidence does not match the computed metrics.')}[code]??code);
 const unverifiedAi=comparison?.recommendation?.source==='NEBIUS'&&comparison.recommendation.rationaleCheck?.status!=='VERIFIED';
 const dates=(c:Candidate)=>{
  const selectedIds=new Set([...ids,...(c.result?.workSplit??[]).flatMap(s=>s.partIds)]);
  const days=[...new Set<string>((c.result?.assignments??[]).filter((a:{id:string})=>selectedIds.has(a.id)).map((a:{start:number})=>slotDay(a.start)))].sort();
  return days.length>1?days[0]+' ~ '+days.at(-1):days[0]??'—';
 };
 const duration=(slots?:number)=>slots===undefined?'':`${slots*15}${t('분',' min')}`;
 const splitRows=result?.diff.filter(d=>d.split)??[];
 const splitSources=[...new Set(splitRows.map(d=>d.sourceId??d.id))];
 const splitBefore=splitSources.reduce((n,id)=>n+(splitRows.find(d=>(d.sourceId??d.id)===id)?.beforeDuration??0),0);
 const splitAfter=splitRows.reduce((n,d)=>n+(d.afterDuration??0),0);

 async function run(action:'compare'|'preview'|'approve',candidate?:Candidate){
  if(pending.current)return;
  if(action==='preview'&&!candidate?.previewRequest)return;
  if(action==='approve'&&!result?.proposalId)return;
  const controller=new AbortController(),token=++requestId.current;
  pending.current=controller;setBusy(action);setError('');
  const alternatives:ReplanAlternative[]=[{id:'preserve',label:title('preserve',''),scope:'PRESERVE'},{id:'expand',label:title('expand',''),scope:'EXPAND'}];
  if(resourceTradeoffs)alternatives.unshift({id:'local',label:title('local',''),scope:'PRESERVE',replacement:'NONE',newLaborSupport:false},{id:'equipment',label:title('equipment',''),scope:'PRESERVE',newLaborSupport:false},{id:'labor',label:title('labor',''),scope:'PRESERVE',replacement:'NONE'});
  if(replacement.failedId){for(const option of alternatives)if(option.replacement!=='NONE')option.replacement='REQUESTED';alternatives.unshift({id:'existing',label:title('existing',''),replacement:'NONE'})}
  const body=action==='approve'?{action,proposalId:result!.proposalId}:action==='preview'?candidate!.previewRequest:{action,ids,reason,useAi,decisionPriority,preferred:preferred||undefined,alternatives,
   ...(day?{day}:{}),...(simulation?{simulation}:{}),...(replacement.failedId?{replacement:{...replacement,availableUntil:replacement.availableUntil||undefined}}:{})};
  if(action!=='approve'){setResult(null);setSelected(null)}
  if(action==='compare')setComparison(null);
  try{
   const response=await fetch('/api/replanning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   const data=await response.json();
   if(token!==requestId.current)return;
   if(!response.ok){
    // Rejected/stale proposals must not retain an enabled approval button.
    if(action!=='compare'){setComparison(null);setResult(null);setSelected(null)}
    throw Error(data.error||t('계산 요청에 실패했습니다. 다시 비교하세요.','Request failed. Compare again.'));
   }
   if(action==='compare')setComparison(data);
   else if(action==='preview'){
    if(data.status!=='FEASIBLE'||!data.proposalId){setComparison(null);throw Error(data.reason||t('조건이 달라졌습니다. 대안을 다시 비교하세요.','Conditions changed. Compare the alternatives again.'))}
    setSelected(candidate!.id);setResult(data);
   }else await onSaved();
  }catch(e){if(token===requestId.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:t('요청 실패','Request failed'))}
  finally{if(pending.current===controller)pending.current=null;if(token===requestId.current)setBusy(null)}
 }

 return <section className="card section-space replan-manager" role="region" aria-label={t('작업 관리','Task management')} aria-busy={!!busy}>
  <div className="card-head"><h2>{day?day+' · '+t('일정변경','Change schedule'):t('개별 일정변경','Reschedule task')}</h2><Button onClick={onClose} variant="outline">{t('닫기','Close')}</Button></div>
  <p>{ids.length}{t('건 선택',' selected')}</p><p className="description">{laborRecovery?t('센터 내 가용 인원과 확정된 인접센터 지원시간으로 같은 날 배치할 수 있는지 먼저 비교합니다. 부족하면 각 작업기간 안에서 관련 일정을 조정합니다. 변경된 작업의 실제 참석은 다시 확인합니다.','Compare local staffing capacity and confirmed adjacent-center support on the preferred date. If insufficient, rearrange related tasks within their work windows. Reconfirm attendance for changed work.'):t('호환·운송·운영 조건이 확인된 센터 내 대체 장비, 직접 인접 센터의 사전 허용 장비 순으로 확인합니다. 장비 교체로 작업일을 유지하고, 남는 공백만 재배치합니다.','Checks authorized local substitutes, then directly adjacent centers. Preserve work dates by replacing equipment; reschedule uncovered work only.')}</p>
  <fieldset disabled={!!busy} className="replan-inputs">
   <div className="replan-fields">
    <label>{t('변경 사유','Change reason')}<input required maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);invalidate()}} placeholder={t('이름·연락처 없이 작업 사유만 입력','Work reasons only; no names or contact details')}/></label>
    <label>{t('변경 희망일 (비우면 자동 지정)','Preferred date (blank for automatic)')}<input type="date" value={preferred} onChange={e=>{setPreferred(e.target.value);invalidate()}}/></label>
    <label>{t('판단 우선순위','Decision priority')}<select aria-label={t('판단 우선순위','Decision priority')} value={decisionPriority} onChange={e=>{setDecisionPriority(e.target.value as DecisionPriority);invalidate()}}><option value="DEFAULT">{t('기본 · 희망일 우선, 없으면 이동 최소','Default: preferred date, otherwise minimal movement')}</option><option value="PREFERRED_DATE">{t('희망일 우선','Preferred date first')}</option><option value="MIN_DISRUPTION">{t('다른 작업 변경 최소','Minimize changes to other tasks')}</option><option value="MIN_EXTERNAL">{t('차용 시간 최소, 다음 지원 인력 최소','Minimize borrowing first, then support labor')}</option></select></label>
   </div>
   {!laborRecovery&&<details className="replan-replacement"><summary>{t('고장 장비 대체','Replace failed equipment')}</summary>
    <p>{t('공백 기간의 작업을 선택하세요. 사용 시작일은 운송·점검 완료 후 하루 전체 사용 가능한 날입니다. 대체 장비의 처리능력으로 작업시간을 계산하고, 하루에 끝나지 않으면 작업기간 안에서 나눠 배치합니다.','Select affected tasks. Availability starts after delivery and checks. Duration is recalculated using the replacement’s capacity; work that exceeds a day is split within its allowed window.')}</p>
    <div className="replan-fields"><label>{t('고장 장비','Failed machine')}<select value={replacement.failedId} onChange={e=>changeReplacement({...emptyReplacement,failedId:e.target.value})}><option value="">—</option>{state?.machines.filter(m=>m.status==='MAINTENANCE').map(m=><option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}</select></label>
    {replacement.failedId&&<>
     <label>{t('대체 장비','Replacement')}<select value={replacement.replacementId} onChange={e=>changeReplacement({replacementId:e.target.value,arrivalConfirmed:false,compatibilityConfirmed:false})}><option value="">—</option>{state?.machines.filter(m=>m.status==='AVAILABLE'&&!m.safetyLock).map(m=><option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}</select></label>
     <label>{t('사용 시작일','Available from')}<input type="date" value={replacement.availableFrom} onChange={e=>changeReplacement({availableFrom:e.target.value,arrivalConfirmed:false})}/></label>
     <label>{t('대여 종료일 (선택)','Available until (optional)')}<input type="date" value={replacement.availableUntil} onChange={e=>changeReplacement({availableUntil:e.target.value,arrivalConfirmed:false})}/></label>
     <label className="replan-check"><input type="checkbox" checked={replacement.arrivalConfirmed} onChange={e=>changeReplacement({arrivalConfirmed:e.target.checked})}/>{t('도착·점검 일정 확정','Arrival and setup confirmed')}</label>
     <label className="replan-check"><input type="checkbox" checked={replacement.compatibilityConfirmed} onChange={e=>changeReplacement({compatibilityConfirmed:e.target.checked})}/>{t('작업기·진입·인력·운송 조건 확인','Implement, access, staff and transport checked')}</label>
     <label>{t('확인 근거','Confirmation evidence')}<input value={replacement.note} maxLength={500} onChange={e=>changeReplacement({note:e.target.value})}/></label>
    </>}</div>
   </details>}
  </fieldset>
  <label className="replan-check"><input type="checkbox" checked={resourceTradeoffs} disabled={!!busy} onChange={e=>{setResourceTradeoffs(e.target.checked);invalidate()}}/>{t('현재 자원·차용·인력 지원 대안도 비교','Compare assigned resources, borrowing and labor support')}</label>
  <label className="replan-check"><input type="checkbox" checked={useAi} disabled={!!busy} onChange={e=>{setUseAi(e.target.checked);invalidate()}}/>{t('AI 판단 함께 비교','Compare with AI judgment')}</label>
  {useAi&&<p className="description">{t('비교 버튼을 누를 때만 계산 결과와 변경 사유를 Nebius에 전송합니다. 예약·승인 권한은 전달하지 않습니다.','Only Compare sends computed facts and the work reason to Nebius. Reservation and approval authority stay here.')}</p>}
  <Button disabled={!!busy||!reason.trim()} onClick={()=>run('compare')}>{busy==='compare'?t('대안 계산 중…','Comparing…'):t('변경 대안 비교','Compare alternatives')}</Button>
  {comparison&&<section className="replan-comparison" aria-label={t('변경 대안 비교 결과','Alternative comparison')}>
   <h3>{t('변경 대안','Schedule alternatives')}</h3>
   <p className="description">{t('대안을 선택해 상세 변경을 확인한 뒤 일괄 승인합니다. 비교·선택만으로 실제 일정은 변경되지 않습니다.','Select an alternative, review its changes, then approve. Comparison and selection do not change the active schedule.')}</p>
   {comparison.recommendation&&<div className="replan-review" data-testid="planning-recommendation">
    <strong>{comparison.recommendation.source==='NEBIUS'?(comparison.recommendation.priorityCheck?.status==='MISMATCH'?t('AI 제안 · 우선순위 재검토 필요','AI suggestion · priority review required'):unverifiedAi?t('AI 제안 · 근거 검증 필요','AI suggestion · rationale review required'):t('AI 추천 · 근거 검증 통과','AI recommendation · rationale verified')):t('계산 기준 추천','Rule-based recommendation')} · {comparison.recommendation.alternativeId?title(comparison.recommendation.alternativeId,comparison.results.find(r=>r.id===comparison.recommendation!.alternativeId)?.label??''):t('조건에 맞는 대안 없음','No feasible alternative')}</strong>
    {unverifiedAi&&<div role="alert" data-testid="planning-rationale-invalid"><p>{t('AI의 선택·제외 근거가 검증되지 않았습니다. 자동 적용하지 않았으며, 아래 대안을 직접 검토해 선택하면 담당자 판단으로 기록합니다.','The AI selection/rejection rationale is not verified. Nothing was applied. Reviewing and choosing an option below will be recorded as an operator decision.')}</p>{[...new Set(comparison.recommendation.rationaleCheck?.issues.map(i=>i.code)??['MISSING_RATIONALE'])].map(code=><p key={code}>{issueTitle(code)}</p>)}</div>}
    {comparison.recommendation.priorityCheck?.status==='MISMATCH'&&<p role="alert" data-testid="planning-priority-mismatch">{t('배치는 가능하지만 설정한 우선순위를 따르지 않은 AI 제안입니다. 자동 적용하지 않았습니다.','The AI suggestion is feasible but does not follow your selected priority. It has not been applied.')} {metricTitle(comparison.recommendation.priorityCheck.metric!)}: {comparison.recommendation.priorityCheck.selectedValue}{metricUnit(comparison.recommendation.priorityCheck.metric!)} → {t('계산 기준','Rule baseline')} {comparison.recommendation.priorityCheck.ruleValue}{metricUnit(comparison.recommendation.priorityCheck.metric!)}</p>}
    {comparison.recommendation.source==='NEBIUS'&&comparison.baseline&&<p data-testid="planning-baseline">{t('동일 입력의 계산 기준 추천','Rule baseline for the same input')}: {title(comparison.baseline.alternativeId??'',comparison.results.find(r=>r.id===comparison.baseline!.alternativeId)?.label??'—')} · {comparison.baseline.alternativeId===comparison.recommendation.alternativeId?t('AI와 동일한 선택','Same choice as AI'):t('AI와 다른 선택 · 근거 비교 필요','Different choice; review the tradeoff')}</p>}
    <p className="description">{t('추천은 승인되지 않은 검토안입니다. 다른 가능한 안을 선택할 수 있습니다.','This recommendation is not approved. You can choose another feasible alternative.')}</p>
    <details><summary>{t('판단 근거','Decision evidence')}</summary>
     {comparison.recommendation.rationaleCheck&&<section data-testid="planning-rationale-details">
      <h4>{t('선택·제외 이유 검증','Selection and rejection validation')}</h4>
      <p>{comparison.recommendation.rationaleCheck.selectionReason==='ONLY_ELIGIBLE'?t('선택 가능한 후보가 하나입니다.','There is one eligible candidate.'):t('동일 우선순위로 다른 모든 후보와 비교합니다.','Compare every other candidate under the same priority order.')}</p>
      {comparison.recommendation.rationaleCheck.comparisons.map(c=><div key={c.alternativeId}>
       <strong>{title(c.alternativeId,comparison.results.find(r=>r.id===c.alternativeId)?.label??c.alternativeId)} · {c.verified?t('검증 통과','Verified'):t('검증 실패','Invalid')}</strong>
       <p>{t('제출 사유','Submitted reason')}: {rejectionTitle(c.claimedReason)}{c.claimedMetric?' · '+metricTitle(c.claimedMetric):''}</p>
       <p>{t('계산 확인','Computed check')}: {c.metric?<>{metricTitle(c.metric)} · {t('선택안','Selected')} {c.selectedValue}{metricUnit(c.metric)} / {t('제외 후보','Rejected')} {c.rejectedValue}{metricUnit(c.metric)}</>:rejectionTitle(c.reason)}</p>
      </div>)}
     </section>}
     {comparison.recommendation.evidence.map((e,i)=><p key={i}>{title(e.alternativeId,comparison.results.find(r=>r.id===e.alternativeId)?.label??e.alternativeId)} · {metricTitle(e.metric)}: {e.value}{metricUnit(e.metric)}</p>)}
     <p className="description">{comparison.recommendation.inferenceCalled?comparison.recommendation.model:t('현재는 계산 기준으로 추천하며 유료 AI를 호출하지 않았습니다.','Currently recommended by rules; no paid AI call was made.')}</p>
     {comparison.recommendation.usage&&<p className="description">{t('토큰 기준 추정 비용','Token-based estimated cost')}: {comparison.recommendation.usage.estimatedMicroUsd===undefined?'—':'$'+(comparison.recommendation.usage.estimatedMicroUsd/1e6).toFixed(6)} · {t('한도 차감 예약액','Budget reservation')}: ${(comparison.recommendation.usage.reservedMicroUsd/1e6).toFixed(3)} · {t('실제 청구액 아님','Not an invoice')}</p>}
    </details>
   </div>}
   <div className="replan-options">{comparison.results.map(c=><article key={c.id} className={'replan-option'+(selected===c.id?' is-selected':'')} data-testid={'replan-option-'+c.id}>
    <div className="replan-option-heading"><h4>{title(c.id,c.label)}</h4><span className={'replan-status '+(c.status==='FEASIBLE'?'is-feasible':'is-blocked')}>{c.status==='FEASIBLE'?t('배치 가능','Feasible'):c.status==='BLOCKED'?t('조건 확인 필요','Check constraints'):t('배치 불가','Not feasible')}</span></div>
    <p className="replan-option-description">{detail(c.id)}</p>
    {c.status==='FEASIBLE'&&<p className="replan-option-dates"><span>{t('선택 작업 배치일','Dates for selected tasks')}</span><strong>{dates(c)}</strong></p>}
    {!!c.result?.workSplit?.length&&<p>{t('여러 날로 나누는 작업','Work split across days')}: {c.result.workSplit.map(s=>`${s.partIds.length}${t('회',' parts')}`).join(', ')}</p>}
    {c.metrics?<dl>
     <div><dt>{t('변경 작업','Changed tasks')}</dt><dd>{c.metrics.changedTasks}{t('건','')}</dd></div>
     <div><dt>{t('다른 작업 변경','Other tasks moved')}</dt><dd>{c.metrics.otherChangedTasks}{t('건','')}</dd></div>
     <div><dt>{t('장비 변경 작업','Resource changes')}</dt><dd>{c.metrics.resourceChanges}{t('건','')}</dd></div>
     <div><dt>{t('이동 일수 합계','Total days moved')}</dt><dd>{c.metrics.shiftDays}{t('일',' days')}</dd></div>
     <div><dt>{t('희망일 차이 합계','Total preferred-date gap')}</dt><dd>{c.previewRequest?.preferred?c.metrics.preferredDistanceDays+t('일',' days'):t('자동 배치','Automatic')}</dd></div>
     {(['borrowedEquipmentMinutes','supportPersonMinutes'] as const).map(metric=><div key={metric}><dt>{metricTitle(metric)}</dt><dd>{Number.isFinite(c.metrics![metric])?c.metrics![metric]+metricUnit(metric):'—'}</dd></div>)}
    </dl>:<p className="replan-blocked-reason">{c.reason||t('조건을 만족하는 배치가 없습니다.','No schedule satisfies the constraints.')}</p>}
    {!!c.warnings.length&&<details className="replan-warnings"><summary>{t('검토사항','Review notes')} ({c.warnings.length})</summary>{c.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
    <Button variant={selected===c.id?'default':'outline'} disabled={!!busy||!c.previewRequest||c.status!=='FEASIBLE'} aria-pressed={selected===c.id} aria-label={title(c.id,c.label)+' · '+t('선택','Select')} onClick={()=>run('preview',c)}>{selected===c.id?t('선택됨','Selected'):t('이 안 선택','Select this option')}</Button>
   </article>)}</div>
   <p className="description replan-metric-note">{t('이동 일수는 모든 변경 작업의 날짜 차이 합계, 희망일 차이는 선택 작업의 희망일과 배치일 차이 합계입니다.','Days moved sums date changes across all affected tasks. Preferred-date gap sums deviations for the selected tasks.')}</p>
   <p className="description">{t('자원 시간은 대안 적용 후 센터 전체의 미완료 미래 작업 합계입니다. 인·분은 인원 × 작업 분입니다. 이동시간·단가·수확 손익은 합산하지 않았습니다.','Resource time covers this center’s unfinished future work after each option, including unchanged work. Person-minutes = people × work minutes. Travel, monetary rates and harvest outcomes are not valued.')}</p>
  </section>}
  {busy==='preview'&&<p role="status">{t('선택한 대안을 최신 자료로 다시 검증하는 중…','Revalidating the selected alternative…')}</p>}
  {result&&<section className="replan-review" aria-label={t('선택안 상세 변경','Selected plan changes')}>
   <h3 ref={reviewHeading} tabIndex={-1}>{selected?title(selected,selected)+' · ':''}{t('상세 변경내역','Detailed changes')}</h3>
   {result.decision?.selectionBasis&&<p data-testid="planning-selection-basis">{result.decision.selectionBasis==='VERIFIED_AI'?t('근거가 검증된 AI 제안 선택 · 담당자 승인 대기','Verified AI recommendation selected · awaiting operator approval'):result.decision.selectionBasis==='RULE_BASELINE'?t('계산 기준안 선택 · 담당자 승인 대기','Rule baseline selected · awaiting operator approval'):t('담당자 직접 선택 · 검증된 AI 판단으로 집계하지 않음','Operator decision · not counted as verified AI judgment')}</p>}
   <p>{result.status==='FEASIBLE'?(result.phase==='GAPS_ONLY'?t('기존 일정 유지 · 빈자리 배치','Existing schedule preserved · gaps filled'):result.phase==='REBUILD_APPROVED'?t('충돌 관련 일정 재배치','Related schedules rebuilt'):t('충돌 관련 일정 재배치','Related schedules rebuilt')):result.reason}</p>
   {result.warnings?.map((w,i)=><p className="description" key={i}>{w}</p>)}
   {result.status==='FEASIBLE'&&<>
    {!!splitRows.length&&<p>{t('변경 대상 작업시간 합계','Total work time being changed')}: {duration(splitBefore)} → {duration(splitAfter)} · {t('이동시간 별도 · 회차별 준비시간 확인','Transit excluded; review setup for each part')}</p>}
    <div className="table-wrap"><table><thead><tr><th>{t('작업','Task')}</th><th>{t('기존','Before')}</th><th>{t('변경','After')}</th></tr></thead><tbody>{result.diff.map(d=>{const m=state?.missions.find(m=>m.id===d.id);return <tr key={d.id}><td>{d.label??m?.label??d.id}<br/>{d.address}{d.split?<div>{t('분할','Part')} {d.split.part}/{d.split.parts} · {t('구역·참석 재확인','Recheck work area and attendance')}</div>:!ids.includes(d.id)&&' · '+t('함께 조정','also adjusted')}</td><td>{d.added?t('추가 분할 작업','Additional part'):<>{slotDay(d.before)}<div>{duration(d.beforeDuration)}</div></>}</td><td>{[...(d.beforeLaborSupport??[])].sort().join('|')!==[...(d.afterLaborSupport??[])].sort().join('|')&&<div>{t('인접센터 지원 배정 변경 · 참석 재확인','Adjacent support changed · reconfirm attendance')} ({d.beforeLaborSupport?.length??0} → {d.afterLaborSupport?.length??0})</div>}{d.beforeResource!==d.afterResource&&<div>{d.beforeResource} → {d.afterResource}</div>}{d.date} {String(8+Math.floor(d.after%32/4)).padStart(2,'0')}:{String(d.after%4*15).padStart(2,'0')}<div>{duration(d.afterDuration)}</div></td></tr>})}</tbody></table></div>
    <Button disabled={!!busy||!result.diff.length||!result.proposalId} onClick={()=>run('approve')}>{busy==='approve'?t('승인·저장 중…','Saving…'):t('변경계획 일괄 승인·저장','Approve and save all changes')} ({result.diff.length})</Button>
    {!result.diff.length&&<p>{t('현재 일정이 이미 조건을 충족합니다.','Current schedule already satisfies the constraints.')}</p>}
   </>}
  </section>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
