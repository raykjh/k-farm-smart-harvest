'use client';
import {useState} from 'react';
import type {Mission,State} from '@/lib/types';
import type {PendingApproval} from '@/lib/calendar-status';
import {useLanguage} from './language';
import {Button} from './ui/button';
export default function TaskAttention({state,tasks,approvals,onTask,onApproval}:{state:State;tasks:{mission:Mission;action:string}[];approvals:PendingApproval[];onTask:(m:Mission,tab:string)=>void;onApproval:(p:PendingApproval)=>void}){
 const {locale}=useLanguage(),t=(a:string,b:string)=>locale==='ko'?a:b,[filter,setFilter]=useState('');
 if(!tasks.length&&!approvals.length)return null;
 const groups=[['RESULT_MISSING',t('작업결과 미입력','Results missing')],['REPLAN_PENDING',t('재배치 대기','Awaiting reschedule')],['STAFFING_PENDING',t('인력 배정 대기','Awaiting labor')],['APPROVAL_PENDING',t('변경계획 승인 대기','Awaiting plan approval')]];
 return <section className="card section-space" data-testid="task-attention"><h2>{t('현재 처리할 업무','Work requiring action')}</h2><div className="view-tabs">{groups.map(([key,label])=>{const count=key==='APPROVAL_PENDING'?approvals.length:tasks.filter(x=>x.action===key).length;return count>0&&<button key={key} aria-pressed={filter===key} onClick={()=>setFilter(filter===key?'':key)}>{label} {count}{t('건','')}</button>})}</div>{filter&&<div className="table-wrap"><table><thead><tr><th>{t('작업일','Date')}</th><th>{t('농지·작업','Field / task')}</th><th>{t('처리','Action')}</th></tr></thead><tbody>{filter==='APPROVAL_PENDING'?approvals.map(p=><tr key={p.id}><td>{p.day??'—'}</td><td>{p.missionIds.length}{t('건 변경 묶음',' changes')}</td><td><Button onClick={()=>onApproval(p)}>{t('변경계획 검토','Review plan')}</Button></td></tr>):tasks.filter(x=>x.action===filter).map(({mission:m,action})=><tr key={m.id}><td>{m.scheduledDate??m.originalScheduledDate??'—'}</td><td>{state.fields.find(f=>f.id===m.fieldId)?.address??m.fieldId}<br/>{m.label}</td><td>{action==='STAFFING_PENDING'?<a href="/?tab=labor">{t('인력 배정','Assign labor')}</a>:<Button onClick={()=>onTask(m,action==='RESULT_MISSING'?'result':'schedule')}>{action==='RESULT_MISSING'?t('결과 입력','Record result'):t('재배치','Reschedule')}</Button>} <Button variant="outline" onClick={()=>onTask(m,'cancel')}>{t('작업취소','Cancel task')}</Button></td></tr>)}</tbody></table></div>}</section>;
}
