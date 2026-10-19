import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {removeRegisteredDemo} from '@/lib/registered-demo-storage';
import {clearedState} from '@/lib/demo-data';
import {readDemoRemoval} from '@/lib/demo-removal-preflight';
import type {State} from '@/lib/types';
import {z} from 'zod';
import {ProviderArtifactError} from '@/lib/provider-artifacts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handleGET(){try{const info=await db.$transaction(async tx=>{const row=await tx.center.findUnique({where:{id:'demo'}});return readDemoRemoval(tx,row?row.state as unknown as State:clearedState(),row?.version??0)},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});return NextResponse.json({...info,inputMethod:'ORDINARY_WORKFLOW',legacyInsertEnabled:false},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'데이터 조회 실패'},{status:503})}}
async function handlePOST(req:NextRequest){
 try{const b=z.object({action:z.enum(['insert','remove']),token:z.string().length(64)}).strict().parse(await req.json());
 // Cached clients must not recreate the fixed-date snapshot or infer completed
 // work. Fresh demo inputs use the ordinary registration/planning/result paths.
 if(b.action==='insert')return NextResponse.json({code:'LEGACY_DEMO_IMPORT_RETIRED',error:'일정과 과거 완료 상태를 일괄 생성하는 입력 방식은 종료했습니다. 화면·설정 확인 후 가상 신청을 일반 등록·계획·작업기록 흐름으로 순차 입력합니다.'},{status:410});
 const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-data'))`;
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id='demo' FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
  const row=await tx.center.findUnique({where:{id:'demo'}}),state=row?row.state as unknown as State:clearedState();
  for(const id of state.machines.map(m=>m.id).sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kfarm-resource:${id}`},0))`;
  const info=await readDemoRemoval(tx,state,row?.version??0);
  if(info.token!==b.token)throw Error('STALE');
  if(!info.safe)return {ok:false,code:'DEMO_REMOVAL_BLOCKED',blockers:info.blockers,error:'연결된 예약·인력·실적 또는 변경된 등록 자료가 있어 삭제하지 않았습니다. 연결 기록을 포함한 정리 준비가 필요합니다.'};
  // Recoverable snapshot of this exact generated aggregate. Other records are untouched.
  if(row)await tx.$executeRaw`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload") VALUES ('sandbox','removedDemo',${crypto.randomUUID()},1,${JSON.stringify(state)}::jsonb)`;
  await removeRegisteredDemo(tx);
  const next=clearedState();
  await tx.center.upsert({where:{id:'demo'},create:{id:'demo',state:next as unknown as Prisma.InputJsonValue},update:{state:next as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  await tx.audit.create({data:{centerId:'demo',action:`demoData.${b.action}`,detail:{fields:info.fields,tasks:info.tasks}}});
  return {ok:true};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});return NextResponse.json(result,{status:result.ok?200:409});
 }catch(error){if(error instanceof ProviderArtifactError)return NextResponse.json({error:error.message,code:error.code},{status:503});return NextResponse.json({error:'자료가 변경됐거나 직접 입력한 자료가 섞여 있습니다. 기존 자료를 유지했습니다. 목록을 새로고침하세요.'},{status:409})}
}

export const GET=withAuth('demo-data',handleGET);
export const POST=withAuth('demo-data',handlePOST);
