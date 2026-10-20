'use client';
import {addressText} from '@/lib/display-language';
import {operationalText} from '@/lib/operational-i18n';
import {useEffect,useRef,useState} from 'react';
import type {State,Mission} from '@/lib/types';
import {executionStatus,type ExecutionView} from '@/lib/execution-view';
import {equipmentCode} from '@/lib/equipment-code';
import {isClosedTask} from '@/lib/task-lifecycle';
import {taskResourceLabel} from '@/lib/schedule-display';
import TaskAttention from './task-attention';
import TaskOperations from './task-operations';
import TaskCancelForm from './task-cancel-form';
import {calendarStatus,inDailySchedule,type PendingApproval} from '@/lib/calendar-status';
import {useKoreaDay} from './use-korea-day';
import TodayWeather from './today-weather';
import EquipmentRegister from './equipment-register';
import ManagedFields from './managed-fields';
import ReplanManager from './replan-manager';
import ScheduleChangeDialog from './schedule-change-dialog';
import Modal from './modal';
import {Button} from './ui/button';
import {useLanguage} from './language';
export function missionDate(m:Mission){return m.scheduledDate??null}
export {equipmentCode} from '@/lib/equipment-code';
export type ScheduleNavigation={id:number;date:string;allMonths?:boolean};
export default function OperationsOverview({state:s,view,onView,onRefresh,scheduleNavigation,onRegister,aiAvailable=false}:{aiAvailable?:boolean;state:State;view:string;onView:(v:'오늘'|'일정표'|'장비'|'농지·농가',date?:string,allMonths?:boolean)=>void;onRefresh:()=>Promise<void>;scheduleNavigation?:ScheduleNavigation;onRegister:(kind:'field'|'equipment'|'labor')=>void}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b;
 const currentDay=useKoreaDay(),year=Number(currentDay.slice(0,4));
 const [history,setHistory]=useState<ExecutionView[]>([]),[historyError,setHistoryError]=useState(false),[loaded,setLoaded]=useState(false);
 const [scheduleYear,setScheduleYear]=useState(year);
 const [month,setMonth]=useState(Number(currentDay.slice(5,7))),[scheduleMonth,setScheduleMonth]=useState(Number(currentDay.slice(5,7))),[batchIds,setBatchIds]=useState<string[]>([]),[batch,setBatch]=useState<{day:string;ids:string[]}|null>(null),[managed,setManaged]=useState<{mission:Mission;tab:string}|null>(null),[approval,setApproval]=useState<PendingApproval|null>(null),[approvals,setApprovals]=useState<PendingApproval[]>([]),[cancelling,setCancelling]=useState<Mission[]>([]);
 useEffect(()=>{let active=true;setHistoryError(false);setLoaded(false);fetch('/api/work-history').then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(active){setHistory(d.items);setApprovals(d.approvals??[]);setLoaded(true)}}).catch(()=>{if(active){setHistoryError(true);setLoaded(false)}});return()=>{active=false}},[s]);
 const [adjustOpen,setAdjustOpen]=useState(false);
 const managedFields=s.fields.filter(f=>f.serviceStatus!=='WITHDRAWN');
 const visibleMissions=s.missions.filter(m=>!m.cancellation||m.cancellation.category==='UNNECESSARY');
 const selectedDay=scheduleNavigation?.date??currentDay,selectedDayRef=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{if(scheduleNavigation){setScheduleYear(Number(scheduleNavigation.date.slice(0,4)));setScheduleMonth(scheduleNavigation.allMonths?0:Number(scheduleNavigation.date.slice(5,7)))}},[scheduleNavigation]);
 useEffect(()=>{if(view!=='일정표')return;const frame=requestAnimationFrame(()=>selectedDayRef.current?.scrollIntoView({block:'nearest'}));return()=>cancelAnimationFrame(frame)},[view,scheduleNavigation,scheduleMonth]);
 const cs=(m:Mission)=>calendarStatus(s,m,history,currentDay,missionDate(m)??undefined);
 const st=(m:Mission)=>executionStatus(s,m,history),canManage=(m:Mission)=>loaded&&!historyError&&!isClosedTask(st(m))&&st(m)!=='UNKNOWN';
 // Reloading history disables submission, but must not temporarily erase the
 // popup's selected tasks and discard the operator's in-progress form state.
 const dialogEligibleIds=s.missions.filter(m=>!isClosedTask(st(m))&&st(m)!=='UNKNOWN').map(m=>m.id);
 const displayedState={...s,missions:s.missions.map(m=>({...m,status:st(m)==='UNKNOWN'?'UNSTAFFED' as const:st(m) as Mission['status']}))};
 const annual=visibleMissions.filter(m=>missionDate(m)?.startsWith(year+'-')),today=annual.filter(m=>missionDate(m)===currentDay);
 const dailyAnnual=annual.filter(m=>inDailySchedule(s,m,history,currentDay));
 const scheduleYears=[...new Set([year,scheduleYear,...s.missions.map(m=>Number(missionDate(m)?.slice(0,4))).filter(y=>y>=2000&&y<=2200)])].sort((a,b)=>a-b);
 const scheduleAnnual=visibleMissions.filter(m=>missionDate(m)?.startsWith(scheduleYear+'-'));
 const scheduleDaily=scheduleAnnual.filter(m=>inDailySchedule(s,m,history,currentDay));
 const pending=s.missions.filter(m=>!isClosedTask(st(m))&&!approvals.some(p=>p.missionIds.includes(m.id))).map(m=>({mission:m,action:cs(m)})).filter(x=>['RESULT_MISSING','REPLAN_PENDING','STAFFING_PENDING'].includes(x.action));
 const status=(v:string)=>({CANCELLED:t('취소','Cancelled'),RESULT_MISSING:t('작업결과 미입력','Results missing'),REPLAN_PENDING:t('재배치 대기','Awaiting reschedule'),STAFFING_PENDING:t('인력 배정 대기','Awaiting labor'),PLANNED:t('예정','Planned'),HELD:t('보류','Held'),UNSTAFFED:t('인력 미배정','Unstaffed'),COMPLETED:t('완료','Completed'),UNKNOWN:t('작업결과 미입력','Results missing'),WORKING:t('작업중','In progress')}[v]??v);
 const cards=(items:[string,number|string,(()=>void)?][])=> <div className="ops-metrics">{items.map(([label,n,click])=><button disabled={!click} type="button" key={label} className="card stat" onClick={click}><div><p className="stat-label">{label}</p><p className="stat-value">{n}</p></div></button>)}</div>;
 const error=historyError&&<p role="alert">{t('실적 조회 실패 · 일정변경은 다시 불러온 후 가능합니다.','History unavailable. Reload before changing schedules.')}</p>;
 const crop=(v:string|null)=>locale==='ko'?v??'미선택':({쌀:'Rice',감자:'Potato',고추:'Pepper'}[v??'']??'Not selected');
 const inProgress=(m:Mission)=>String(st(m))==='WORKING';
 const openTask=(mission:Mission,tab='schedule')=>setManaged({mission:isClosedTask(st(mission))?{...mission,status:st(mission) as Mission['status']}:mission,tab});
 const dismiss=()=>{setManaged(null);setBatch(null);setApproval(null);void onRefresh().catch(()=>setHistoryError(true))};
 const saved=async()=>{await onRefresh();setManaged(null);setApproval(null);setCancelling([]);setBatch(null);setBatchIds([])};
 const attention=loaded&&!historyError&&<TaskAttention state={s} tasks={pending} approvals={approvals} onTask={openTask} onApproval={setApproval}/>;

 const dialogs=<>
 {adjustOpen&&<Modal title={t('일정변경','Change schedule')} onClose={()=>setAdjustOpen(false)}><ScheduleChangeDialog aiAvailable={aiAvailable} ready={loaded&&!historyError} state={displayedState} today={currentDay} eligibleIds={dialogEligibleIds} onClose={()=>setAdjustOpen(false)} onSaved={async()=>{setAdjustOpen(false);await saved()}} onUpdated={onRefresh}/></Modal>}
 {managed&&<Modal className="task-management-modal" title={t('작업 관리','Task management')} onClose={dismiss}><TaskOperations key={managed.mission.id} state={displayedState} mission={managed.mission} initialTab={managed.tab} onClose={dismiss} onSaved={saved} onUpdated={onRefresh}/></Modal>}
 {cancelling.length>0&&<Modal title={t('작업 취소','Cancel tasks')} onClose={()=>setCancelling([])}><TaskCancelForm missions={cancelling} state={s} onSaved={saved}/></Modal>}
 {approval&&<Modal title={t('변경계획 검토','Review plan')} onClose={dismiss}><ReplanManager state={displayedState} ids={approval.missionIds} day={approval.day} initialResult={approval.result} onClose={dismiss} onSaved={saved} onUpdated={onRefresh}/></Modal>}
 {batch&&<Modal title={t('일정변경','Change schedule')} onClose={dismiss}><ScheduleChangeDialog aiAvailable={aiAvailable} ready={loaded&&!historyError} state={displayedState} today={currentDay} eligibleIds={dialogEligibleIds} initialDate={batch.day} initialIds={batch.ids} onClose={dismiss} onSaved={saved} onUpdated={onRefresh}/></Modal>}
 </>;
 if(view==='오늘')return <div data-testid="ops-home"><TodayWeather space="sandbox"/>{error}{cards([[t('오늘 작업 총수','Tasks today'),today.length,()=>onView('일정표')],[t('작업중','In progress'),today.filter(inProgress).length],[t('취소작업','Cancelled tasks'),today.filter(m=>st(m)==='CANCELLED').length],[t('완료작업','Completed tasks'),today.filter(m=>st(m)==='COMPLETED').length]])}{cards([[t('관리농지','Managed fields'),managedFields.length,()=>onView('농지·농가')],[t('연간작업','Annual tasks'),annual.length,()=>onView('일정표')],[t('전체 장비','Total equipment'),s.machines.length,()=>onView('장비')],[t('작업중 장비','Working equipment'),s.machines.filter(m=>m.status==='WORKING').length,()=>onView('장비')],[t('정비 필요','Maintenance needed'),s.machines.filter(m=>m.status==='MAINTENANCE').length,()=>onView('장비')],[t('사용가능','Available'),s.machines.filter(m=>m.status==='AVAILABLE'&&!m.safetyLock).length,()=>onView('장비')]])}<section className="home-quick-actions" aria-label={t('빠른 업무','Quick actions')}><Button variant="outline" onClick={()=>onRegister('field')}>{t('농지 등록','Register field')}</Button><Button variant="outline" onClick={()=>onRegister('equipment')}>{t('장비 등록','Register equipment')}</Button><Button variant="outline" onClick={()=>onRegister('labor')}>{t('인력 등록','Register worker')}</Button><Button variant="outline" disabled={!loaded||historyError} onClick={()=>setAdjustOpen(true)}>{t('일정변경','Change schedule')}</Button></section><section className="card section-space"><div className="card-head"><h2>{t('작업 달력','Work calendar')}</h2><label>{year}<select aria-label="Calendar month" value={month} onChange={e=>setMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}{t('월','')}</option>)}</select></label></div><div className="calendar-header">{(locale==='ko'?['일','월','화','수','목','금','토']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).map(d=><div className="weeklabel" key={d}>{d}</div>)}</div><div className="calendar">{Array.from({length:Math.ceil((new Date(year,month-1,1).getDay()+new Date(year,month,0).getDate())/7)*7},(_,i)=>{const d=i-new Date(year,month-1,1).getDay()+1,valid=d>0&&d<=new Date(year,month,0).getDate(),date=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,tasks=dailyAnnual.filter(m=>missionDate(m)===date);return <button data-testid={valid?'calendar-day-'+date:undefined} key={i} disabled={!valid} className={`day ${valid?'':'empty'} ${date===currentDay?'today':''}`} onClick={()=>onView('일정표',date)}>{valid&&<><b className="calendar-date">{d}</b><div className="calendar-task-thirds">{[[t('예정작업','Scheduled'),date>=currentDay?tasks.filter(m=>!isClosedTask(st(m))&&!inProgress(m)).length:0],[t('작업중','In progress'),date>=currentDay?tasks.filter(inProgress).length:0],[t('완료작업','Completed'),tasks.filter(m=>st(m)==='COMPLETED').length]].map(([label,count],index)=><div key={label} className={'calendar-task-count status-'+index}><small>{label}</small> <b>{count}</b></div>)}</div></>}</button>})}</div></section>{dialogs}</div>;
 if(view==='일정표'){
  const dates=[...new Set([...scheduleDaily.map(m=>missionDate(m)!),...(selectedDay.startsWith(scheduleYear+'-')?[selectedDay]:[])])].sort().filter(d=>!scheduleMonth||Number(d.slice(5,7))===scheduleMonth);
  return <div data-testid="ops-schedule">{cards([[t('연간 작업','Annual tasks'),scheduleAnnual.length],[t('처리완료','Completed'),scheduleAnnual.filter(m=>st(m)==='COMPLETED').length],[t('잔여작업','Remaining'),scheduleAnnual.filter(m=>!isClosedTask(st(m))).length],[t('취소','Cancelled'),scheduleAnnual.filter(m=>st(m)==='CANCELLED').length ]])}{error}{attention}{batchIds.length>0&&<div className="actions"><Button variant="outline" disabled={!loaded||historyError||!batchIds.length} onClick={()=>setCancelling(s.missions.filter(m=>batchIds.includes(m.id)&&!isClosedTask(st(m))))}>{t('선택 작업 취소','Cancel selected tasks')}</Button></div>}<label className="actions">{t('일정 연도','Schedule year')}<select aria-label={t('일정 연도','Schedule year')} value={scheduleYear} onChange={e=>{setScheduleYear(Number(e.target.value));setBatchIds([])}}>{scheduleYears.map(y=><option key={y} value={y}>{y}</option>)}</select></label><div className="view-tabs month-tabs" aria-label={t('월별 일정','Schedule month')}>{[1,2,3,4,5,6,7,8,9,10,11,12,0].map(n=><button key={n} aria-pressed={scheduleMonth===n} onClick={()=>setScheduleMonth(n)}>{n?n+t('월',''):t('전체','All')}</button>)}</div>
  {dates.map(date=>{const tasks=scheduleDaily.filter(m=>missionDate(m)===date),eligible=tasks.filter(canManage);return <details className="card section-space schedule-day" key={`${scheduleNavigation?.id??0}-${date}`} ref={date===selectedDay?selectedDayRef:undefined} open={date===selectedDay} data-testid={'schedule-day-'+date}><summary><b>{date}</b> · {t('작업','Tasks')} {tasks.length} · {t('취소','Cancelled')} {tasks.filter(m=>st(m)==='CANCELLED').length} · {t('완료','Completed')} {tasks.filter(m=>st(m)==='COMPLETED').length}</summary>{!tasks.length&&<p className="empty-state">{t('이 날짜에 표시할 작업이 없습니다.','No tasks to display on this date.')}</p>}<div className="actions"><Button variant="outline" disabled={!eligible.length} onClick={()=>setBatchIds(eligible.map(m=>m.id))}>{t('전체 선택','Select all')}</Button><Button disabled={!eligible.length} onClick={()=>setBatch({day:date,ids:(eligible.some(m=>batchIds.includes(m.id))?eligible.filter(m=>batchIds.includes(m.id)):eligible).map(m=>m.id)})}>{t('일정변경','Change schedule')}</Button></div><div className="table-wrap"><table><thead><tr>{[t('농지','Field'),t('작물','Crop'),t('작업','Task'),t('장비 / 인력','Equipment / labor'),t('상태·비고','Status / notes'),t('관리','Manage')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{tasks.map(m=><tr key={m.id} data-testid={'schedule-task-'+m.id}><td>{canManage(m)&&<input aria-label={t('일괄 선택 ','Select task ')+m.id} type="checkbox" checked={batchIds.includes(m.id)} onChange={e=>setBatchIds(e.target.checked?[...batchIds,m.id]:batchIds.filter(id=>id!==m.id))}/>} {addressText(s.fields.find(f=>f.id===m.fieldId)?.address,locale)||m.fieldId}</td><td>{crop(m.crop)}</td><td>{operationalText(m.label,locale)}</td><td>{taskResourceLabel(s,m,locale==='ko')}</td><td>{status(st(m))}</td><td><Button variant="outline" disabled={!loaded||historyError} onClick={()=>openTask(m,isClosedTask(st(m))?'history':'schedule')}>{t('관리','Manage')}</Button></td></tr>)}</tbody></table></div></details>})}
  {!dates.length&&<p className="empty-state">{t('이 달에 등록된 작업이 없습니다.','No tasks this month.')}</p>}
  {dialogs}
  </div>;
 }
 if(view==='장비')return <EquipmentRegister state={s} onRefresh={onRefresh} statusOf={st}/>;
 if(view==='농지·농가')return <ManagedFields state={displayedState} onRefresh={onRefresh} onRegister={()=>onRegister('field')}/>;
 return null;
}
