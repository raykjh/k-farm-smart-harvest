import {isCenterOperator} from '@/lib/auth-policy';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {centerId} from '@/lib/workspace';
import {knownCenter,centerRegistry} from '@/lib/center-registry';
import {coordinationPolicySchema,emptyCoordinationPolicy} from '@/lib/production-coordination';
import {coordinationPolicyKey,readProductionCoordination} from '@/lib/production-coordination-store';
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export const GET=withAuth('production-coordination',async()=>{
 const global=currentPrincipal()?.role==='SUPER_ADMIN',id=global?'global':centerId();
 const s=await readProductionCoordination(db,id,today());
 return NextResponse.json({policy:s.policy,version:s.policyVersion,totals:s.totals,unquantified:s.unquantified,contributionCount:s.contributions.length,coverage:s.coverage,centerId:id,centers:centerRegistry.map(c=>({id:c.id,name:c.name})),canManage:global||isCenterOperator(currentPrincipal()),global});
});
export const POST=withAuth('production-coordination',async req=>{
 try{
  const b=z.object({version:z.number().int().nonnegative(),policy:coordinationPolicySchema}).strict().parse(await req.json()),global=currentPrincipal()?.role==='SUPER_ADMIN',actor=actorLabel();
  if([...b.policy.specialties,...b.policy.equipmentCostRates??[],...b.policy.operatorCostRates??[]].some(s=>!knownCenter(s.centerId)))throw Error('지역 확인 필요');
  const costEvidence=(b.policy.economicReferences??[]).flatMap<{checkedOn:string}>(r=>r.cost.mode==='STATISTICAL_TOTAL'?[r.cost]:r.cost.components);
  if([...b.policy.yields,...b.policy.targets,...b.policy.specialties,...b.policy.marketOutlooks??[],...b.policy.nationalReferences??[],...b.policy.economicReferences??[],...b.policy.equipmentCostRates??[],...b.policy.operatorCostRates??[],...costEvidence].some(s=>s.checkedOn>today()))throw Error('미래 검토일은 사용할 수 없습니다.');
  const result=await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-coordination'}))`;
   const row=await tx.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),previous=coordinationPolicySchema.parse(row?.payload??emptyCoordinationPolicy());
   if((row?.version??0)!==b.version)throw Error('기준이 변경되었습니다. 다시 불러오세요.');
   // Older clients know only the original policy sections. Omission preserves
   // optional evidence; an explicit [] is a reviewed deletion subject to auth.
   b.policy={...previous,...b.policy};
   if(!global&&(JSON.stringify(b.policy.yields)!==JSON.stringify(previous.yields)||JSON.stringify(b.policy.targets)!==JSON.stringify(previous.targets)||JSON.stringify(b.policy.marketOutlooks??[])!==JSON.stringify(previous.marketOutlooks??[])||JSON.stringify(b.policy.nationalReferences??[])!==JSON.stringify(previous.nationalReferences??[])||JSON.stringify(b.policy.economicReferences??[])!==JSON.stringify(previous.economicReferences??[])||JSON.stringify(b.policy.equipmentCostRates??[])!==JSON.stringify(previous.equipmentCostRates??[])||JSON.stringify(b.policy.operatorCostRates??[])!==JSON.stringify(previous.operatorCostRates??[])||JSON.stringify(b.policy.specialties.filter(s=>s.centerId!==centerId()))!==JSON.stringify(previous.specialties.filter(s=>s.centerId!==centerId()))))throw Error('전국·경제·비용 기준은 총괄, 지역 특화 기준은 소속 센터만 수정할 수 있습니다.');
   const payload=JSON.parse(JSON.stringify(b.policy)),version=b.version+1;
   await tx.workRecord.upsert({where:{workspace_kind_id:coordinationPolicyKey},create:{...coordinationPolicyKey,payload,version},update:{payload,version}});
   await tx.audit.create({data:{centerId:global?'global':centerId(),action:'production.coordination.policy',detail:{actor,version,before:row?.payload??null,after:payload}}});
   return {ok:true,version};
  });return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'기준 저장 실패'},{status:409})}
});
