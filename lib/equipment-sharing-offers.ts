import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import type {Principal} from './auth';
import type {State} from './types';
import {geographicNeighbors} from './center-adjacency';
import {lockCenterPool} from './center-resources';
import type {EquipmentLoan} from './center-sharing';
import {recordResourceNotice} from './center-resource-notices';
import {sameEquipmentKind} from './equipment-code';
// Exclusive equipment day; deduct outbound/loading/return time from work hours.
export const sharingOfferSchema=z.object({id:z.string().uuid(),version:z.number().int().nonnegative(),machineId:z.string().min(1),borrowerCenterId:z.string().min(1),
 from:z.string().date(),to:z.string().date(),compatibleMachineIds:z.array(z.string().min(1)).min(1).max(100),
 outboundSlots:z.number().int().min(0).max(16),returnSlots:z.number().int().min(0).max(16),
 agreementRef:z.string().trim().min(1).max(300),conditions:z.string().trim().min(1).max(500),
 operatorConfirmed:z.literal(true),transportConfirmed:z.literal(true),noExtraApprovalRequired:z.literal(true),enabled:z.boolean(),
}).strict().refine(v=>v.from<=v.to&&Date.parse(v.to)-Date.parse(v.from)<=366*86400000&&v.outboundSlots+v.returnSlots<32,'공유 기간(최대 1년)·이동 시간을 확인하세요.');
export type SharingOffer=z.infer<typeof sharingOfferSchema>&{ownerCenterId:string};
export type ResourceBlock={machineId:string;date:string};
export async function saveSharingOffer(tx:Prisma.TransactionClient,raw:unknown,actor:Principal){
 const b=sharingOfferSchema.parse(raw);if(actor.role!=='CENTER_ADMIN'||!actor.centerId)throw Error('소유 센터 관리자 권한 필요');
 await lockCenterPool(tx);
 const row=await tx.center.findUniqueOrThrow({where:{id:actor.centerId}}),s=row.state as unknown as State;
 const m=s.machines.find(m=>m.id===b.machineId&&(!m.ownerCenterId||m.ownerCenterId===actor.centerId));
 if(!m)throw Error('소유 장비만 사전 공유를 설정할 수 있습니다.');
 if(b.enabled&&b.borrowerCenterId!==actor.centerId&&!(await geographicNeighbors(tx,actor.centerId)).includes(b.borrowerCenterId))throw Error('면 경계가 직접 인접한 센터만 공유할 수 있습니다.');
 const borrower=await tx.center.findUniqueOrThrow({where:{id:b.borrowerCenterId}}),targets=(borrower.state as unknown as State).machines;
 if(b.enabled&&b.compatibleMachineIds.some(id=>!targets.some(t=>t.id===id&&sameEquipmentKind(t,m)&&Number.isFinite(m.capacityHaHour)&&m.capacityHaHour>0&&t.capacityHaHour>0)))throw Error('호환 대상으로 지정한 장비의 종류·처리능력을 확인하세요.');
 if(b.borrowerCenterId!==actor.centerId&&(!b.outboundSlots||!b.returnSlots))throw Error('인근 센터 이동·상하차·복귀 시간을 입력하세요.');
 const key={workspace:'shared',kind:'equipmentSharingOffer',id:b.id},old=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
 if((old?.version??0)!==b.version)throw Error('공유 조건이 변경되었습니다. 다시 확인하세요.');
 if(old&&((old.payload as any).ownerCenterId!==actor.centerId||(old.payload as any).machineId!==b.machineId||(old.payload as any).borrowerCenterId!==b.borrowerCenterId))throw Error('공유 식별정보를 변경할 수 없습니다.');
 const otherOffers=await tx.workRecord.findMany({where:{workspace:'shared',kind:'equipmentSharingOffer'}});
 if(b.enabled&&otherOffers.some(r=>r.id!==b.id&&(r.payload as any).enabled&&(r.payload as any).machineId===b.machineId&&(r.payload as any).borrowerCenterId===b.borrowerCenterId))throw Error('같은 장비·사용 센터의 기존 사전 허용을 중단한 뒤 새 조건을 저장하세요.');
 const offer={...b,version:b.version+1,ownerCenterId:actor.centerId};
 await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,version:offer.version,payload:offer},update:{version:offer.version,payload:offer}});
 await tx.audit.create({data:{centerId:actor.centerId,action:'equipment.sharingOffer',detail:{actorId:actor.id,offer}}});return {offer};
}
/** Only under all-center locks after independent plan verification. */
export async function commitAutomaticLoans(tx:Prisma.TransactionClient,s:State,assignments:{id:string;start:number;resource?:string|null}[],choices:{id:string;options?:{resource:string|null;offerId?:string}[]}[],dateOf:(slot:number)=>string,proposalId:string){
 const sharing=s.centerSharing;if(!sharing)return;const created=new Set<string>();
 for(const a of assignments){
  const option=choices.find(t=>t.id===a.id)?.options?.find(o=>o.resource===a.resource);
  if(!option?.offerId||!a.resource)continue;
  const offer=sharing.offers?.find(o=>o.id===option.offerId);if(!offer)throw Error('사전 공유 조건 만료');
  if(offer.ownerCenterId===sharing.centerId)continue;
  const date=dateOf(a.start),keyId=`auto:${proposalId}:${a.resource}:${date}`;
  if(created.has(keyId))continue;created.add(keyId);
  if(sharing.loans.some(l=>l.machineId===a.resource&&l.status==='CONFIRMED'&&l.usableFrom<=date&&date<=l.usableUntil))continue;
  const loan:EquipmentLoan={id:crypto.randomUUID(),machineId:a.resource,ownerCenterId:offer.ownerCenterId,borrowerCenterId:sharing.centerId,usableFrom:date,usableUntil:date,status:'CONFIRMED',operatorConfirmed:true,transportConfirmed:true};
  await tx.workRecord.create({data:{workspace:'shared',kind:'equipmentLoan',id:loan.id,payload:loan}});sharing.loans.push(loan);
  await recordResourceNotice(tx,`loan:${loan.id}:1`,{event:'CONFIRMED',loanId:loan.id,machineId:loan.machineId,ownerCenterId:loan.ownerCenterId,borrowerCenterId:loan.borrowerCenterId,from:date,to:date,reason:'사전 공유 조건에 따른 계획 일괄 승인'});
  await tx.audit.create({data:{centerId:sharing.centerId,action:'equipmentLoan.automatic',detail:{proposalId,offerId:offer.id,offerVersion:offer.version,agreementRef:offer.agreementRef,conditions:offer.conditions,loan}}});
 }
}
