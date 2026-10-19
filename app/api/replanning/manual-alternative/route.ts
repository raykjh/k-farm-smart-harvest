import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel} from '@/lib/auth';
import {centerId} from '@/lib/workspace';
import {lockCenterPool} from '@/lib/center-resources';
import {planningState,readExecutionHistory} from '@/lib/replan-history';
import {executionStatus} from '@/lib/execution-view';
import {manualWorkAlternativeSchema,manualReviewIssue,manualWorkArea,manualWorkRequirement} from '@/lib/replan-manual-fallback';
import type {State} from '@/lib/types';

export const runtime='nodejs';
const standardSchema=manualWorkAlternativeSchema.omit({basis:true,reviewedBy:true}).strict();
const input=z.object({action:z.literal('saveManualAlternative'),missionId:z.string().min(1).max(200),version:z.number().int().positive(),standard:standardSchema}).strict();
const messages={FIELD:'농지와 작업면적을 확인하세요.',PARTICIPATION:'센터 인력 위탁은 완전 위탁형에서만 가능합니다.',PROTECTED:'시작·완료·취소되었거나 잠긴 작업의 수행 기준은 바꿀 수 없습니다.',SPECIALIST:'방제·운전·운송 등 전문 작업은 일반 인력으로 전환할 수 없습니다.'};

export const GET=withAuth('replanning',async(req:NextRequest)=>{
 try{
  const row=await db.center.findUniqueOrThrow({where:{id:centerId()}}),raw=row.state as unknown as State;
  const history=await readExecutionHistory(),state=planningState(raw,history);
  const mission=state.missions.find(m=>m.id===req.nextUrl.searchParams.get('missionId'));
  if(!mission)return NextResponse.json({error:'이 센터의 작업을 찾을 수 없습니다.'},{status:404});
  const original=raw.missions.find(m=>m.id===mission.id)!;
  const issue=executionStatus(raw,original,history)==='UNKNOWN'?'PROTECTED':manualReviewIssue(state,mission);
  const saved=manualWorkAlternativeSchema.safeParse(mission.manualAlternative);
  return NextResponse.json({version:row.version,missionId:mission.id,task:mission.label,areaM2:manualWorkArea(state,mission),issue,standard:saved.success?saved.data:null});
 }catch{return NextResponse.json({error:'작업 기준을 불러오지 못했습니다.'},{status:409})}
});

export const POST=withAuth('replanning',async(req:NextRequest)=>{
 try{
  const b=input.parse(await req.json());
  const result=await db.$transaction(async tx=>{
   await lockCenterPool(tx);
   const row=await tx.center.findUniqueOrThrow({where:{id:centerId()}}),state=row.state as unknown as State;
   if(row.version!==b.version)throw Error('자료가 변경되었습니다. 기준을 다시 열어 확인하세요.');
   const mission=state.missions.find(m=>m.id===b.missionId);if(!mission)throw Error('이 센터의 작업을 찾을 수 없습니다.');
   const history=await readExecutionHistory(tx),planning=planningState(state,history),effective=planning.missions.find(m=>m.id===mission.id)!;
   const issue=executionStatus(state,mission,history)==='UNKNOWN'?'PROTECTED':manualReviewIssue(planning,effective);
   if(issue)throw Error(messages[issue]);
   const field=state.fields.find(f=>f.id===mission.fieldId)!;
   const standard=manualWorkAlternativeSchema.parse({...b.standard,reviewedBy:actorLabel(),basis:field.source==='DEMO_ASSUMPTION'?'DEMO_INPUT':'REVIEWED'});
   const requirement=manualWorkRequirement(planning,{...effective,manualAlternative:standard});
   if(!requirement)throw Error('인력 대체 기준을 확인하세요.');
   const previous=mission.manualAlternative??null;
   mission.manualAlternative=standard;state.planVersion++;
   for(const r of state.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
   await tx.center.update({where:{id:centerId()},data:{state:state as unknown as Prisma.InputJsonValue,version:{increment:1}}});
   await tx.audit.create({data:{centerId:centerId(),action:'manualAlternative.review',detail:{actor:actorLabel(),missionId:mission.id,before:previous,after:standard,areaM2:manualWorkArea(state,mission),planVersion:state.planVersion}}});
   return {ok:true,version:row.version+1,people:requirement.workers,minutes:requirement.duration*15,requiresDailySplit:requirement.duration>32,scheduleChanged:false};
  });
  return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'기준 저장 실패'},{status:409})}
});
