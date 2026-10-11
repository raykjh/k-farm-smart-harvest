import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {parseWorkspace} from '@/lib/workspace';
import {fieldInventory,type FieldEntry} from '@/lib/field-record';
import {buildAnnualPlan,type AnnualPlan} from '@/lib/annual-plan';
import {z} from 'zod';
import {planningContext} from '@/lib/planning-context';
import type {State} from '@/lib/types';
import {resourceView} from '@/lib/center-resources';
import type {LinkedMission} from '@/lib/operation-links';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Row<T>={version:number;payload:T};
async function handleGET(req:NextRequest){try{
 const space=(parseWorkspace(req.nextUrl.searchParams.get('workspace')),recordSpace()),year=z.coerce.number().int().min(2000).max(2200).parse(req.nextUrl.searchParams.get('year'));
 const fields=await db.$queryRaw<Row<FieldEntry[]>[]>`SELECT "version","payload" FROM "WorkRecord" WHERE "workspace"=${space} AND "kind"='fields' AND "id"='current'`;
 const plans=await db.$queryRaw<Row<AnnualPlan>[]>`SELECT "version","payload" FROM "WorkRecord" WHERE "workspace"=${space} AND "kind"='annualPlan' AND "id"=${String(year)}`;
 const plan=plans[0]??null;
 const center=await db.center.findUnique({where:{id:activeCenterId()}});
 const linked=((center?.state as unknown as State)?.missions??[]).filter(m=>(m as LinkedMission).operationKey?.startsWith(year+':'));
 const linkedWork={total:linked.length,stages:linked.reduce((a,m)=>{const code=(m as LinkedMission).operationCode??'unknown';a[code]=(a[code]??0)+1;return a},{} as Record<string,number>)};
 return NextResponse.json({version:plan?.version??0,plan:plan?.payload??null,linkedWork,fieldVersion:fields[0]?.version??0,fieldCount:fields[0]?.payload.length??0,stale:!!plan&&plan.payload.fieldVersion!==(fields[0]?.version??0)},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'연간계획 조회 실패'},{status:400})}}
async function handlePOST(req:NextRequest){
 const origin=req.headers.get('origin');if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(origin&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(origin)))return NextResponse.json({error:'허용되지 않은 출처'},{status:403});
 try{const b=z.object({workspace:z.enum(['operations','sandbox']).transform(()=>recordSpace()),year:z.number().int().min(2000).max(2200),version:z.number().int().nonnegative(),fieldVersion:z.number().int().nonnegative(),context:planningContext.optional()}).strict().parse(await req.json());
 const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${b.workspace}`}))`;
  const fields=await tx.$queryRaw<Row<FieldEntry[]>[]>`SELECT "version","payload" FROM "WorkRecord" WHERE "workspace"=${b.workspace} AND "kind"='fields' AND "id"='current' FOR UPDATE`;
  if((fields[0]?.version??0)!==b.fieldVersion)return null;
  const old=await tx.$queryRaw<Row<AnnualPlan>[]>`SELECT "version","payload" FROM "WorkRecord" WHERE "workspace"=${b.workspace} AND "kind"='annualPlan' AND "id"=${String(b.year)} FOR UPDATE`;
  if((old[0]?.version??0)!==b.version)return null;
  const center=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),resources=await resourceView(tx,center.state as unknown as State,activeCenterId());
  const plan=buildAnnualPlan(fieldInventory.parse(fields[0]?.payload??[]),b.year,b.fieldVersion,{...old[0]?.payload.context,...b.context,operations:b.context?.operations??old[0]?.payload.context?.operations},undefined,undefined,resources),version=b.version+1;
  // Only draft generation exists here; confirmed plans and reservations are never written.
  await tx.$executeRaw`INSERT INTO "WorkRecord" ("workspace","kind","id","version","payload") VALUES (${b.workspace},'annualPlan',${String(b.year)},${version},${JSON.stringify(plan)}::jsonb) ON CONFLICT ("workspace","kind","id") DO UPDATE SET "version"=EXCLUDED."version","payload"=EXCLUDED."payload","updatedAt"=CURRENT_TIMESTAMP`;
  await tx.audit.create({data:{centerId:activeCenterId(),action:'annualPlan.draft',detail:{year:b.year,version,fieldVersion:b.fieldVersion,taskCount:plan.taskCount}}});
  return {version,plan,fieldVersion:b.fieldVersion,fieldCount:fields[0].payload.length,stale:false};
 });
 return result?NextResponse.json(result):NextResponse.json({error:'농지 또는 계획이 변경되었습니다. 다시 불러오세요.'},{status:409});
 }catch{return NextResponse.json({error:'작물·면적이 입력된 농지를 저장한 뒤 다시 시도하세요. 계획 저장에 실패했습니다.'},{status:400})}
}

export const GET=withAuth('annual-plan',handleGET);
export const POST=withAuth('annual-plan',handlePOST);
