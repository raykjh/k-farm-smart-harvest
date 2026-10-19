import type {Prisma} from '@prisma/client';
import {db} from './db';
import {recordSpace} from './workspace';
import {emptyLaborOps,type LaborOps} from './labor-operations';
import type {State} from './types';
import {SMS_POLICY,smsDrafts,type SmsMessage,type SmsMessageView} from './sms-policy';
export const SMS_KIND='smsMessage';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
async function rows(tx:Prisma.TransactionClient,center:string){return tx.workRecord.findMany({where:{workspace:recordSpace(center),kind:SMS_KIND}})}
/** Caller holds its center lock. This queues messages; it never sends them. */
export async function prepareSms(tx:Prisma.TransactionClient,center:string,now=new Date().toISOString()){
 const c=await tx.center.findUniqueOrThrow({where:{id:center}}),s=c.state as unknown as State,old=await rows(tx,center);
 const labor=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(center),kind:'laborOperations',id:'current'}}});
 const desired=smsDrafts(s,(labor?.payload??emptyLaborOps()) as unknown as LaborOps,new Map(),old.map(r=>r.payload as unknown as SmsMessage),now),keys=new Set(desired.map(m=>m.id)),previous=new Map(old.map(r=>[r.id,r]));
 // The retired owner Outbox remains an internal record, never a send queue.
 await tx.outbox.updateMany({where:{centerId:center,status:{in:['PENDING','FAILED']}},data:{status:'RECORDED_ONLY'}});
 for(const row of old){const m=row.payload as unknown as SmsMessage;if(!keys.has(row.id)&&['QUEUED','BLOCKED','FAILED'].includes(m.status))await tx.workRecord.update({where:{workspace_kind_id:{workspace:row.workspace,kind:SMS_KIND,id:row.id}},data:{version:{increment:1},updatedAt:new Date(now),payload:json({...m,status:'SUPERSEDED',...(m.recipient.type==='OWNER'?{lastError:'소유주 문자 발송 중단'}:{})})}});}
 for(const m of desired){const row=previous.get(m.id),oldMessage=row?.payload as unknown as SmsMessage|undefined;
  if(!row)await tx.workRecord.create({data:{workspace:recordSpace(center),kind:SMS_KIND,id:m.id,payload:json(m)}});
  else if(oldMessage?.status==='SUPERSEDED')await tx.workRecord.update({where:{workspace_kind_id:{workspace:row.workspace,kind:SMS_KIND,id:m.id}},data:{version:{increment:1},updatedAt:new Date(now),payload:json({...m,attempts:oldMessage.attempts})}});
 }
 return {queued:desired.length,provider:'NOT_CONNECTED',realMessages:0};
}
export async function refreshSms(center:string,now=new Date().toISOString()){
 return db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${center} FOR UPDATE`;return prepareSms(tx,center,now)},{timeout:20000});
}
export async function readSms(center:string){
 const [all,attempts]=await Promise.all([db.workRecord.findMany({where:{workspace:recordSpace(center),kind:SMS_KIND},orderBy:{updatedAt:'desc'}}),db.workRecord.findMany({where:{workspace:recordSpace(center),kind:'smsAttempt'},orderBy:{updatedAt:'asc'}})]);
 const byMessage=new Map<string,SmsMessageView['attemptHistory']>();
 for(const row of attempts){const p=row.payload as any;byMessage.set(p.id,[...(byMessage.get(p.id)??[]),{at:p.at,status:p.result.status,attempt:p.result.attempts}]);}
 return all.filter(row=>(row.payload as unknown as SmsMessage).recipient.type==='WORKER').map(row=>({...row.payload as unknown as SmsMessage,version:row.version,attemptHistory:(byMessage.get(row.id)??[]).sort((a,b)=>a.attempt-b.attempt)}));
}
export async function simulateSms(center:string,input:{id:string;requestId:string;fail:boolean},now=new Date().toISOString()){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${center} FOR UPDATE`;
  const receipt={workspace:recordSpace(center),kind:'smsAttempt',id:input.requestId},old=await tx.workRecord.findUnique({where:{workspace_kind_id:receipt}});
  if(old){const p=old.payload as any;if(p.id!==input.id||p.fail!==input.fail)throw Error('다른 내용에 사용한 요청입니다.');return p.result;}
  await prepareSms(tx,center,now);
  const key={workspace:recordSpace(center),kind:SMS_KIND,id:input.id},row=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),m=row?.payload as unknown as SmsMessage|undefined;
  if(!m||m.recipient.type!=='WORKER'||m.policy!==SMS_POLICY||!['QUEUED','FAILED'].includes(m.status))throw Error('현재 발송 대기 중인 인력 문자를 선택하세요.');
  if(Date.parse(m.scheduledAt)>Date.parse(now))throw Error('아직 발송 예정일이 아닙니다.');
  if(m.attempts>=3)throw Error('3회 실패했습니다. 연락처와 안내 내용을 확인하세요.');
  const result={id:m.id,status:input.fail?'FAILED':'SIMULATED',provider:'MOCK_SMS',realMessages:0,attempts:m.attempts+1};
  const sequence=Math.max(0,...(await rows(tx,center)).map(r=>(r.payload as unknown as SmsMessage).deliverySequence??0))+1;
  await tx.workRecord.update({where:{workspace_kind_id:key},data:{version:{increment:1},updatedAt:new Date(now),payload:json({...m,status:result.status,attempts:result.attempts,processedAt:now,...(!input.fail?{deliverySequence:sequence}:{}),lastError:input.fail?'발송 실패 모의 검증':undefined})}});
  await tx.workRecord.create({data:{...receipt,payload:json({...input,at:now,result})}});
  return result;
 },{timeout:20000});
}
