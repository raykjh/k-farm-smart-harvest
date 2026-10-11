import {centerId as activeCenterId} from '@/lib/workspace';
import {receiptId as scopedReceipt} from '@/lib/workspace';
import {resourceView} from '@/lib/center-resources';
import {syncChangedPlanReservations} from '@/lib/plan-reservation-sync';
import {actorLabel} from '@/lib/auth';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '../../../lib/db';
import {taskScheduleOptions} from '../../../lib/task-schedule';
import type {State} from '../../../lib/types';
import type {Prisma} from '@prisma/client';
export const runtime='nodejs';
const schema=z.object({action:z.enum(['preview','save']),missionId:z.string().min(1).max(60),preferred:z.string(),token:z.string().optional(),start:z.number().int().optional(),key:z.string().uuid().optional()}).strict();
async function handlePOST(req:NextRequest){
 const origin=req.headers.get('origin');if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(origin&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(origin)))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const b=schema.parse(await req.json());const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  const row=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),s=await resourceView(tx,row.state as unknown as State,activeCenterId()),previous=structuredClone(s);
  if(s.missions.some(m=>m.id===b.missionId&&(m as typeof m&{environmentReference?:unknown}).environmentReference))throw Error('환경 기준 작업은 예보·생육 조건을 재검증하는 일정 재계획 화면을 이용하세요.');
  const op=JSON.stringify({id:b.missionId,preferred:b.preferred,start:b.start,token:b.token});
  const receiptId=scopedReceipt('task-schedule:'+b.key);
  if(b.action==='save'&&b.key){const old=await tx.receipt.findUnique({where:{id:receiptId}});if(old){if(old.operation!==op)throw Error('중복 요청 내용이 다릅니다.');return old.result;}}
  const proposal=taskScheduleOptions(s,b.missionId,b.preferred);if(b.action==='preview')return proposal;
  if(!b.key||proposal.token!==b.token)throw Error('일정이 변경됐습니다. 다시 계산하세요.');
  const choice=proposal.options.find(x=>x.start===b.start);if(!choice)throw Error('선택 일정이 더 이상 가능하지 않습니다.');
  const m=s.missions.find(x=>x.id===b.missionId)!,before=m.scheduledDate;
  m.originalScheduledDate??=m.scheduledDate;m.start=choice.start;m.scheduledDate=choice.date;m.month=Number(choice.date.slice(5,7));m.deadline=Math.floor(choice.start/32)*32+32;if(m.status==='HELD')m.status='PLANNED';
  s.planVersion++;for(const r of s.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
  await syncChangedPlanReservations(tx,activeCenterId(),previous,s,[m.id],actorLabel());
  await tx.center.update({where:{id:activeCenterId()},data:{state:s as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  const result={ok:true,date:choice.date,planVersion:s.planVersion};
  await tx.receipt.create({data:{id:receiptId,operation:op,result}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:'task.reschedule',detail:{missionId:m.id,before,after:choice.date,planVersion:s.planVersion,basis:proposal.basis}}});
  return result;
 });return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'변경 실패'},{status:409})}
}

export const POST=withAuth('task-schedule',handlePOST);
