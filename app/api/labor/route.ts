import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {parseWorkspace} from '@/lib/workspace';
import {emptyLabor,laborRecord} from '@/lib/labor-record';
import {allocateLabor} from '@/lib/labor';
import {z} from 'zod';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Row={version:number;payload:ReturnType<typeof emptyLabor>};
async function handleGET(req:NextRequest){
 try{const space=(parseWorkspace(req.nextUrl.searchParams.get('workspace')),recordSpace());
 const rows=await db.$queryRaw<Row[]>`SELECT "version", "payload" FROM "WorkRecord" WHERE "workspace"=${space} AND "kind"='labor' AND "id"='current'`;
 return NextResponse.json(rows[0]??{version:0,payload:emptyLabor()},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'인력 자료를 읽을 수 없습니다.'},{status:503})}
}
async function handlePOST(req:NextRequest){
 const origin=req.headers.get('origin');
 if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(origin&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(origin)))return NextResponse.json({error:'허용되지 않은 출처'},{status:403});
 try{
 const raw=await req.text();if(raw.length>300000)return NextResponse.json({error:'입력이 너무 큽니다.'},{status:413});
 const b=z.object({workspace:z.enum(['operations','sandbox']).transform(()=>recordSpace()),version:z.number().int().nonnegative(),payload:laborRecord}).strict().parse(JSON.parse(raw));
 const result=await db.$transaction(async tx=>{
  const saved=await tx.$queryRaw<Row[]>`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload")
   SELECT ${b.workspace},'labor','current',1,${JSON.stringify(b.payload)}::jsonb WHERE ${b.version}=0
   ON CONFLICT DO NOTHING RETURNING "version","payload"`;
  const rows=saved.length?saved:await tx.$queryRaw<Row[]>`UPDATE "WorkRecord" SET "payload"=${JSON.stringify(b.payload)}::jsonb,"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspace"=${b.workspace} AND "kind"='labor' AND "id"='current' AND "version"=${b.version} RETURNING "version","payload"`;
  if(!rows.length)return null;
  await tx.audit.create({data:{centerId:activeCenterId(),action:'labor.save',detail:{version:rows[0].version,peopleCount:b.payload.people.length,confirmed:b.payload.confirmed,assignedCount:b.payload.confirmed?allocateLabor(b.payload.people,b.payload.count).selected.length:0}}});
  return rows[0];
 });
 return result?NextResponse.json(result):NextResponse.json({error:'다른 변경이 저장되었습니다. 다시 불러온 뒤 수정하세요.'},{status:409});
 }catch{return NextResponse.json({error:'입력 검증 또는 저장 실패. 입력은 화면에 유지됩니다.'},{status:400})}
}

export const GET=withAuth('labor',handleGET);
export const POST=withAuth('labor',handlePOST);
