import type {Prisma} from '@prisma/client';
import type {Principal} from './auth';
import {recordSpace} from './workspace';
export type CenterResourceNotice={
 id:string;event:'REQUESTED'|'CONFIRMED'|'CHANGED'|'CANCELLED'|'RETURNED'|'FAILURE';
 loanId?:string;machineId:string;ownerCenterId:string;borrowerCenterId:string;
 from:string;to?:string;reason?:string;createdAt:string;acknowledgedAt:string|null;acknowledgedBy?:string;
};
/** Internal center inbox only. This does not send SMS or issue equipment commands. */
export async function recordResourceNotice(tx:Prisma.TransactionClient,eventId:string,input:Omit<CenterResourceNotice,'id'|'createdAt'|'acknowledgedAt'|'acknowledgedBy'>){
 const payload:CenterResourceNotice={...input,id:eventId,createdAt:new Date().toISOString(),acknowledgedAt:null};
 for(const centerId of new Set([input.ownerCenterId,input.borrowerCenterId])){
  const key={workspace:recordSpace(centerId),kind:'centerResourceNotice',id:eventId};
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload},update:{}});
 }
}
export async function acknowledgeResourceNotice(tx:Prisma.TransactionClient,id:string,actor:Principal){
 if(!actor.centerId||actor.role==='SUPER_ADMIN')throw Error('소속 센터의 안내만 확인할 수 있습니다.');
 const key={workspace:recordSpace(actor.centerId),kind:'centerResourceNotice',id};
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`center-notice:${key.workspace}:${id}`}))`;
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
 if(!row)throw Error('해당 센터의 안내를 찾을 수 없습니다.');
 const p=row.payload as unknown as CenterResourceNotice;
 if(p.acknowledgedAt)return {ok:true,alreadyAcknowledged:true};
 await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:{...p,acknowledgedAt:new Date().toISOString(),acknowledgedBy:actor.id},version:{increment:1}}});
 return {ok:true};
}
