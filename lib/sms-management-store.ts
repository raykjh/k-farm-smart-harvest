import {z} from 'zod';
import {db} from './db';
import {recordSpace} from './workspace';
import {readSms,SMS_KIND,prepareSms} from './sms-store';
import {messageStatuses,messageDay,type ManagedSms,type MessageStatus} from './sms-management';
import {emptyLaborOps,advanceAttendance,type LaborOps} from './labor-operations';
import {laborSharingLock,externalLaborBusy,sharedLaborRows,reconcileLaborShares,type LaborShare} from './labor-sharing';
import {laborPoliciesForDates} from './labor-policy-store';
import {assertCapacityRoster} from './labor-capacity-store';
import {refreshLaborRecoveries} from './labor-recovery-store';
import {saveAttendanceChanges} from './labor-attendance-save';
import {currentLaborDemands} from './labor-demands';
import {type SmsMessage} from './sms-policy';
import type {Principal} from './auth';
import {isCenterOperator} from './auth-policy';
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
type Review={status:MessageStatus;actorId:string;at:string;source:'MANUAL'};
type StoredMessage=SmsMessage&{review?:Review;resendRequestedAt?:string};
const key=(center:string)=>({workspace:recordSpace(center),kind:'laborOperations',id:'current'});
function response(state:LaborOps,message:SmsMessage){
 const job=state.jobs.find(j=>j.id===message.jobId),id=message.recipient.id;
 if(!job)return undefined;
 return id.startsWith('reserve:')?job.reserveAttendance?.[id.slice(8)]:job.responses[id]==='DECLINED'?'DECLINED':job.responses[id]?'ATTENDING':undefined;
}
export async function readManagedSms(center:string):Promise<ManagedSms[]>{
 const [messages,labor]=await Promise.all([readSms(center),db.workRecord.findUnique({where:{workspace_kind_id:key(center)}})]);
 const state=(labor?.payload??emptyLaborOps()) as unknown as LaborOps;
 const latest=new Map<string,typeof messages[number]>();
 for(const m of messages.filter(m=>m.status!=='SUPERSEDED'||!!(m as StoredMessage).review).sort((a,b)=>Number(a.status==='SUPERSEDED')-Number(b.status==='SUPERSEDED')||b.createdAt.localeCompare(a.createdAt))){const id=JSON.stringify([m.jobId,m.recipient.id]);if(!latest.has(id))latest.set(id,m);}
 return [...latest.values()].map(m=>{
  const stored=m as StoredMessage,reply=response(state,m),status=reply??stored.review?.status??(['SIMULATED','SENT'].includes(m.status)?'SENT':m.status==='FAILED'||m.status==='BLOCKED'?'FAILED':'QUEUED');
  const job=state.jobs.find(j=>j.id===m.jobId),editable=!!job&&job.status==='OPEN'&&Date.parse(job.date+'T00:00:00+09:00')+job.startMinute*60000>Date.now();
  return {...m,editable,workDate:job?.date??'',sendDate:messageDay(m.processedAt??m.scheduledAt),managementStatus:status,laborVersion:labor?.version??0};
 });
}
export const messageEdit=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),version:z.number().int().positive(),laborVersion:z.number().int().nonnegative(),status:z.enum(messageStatuses),requestId:z.string().uuid()}).strict();
export const messageResend=messageEdit.omit({status:true,laborVersion:true});
export async function manageMessage(actor:Principal,input:z.infer<typeof messageEdit>|z.infer<typeof messageResend>,action:'review'|'resend'){
 if(!isCenterOperator(actor))throw Error('센터 업무 권한이 필요합니다.');
 const center=actor.centerId,now=new Date().toISOString();
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${center} FOR UPDATE`;
  await laborSharingLock(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace(center)}`}))`;
  const receiptKey={workspace:recordSpace(center),kind:'smsManagementReceipt',id:input.requestId};
  const receipt=await tx.workRecord.findUnique({where:{workspace_kind_id:receiptKey}});
  const signature=JSON.stringify([action,input.id,input.version,'status' in input?input.status:null,'laborVersion' in input?input.laborVersion:null]);
  if(receipt){const old=receipt.payload as any;if(old.signature!==signature||old.actorId!==actor.id)throw Error('이미 다른 내용으로 저장한 요청입니다.');return old.result;}
  const messageKey={workspace:recordSpace(center),kind:SMS_KIND,id:input.id},row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:messageKey}}),message=row.payload as unknown as StoredMessage;
  if(row.version!==input.version||message.recipient.type!=='WORKER'||message.status==='SUPERSEDED'&&!(action==='review'&&message.review&&'status' in input&&['ATTENDING','DECLINED'].includes(input.status)))throw Error('문자 내용이 변경되었습니다. 다시 불러오세요.');
  const labor=await tx.workRecord.findUnique({where:{workspace_kind_id:key(center)}}),state=(labor?.payload??emptyLaborOps()) as unknown as LaborOps;
  const job=state.jobs.find(j=>j.id===message.jobId),demands=await currentLaborDemands(tx,center);
  if(!job||job.status!=='OPEN'||!demands.some(d=>d.id===job.missionId&&d.sourceHash===job.sourceHash&&!d.held&&!d.completed)||Date.parse(job.date+'T00:00:00+09:00')+job.startMinute*60000<=Date.now())throw Error('진행 전의 현재 작업 문자만 변경할 수 있습니다.');
  const latest=state.notices.filter(n=>n.jobId===message.jobId&&n.workerId===message.recipient.id).at(-1);
  if(!message.recipient.id.startsWith('reserve:')&&message.noticeId!==latest?.id&&!(action==='review'&&message.review&&'status' in input&&['ATTENDING','DECLINED'].includes(input.status)))throw Error('새 안내가 있습니다. 다시 불러오세요.');
  if(action==='review'&&'status' in input){
   if((labor?.version??0)!==input.laborVersion)throw Error('참석 명단이 변경되었습니다. 다시 불러오세요.');
   if(['ATTENDING','DECLINED'].includes(input.status)){
    const policies=await laborPoliciesForDates(tx,center,state.jobs.filter(j=>j.status==='OPEN').map(j=>j.date));
    state.reserveCapacityByYear=Object.fromEntries(Object.entries(policies).map(([year,p])=>[year,p.policy?.reserveCount??3]));
    state.externalBusy=await externalLaborBusy(tx,center);
    const incoming=(await sharedLaborRows(tx)).map(r=>r.payload as unknown as LaborShare).filter(s=>s.borrowerCenterId===center&&s.status==='ASSIGNED');
    for(const j of state.jobs){j.borrowedNames=incoming.filter(s=>s.jobId===j.id&&s.sourceHash===j.sourceHash).map(s=>s.workerName);if(demands.some(d=>d.id===j.missionId&&d.sourceHash===j.sourceHash&&!d.held&&!d.completed))advanceAttendance(state,j,now);}
    await saveAttendanceChanges(tx,center,state,[job.id],[{jobId:job.id,personId:message.recipient.id,response:input.status as 'ATTENDING'|'DECLINED'}],`${actor.name} [${actor.id}]`,now);
    delete state.externalBusy;for(const j of state.jobs)delete j.borrowedNames;
    await assertCapacityRoster(tx,center,state);
    await tx.workRecord.update({where:{workspace_kind_id:key(center)},data:{version:{increment:1},payload:json(state)}});
    await reconcileLaborShares(tx);await refreshLaborRecoveries(tx,center);
   }else if(response(state,message))throw Error('이미 확인한 참석 여부는 참석확인 또는 미참석확인으로 수정하세요.');
   if(input.status==='SENT'){message.status='SENT';message.processedAt=now;delete message.lastError;}
   if(input.status==='FAILED')message.status='FAILED';
   if(input.status==='QUEUED')message.status=message.recipient.phone.trim()?'QUEUED':'BLOCKED';
   message.review={status:input.status,at:now,actorId:actor.id,source:'MANUAL'};
  }else{
   if(!message.recipient.phone.trim())throw Error('인력관리에서 연락처를 먼저 등록하세요.');
   message.resendRequestedAt=now;
   // A provider worker may consume this request later. Never fabricate delivery.
   await tx.workRecord.create({data:{workspace:recordSpace(center),kind:'smsResendRequest',id:input.requestId,payload:{messageId:message.id,at:now,status:'WAITING_PROVIDER',actorId:actor.id}}});
  }
  await tx.workRecord.update({where:{workspace_kind_id:messageKey},data:{version:{increment:1},payload:json(message)}});
  if(action==='review'&&'status' in input&&['ATTENDING','DECLINED'].includes(input.status))await prepareSms(tx,center,now);
  const result={ok:true,action,realMessages:0,...(action==='resend'?{delivery:'WAITING_PROVIDER'}:{})};
  await tx.workRecord.create({data:{...receiptKey,payload:json({signature,actorId:actor.id,result})}});
  await tx.audit.create({data:{centerId:center,action:'sms.'+action,detail:json({actorId:actor.id,messageId:input.id,before:row.payload,after:message,requestId:input.requestId,realMessages:0})}});
  return result;
 },{timeout:20000});
}
