'use client';
import {useEffect,useState} from 'react';
import RegionalContextEditor from './regional-context-editor';
import type {CropCode,GuidelineContext} from '@/lib/crop-guidelines';
import {useLanguage} from './language';
export default function DelegatedPlanningPanel({onSaved}:{onSaved:()=>Promise<void>}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[crop,setCrop]=useState<CropCode>('rice'),[context,setContext]=useState<GuidelineContext>({region:'계북면'}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<any>(null),[dirty,setDirty]=useState(false),[ack,setAck]=useState(false),[message,setMessage]=useState('');
 const names={rice:t('쌀','Rice'),potato:t('감자','Potato'),pepper:t('고추','Pepper')};
 useEffect(()=>{fetch('/api/delegated-planning').then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(d.settings){setStart(d.settings.start);setEnd(d.settings.end);setContext(d.settings.context)}}).catch(()=>setError(t('공통 기준 조회 실패','Could not load shared criteria')))},[]);
 function changed(){setDirty(true);setResult(null);setAck(false);setMessage('')}
 async function run(action:'settings'|'preview'|'approve'){
  setBusy(true);setError('');setMessage('');try{
   const r=await fetch('/api/delegated-planning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(action==='settings'?{settings:{start,end,context}}:action==='approve'?{proposalId:result.proposalId,provisionalAcknowledged:ack}:{})})}),d=await r.json();if(!r.ok)throw Error(d.error);
   if(action==='settings'){setDirty(false);setMessage(t('센터 공통 기준 저장 완료','Shared criteria saved'))}
   else if(action==='preview'){setResult(d);setAck(false)}
   else{setResult(null);setAck(false);setMessage(t(`배치 ${d.fields}필지 · 작업 ${d.assigned}건 확정 · 미배정 ${d.unassigned}건 확인 대기`,`Approved ${d.fields} fields / ${d.assigned} tasks; ${d.unassigned} tasks pending`));await onSaved()}
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 return <section className="card section-space" data-testid="delegated-planning"><h2>{t('위탁 농지 자동 계획','Delegated field planning')}</h2><p>{t('완전 위탁형의 새 재배 대상 농지를 함께 계산합니다. 작물 적합도 순으로 가능한 배치안을 만들고 기존 일정은 유지합니다. AI 실호출이 아닌 공통 규칙·배차 계산입니다.','Plan new fully delegated cultivations together, ranked by suitability, preserving existing schedules. Uses common rules and scheduling, not a live LLM.')}</p>
 <details><summary>{t('센터 공통 작업 기준','Shared center work criteria')}</summary><p>{t('지역·작물 기준을 한 번 저장하여 새 농지에 재사용합니다. 미확인 기간·인력 능률은 자동으로 만들지 않습니다. 기간이 지나면 기준을 갱신하세요.','Save regional crop criteria once and reuse them. Unknown windows and labor rates remain pending. Update expired criteria.')}</p><fieldset disabled={busy} style={{border:0}}>
 <label>{t('배치 대상 시작일','Planning period start')}<input type="date" value={start} onChange={e=>{setStart(e.target.value);changed()}}/></label><label>{t('배치 대상 종료일','Planning period end')}<input type="date" value={end} onChange={e=>{setEnd(e.target.value);changed()}}/></label>
 <label>{t('공통 기준 지역','Shared criteria region')}<input value={context.region??''} onChange={e=>{setContext({...context,region:e.target.value});changed()}}/></label>
 <label>{t('기준 편집 작물','Edit crop criteria')}<select value={crop} onChange={e=>setCrop(e.target.value as CropCode)}>{(['rice','potato','pepper'] as const).map(c=><option key={c} value={c}>{names[c]}</option>)}</select></label>
 <RegionalContextEditor crop={crop} value={context} onChange={v=>{setContext(v);changed()}}/>
 <button disabled={!start||!end} onClick={()=>run('settings')}>{t('공통 기준 저장','Save shared criteria')}</button></fieldset></details>
 <button disabled={busy||dirty||!start||!end} onClick={()=>run('preview')}>{t('위탁 농지 배치안 계산','Calculate delegated proposal')}</button>{dirty&&<p>{t('변경한 기준을 먼저 저장하세요.','Save the changed criteria first.')}</p>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {result&&<><p>{t('배치 후보 농지','Candidate fields')} {result.plans.length} · {t('배정 작업','Assigned tasks')} {result.assigned} · {t('미배정 작업','Unassigned tasks')} {result.unassigned}</p>
 {result.approvalBlocked&&<p role="alert">{t('필수 작업의 배차가 미완성입니다. 파종만 예약하고 수확을 놓치지 않도록, 기준·자원 부족을 해결한 뒤 일괄 확정하세요.','Essential operations are not fully allocated. Resolve missing work criteria or resources before approving the cultivation.')}</p>}
 <h3>{t('작물별 실행 가능성 비교','Crop feasibility comparison')}</h3>
 <p>{t('필수 작업을 모두 배정할 수 있는 작물을 우선하고, 그 안에서 적합도를 비교합니다. 미완성 후보는 검토용이며 확정되지 않습니다.','Complete essential-work coverage takes priority, then suitability. Incomplete candidates are review-only.')}</p>
 <div className="table-wrap"><table><thead><tr>{[t('농지','Field'),t('작물','Crop'),t('점수','Score'),t('배정 작업','Assigned'),t('판정','Result'),t('확인 사항','Requirements')].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{(result.comparisons??[]).map((c:any)=><tr key={c.pnu+':'+c.crop}><td>{c.address}</td><td>{names[c.crop as CropCode]} {c.selected?t('(선택안)','(Selected)'):''}</td><td>{c.score}</td><td>{c.assigned}</td><td>{c.status==='CAPACITY_FEASIBLE'?t('필수 배차 가능','Essential capacity available'):c.status==='BLOCKED'?t('조건 확인 필요','Conditions unresolved'):t('필수 배차 미완성','Incomplete')}</td><td>{c.reasons.join(' / ')||'—'}</td></tr>)}</tbody></table></div>
 {result.pending.map((p:any)=><p key={p.pnu}>{p.address} · {p.reason}</p>)}
 {result.plans.map((p:any)=><details key={p.cultivation.id}><summary>{p.plan.plots[0].address} · {names[p.cultivation.crop as CropCode]} · {p.score}{t('점',' points')} · {p.dispatch.assignments.length}{t('건',' tasks')}</summary><p>{t('권한·현장·기상 확인 전 잠정 계획입니다.','Provisional plan pending rights, field and weather checks.')}</p><div className="table-wrap"><table><thead><tr>{[t('작업','Task'),t('날짜·시각','Date / time'),t('장비·담당','Machine / owner'),t('필요 인원','Required staff'),t('분','Minutes')].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{p.dispatch.assignments.map((a:any)=><tr key={a.taskId}><td>{p.plan.plots[0].tasks.find((x:any)=>x.id===a.taskId)?.name}</td><td>{a.date} {String(Math.floor(a.startMinute/60)).padStart(2,'0')}:{String(a.startMinute%60).padStart(2,'0')}</td><td>{a.machineId??a.owner}</td><td>{a.staff}</td><td>{a.durationMinutes}</td></tr>)}</tbody></table></div>{p.dispatch.pending.map((w:any)=><p key={w.id}>{p.plan.plots[0].tasks.find((x:any)=>x.id===w.id)?.name} · {w.reason}</p>)}</details>)}
 <h3>{t('신규 배치의 일별 자원 수요','Daily demand from new assignments')}</h3><p>{t('인원은 동시 필요 최대값입니다. 기존 작업·실제 인력 모집 명단을 포함한 총원이 아닙니다.','Staff is peak simultaneous demand for new assignments, not total staffing or confirmed workers.')}</p><div className="table-wrap"><table><thead><tr>{[t('날짜','Date'),t('장비','Equipment'),t('동시 인원','Peak staff'),t('인력 분','Person-minutes'),t('동시 운송','Peak transport')].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{result.demand.map((d:any)=><tr key={d.date}><td>{d.date}</td><td>{d.machines.join(', ')||'—'}</td><td>{d.staffPeak}</td><td>{d.personMinutes}</td><td>{d.transportPeak}</td></tr>)}</tbody></table></div>
 <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{t('미배정·권한 확인 대기를 확인했으며, 가능한 작업의 잠정 계획만 확정합니다. 실제 장비·파견·문자 실행은 아닙니다.','I reviewed pending work and rights. Approve feasible provisional assignments only, without equipment, worker dispatch or real SMS.')}</label><button disabled={busy||!ack||!result.assigned||result.approvalBlocked} onClick={()=>run('approve')}>{t('작물·계획·배차 일괄 확정','Approve crops, plans and assignments')}</button></>}
 </section>;
}
