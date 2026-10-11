import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {initialState} from '@/lib/seed';
import {insertRegisteredDemo,removeRegisteredDemo} from '@/lib/registered-demo-storage';
import {clearedState,demoRemoval,dataToken} from '@/lib/demo-data';
import type {State} from '@/lib/types';
import {z} from 'zod';
import {ProviderArtifactError} from '@/lib/provider-artifacts';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handleGET(){try{const row=await db.center.findUnique({where:{id:'demo'}});return NextResponse.json(demoRemoval(row?row.state as unknown as State:clearedState()),{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'데이터 조회 실패'},{status:503})}}
async function handlePOST(req:NextRequest){
 const origin=req.headers.get('origin');if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(origin&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(origin)))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const b=z.object({action:z.enum(['insert','remove']),token:z.string().length(64)}).strict().parse(await req.json());
 const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-data'))`;
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id='demo' FOR UPDATE`;
  const row=await tx.center.findUnique({where:{id:'demo'}}),state=row?row.state as unknown as State:clearedState();
  if(dataToken(state)!==b.token)throw Error('STALE');
  const info=demoRemoval(state);
  if(b.action==='insert'&&(state.fields.length||state.missions.length||state.machines.length))throw Error('NOT_EMPTY');
  if(b.action==='remove'&&!info.safe)throw Error('MIXED_DATA');
  // Recoverable snapshot of this exact generated aggregate. Other records are untouched.
  if(b.action==='remove'&&row){await tx.$executeRaw`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload") VALUES ('sandbox','removedDemo',${crypto.randomUUID()},1,${JSON.stringify(state)}::jsonb)`;await tx.outbox.deleteMany({where:{centerId:'demo',farmerId:{in:state.fields.map(f=>f.farmerId)}}});}
  if(b.action==='remove')await removeRegisteredDemo(tx);
  const next=b.action==='insert'?await insertRegisteredDemo(tx):clearedState();
  await tx.center.upsert({where:{id:'demo'},create:{id:'demo',state:next as unknown as Prisma.InputJsonValue},update:{state:next as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  await tx.audit.create({data:{centerId:'demo',action:`demoData.${b.action}`,detail:{fields:info.fields,tasks:info.tasks}}});
  return {ok:true};
 });return NextResponse.json(result);
 }catch(error){if(error instanceof ProviderArtifactError)return NextResponse.json({error:error.message,code:error.code},{status:503});return NextResponse.json({error:'자료가 변경됐거나 직접 입력한 자료가 섞여 있습니다. 기존 자료를 유지했습니다. 목록을 새로고침하세요.'},{status:409})}
}

export const GET=withAuth('demo-data',handleGET);
export const POST=withAuth('demo-data',handlePOST);
