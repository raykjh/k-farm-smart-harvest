'use client';
import {attendanceDates,assignedWorkerCount,type LaborJob,type Worker} from '@/lib/labor-operations';
import {useLanguage} from './language';
import {Button} from './ui/button';
export default function LaborAttendanceStatus({job:j,people,busy,onAction}:{job:LaborJob;people:Worker[];busy:boolean;onAction:(action:object)=>Promise<unknown>}){
 const {locale}=useLanguage(),t=(ko:string,en:string)=>locale==='ko'?ko:en,a=j.attendance,dates=attendanceDates(j),name=(id:string)=>people.find(p=>p.id===id)?.name??'—';
 if(j.status!=='OPEN')return null;
 if(!a)return <Button variant="outline" disabled={busy} onClick={()=>onAction({action:'attendance',jobId:j.id})}>{t('7일 전 배정·2일 전 확인 적용','Enable 7-day allocation / 2-day confirmation')}</Button>;
 const pending=a.proposed.filter(id=>!j.assigned.includes(id));
 return <section className="card section-space" aria-label={t('참석 확정 일정','Attendance timeline')}>
  <p>{t('자동 배정','Automatic allocation')} {dates.allocateOn} → {t('참석 마감·교체 및 담당자 확인','Confirmation cutoff / replacement and operator review')} {dates.confirmBy}</p>
  <p>{t('참석 확인','Attendance confirmed')} {j.assigned.length}{t('명',' people')} · {t('직접고용 예비 배정','Employee reserve slots')} {j.reserveSlots?.length??0} · {t('확답 대기','Awaiting reply')} {pending.length}{t('명',' people')}{pending.length>0?' · '+pending.map(name).join(', '):''}</p>
  {!a.startedAt&&<p>{t('작업 7일 전부터 점수·거리 순으로 배정 안내를 시작합니다.','Allocation notices begin 7 days before work, ordered by score and distance.')}</p>}
  {!!a.expired.length&&<p>{t('마감 미확정으로 교체','Replaced after no reply')}: {a.expired.map(name).join(', ')}</p>}
  {a.cutoffAt&&<><p>{Math.max(0,j.count-assignedWorkerCount(j))>0?t('충원 필요 · 확답 전에는 확보 인원에 포함하지 않습니다.','Staffing needed. Unconfirmed replacements do not count as secured workers.'):t('작업에 필요한 인원을 배정했습니다.','Required staffing has been allocated.')}</p><Button variant="outline" disabled={busy||!!a.reviewedAt} onClick={()=>onAction({action:'reviewAttendance',jobId:j.id})}>{a.reviewedAt?t('담당자 확인 완료','Reviewed'):t('배정 결과 확인','Acknowledge assignment result')}</Button></>}
 </section>;
}
