import type {Prisma} from '@prisma/client';
import type {LaborOps} from './labor-operations';
import {applyAttendanceReview,type attendanceChange} from './labor-attendance-review';
import {absenceInput,recordLaborRecovery} from './labor-recovery-store';
import {currentLaborDemands} from './labor-demands';
import type {z} from 'zod';

/** Shared attendance validation for both the labor and message tables. */
export async function saveAttendanceChanges(tx:Prisma.TransactionClient,center:string,state:LaborOps,jobIds:string[],changes:z.infer<typeof attendanceChange>[],operator:string,now:string){
 const demands=await currentLaborDemands(tx,center);
 for(const id of jobIds){
  const job=state.jobs.find(j=>j.id===id),demand=demands.find(d=>d.id===job?.missionId&&d.sourceHash===job.sourceHash);
  if(!job||!demand||demand.held||demand.completed)throw Error('작업 일정이 변경되었습니다. 명단을 다시 불러오세요.');
 }
 for(const change of changes.filter(c=>c.response==='DECLINED'&&!c.personId.startsWith('reserve:'))){
  const job=state.jobs.find(j=>j.id===change.jobId);
  if(job?.assigned.includes(change.personId))await recordLaborRecovery(tx,absenceInput(crypto.randomUUID(),center,change.personId,state.people.find(p=>p.id===change.personId)!.name,job,'담당자가 불참 답신 확인',operator));
 }
 applyAttendanceReview(state,jobIds,changes,now);
 for(const job of state.jobs.filter(j=>jobIds.includes(j.id)))if(job.attendance){job.attendance.reviewedAt=now;job.attendance.reviewedBy=operator;}
}
