import {centerId as activeCenterId,recordSpace,reportSpace} from './workspace';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {db} from './db';
import {buildWorkReport,type ReportEvidence} from './work-report';
import type {State} from './types';
import type {Prisma} from '@prisma/client';
import {currentPrincipal,actorLabel} from './auth';
export class RecordConflict extends Error {}
const actor=z.string().trim().min(1).max(100);
export const executionInput=z.object({id:z.string().uuid(),missionId:z.string().min(1),expectedPlanVersion:z.number().int(),expectedEvidenceId:z.string().nullable(),status:z.enum(['COMPLETED','HELD']),startedAt:z.string().datetime({offset:true}).nullable(),finishedAt:z.string().datetime({offset:true}).nullable(),actor,reason:z.string().trim().min(1).max(2000)}).strict();
export const snapshotInput=z.object({id:z.string().uuid(),actor,source:z.enum(['ALL','ACTUAL','SIMULATED']),period:z.string().regex(/^(?:\d{4}(?:-(?:0[1-9]|1[0-2]))?)?$/),expectedHash:z.string().length(64)}).strict();
export function reportHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
export async function readReport(tx:Prisma.TransactionClient){
 const center=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}});
 const records=await tx.$queryRaw<{id:string;version:number;payload:ReportEvidence;updatedAt:Date}[]>`SELECT id,version,payload,"updatedAt" FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='taskExecutionAssessment' ORDER BY "updatedAt" DESC,id`;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return buildWorkReport(center.state as unknown as State,records.map(r=>({...r.payload,recordId:r.id,version:r.version,updatedAt:r.updatedAt.toISOString()})),today);
}
export type ExecutionOrigin={type:'EQUIPMENT_REPORT'|'LABOR_REPORT'|'CORRECTION';resourceId:string|null;laborSource?:'REGISTERED'|'DIRECT_EMPLOYMENT'};
export async function saveExecution(input:unknown){return db.$transaction(tx=>saveExecutionInTransaction(tx,input));}
export async function saveExecutionInTransaction(tx:Prisma.TransactionClient,input:unknown,origin?:ExecutionOrigin){
 const b=executionInput.parse(input);if(currentPrincipal())b.actor=actorLabel();const hash=reportHash(origin?{input:b,origin}:b);
 if(b.status==='COMPLETED'&&(!b.startedAt||!b.finishedAt||Date.parse(b.startedAt)>Date.parse(b.finishedAt)||Date.parse(b.finishedAt)>Date.now()))throw Error('완료 시작·종료 시각을 확인해주세요.');
 if(b.status==='HELD'&&(b.startedAt||b.finishedAt))throw Error('보류 정정에는 완료 시각을 입력하지 않습니다.');
  const centers=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'taskExecutionAssessment',id:b.id}}});
  if(previous){if((previous.payload as any).requestHash!==hash)throw new RecordConflict('요청 ID가 다른 입력에 사용되었습니다.');return previous.payload;}
  const state=centers[0]?.state,m=state?.missions.find(m=>m.id===b.missionId);
  if(!m||!m.scheduledDate)throw Error('일정이 배정된 작업만 기록할 수 있습니다.');
  if(m.status==='CANCELLED')throw Error('취소된 작업은 실적으로 덮어쓸 수 없습니다.');
  if(origin&&origin.type!=='CORRECTION'){
   if(m.resourceId!==origin.resourceId)throw Error('배정 장비와 수신 결과의 장비가 다릅니다.');
   if((origin.type==='EQUIPMENT_REPORT')!==!!m.resourceId)throw Error('장비·인력 결과 구분이 다릅니다.');
   if(m.status==='COMPLETED')throw new RecordConflict('이미 완료된 작업입니다. 농지 이력에서 정정하세요.');
   const kstDay=(v:string)=>new Date(Date.parse(v)+9*3600000).toISOString().slice(0,10);
   if(b.startedAt&&kstDay(b.startedAt)!==m.scheduledDate)throw Error('수신 결과의 작업일과 배정일이 다릅니다.');
  }
  const report=await readReport(tx),row=report.rows.find(r=>r.missionId===b.missionId)!;
  if(state.planVersion!==b.expectedPlanVersion||row.evidenceId!==b.expectedEvidenceId)throw new RecordConflict('계획 또는 실적이 변경되었습니다. 새로고침하세요.');
  const field=state.fields.find(f=>f.id===m.fieldId),simulated=field?.source==='DEMO_ASSUMPTION',now=new Date().toISOString();
  const payload={missionId:m.id,plannedDate:m.scheduledDate,source:simulated?'DEMO_SIMULATION':'ACTUAL',sourceBatchId:simulated?field?.demoBatchId??null:null,assessment:simulated?(b.status==='COMPLETED'?'SIMULATED_COMPLETED':'SIMULATED_HELD'):b.status,actualStartedAt:simulated?null:b.startedAt,actualFinishedAt:simulated?null:b.finishedAt,simulatedStartedAt:simulated?b.startedAt:null,simulatedFinishedAt:simulated?b.finishedAt:null,confirmedBy:b.actor,confirmedAt:now,reason:b.reason,supersedesId:row.evidenceId,requestHash:hash,missionSnapshot:structuredClone(m),planVersion:state.planVersion,fieldId:m.fieldId,fieldSnapshot:field?{id:field.id,address:field.address,areaM2:field.area}:null,reportOrigin:origin??null};
  await tx.workRecord.create({data:{workspace:recordSpace(),kind:'taskExecutionAssessment',id:b.id,payload}});
  m.status=b.status;state.planVersion++;
  await tx.center.update({where:{id:activeCenterId()},data:{state:state as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:'EXECUTION_CONFIRMED',detail:{id:b.id,missionId:m.id,supersedesId:row.evidenceId,actor:b.actor}}});
  return payload;
}
export async function saveReportSnapshot(input:unknown){
 const b=snapshotInput.parse(input);if(currentPrincipal())b.actor=actorLabel();const hash=reportHash(b);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:reportSpace(),kind:'confirmedReport',id:b.id}}});
  if(previous){if((previous.payload as any).requestHash!==hash)throw new RecordConflict('요청 ID 충돌');return previous.payload;}
  const report=await readReport(tx);
  if(reportHash(report)!==b.expectedHash)throw new RecordConflict('보고서 자료가 변경되었습니다. 새로고침하세요.');
  const rows=report.rows.filter(r=>(b.source==='ALL'||r.source===b.source)&&(!b.period||r.plannedDate?.startsWith(b.period)));
  if(!rows.length)throw Error('저장할 자료가 없습니다.');
  const content={...report,rows,filter:{source:b.source,plannedPeriod:b.period}};
  const payload={id:b.id,confirmedBy:b.actor,confirmedAt:new Date().toISOString(),requestHash:hash,contentHash:reportHash(content),content};
  await tx.workRecord.create({data:{workspace:reportSpace(),kind:'confirmedReport',id:b.id,payload}});
  return payload;
 });
}
