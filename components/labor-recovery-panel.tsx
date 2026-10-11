'use client';
import {useEffect,useState} from 'react';
import type {State} from '@/lib/types';
import type {LaborRecovery} from '@/lib/labor-recovery-store';
import {useLanguage} from './language';
import {Button} from './ui/button';
import Modal from './modal';
import ReplanManager from './replan-manager';
type Issue=Omit<LaborRecovery,'tasks'>&{tasks:{id:string;label:string;date?:string;movable:boolean;shortage:number|null}[]};
export default function LaborRecoveryPanel(){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en;
 const [data,setData]=useState<{canManage:boolean;state:State;issues:Issue[]}|null>(null),[error,setError]=useState(''),[selection,setSelection]=useState<{ids:string[];day:string}|null>(null);
 async function load(){try{const r=await fetch('/api/labor-recovery',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setError('')}catch(e){setError(e instanceof Error?e.message:String(e))}}
 useEffect(()=>{void load();const reload=()=>void load();window.addEventListener('kfarm-labor-updated',reload);return()=>window.removeEventListener('kfarm-labor-updated',reload)},[]);
 const open=data?.issues.filter(i=>i.status==='OPEN')??[];
 return <details className="card section-space" data-testid="labor-recovery"><summary>{t('인력 불참·지원 철회 대응','Absence and withdrawn support')} · {open.length}</summary>
 <p>{t('출근 확인된 센터 대기 인력, 참석 확인된 일반 대기자, 동의한 인접센터 지원 순으로 빈자리를 채웁니다. 부족하면 기존 작업기간 안에서 대안을 비교하고 일괄 승인합니다. 날짜·지원 인력이 바뀌면 참석을 다시 확인하며 자동 감점하지 않습니다.','Fill vacancies from confirmed reserve employees, then local attendees and consenting adjacent-center support. Compare and approve schedule alternatives if still short. Reconfirm changed dates or support; no automatic penalties.')}</p>
 {error&&<p role="alert">{error}</p>}{open.map(issue=><section key={issue.id} data-testid={'recovery-'+issue.id} className="section-space"><h3>{issue.date} · {issue.workerName}</h3><p>{issue.reason}</p>{issue.tasks.map(task=><p key={task.id}>{task.date} · {task.label} · {task.shortage===null?t('새 작업 참석 확인 필요','New task attendance required'):t('부족 ','Shortage ')+task.shortage}{!task.movable&&' · '+t('시작·잠금·완료 상태: 담당자 확인','Started, locked or closed: staff review')}</p>)}
 {data?.canManage&&[...new Set(issue.tasks.filter(task=>task.movable&&task.date).map(task=>task.date!))].map(day=><Button key={day} variant="outline" onClick={()=>setSelection({day,ids:issue.tasks.filter(task=>task.movable&&task.date===day).map(task=>task.id)})}>{day} · {t('대체 인력·일정 비교','Compare staffing and schedule')}</Button>)}
 </section>)}{!open.length&&<p>{t('현재 미해결 인력 대응 건이 없습니다.','No unresolved labor recovery items.')}</p>}
 <Button variant="outline" onClick={()=>void load()}>{t('대응 상태 새로고침','Refresh recovery')}</Button>
 <details><summary>{t('처리 이력','Recovery history')}</summary>{data?.issues.filter(i=>i.status==='RESOLVED').map(i=><p key={i.id}>{i.date} · {i.workerName} · {i.resolution==='REPLACED'?t('참석 확인 인력으로 충원','Filled by confirmed attendees'):i.resolution==='REPLANNED'?t('재계획 반영 · 새 참석 별도 확인','Replanned; confirm new attendance'):t('작업 종료','Task closed')}</p>)}</details>
 {selection&&<Modal title={t('인력 대체·재계획','Labor recovery and replanning')} onClose={()=>setSelection(null)}><ReplanManager laborRecovery ids={selection.ids} day={selection.day} preferredDate={selection.day} state={data?.state} onClose={()=>setSelection(null)} onSaved={async()=>{setSelection(null);await load();window.dispatchEvent(new Event('kfarm-labor-updated'))}}/></Modal>}
 </details>;
}
