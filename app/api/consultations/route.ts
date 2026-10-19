import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {parseWorkspace} from '@/lib/workspace';
import {consultationSchema,type Consultation} from '@/lib/consultation';
import {assertNoNewJointEnrollment} from '@/lib/field-enrollment-policy';
import {z} from 'zod';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Row={id:string;version:number;payload:Consultation};
async function handleGET(req:NextRequest){
 try{const space=(parseWorkspace(req.nextUrl.searchParams.get('workspace')),recordSpace()),id=req.nextUrl.searchParams.get('id');
  if(id){z.string().uuid().parse(id);const rows=await db.$queryRaw<Row[]>`SELECT "id","version","payload" FROM "WorkRecord" WHERE "workspace"=${space} AND "kind"='consultation' AND "id"=${id}`;
   return rows[0]?NextResponse.json(rows[0],{headers:{'Cache-Control':'no-store'}}):NextResponse.json({error:'상담을 찾을 수 없습니다.'},{status:404});}
  // List metadata only. Personal details are fetched only for a selected record.
  const rows=await db.$queryRaw<{id:string;version:number;updatedAt:Date}[]>`SELECT "id","version","updatedAt" FROM "WorkRecord" WHERE "workspace"=${space} AND "kind"='consultation' ORDER BY "updatedAt" DESC,"id" LIMIT 50`;
  return NextResponse.json({items:rows},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'상담 조회 실패'},{status:400})}
}
async function handlePOST(req:NextRequest){
 try{const raw=await req.text();if(raw.length>100000)return NextResponse.json({error:'입력이 너무 큽니다.'},{status:413});
 const b=z.object({workspace:z.enum(['operations','sandbox']).transform(()=>recordSpace()),id:z.string().uuid(),version:z.number().int().nonnegative(),testDataOnly:z.literal(true),payload:consultationSchema}).strict().parse(JSON.parse(raw));
 const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consultation:${b.workspace}:${b.id}`}))`;
  const old=await tx.$queryRaw<Row[]>`SELECT "id","version","payload" FROM "WorkRecord" WHERE "workspace"=${b.workspace} AND "kind"='consultation' AND "id"=${b.id} FOR UPDATE`;
  if((old[0]?.version??0)!==b.version)return null;
  assertNoNewJointEnrollment(b.payload.fields,old[0]?.payload.fields??[]);
  const version=b.version+1;
  await tx.$executeRaw`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload") VALUES (${b.workspace},'consultation',${b.id},${version},${JSON.stringify(b.payload)}::jsonb) ON CONFLICT ("workspace","kind","id") DO UPDATE SET "version"=EXCLUDED."version","payload"=EXCLUDED."payload","updatedAt"=CURRENT_TIMESTAMP`;
  await tx.audit.create({data:{centerId:activeCenterId(),action:'consultation.save',detail:{id:b.id,version,fieldCount:b.payload.fields.length,rights:'pending'}}});
  return {id:b.id,version};
 });
 return result?NextResponse.json(result):NextResponse.json({error:'다른 화면에서 수정되었습니다. 저장된 상담을 다시 불러오세요.'},{status:409});
 }catch{return NextResponse.json({error:'상담 입력 검증 또는 저장 실패. 화면 입력은 유지됩니다.'},{status:400})}
}

export const GET=withAuth('consultations',handleGET);
export const POST=withAuth('consultations',handlePOST);
