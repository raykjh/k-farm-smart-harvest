import {centerId as activeCenterId} from './workspace';
import type {Prisma} from '@prisma/client';
import type {State} from './types';
/** Restore only cancelled resource/date references for calculation; no DB mutation. */
export async function resumeReservationState(tx:Pick<Prisma.TransactionClient,'workRecord'>,state:State,ids:string[]){
 const next=structuredClone(state);
 for(const m of next.missions.filter(m=>ids.includes(m.id)&&!m.scheduledDate)){
  if(m.status!=='HELD')throw Error('예약 취소로 보류된 작업만 재배정할 수 있습니다.');
  const records=await tx.workRecord.findMany({where:{workspace:'shared',kind:'cancelledReservation'},orderBy:{updatedAt:'desc'}});
  const record=records.map(r=>r.payload as any).find(r=>r.reservation?.centerId===activeCenterId()&&r.reservation?.taskId===m.id&&r.before);
  if(!record||!record.before.scheduledDate||!record.before.resourceId)throw Error('취소 이전 장비·일정 확인이 필요합니다.');
  m.scheduledDate=record.before.scheduledDate;m.resourceId=record.before.resourceId;m.start=record.before.start;
  Object.assign(m,{resumingCancelledReservation:true});
 }
 return next;
}
