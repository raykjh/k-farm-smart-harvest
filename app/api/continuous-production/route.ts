import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {centerDefinition} from '@/lib/center-registry';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {productionCriteria,serviceTerm} from '@/lib/continuous-production';
import {productionKey,lockProduction,readProductionSource,refreshProduction,approveProduction,changeParticipation} from '@/lib/production-service';
import {reviewProductionCrop,returnToRuleReview} from '@/lib/production-ai-review';
import {cropPriorities} from '@/lib/operating-crop-adviser';

const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('refresh')}).strict(),
 z.object({action:z.literal('ai-review'),requestId:z.string().uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),pnu:z.string().regex(/^\d{19}$/),priority:z.enum(cropPriorities)}).strict(),
 z.object({action:z.literal('rule-review'),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('criteria'),version:z.number().int().nonnegative(),criteria:productionCriteria}).strict(),
 z.object({action:z.literal('participation'),pnu:z.string().regex(/^\d{19}$/),status:z.enum(['ACTIVE','PAUSED','ENDED']),term:serviceTerm.optional(),reason:z.string().trim().min(1).max(500),expectedChangedAt:z.string().datetime().nullable()}).strict(),
 z.object({action:z.literal('approve'),requestId:z.string().uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),pnus:z.array(z.string().regex(/^\d{19}$/)).min(1).max(30),provisionalAcknowledged:z.literal(true)}).strict(),
]);
export const GET=withAuth('continuous-production',async()=>{
 const result=await db.$transaction(async tx=>{
  const source=await readProductionSource(tx),row=await tx.workRecord.findUnique(productionKey('continuousProduction')),criteria=await tx.workRecord.findUnique(productionKey('productionCriteria'));
  return {view:row?.payload??null,criteria:source.criteria,criteriaVersion:criteria?.version??0,canManage:currentPrincipal()?.role==='CENTER_ADMIN',center:centerDefinition(activeCenterId()),demoSourceBatchId:source.state?.demoResourceBatchId??(activeCenterId()==='demo'?'crop30-local-input':null)};
 });
 return NextResponse.json(result);
});
export const POST=withAuth('continuous-production',async req=>{
 try{
  const b=command.parse(await req.json()),actor=actorLabel();
  if(b.action==='ai-review')return NextResponse.json(await reviewProductionCrop({requestId:b.requestId,fingerprint:b.fingerprint,pnu:b.pnu,priority:b.priority},actor));
  if(b.action==='rule-review')return NextResponse.json(await returnToRuleReview(b.fingerprint,actor));
  const result=await db.$transaction(async tx=>{
   if(b.action==='refresh')return {view:await refreshProduction(tx)};
   if(b.action==='approve')return approveProduction(tx,{requestId:b.requestId,fingerprint:b.fingerprint,pnus:b.pnus},actor);
   if(b.action==='participation')return {view:await changeParticipation(tx,b.pnu,b,actor)};
   await lockProduction(tx);
   const owner=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),demoBatch=(owner.state as {demoResourceBatchId?:string}).demoResourceBatchId;
   if(activeCenterId()!=='demo'&&b.criteria.profiles.some(p=>p.dataOrigin==='DEMO'&&(!demoBatch||p.sourceBatchId!==demoBatch)))throw Error('센터에 연결된 데모 입력 묶음을 확인하세요.');
   if(activeCenterId()!=='demo'&&b.criteria.profiles.some(p=>p.context.region!==centerDefinition(activeCenterId()).township||p.dataOrigin!=='DEMO'&&(!p.context.regionalProfile||p.context.regionalProfile.region!==p.context.region)))throw Error('해당 면의 작업 기준과 지역 검토 근거를 첨부하세요.');
   const previous=await tx.workRecord.findUnique(productionKey('productionCriteria'));
   if((previous?.version??0)!==b.version)throw Error('작업 기준이 변경되었습니다. 다시 불러오세요.');
   const payload=JSON.parse(JSON.stringify(b.criteria)),version=b.version+1;
   await tx.workRecord.upsert({...productionKey('productionCriteria'),create:{workspace:recordSpace(),kind:'productionCriteria',id:'current',version,payload},update:{version,payload,updatedAt:new Date()}});
   await tx.audit.create({data:{centerId:activeCenterId(),action:'production.criteria.change',detail:{actor,version,before:previous?.payload??null,after:payload}}});
   return {view:await refreshProduction(tx),criteriaVersion:version};
  },{timeout:60000});
  return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'처리 실패'},{status:409})}
});
