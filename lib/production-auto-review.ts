import type {Prisma} from '@prisma/client';
import {db} from './db';
import {centerId,recordSpace} from './workspace';
import {productionKey,productionSourceHash,readProductionSource} from './production-service';
import {integratedHash,jointSourceHash} from './integrated-plan';
import {createJointDraft,readJointSources,stageJointDraft} from './integrated-plan-service';
import type {JointCompletion} from './integrated-plan-adviser';

const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const actor='상시 AI 계획 처리';
export function needsAutomaticReview(view:any){
 return !view?.integratedPlan&&Array.isArray(view?.items)&&view.items.some((i:any)=>i.status==='REVIEW'||i.status==='BLOCKED'&&i.comparisons?.length>0);
}

/** Paid inference is explicitly enabled, fingerprinted and claimed in the DB.
 * A stopped process or failed model response is never blindly retried. Human
 * confirmation still owns approval, reservations, employment and notices. */
export async function reviewProductionAutomatically(complete?:JointCompletion){
 if(process.env.KFARM_PRODUCTION_AI!=='1'||process.env.AI_MODE!=='nebius')return 'DISABLED';
 const id=centerId(),workspace=recordSpace();
 const claim=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-auto:'+id}))`;
  const jobs=await tx.workRecord.findMany({where:{workspace,kind:'productionAutoJob'}});
  const approvals=await tx.workRecord.findMany({where:{workspace,kind:'productionApproval'}});
  for(const job of jobs){
   const p=job.payload as any,applied=approvals.filter(r=>(r.payload as any).integratedPlan?.requestId===p.requestId);
   if(!p.requestId||!applied.length||p.status==='CONFIRMED')continue;
   const approvedPnus=[...new Set(applied.flatMap(r=>(r.payload as any).input.pnus as string[]))];
   const all=(applied[0].payload as any).integratedPlan.choices.every((c:{pnu:string})=>approvedPnus.includes(c.pnu));
   const status=all?'CONFIRMED':'PARTIALLY_CONFIRMED';
   if(status!==p.status||JSON.stringify(approvedPnus)!==JSON.stringify(p.approvedPnus))await tx.workRecord.update({where:{workspace_kind_id:{workspace,kind:job.kind,id:job.id}},data:{payload:json({...p,status,approvedPnus,approvedAt:(applied.at(-1)!.payload as any).approvedAt}),version:{increment:1},updatedAt:new Date()}});
  }
  const view=(await tx.workRecord.findUnique(productionKey('continuousProduction')))?.payload as any;
  if(!needsAutomaticReview(view))return null;
  const sources=await readJointSources(tx),source=sources.find(s=>s.scopeId===id)!;
  if((view.sourceFingerprint??view.fingerprint)!==productionSourceHash(source))return null;
  const fingerprint=jointSourceHash(sources,[id]),jobId=integratedHash({version:'automatic-production-v1',id,fingerprint});
  const requestId=`${jobId.slice(0,8)}-${jobId.slice(8,12)}-5${jobId.slice(13,16)}-a${jobId.slice(17,20)}-${jobId.slice(20,32)}`;
  const key={workspace,kind:'productionAutoJob',id:jobId};
  const existing=await tx.workRecord.findUnique({where:{workspace_kind_id:key}}),old=existing?.payload as any;
  if(old){
   if(old.status==='RUNNING'&&Date.now()-Date.parse(old.startedAt)>=10*60000){
    const message='AI 처리 중 서버가 중단되었거나 응답 확인이 필요합니다. 중복 호출하지 않았습니다. 계획을 다시 검토해주세요.';
    await tx.workRecord.update({where:{workspace_kind_id:key},data:{payload:json({...old,status:'NEEDS_REVIEW',message}),version:{increment:1},updatedAt:new Date()}});
    await tx.workRecord.update({...productionKey('continuousProduction'),data:{payload:json({...view,aiReviewError:{pnu:view.items.find((i:any)=>i.status==='REVIEW')?.pnu??'',message}}),version:{increment:1},updatedAt:new Date()}});
   }
   return null;
  }
  // At most one in-flight review per center, including after process restart.
  if(jobs.some(r=>(r.payload as any).status==='RUNNING'&&Date.now()-Date.parse((r.payload as any).startedAt)<10*60000))return null;
  await tx.workRecord.create({data:{...key,payload:json({status:'RUNNING',fingerprint,sourceFingerprint:productionSourceHash(source),startedAt:new Date().toISOString()})}});
  return {key,requestId,fingerprint,sourceFingerprint:productionSourceHash(source),pnu:view.items.find((i:any)=>i.status==='REVIEW'||i.comparisons?.length)?.pnu??''};
 },{timeout:60000,isolationLevel:'RepeatableRead'});
 if(!claim)return 'UNCHANGED';
 try{
  const draft=await createJointDraft({requestId:claim.requestId,mode:'AI',audience:id},actor,complete);
  await db.$transaction(async tx=>{
   await stageJointDraft(tx,{requestId:claim.requestId,audience:id,fingerprint:draft.fingerprint},actor);
   await tx.workRecord.update({where:{workspace_kind_id:claim.key},data:{payload:json({...claim,status:'AWAITING_CONFIRMATION',source:draft.source,finishedAt:new Date().toISOString()}),version:{increment:1},updatedAt:new Date()}});
  },{timeout:60000});
  return 'AWAITING_CONFIRMATION';
 }catch(e){
  const message=e instanceof Error?e.message.slice(0,500):'AI 계획 처리 실패';
  await db.$transaction(async tx=>{
   await tx.workRecord.update({where:{workspace_kind_id:claim.key},data:{payload:json({...claim,status:'NEEDS_REVIEW',message,finishedAt:new Date().toISOString()}),version:{increment:1},updatedAt:new Date()}});
   // Never attach an old failure to a newer registration or confirmed draft.
   const source=await readProductionSource(tx),row=await tx.workRecord.findUnique(productionKey('continuousProduction'));
   if(row&&productionSourceHash(source)===claim.sourceFingerprint&&!(row.payload as any).integratedPlan){
    await tx.workRecord.update({...productionKey('continuousProduction'),data:{payload:json({...row.payload as object,aiReviewError:{pnu:claim.pnu,message},automaticReview:{requestId:claim.requestId,status:'NEEDS_REVIEW'}}),version:{increment:1},updatedAt:new Date()}});
   }
  },{timeout:60000});
  return 'NEEDS_REVIEW';
 }
}
