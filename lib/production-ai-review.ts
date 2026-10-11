import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db} from './db';
import {recordSpace,centerId} from './workspace';
import {adviseOperatingCrop,type CropPriority} from './operating-crop-adviser';
import {calculateProduction,lockProduction,productionKey,productionSourceHash,readProductionSource,refreshProduction,savedCropSelector} from './production-service';

export type CropReviewInput={requestId:string;fingerprint:string;pnu:string;priority:CropPriority};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const options={timeout:60000};
const viewKey=()=>productionKey('continuousProduction');
const requestKey=(id:string)=>productionKey('productionAiReview',id);

/** One explicit request -> at most one inference. Source and reviewed revision
 * are checked again after the network call; no reservations are made here. */
export async function reviewProductionCrop(input:CropReviewInput,actor:string){
 const prepared=await db.$transaction(async tx=>{
  await lockProduction(tx);
  const prior=(await tx.workRecord.findUnique(requestKey(input.requestId)))?.payload as any;
  if(prior){
   if(prior.actor!==actor||prior.inputHash!==hash(input))throw Error('AI 검토 요청 ID 충돌');
   if(prior.status==='VERIFIED')return {alreadyReviewed:true as const,view:await refreshProduction(tx)};
   throw Error(prior.status==='RUNNING'?'AI 검토가 진행 중입니다. 중복 호출하지 않았습니다.':prior.error??'OPERATOR_REVIEW: 이전 요청 실패. 자동 재시도하지 않았습니다.');
  }
  const running=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'productionAiReview'}});
  for(const row of running){const p=row.payload as any;if(p.status!=='RUNNING')continue;
   if(Date.now()-Date.parse(p.startedAt)<5*60000)throw Error('센터의 AI 작물 검토가 진행 중입니다. 완료 후 다시 확인하세요.');
   // A crashed process never retries an uncertain paid request automatically.
   await tx.workRecord.update({...requestKey(row.id),data:{payload:json({...p,status:'OPERATOR_REVIEW',error:'중단된 AI 검토. 기존 결과는 적용하지 않았습니다.'}),version:{increment:1}}});
  }
  const view=await refreshProduction(tx),source=await readProductionSource(tx);
  if(view.fingerprint!==input.fingerprint)throw Error('농지·계획·작물 후보가 변경되었습니다. 다시 확인하세요.');
  const item=view.items.find((i:any)=>i.pnu===input.pnu);
  if(item?.status!=='REVIEW'||!item.proposal)throw Error('실행 가능한 새 작물 계획이 있어야 AI가 비교할 수 있습니다.');
  const sourceFingerprint=productionSourceHash(source);
  await tx.workRecord.create({data:{workspace:recordSpace(),kind:'productionAiReview',id:input.requestId,payload:json({actor,input,inputHash:hash(input),sourceFingerprint,status:'RUNNING',startedAt:new Date().toISOString()})}});
  return {alreadyReviewed:false as const,source,view,sourceFingerprint};
 },options);
 if(prepared.alreadyReviewed)return {view:prepared.view,alreadyReviewed:true};
 try{
  let targeted=false;
  // Earlier reviewed choices are replayed. A changed earlier choice can invalidate
  // later choices, which return to the visibly labelled RULES baseline, not AI.
  const replay=savedCropSelector(prepared.view,false);
  const calculated=await calculateProduction(prepared.source,async(pnu,facts)=>{
   if(pnu!==input.pnu)return replay(pnu,facts);
   if(targeted)throw Error('중복 작물 판단 차단');targeted=true;
   if(!facts.length)throw Error('실행 가능한 작물 후보가 없습니다.');
   return adviseOperatingCrop(facts,true,input.priority);
  });
  if(!targeted||!calculated.items.find(i=>i.pnu===input.pnu)?.decision?.inferenceCalled)throw Error('실제 AI 응답을 확인하지 못했습니다.');
  return await db.$transaction(async tx=>{
   await lockProduction(tx);
   const source=await readProductionSource(tx),current=(await tx.workRecord.findUnique(viewKey()))?.payload as any;
   const receipt=(await tx.workRecord.findUnique(requestKey(input.requestId)))?.payload as any;
   if(receipt?.status!=='RUNNING'||productionSourceHash(source)!==prepared.sourceFingerprint||current?.fingerprint!==input.fingerprint)throw Error('AI 검토 중 농지·일정·자원 또는 검토 결과가 변경되었습니다. 응답은 적용하지 않았습니다.');
   const view={...calculated,sourceFingerprint:prepared.sourceFingerprint,fingerprint:hash({source:prepared.sourceFingerprint,request:input.requestId}),calculatedAt:new Date().toISOString(),aiReview:{requestId:input.requestId,pnu:input.pnu,status:'VERIFIED',actor}};
   const decision=calculated.items.find(i=>i.pnu===input.pnu)!.decision!;
   await tx.workRecord.update({...viewKey(),data:{payload:json(view),version:{increment:1},updatedAt:new Date()}});
   await tx.workRecord.update({...requestKey(input.requestId),data:{payload:json({...receipt,status:'VERIFIED',finishedAt:new Date().toISOString(),decision,resultFingerprint:view.fingerprint}),version:{increment:1}}});
   await tx.audit.create({data:{centerId:centerId(),action:'production.crop.ai-review',detail:json({actor,requestId:input.requestId,pnu:input.pnu,priority:input.priority,sourceFingerprint:prepared.sourceFingerprint,decision})}});
   return {view,alreadyReviewed:false};
  },options);
 }catch(e){
  const error='OPERATOR_REVIEW: '+(e instanceof Error?e.message:'AI 작물 검토 실패').replace(/^OPERATOR_REVIEW: /,'').slice(0,500);
  await db.$transaction(async tx=>{
   await lockProduction(tx);
   const row=await tx.workRecord.findUnique(requestKey(input.requestId)),receipt=row?.payload as any;
   // Never overwrite a completed receipt after a client connection error.
   if(receipt?.status!=='RUNNING')return;
   await tx.workRecord.update({...requestKey(input.requestId),data:{payload:json({...receipt,status:'OPERATOR_REVIEW',error,finishedAt:new Date().toISOString()}),version:{increment:1}}});
   const current=(await tx.workRecord.findUnique(viewKey()))?.payload as any;
   if(current?.fingerprint===input.fingerprint){
    await tx.workRecord.update({...viewKey(),data:{payload:json({...current,fingerprint:hash({previous:input.fingerprint,failedReview:input.requestId}),aiReviewError:{pnu:input.pnu,priority:input.priority,message:error}}),version:{increment:1}}});
   }
  },options);
  throw Error(error);
 }
}

export async function returnToRuleReview(fingerprint:string,actor:string){
 return db.$transaction(async tx=>{
  await lockProduction(tx);const row=await tx.workRecord.findUnique(viewKey()),current=row?.payload as any;
  if(current?.fingerprint!==fingerprint)throw Error('검토 결과가 변경되었습니다. 다시 확인하세요.');
  // Deliberate, audited operator action, not a hidden fallback on AI failure.
  const baseline=await refreshProduction(tx,true);
  const view={...baseline,fingerprint:hash({source:baseline.sourceFingerprint,resetVersion:row!.version+1}),ruleReview:{actor,at:new Date().toISOString()}};
  await tx.workRecord.update({...viewKey(),data:{payload:json(view),version:{increment:1}}});
  await tx.audit.create({data:{centerId:centerId(),action:'production.crop.rule-review',detail:json({actor,previous:fingerprint,current:view.fingerprint})}});
  return {view};
 },options);
}
