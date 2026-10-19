import {z} from 'zod';
import {db} from './db';
import {centerId,recordSpace} from './workspace';
import {readReport,saveExecutionInTransaction,RecordConflict,reportHash} from './execution-records';
import type {State} from './types';
import {actorLabel} from './auth';

// Authenticated integration contract. Importing a report is not a device command.
export const receivedResult=z.object({id:z.string().uuid(),missionId:z.string().min(1),expectedPlanVersion:z.number().int(),expectedEvidenceId:z.string().nullable().default(null),resourceId:z.string().min(1).nullable(),laborSource:z.enum(['REGISTERED','DIRECT_EMPLOYMENT']).optional(),startedAt:z.string().datetime({offset:true}),finishedAt:z.string().datetime({offset:true})}).strict();
export async function receiveWorkResult(input:unknown){
 const b=receivedResult.parse(input);
 if(!b.resourceId&&!b.laborSource||b.resourceId&&b.laborSource)throw Error('인력 결과에는 인력 구분을, 장비 결과에는 장비번호를 입력하세요.');
 return db.$transaction(async tx=>saveExecutionInTransaction(tx,{id:b.id,missionId:b.missionId,expectedPlanVersion:b.expectedPlanVersion,expectedEvidenceId:b.expectedEvidenceId,status:'COMPLETED',startedAt:b.startedAt,finishedAt:b.finishedAt,actor:'result integration',reason:'작업결과 수신'}, {type:b.resourceId?'EQUIPMENT_REPORT':'LABOR_REPORT',resourceId:b.resourceId,...(b.laborSource?{laborSource:b.laborSource}:{})}));
}
const correction=z.object({id:z.string().uuid(),missionId:z.string().min(1),expectedPlanVersion:z.number().int(),expectedEvidenceId:z.string().min(1),minutes:z.number().positive().max(1440),reason:z.string().trim().min(1).max(2000)}).strict();
export async function correctWorkDuration(input:unknown){
 const b=correction.parse(input);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${centerId()} FOR UPDATE`;
  const key={workspace:recordSpace(),kind:'workDurationCorrection',id:b.id},requestHash=reportHash({input:b,actor:actorLabel()});
  const receipt=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if(receipt){if((receipt.payload as any).requestHash!==requestHash)throw new RecordConflict('요청 ID가 다른 입력에 사용되었습니다.');return (receipt.payload as any).result;}
  const report=await readReport(tx),row=report.rows.find(r=>r.missionId===b.missionId);
  if(!row?.confirmed||row.evidenceId!==b.expectedEvidenceId||report.planVersion!==b.expectedPlanVersion)throw new RecordConflict('작업 이력이 변경되었습니다. 다시 불러오세요.');
  const old=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace(),kind:'taskExecutionAssessment',id:row.evidenceId}}}),p=old.payload as any;
  const start=p.actualStartedAt??p.simulatedStartedAt;
  if(!start)throw Error('수신된 작업 시작 정보가 없습니다.');
  const result=await saveExecutionInTransaction(tx,{id:b.id,missionId:b.missionId,expectedPlanVersion:b.expectedPlanVersion,expectedEvidenceId:b.expectedEvidenceId,status:'COMPLETED',startedAt:start,finishedAt:new Date(Date.parse(start)+b.minutes*60000).toISOString(),actor:'field history correction',reason:b.reason},{type:'CORRECTION',resourceId:(p.missionSnapshot as State['missions'][number])?.resourceId??null,...(p.reportOrigin?.laborSource?{laborSource:p.reportOrigin.laborSource}:{})});
  await tx.workRecord.create({data:{...key,payload:JSON.parse(JSON.stringify({requestHash,result}))}});
  return result;
 });
}
