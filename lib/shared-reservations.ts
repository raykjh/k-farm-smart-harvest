import {z} from 'zod';
import type {Prisma} from '@prisma/client';
const instant=z.string().datetime({offset:true});
export const reservationSchema=z.object({id:z.string().min(1),centerId:z.string().min(1),resourceId:z.string().min(1),taskId:z.string().min(1),from:instant,to:instant}).strict().refine(x=>Date.parse(x.from)<Date.parse(x.to),'예약 종료 시각 확인 필요');
export type SharedReservation=z.infer<typeof reservationSchema>;
export function validateReservations(batch:SharedReservation[],existing:SharedReservation[]){
 const checked=batch.map(x=>reservationSchema.parse(x));
 if(new Set(checked.map(x=>x.id)).size!==checked.length)throw Error('예약 ID 중복');
 const all=[...existing];
 for(const r of checked){
  if(all.some(x=>x.id===r.id))throw Error('기존 예약은 명시적으로 변경해야 합니다.');
  if(all.some(x=>x.resourceId===r.resourceId&&Date.parse(x.from)<Date.parse(r.to)&&Date.parse(r.from)<Date.parse(x.to)))throw Error('센터 간 자원 예약 충돌');
  all.push(r);
 }
 return checked;
}
/** Call INSIDE the same transaction that saves the approved plan.
 * All writers must use this lock, including replacement/cancellation paths.
 * Approval/ownership authorization belongs to the caller, not the AI.
 */
export async function reserveSharedResources(tx:Prisma.TransactionClient,batch:SharedReservation[]){
 const parsed=batch.map(x=>reservationSchema.parse(x));
 for(const id of [...new Set(parsed.map(x=>x.resourceId))].sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${id}`}, 0))`;
 const rows=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
 const checked=validateReservations(parsed,rows.map(x=>reservationSchema.parse(x.payload)));
 for(const r of checked)await tx.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:r.id,payload:r}});
 return checked;
}
