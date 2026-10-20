import {NextResponse} from 'next/server';
import {z} from 'zod';
import {withAuth} from '@/lib/auth-route';
import {db} from '@/lib/db';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {economicReferenceSchema} from '@/lib/crop-economics';
import {coordinationPolicySchema,emptyCoordinationPolicy} from '@/lib/production-coordination';
import {coordinationPolicyKey,readProductionCoordination} from '@/lib/production-coordination-store';
import {validatePriceEvidence,type PriceDay} from '@/lib/price-reference';
import {historicalCostReferences} from '@/lib/cost-reference-library';
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export const GET=withAuth('economic-reference',async()=>{
 const row=await db.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),policy=coordinationPolicySchema.parse(row?.payload??emptyCoordinationPolicy());
 const applied=await readProductionCoordination(db,currentPrincipal()?.centerId??'global',today());
 return NextResponse.json({version:row?.version??0,references:policy.economicReferences??[],excluded:applied.excludedEconomicReferences,costSources:historicalCostReferences,canManage:currentPrincipal()?.role==='SUPER_ADMIN'});
});
export const POST=withAuth('economic-reference',async req=>{
 const parsed=z.object({version:z.number().int().nonnegative(),replaceVersion:z.string().optional(),reference:economicReferenceSchema}).strict().safeParse(await req.json());
 if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join(' / ')},{status:400});
 const b=parsed.data,r=b.reference;
 if(r.checkedOn>today()||r.validUntil<today())return NextResponse.json({error:'검토일·유효기간을 확인하세요.'},{status:400});
 try{const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-coordination'}))`;
  // Same lock order as imports; the reference and its source snapshot commit together.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'price-reference-import'}))`;
  const row=await tx.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),policy=coordinationPolicySchema.parse(row?.payload??emptyCoordinationPolicy());
  if((row?.version??0)!==b.version)throw Error('기준이 변경되었습니다. 다시 불러오세요.');
  const refs=policy.economicReferences??[];
  if(b.replaceVersion&&!refs.some(p=>p.version===b.replaceVersion))throw Error('수정할 기준이 변경되었습니다.');
  const remaining=refs.filter(p=>p.version!==b.replaceVersion);
  if(remaining.some(p=>p.version===r.version||p.crop===r.crop&&p.commodity===r.commodity&&p.origin===r.origin&&p.harvestPeriod.from<=r.harvestPeriod.to&&r.harvestPeriod.from<=p.harvestPeriod.to))throw Error('같은 생산물의 적용 기간 또는 버전이 중복됩니다. 기존 기준을 수정하세요.');
  if(r.priceEvidence){const days=await tx.workRecord.findMany({where:{workspace:'shared',kind:'atPriceDay',id:{in:r.priceEvidence.revisions.map(d=>`${r.crop}:${d.date}`)}}});if(!validatePriceEvidence(r.priceEvidence,days.map(d=>d.payload as unknown as PriceDay),r.price,r.crop))throw Error('가격 이력이 변경되었거나 가격 조건이 일치하지 않습니다. 다시 연결하세요.');}
  const payload=coordinationPolicySchema.parse({...policy,economicReferences:[...remaining,r]}),version=b.version+1;
  await tx.workRecord.upsert({where:{workspace_kind_id:coordinationPolicyKey},create:{...coordinationPolicyKey,version,payload:JSON.parse(JSON.stringify(payload))},update:{version,payload:JSON.parse(JSON.stringify(payload)),updatedAt:new Date()}});
  await tx.audit.create({data:{centerId:'global',action:'reference.economics.save',detail:{actor:actorLabel(),version,before:refs.find(p=>p.version===b.replaceVersion)??null,after:JSON.parse(JSON.stringify(r))}}});return {ok:true,version};
 });return NextResponse.json(result);}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'기준 저장 실패'},{status:409});}
});
