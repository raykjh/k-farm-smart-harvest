import {createHash} from 'node:crypto';
import type {State} from './types';
import type {LaborOps} from './labor-operations';
import {ordinaryWorkerDemand} from './planned-labor-demand';

// Retain the persisted identifier so existing worker notices are not re-sent.
// Owner fields below are read-only compatibility for the historical ledger.
export const SMS_POLICY='owner-five-days-labor-seven-two-v1';
export type OwnerWork={missionId:string;fieldId:string;address:string;crop:string;task:string;date:string};
export type SmsMessage={id:string;policy:typeof SMS_POLICY;recipient:{type:'OWNER'|'WORKER';id:string;name:string;phone:string};category:'WORK_PLANNED'|'WORK_CHANGED'|'LABOR';body:string;scheduledAt:string;status:'QUEUED'|'BLOCKED'|'FAILED'|'SIMULATED'|'SENT'|'SUPERSEDED';attempts:number;createdAt:string;processedAt?:string;deliverySequence?:number;lastError?:string;ownerItems?:OwnerWork[];removedIds?:string[];jobId?:string;noticeId?:string};
export type SmsMessageView=SmsMessage&{version:number;attemptHistory:{at:string;status:'FAILED'|'SIMULATED';attempt:number}[]};
export type SmsContact={name:string;phone:string};
// JSONB may reorder object keys; hashes compare meaning, never storage order.
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,canonical(value)])):v??null;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const day=(now:string)=>new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
export const noticeAt=(date:string,days:number)=>new Date(Date.parse(date+'T09:00:00+09:00')-days*86400000).toISOString();

/** Pure projection: no delivery, attendance confirmation, AI, or plan mutation. */
export function smsDrafts(state:State,labor:LaborOps,_legacyContacts:Map<string,SmsContact>,history:SmsMessage[],now:string):SmsMessage[]{
 const today=day(now),drafts:SmsMessage[]=[],fields=new Map(state.fields.map(f=>[f.id,f]));
 const missions=new Map(state.missions.map(m=>[m.id,m]));
 function add(value:Omit<SmsMessage,'id'|'policy'|'status'|'attempts'|'createdAt'>,revision:unknown){
  const id=digest([SMS_POLICY,value.recipient,value.category,value.body,value.ownerItems,value.removedIds,value.jobId,value.noticeId,revision]);
  drafts.push({...value,id,policy:SMS_POLICY,status:value.recipient.phone.trim()?'QUEUED':'BLOCKED',attempts:0,createdAt:now,...(!value.recipient.phone.trim()?{lastError:'등록 연락처 확인 필요'}:{})});
 }
 // Only the latest notice for a worker/job is still actionable. Never replay
 // obsolete invitations or infer that a sent message means accepted attendance.
 const latest=new Map<string,LaborOps['notices'][number]>();for(const n of labor.notices)latest.set(JSON.stringify([n.jobId,n.workerId]),n);
 for(const n of latest.values()){
  const p=labor.people.find(p=>p.id===n.workerId),j=labor.jobs.find(j=>j.id===n.jobId);if(!p||!j||j.date<today)continue;
  const closing=n.type==='CANCELLED'||n.type==='EXPIRED';
  const m=missions.get(j.missionId),f=fields.get(m?.fieldId??'');
  const currentJob=m&&f&&f.serviceStatus!=='WITHDRAWN'&&m.status==='PLANNED'&&m.scheduledDate===j.date&&m.label===j.task&&f.address===j.address&&480+((m.start%32+32)%32)*15===j.startMinute&&m.duration*15===j.durationMinutes&&ordinaryWorkerDemand(m)===j.count;
  if(!closing&&(!currentJob||j.status!=='OPEN'||!p.active||!j.invited.includes(p.id)||j.responses[p.id]==='DECLINED'||j.attendance?.expired.includes(p.id)))continue;
  // For automatic recruitment, contact selected nominees only, not every
  // registered candidate. An operator's unsaved preview never creates notices.
  if(!closing&&j.attendance&&!j.attendance.proposed.includes(p.id)&&!j.assigned.includes(p.id))continue;
  if(closing&&!history.some(h=>(h.status==='SIMULATED'||h.status==='SENT')&&h.jobId===j.id&&h.recipient.type==='WORKER'&&h.recipient.id===p.id))continue;
  if(history.some(h=>(h.status==='SIMULATED'||h.status==='SENT')&&h.noticeId===n.id))continue;
  add({recipient:{type:'WORKER',id:p.id,name:p.name,phone:p.phone},category:'LABOR',body:`[${state.name}] ${n.body}\n${closing?'문의 사항은 센터로 연락해주세요.':'참석 여부는 문자 답장 또는 센터에 전화로 알려주세요.'}`,scheduledAt:closing?n.at:new Date(Math.max(Date.parse(n.at),Date.parse(noticeAt(j.date,7)))).toISOString(),jobId:j.id,noticeId:n.id},n.id);
 }
 // Registered regular employees use stable roster slots. Capacity alone is not
 // a recipient: both name and contact must exist, and no reply is fabricated.
 for(const j of labor.jobs){
  if(j.date<today)continue;
  const m=missions.get(j.missionId),f=fields.get(m?.fieldId??'');
  const current=j.status==='OPEN'&&m&&f&&f.serviceStatus!=='WITHDRAWN'&&m.status==='PLANNED'&&m.scheduledDate===j.date&&m.label===j.task&&f.address===j.address&&480+((m.start%32+32)%32)*15===j.startMinute&&m.duration*15===j.durationMinutes&&ordinaryWorkerDemand(m)===j.count;
  const prior=history.filter(h=>h.jobId===j.id&&h.recipient.type==='WORKER'&&h.recipient.id.startsWith('reserve:'));
  const slots=new Set([...(j.reserveSlots??[]),...prior.filter(h=>(h.status==='SIMULATED'||h.status==='SENT')).map(h=>h.recipient.id.slice(8))]);
  for(const slot of slots){
   const id='reserve:'+slot,p=labor.reserveRoster?.profiles[slot]??j.reservePeople?.[slot];if(!p?.name||!p.phone)continue;
   const closing=!current||!j.reserveSlots?.includes(slot)||j.reserveAttendance?.[slot]==='DECLINED';
   const kind=closing?'CANCELLED':j.reserveAttendance?.[slot]==='ATTENDING'?'ASSIGNED':'PROPOSED';
   if(closing&&!prior.some(h=>(h.status==='SIMULATED'||h.status==='SENT')&&h.recipient.id===id))continue;
   const noticeId=['reserve',j.id,j.sourceHash,slot,kind].join(':');if(prior.some(h=>(h.status==='SIMULATED'||h.status==='SENT')&&h.noticeId===noticeId))continue;
   const body=`[${state.name}] ${closing?'배정 취소':kind==='ASSIGNED'?'배정 확정 안내':'참석 확답 요청'}: ${j.date} · ${j.task} · ${j.address}\n${closing?'문의 사항은 센터로 연락해주세요.':'참석 여부는 문자 답장 또는 센터에 전화로 알려주세요.'}`;
   add({recipient:{type:'WORKER',id,...p},category:'LABOR',body,scheduledAt:prior.find(h=>h.noticeId===noticeId)?.scheduledAt??new Date(Math.max(Date.parse(now),Date.parse(noticeAt(j.date,7)))).toISOString(),jobId:j.id,noticeId},noticeId);
  }
 }
 return drafts;
}
