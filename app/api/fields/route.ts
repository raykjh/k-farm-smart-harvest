import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {assertOwnerApplication} from '@/lib/application-policy';
import type {Consultation} from '@/lib/consultation';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {parseWorkspace} from '@/lib/workspace';
import {fieldInventory,type FieldEntry} from '@/lib/field-record';
import {z} from 'zod';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Row={version:number;payload:FieldEntry[]};
async function handleGET(req:NextRequest){
 try{const space=(parseWorkspace(req.nextUrl.searchParams.get('workspace')),recordSpace());
 const rows=await db.$queryRaw<Row[]>`SELECT "version","payload" FROM "WorkRecord" WHERE "workspace"=${space} AND "kind"='fields' AND "id"='current'`;
 return NextResponse.json(rows[0]??{version:0,payload:[]},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'농지 자료를 읽을 수 없습니다.'},{status:503})}
}
async function handlePOST(req:NextRequest){
 const origin=req.headers.get('origin');
 if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(origin&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(origin)))return NextResponse.json({error:'허용되지 않은 출처'},{status:403});
 try{
 const raw=await req.text();if(raw.length>500000)return NextResponse.json({error:'입력이 너무 큽니다.'},{status:413});
 const b=z.object({workspace:z.enum(['operations','sandbox']).transform(()=>recordSpace()),version:z.number().int().nonnegative(),payload:fieldInventory,mode:z.enum(['replace','append']).default('replace')}).strict().parse(JSON.parse(raw));
 const result=await db.$transaction(async tx=>{
  // Serializes initial creation and subsequent updates, per workspace only.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${b.workspace}`}))`;
  const old=await tx.$queryRaw<Row[]>`SELECT "version","payload" FROM "WorkRecord" WHERE "workspace"=${b.workspace} AND "kind"='fields' AND "id"='current' FOR UPDATE`;
  if((old[0]?.version??0)!==b.version)return null;
  for(const p of b.payload){if(!p.consultationId)continue;const links=await tx.$queryRaw<{payload:Consultation}[]>`SELECT "payload" FROM "WorkRecord" WHERE "workspace"=${b.workspace} AND "kind"='consultation' AND "id"=${p.consultationId}`;if(!links[0]?.payload.fields.some(f=>f.pnu===p.pnu))throw Error('상담 연결 불일치');assertOwnerApplication(links[0].payload,p.pnu);}
  const payload=fieldInventory.parse(b.mode==='append'?[...(old[0]?.payload??[]),...b.payload]:b.payload);
  const version=b.version+1;
  await tx.$executeRaw`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload") VALUES (${b.workspace},'fields','current',${version},${JSON.stringify(payload)}::jsonb) ON CONFLICT ("workspace","kind","id") DO UPDATE SET "version"=EXCLUDED."version","payload"=EXCLUDED."payload","updatedAt"=CURRENT_TIMESTAMP`;
  await tx.audit.create({data:{centerId:activeCenterId(),action:'fields.save',detail:{version,count:payload.length,mode:b.mode}}});
  return {version,payload};
 });
 return result?NextResponse.json(result):NextResponse.json({error:'다른 화면에서 변경되었습니다. 다시 불러오세요.'},{status:409});
 }catch{return NextResponse.json({error:'중복 필지·그룹·입력값 또는 저장 오류입니다. 기존 자료는 유지됩니다.'},{status:400})}
}

export const GET=withAuth('fields',handleGET);
export const POST=withAuth('fields',handlePOST);
