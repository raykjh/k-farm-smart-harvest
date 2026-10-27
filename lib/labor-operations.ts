import {z} from 'zod';
import {HALF_DAY_MINUTES,type PayBasis} from './labor-policy';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
// Legacy fields remain readable, but no longer restrict ordinary-labor recruitment.
// Attendance is confirmed for each center's scheduled job, not a personal timetable.
export const ordinaryLaborAvailability=()=>({weekdays:[0,1,2,3,4,5,6],preferredDates:[] as string[],excludedDates:[] as string[],startMinute:0,endMinute:1440,workCodes:['*']});
export const workerSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(60),birth:date,phone:z.string().trim().min(1).max(30),address:z.string().trim().min(1).max(200),registeredFarmer:z.boolean(),usesApp:z.boolean().default(false),weekdays:z.array(z.number().int().min(0).max(6)).max(7).optional(),preferredDates:z.array(date).max(366).optional(),excludedDates:z.array(date).max(366).optional(),startMinute:z.number().int().min(0).max(1439).optional(),endMinute:z.number().int().min(1).max(1440).optional(),workCodes:z.array(z.string().min(1).max(40)).min(1).max(30).optional(),active:z.boolean(),employment:z.enum(['VOLUNTEER','CENTER_RESERVE']).optional(),standbyDates:z.array(date).max(366).optional()}).strict().transform(p=>({...p,usesApp:false,...ordinaryLaborAvailability()}));
export type Worker=z.infer<typeof workerSchema>;
export type LaborAttendance={policy:'SEVEN_TWO';proposed:string[];expired:string[];startedAt?:string;cutoffAt?:string;reviewedAt?:string;reviewedBy?:string};
export type LaborJob={reserveAttendance?:Record<string,'ATTENDING'|'DECLINED'>;reservePeople?:Record<string,{name:string;phone:string}>;fieldId?:string;cultivationId?:string;employmentSnapshot?:Record<string,'VOLUNTEER'|'CENTER_RESERVE'>;payBasis?:PayBasis;reserveSlots?:string[];reserveWorked?:string[];attendance?:LaborAttendance;borrowedNames?:string[];id:string;missionId:string;task:string;address:string;date:string;startMinute:number;durationMinutes:number;count:number;workCode:string;sourceHash:string;pay:string;status:'OPEN'|'COMPLETED'|'STALE';invited:string[];responses:Record<string,'APP'|'SMS'|'PHONE'|'DECLINED'|'STANDBY'>;distances:Record<string,number|null>;assigned:string[];manual:string[]|null;worked:string[];completedAt?:string};
export const assignedWorkerCount=(j:LaborJob|undefined)=>j?j.assigned.length+(j.borrowedNames?.length??0)+(j.reserveSlots?.length??0):0;
export type LaborWorkException={id:string;jobId:string;workerId:string;halfDays:number;reason:string;actor:string;at:string};
export type LaborOps={permanentWorkforce?:import('./permanent-workforce').PermanentWorkforce;reserveRoster?:{count:number;profiles:Record<string,{name:string;phone:string}>};reserveCapacityByYear?:Record<string,number>;workExceptions?:LaborWorkException[];externalBusy?:{workerId:string;date:string;startMinute:number;durationMinutes:number}[];people:Worker[];jobs:LaborJob[];penalties:{id:string;jobId:string;workerId:string;points:number;reason:string;operator:string;at:string}[];notices:{id:string;jobId:string;workerId:string;type:'INVITE'|'ASSIGNED'|'CANCELLED'|'RECONFIRM'|'PROPOSED'|'EXPIRED';channel:'APP'|'SMS_PHONE';body:string;at:string;status:'MOCK_RECORDED'}[]};
export const emptyLaborOps=():LaborOps=>({people:[],jobs:[],penalties:[],notices:[]});
export const laborScore=(s:LaborOps,id:string)=>Math.max(0,100-s.penalties.filter(p=>p.workerId===id).reduce((n,p)=>n+p.points,0));
export function availableFor(p:Worker,j:LaborJob){return p.active&&j.startMinute>=0&&j.durationMinutes>0&&j.startMinute+j.durationMinutes<=1440;}
const overlaps=(a:LaborJob,b:LaborJob)=>a.date===b.date&&a.startMinute<b.startMinute+b.durationMinutes&&b.startMinute<a.startMinute+a.durationMinutes;
export function workerBusy(s:LaborOps,j:LaborJob,id:string){return s.jobs.some(other=>other.id!==j.id&&other.status!=='STALE'&&other.assigned.includes(id)&&overlaps(j,other))||!!s.externalBusy?.some(b=>b.workerId===id&&b.date===j.date&&b.startMinute<j.startMinute+j.durationMinutes&&j.startMinute<b.startMinute+b.durationMinutes);}
export function canAssign(s:LaborOps,j:LaborJob,p:Worker){return availableFor(p,j)&&j.invited.includes(p.id)&&!j.attendance?.expired.includes(p.id)&&(p.employment==='CENTER_RESERVE'?j.responses[p.id]==='STANDBY'&&!!p.standbyDates?.includes(j.date):['APP','SMS','PHONE'].includes(j.responses[p.id]))&&!workerBusy(s,j,p.id);}
export function rankedWorkers(s:LaborOps,j:LaborJob){return s.people.filter(p=>canAssign(s,j,p)).sort((a,b)=>Number(a.employment==='CENTER_RESERVE')-Number(b.employment==='CENTER_RESERVE')||laborScore(s,b.id)-laborScore(s,a.id)||(j.distances[a.id]??Infinity)-(j.distances[b.id]??Infinity)||a.id.localeCompare(b.id));}
/** A center's un-named employee capacity is a reservation, not a fabricated
 * person, SMS reply or attendance record. Named employees consume this pool. */
export function reconcileReserveSlots(s:LaborOps,j:LaborJob,now:string,urgent=false){
 if(j.status!=='OPEN')return;
 const capacity=s.reserveRoster?.count??s.reserveCapacityByYear?.[j.date.slice(0,4)];if(capacity===undefined)return;
 const today=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
 if(!urgent&&today<attendanceDates(j).confirmBy)return;
 if(j.manual!==null){j.reserveSlots=[];return;}
 const size=Math.max(0,capacity-s.people.filter(p=>p.active&&p.employment==='CENTER_RESERVE').length);
 const free=Array.from({length:size},(_,i)=>String(i+1)).filter(slot=>j.reserveAttendance?.[slot]!=='DECLINED'&&!s.jobs.some(other=>other.id!==j.id&&other.status!=='STALE'&&other.date===j.date&&(other.reserveSlots?.includes(slot)||other.reserveAttendance?.[slot]==='DECLINED')&&j.startMinute<other.startMinute+Math.max(HALF_DAY_MINUTES,other.durationMinutes)&&other.startMinute<j.startMinute+Math.max(HALF_DAY_MINUTES,j.durationMinutes)));
 free.sort((a,b)=>Number(j.reserveAttendance?.[b]==='ATTENDING')-Number(j.reserveAttendance?.[a]==='ATTENDING')||Number(a)-Number(b));
 j.reserveSlots=free.slice(0,Math.max(0,j.count-j.assigned.length-(j.borrowedNames?.length??0)));
}
export function notice(s:LaborOps,j:LaborJob,id:string,type:LaborOps['notices'][number]['type'],now:string){
 const worker=s.people.find(p=>p.id===id);if(!worker)return;
 const label={RECONFIRM:'일정 변경 · 참석 재확인',INVITE:'참석 의사 확인',ASSIGNED:'배정 확정 안내',CANCELLED:'배정 취소',PROPOSED:'우선 배정 · 참석 확답 요청',EXPIRED:'기한 내 미확정 · 배정 교체'}[type];
 s.notices.push({id:crypto.randomUUID(),jobId:j.id,workerId:id,type,channel:'SMS_PHONE',body:`${label}: ${j.date} ${String(Math.floor(j.startMinute/60)).padStart(2,'0')}:${String(j.startMinute%60).padStart(2,'0')} · ${j.task} · ${j.address} · ${j.durationMinutes}분 · ${j.pay}${j.attendance?' · 참석 확정 기준일 '+attendanceDates(j).confirmBy:''}`,at:now,status:'MOCK_RECORDED'});
}
export function allocateJob(s:LaborOps,j:LaborJob,now:string){
 if(j.status!=='OPEN')return;
 if(j.attendance){advanceAttendance(s,j,now);return;}
 const before=[...j.assigned],ranked=rankedWorkers(s,j);
 j.assigned=j.manual===null?ranked.slice(0,j.count).map(p=>p.id):j.manual.filter(id=>ranked.some(p=>p.id===id)).slice(0,j.count);
 reconcileReserveSlots(s,j,now);
 for(const id of before.filter(id=>!j.assigned.includes(id)))notice(s,j,id,'CANCELLED',now);
 for(const id of j.assigned.filter(id=>!before.includes(id)))notice(s,j,id,'ASSIGNED',now);
}
export function respond(s:LaborOps,jobId:string,id:string,response:'APP'|'SMS'|'PHONE'|'DECLINED',now:string){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='OPEN'||!j.invited.includes(id))throw Error('모집 안내 대상 및 상태를 확인하세요.');
 if(j.attendance){advanceAttendance(s,j,now);if(response!=='DECLINED'&&j.attendance.expired.includes(id))throw Error('확정 기한 경과로 교체된 배정입니다. 새 배정 대상의 참석을 확인하세요.');if(response!=='DECLINED'&&Date.parse(now)>=jobStartsAt(j))throw Error('작업 시작 후에는 참석 배정을 변경하지 않습니다.');}
 if(s.people.find(p=>p.id===id)?.employment==='CENTER_RESERVE'&&response!=='DECLINED')throw Error('센터 대기 인력은 확인된 대기근무를 통해 투입합니다.');
 const lost=j.assigned.includes(id)&&response==='DECLINED';
 j.responses[id]=response;if(lost)activateStandby(s,j);
 if(j.attendance&&lost&&Date.parse(now)>=jobStartsAt(j)){
  const before=[...j.assigned],eligible=rankedWorkers(s,j).map(p=>p.id);
  j.assigned=j.manual===null?eligible.slice(0,Math.max(0,j.count-(j.borrowedNames?.length??0))):j.manual.filter(id=>eligible.includes(id)).slice(0,j.count);
  j.attendance.proposed=[...j.assigned];delete j.attendance.reviewedAt;delete j.attendance.reviewedBy;
  reconcileReserveSlots(s,j,now,true);
  for(const id of before.filter(id=>!j.assigned.includes(id)))notice(s,j,id,'CANCELLED',now);
  for(const id of j.assigned.filter(id=>!before.includes(id)))notice(s,j,id,'ASSIGNED',now);
  return;
 }
 allocateJob(s,j,now);
}
/** Reserve employees do not enter ordinary recruitment. A reviewed duty date is
 * the attendance basis, not a fabricated APP/PHONE reply. Manual lists stay put. */
export function activateStandby(s:LaborOps,j:LaborJob){
 if(j.status!=='OPEN'||j.manual!==null)return;
 const retained=j.assigned.filter(id=>j.responses[id]!=='DECLINED');
 let vacancies=Math.max(0,j.count-retained.length);
 const reserves=s.people.filter(p=>p.employment==='CENTER_RESERVE'&&p.standbyDates?.includes(j.date)&&availableFor(p,j)&&!retained.includes(p.id)&&j.responses[p.id]!=='DECLINED').sort((a,b)=>laborScore(s,b.id)-laborScore(s,a.id)||(j.distances[a.id]??Infinity)-(j.distances[b.id]??Infinity)||a.id.localeCompare(b.id));
 for(const p of reserves){if(!vacancies)break;
  const probe={...j,invited:[...j.invited,p.id],responses:{...j.responses,[p.id]:'STANDBY' as const}};
  if(!canAssign(s,probe,p))continue;
  if(!j.invited.includes(p.id))j.invited.push(p.id);j.responses[p.id]='STANDBY';vacancies--;
 }
}
export function overrideJob(s:LaborOps,jobId:string,ids:string[]|null,now:string){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='OPEN')throw Error('변경 가능한 작업이 아닙니다.');
 if(ids&&(new Set(ids).size!==ids.length||ids.length>j.count||ids.some(id=>!rankedWorkers(s,j).some(p=>p.id===id))))throw Error('참석 확인·중복 배정·필요 인원을 확인하세요.');
 j.manual=ids;
 if(ids===null&&j.assigned.length<j.count&&Object.values(j.responses).includes('DECLINED'))activateStandby(s,j);
 allocateJob(s,j,now);
}

const dayOffset=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export const attendanceDates=(j:LaborJob)=>({allocateOn:dayOffset(j.date,-7),confirmBy:dayOffset(j.date,-2)});
const jobStartsAt=(j:LaborJob)=>Date.parse(j.date+'T00:00:00+09:00')+j.startMinute*60000;
export const newAttendance=():LaborAttendance=>({policy:'SEVEN_TWO',proposed:[],expired:[]});
const priority=(s:LaborOps,j:LaborJob,a:Worker,b:Worker)=>laborScore(s,b.id)-laborScore(s,a.id)||(j.distances[a.id]??Infinity)-(j.distances[b.id]??Infinity)||a.id.localeCompare(b.id);
/** Only proposals may be unconfirmed. All actual assignments still require a
 * verified APP/PHONE response or a confirmed reserve duty. No model or SMS call. */
export function advanceAttendance(s:LaborOps,j:LaborJob,now:string,operatorReview=false){
 const today=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
 const a=j.attendance;if(!a||j.status!=='OPEN'||(operatorReview?j.date<today:Date.parse(now)>=jobStartsAt(j)))return;
 const dates=attendanceDates(j);
 if(!operatorReview&&today<dates.allocateOn)return;
 const before=JSON.stringify(a),oldAssigned=[...j.assigned],oldProposed=[...a.proposed],oldReserves=(j.reserveSlots??[]).join('|');
 if(!a.startedAt)a.startedAt=now;
 const eligible=(p:Worker)=>p.employment!=='CENTER_RESERVE'&&availableFor(p,j)&&!workerBusy(s,j,p.id)&&j.responses[p.id]!=='DECLINED'&&!a.expired.includes(p.id);
 const candidates=s.people.filter(eligible).sort((x,y)=>priority(s,j,x,y));
 for(const p of candidates)if(!j.invited.includes(p.id)){j.invited.push(p.id);notice(s,j,p.id,'INVITE',now);}
 if(today>=dates.confirmBy&&!a.cutoffAt){
  for(const id of a.proposed)if(!['APP','SMS','PHONE','STANDBY'].includes(j.responses[id])){a.expired.push(id);notice(s,j,id,'EXPIRED',now);}
  a.cutoffAt=now;
 }
 if(a.cutoffAt&&rankedWorkers(s,j).length+(j.borrowedNames?.length??0)<j.count)activateStandby(s,j);
 const confirmed=rankedWorkers(s,j);
 if(j.manual!==null){
  a.proposed=j.manual.filter(id=>confirmed.some(p=>p.id===id)).slice(0,j.count);
 }else{
  // Keep prior confirmed assignments stable. At the cutoff, confirmed waitlists
  // precede new proposals; never manufacture attendance for a replacement.
  const kept=[...j.assigned.filter(id=>confirmed.some(p=>p.id===id)),...confirmed.filter(p=>p.employment==='CENTER_RESERVE').map(p=>p.id)];
  const retained=a.proposed.filter(id=>!a.expired.includes(id)&&candidates.some(p=>p.id===id));
  const provisional=candidates.filter(p=>!s.jobs.some(other=>other.id!==j.id&&other.status==='OPEN'&&other.attendance?.proposed.includes(p.id)&&overlaps(j,other))).map(p=>p.id);
  const ordered=a.cutoffAt?[...kept,...confirmed.map(p=>p.id),...retained,...provisional]:[...kept,...retained,...provisional];
  const confirmedReserves=(j.reserveSlots??[]).filter(slot=>j.reserveAttendance?.[slot]==='ATTENDING').length;
  a.proposed=[...new Set(ordered)].filter(id=>!a.expired.includes(id)&&j.responses[id]!=='DECLINED').slice(0,Math.max(0,j.count-(j.borrowedNames?.length??0)-confirmedReserves));
 }
 j.assigned=a.proposed.filter(id=>confirmed.some(p=>p.id===id));
 reconcileReserveSlots(s,j,now);
 for(const id of oldAssigned.filter(id=>!j.assigned.includes(id)))notice(s,j,id,'CANCELLED',now);
 for(const id of oldProposed.filter(id=>!a.proposed.includes(id)&&!oldAssigned.includes(id)&&!a.expired.includes(id)))notice(s,j,id,'CANCELLED',now);
 for(const id of a.proposed.filter(id=>!oldProposed.includes(id)&&!j.assigned.includes(id)))notice(s,j,id,'PROPOSED',now);
 for(const id of j.assigned.filter(id=>!oldAssigned.includes(id)))notice(s,j,id,'ASSIGNED',now);
 if(JSON.stringify({...a,reviewedAt:undefined,reviewedBy:undefined})!==JSON.stringify({...JSON.parse(before),reviewedAt:undefined,reviewedBy:undefined})||oldAssigned.join('|')!==j.assigned.join('|')||oldReserves!==(j.reserveSlots??[]).join('|')){delete a.reviewedAt;delete a.reviewedBy;}
}
export function reviewAttendance(j:LaborJob,operator:string,now:string){
 if(j.status!=='OPEN'||!j.attendance?.cutoffAt)throw Error('작업 2일 전 자동 점검 후 확인할 수 있습니다.');
 j.attendance.reviewedAt=now;j.attendance.reviewedBy=operator;
}
export function completeJob(s:LaborOps,jobId:string,worked:string[],now:string,reserveWorked:string[]=[]){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='OPEN')throw Error('근무 완료 가능한 작업이 아닙니다.');
 if(Date.parse(now)<Date.parse(j.date+'T00:00:00+09:00')+(j.startMinute+j.durationMinutes)*60000)throw Error('근무 종료 시각 이후에 기록하세요.');
 if(new Set(worked).size!==worked.length||worked.some(id=>!j.assigned.includes(id)))throw Error('실제 근무자를 배정 명단에서 확인하세요.');
 if(new Set(reserveWorked).size!==reserveWorked.length||reserveWorked.some(id=>!j.reserveSlots?.includes(id)))throw Error('직접고용 투입 기록을 확인하세요.');
 j.reserveWorked=reserveWorked;
 j.employmentSnapshot=Object.fromEntries(worked.map(id=>[id,s.people.find(p=>p.id===id)?.employment??'VOLUNTEER']));
 j.worked=worked;j.status='COMPLETED';j.completedAt=now;
}
export function recordWorkException(s:LaborOps,entry:LaborWorkException){
 const job=s.jobs.find(j=>j.id===entry.jobId);
 if(!job||job.status!=='COMPLETED'||!job.worked.includes(entry.workerId))throw Error('완료된 실제 근무자의 기록만 정정할 수 있습니다.');
 if(!Number.isFinite(entry.halfDays)||entry.halfDays<0||entry.halfDays>2||!entry.reason.trim())throw Error('반나절 단위 근무량과 특수 사유를 확인하세요.');
 (s.workExceptions??=[]).push(entry);
}
export function addPenalty(s:LaborOps,jobId:string,workerId:string,points:number,reason:string,operator:string,now:string){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='COMPLETED'||!j.worked.includes(workerId))throw Error('근무 완료가 기록된 실제 근무자에게만 입력할 수 있습니다.');
 if(!Number.isInteger(points)||points<1||points>100||!reason.trim()||!operator.trim())throw Error('차감 점수·사유·담당자를 확인하세요.');
 s.penalties.push({id:crypto.randomUUID(),jobId,workerId,points,reason,operator,at:now});
 // Previously notified assignments stay stable. New scores apply to subsequent allocation events.
}
