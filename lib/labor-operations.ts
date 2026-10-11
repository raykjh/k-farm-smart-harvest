import {z} from 'zod';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const workerSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(60),birth:date,phone:z.string().trim().min(1).max(30),address:z.string().trim().min(1).max(200),registeredFarmer:z.boolean(),usesApp:z.boolean(),weekdays:z.array(z.number().int().min(0).max(6)).max(7),preferredDates:z.array(date).max(366),excludedDates:z.array(date).max(366),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),workCodes:z.array(z.string().min(1).max(40)).min(1).max(30),active:z.boolean(),employment:z.enum(['VOLUNTEER','CENTER_RESERVE']).optional(),standbyDates:z.array(date).max(366).optional()}).strict().refine(p=>p.startMinute<p.endMinute,'가능 시간 확인 필요');
export type Worker=z.infer<typeof workerSchema>;
export type LaborJob={borrowedNames?:string[];id:string;missionId:string;task:string;address:string;date:string;startMinute:number;durationMinutes:number;count:number;workCode:string;sourceHash:string;pay:string;status:'OPEN'|'COMPLETED'|'STALE';invited:string[];responses:Record<string,'APP'|'PHONE'|'DECLINED'|'STANDBY'>;distances:Record<string,number|null>;assigned:string[];manual:string[]|null;worked:string[];completedAt?:string};
export const assignedWorkerCount=(j:LaborJob|undefined)=>j?j.assigned.length+(j.borrowedNames?.length??0):0;
export type LaborOps={externalBusy?:{workerId:string;date:string;startMinute:number;durationMinutes:number}[];people:Worker[];jobs:LaborJob[];penalties:{id:string;jobId:string;workerId:string;points:number;reason:string;operator:string;at:string}[];notices:{id:string;jobId:string;workerId:string;type:'INVITE'|'ASSIGNED'|'CANCELLED'|'RECONFIRM';channel:'APP'|'SMS_PHONE';body:string;at:string;status:'MOCK_RECORDED'}[]};
export const emptyLaborOps=():LaborOps=>({people:[],jobs:[],penalties:[],notices:[]});
export const laborScore=(s:LaborOps,id:string)=>Math.max(0,100-s.penalties.filter(p=>p.workerId===id).reduce((n,p)=>n+p.points,0));
export function availableFor(p:Worker,j:LaborJob){return p.active&&!p.excludedDates.includes(j.date)&&(p.preferredDates.includes(j.date)||p.weekdays.includes(new Date(j.date+'T00:00:00Z').getUTCDay()))&&p.startMinute<=j.startMinute&&p.endMinute>=j.startMinute+j.durationMinutes&&(p.workCodes.includes('*')||p.workCodes.includes(j.workCode));}
const overlaps=(a:LaborJob,b:LaborJob)=>a.date===b.date&&a.startMinute<b.startMinute+b.durationMinutes&&b.startMinute<a.startMinute+a.durationMinutes;
export function canAssign(s:LaborOps,j:LaborJob,p:Worker){return availableFor(p,j)&&j.invited.includes(p.id)&&(p.employment==='CENTER_RESERVE'?j.responses[p.id]==='STANDBY'&&!!p.standbyDates?.includes(j.date):['APP','PHONE'].includes(j.responses[p.id]))&&!s.jobs.some(other=>other.id!==j.id&&other.status!=='STALE'&&other.assigned.includes(p.id)&&overlaps(j,other))&&!s.externalBusy?.some(b=>b.workerId===p.id&&b.date===j.date&&b.startMinute<j.startMinute+j.durationMinutes&&j.startMinute<b.startMinute+b.durationMinutes);}
export function rankedWorkers(s:LaborOps,j:LaborJob){return s.people.filter(p=>canAssign(s,j,p)).sort((a,b)=>Number(b.employment==='CENTER_RESERVE')-Number(a.employment==='CENTER_RESERVE')||laborScore(s,b.id)-laborScore(s,a.id)||(j.distances[a.id]??Infinity)-(j.distances[b.id]??Infinity)||a.id.localeCompare(b.id));}
export function notice(s:LaborOps,j:LaborJob,id:string,type:LaborOps['notices'][number]['type'],now:string){
 const worker=s.people.find(p=>p.id===id);if(!worker)return;
 s.notices.push({id:crypto.randomUUID(),jobId:j.id,workerId:id,type,channel:worker.usesApp?'APP':'SMS_PHONE',body:`${type==='RECONFIRM'?'일정 변경 · 참석 재확인':type==='INVITE'?'참석 의사 확인':type==='ASSIGNED'?'배정 안내':'배정 취소'}: ${j.date} ${String(Math.floor(j.startMinute/60)).padStart(2,'0')}:${String(j.startMinute%60).padStart(2,'0')} · ${j.task} · ${j.address} · ${j.durationMinutes}분 · ${j.pay}`,at:now,status:'MOCK_RECORDED'});
}
export function allocateJob(s:LaborOps,j:LaborJob,now:string){
 if(j.status!=='OPEN')return;
 const before=[...j.assigned],ranked=rankedWorkers(s,j);
 j.assigned=j.manual===null?ranked.slice(0,j.count).map(p=>p.id):j.manual.filter(id=>ranked.some(p=>p.id===id)).slice(0,j.count);
 for(const id of before.filter(id=>!j.assigned.includes(id)))notice(s,j,id,'CANCELLED',now);
 for(const id of j.assigned.filter(id=>!before.includes(id)))notice(s,j,id,'ASSIGNED',now);
}
export function respond(s:LaborOps,jobId:string,id:string,response:'APP'|'PHONE'|'DECLINED',now:string){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='OPEN'||!j.invited.includes(id))throw Error('모집 안내 대상 및 상태를 확인하세요.');
 if(s.people.find(p=>p.id===id)?.employment==='CENTER_RESERVE'&&response!=='DECLINED')throw Error('센터 대기 인력은 확인된 대기근무를 통해 투입합니다.');
 const lost=j.assigned.includes(id)&&response==='DECLINED';
 j.responses[id]=response;if(lost)activateStandby(s,j);
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
 if(ids&&(new Set(ids).size!==ids.length||ids.length>j.count||ids.some(id=>!rankedWorkers(s,j).some(p=>p.id===id))))throw Error('참석·가능 시간·중복 배정·필요 인원을 확인하세요.');
 j.manual=ids;
 if(ids===null&&j.assigned.length<j.count&&Object.values(j.responses).includes('DECLINED'))activateStandby(s,j);
 allocateJob(s,j,now);
}
export function completeJob(s:LaborOps,jobId:string,worked:string[],now:string){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='OPEN')throw Error('근무 완료 가능한 작업이 아닙니다.');
 if(Date.parse(now)<Date.parse(j.date+'T00:00:00+09:00')+(j.startMinute+j.durationMinutes)*60000)throw Error('근무 종료 시각 이후에 기록하세요.');
 if(new Set(worked).size!==worked.length||worked.some(id=>!j.assigned.includes(id)))throw Error('실제 근무자를 배정 명단에서 확인하세요.');
 j.worked=worked;j.status='COMPLETED';j.completedAt=now;
}
export function addPenalty(s:LaborOps,jobId:string,workerId:string,points:number,reason:string,operator:string,now:string){
 const j=s.jobs.find(j=>j.id===jobId);if(!j||j.status!=='COMPLETED'||!j.worked.includes(workerId))throw Error('근무 완료가 기록된 실제 근무자에게만 입력할 수 있습니다.');
 if(!Number.isInteger(points)||points<1||points>100||!reason.trim()||!operator.trim())throw Error('차감 점수·사유·담당자를 확인하세요.');
 s.penalties.push({id:crypto.randomUUID(),jobId,workerId,points,reason,operator,at:now});
 // Previously notified assignments stay stable. New scores apply to subsequent allocation events.
}
