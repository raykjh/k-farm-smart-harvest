import type {Prisma} from '@prisma/client';
import {db} from './db';
import {centerRegistry} from './center-registry';
import {centerId,recordSpace} from './workspace';
import {readProductionSource,productionSourceHash,calculateProduction,lockProduction,productionKey,approveProduction} from './production-service';
import {collectJointSnapshot,evaluateJointProposal,jointRuleProposal,jointSourceHash,integratedHash,type JointEvaluation} from './integrated-plan';
import {adviseJointPlan,type JointCompletion} from './integrated-plan-adviser';
import {dispatchPlacementKey} from './annual-dispatch';
import {recordAcquisitionReviews} from './acquisition-review';

const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const jointKey=(audience:string,id:string)=>({where:{workspace_kind_id:{workspace:audience==='network'?'shared':recordSpace(audience),kind:'integratedPlan',id}}});
export const readJointSources=async(tx:Prisma.TransactionClient)=>{
 const sources:Awaited<ReturnType<typeof readProductionSource>>[]=[];
 // One immutable read phase in this transaction: all centers share the same
 // national inputs. Do not cache across transactions or approval mutations.
 for(const c of centerRegistry)sources.push(await readProductionSource(tx,c.id,sources[0]?.coordination));
 return sources;
};
export type JointRequest={requestId:string;mode:'RULES'|'AI';audience:string};
export async function createJointDraft(input:JointRequest,actor:string,complete?:JointCompletion){
 const prepared=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'integrated-plan:'+input.audience}))`;
  const previous=await tx.workRecord.findUnique(jointKey(input.audience,input.requestId));
  if(previous){const p=previous.payload as any;if(p.actor!==actor||p.inputHash!==integratedHash(input))throw Error('통합계획 요청 ID 충돌');if(p.status==='READY')return {replay:p};throw Error(p.error??'이미 시작한 요청입니다. 자동 재호출하지 않았습니다.');}
  const active=await tx.workRecord.findMany({where:{workspace:input.audience==='network'?'shared':recordSpace(input.audience),kind:'integratedPlan'},orderBy:{updatedAt:'desc'},take:30});
  if(active.some(r=>(r.payload as any).status==='RUNNING'&&Date.now()-Date.parse((r.payload as any).startedAt)<10*60000))throw Error('통합계획이 계산 중입니다.');
  const sources=await readJointSources(tx),scope=input.audience==='network'?centerRegistry.map(c=>c.id):[input.audience];
  const fingerprint=jointSourceHash(sources,scope);
  await tx.workRecord.create({data:{workspace:input.audience==='network'?'shared':recordSpace(input.audience),kind:'integratedPlan',id:input.requestId,payload:json({input,inputHash:integratedHash(input),actor,fingerprint,status:'RUNNING',startedAt:new Date().toISOString()})}});
  return {sources,scope,fingerprint};
 },{timeout:60000,isolationLevel:'RepeatableRead'});
 if('replay' in prepared)return prepared.replay;
 try{
  const snapshot=await collectJointSnapshot(prepared.sources!,prepared.scope!);
  if(!snapshot.fields.length)throw Error('미확정 농지에 적용할 작기·위임·농지 조건을 먼저 확인하세요. 기존 확정 재배는 변경하지 않았습니다.');
  const baseline=await evaluateJointProposal(snapshot,jointRuleProposal(snapshot));
  const decision=input.mode==='AI'?await adviseJointPlan(snapshot,baseline,complete):null;
  const selected=decision?.selected??baseline;
  const result={input,inputHash:integratedHash(input),actor,status:'READY',fingerprint:prepared.fingerprint,createdAt:new Date().toISOString(),source:decision?'NEBIUS':'RULES',
   selected,baseline,alternatives:decision?.alternatives??[],decision:decision?{model:decision.model,evidence:decision.evidence,modelReferences:decision.modelReferences,evidenceOrigin:decision.evidenceOrigin,usage:decision.usage,contract:decision.contract,...(decision.selectionAudit?{selectionAudit:decision.selectionAudit}:{})}:null,
   fieldCount:snapshot.fields.length,remaining:snapshot.remaining,excluded:snapshot.excluded,version:snapshot.version,acquisitionReviewIds:[] as string[]};
  return await db.$transaction(async tx=>{
   const fresh=await readJointSources(tx);
   if(jointSourceHash(fresh,prepared.scope!)!==prepared.fingerprint)throw Error('계산 중 농지·자원·예약이 변경되었습니다. 초안을 적용하지 않았습니다.');
   result.acquisitionReviewIds=await recordAcquisitionReviews(tx,selected,{draftId:input.requestId,fingerprint:prepared.fingerprint!,actor,source:decision?'NEBIUS':'RULES'});
   await tx.workRecord.update({...jointKey(input.audience,input.requestId),data:{payload:json(result),version:{increment:1},updatedAt:new Date()}});
   return result;
  },{timeout:60000,isolationLevel:'RepeatableRead'});
 }catch(e){
  const error=e instanceof Error?e.message:'통합계획 실패';
  const row=await db.workRecord.findUnique(jointKey(input.audience,input.requestId));
  if((row?.payload as any)?.status==='RUNNING')await db.workRecord.update({...jointKey(input.audience,input.requestId),data:{payload:json({...row!.payload as object,status:'ERROR',error,finishedAt:new Date().toISOString()}),version:{increment:1}}});
  throw e;
 }
}

/** A compact, privacy-safe response. Stored private calculations never leak
 * another center's farmer, PNU, contact, operator identity or history. */
export function jointPublicView(raw:any,currentFingerprint?:string){
 const current=currentFingerprint!==undefined&&raw.fingerprint===currentFingerprint;
 let ownCenter:string|null=null;try{ownCenter=centerId();}catch{/* A network-only principal receives no private labels. */}
 const range=(value:{low:number;base:number;high:number}|null|undefined)=>value&&[value.low,value.base,value.high].every(Number.isFinite)?{low:value.low,base:value.base,high:value.high}:null;
 const knownMissing=['AREA_COMMODITY_OR_HARVEST_PERIOD_REQUIRED','INVALID_ECONOMIC_REFERENCE','AMBIGUOUS_ECONOMIC_REFERENCE','CURRENT_MATCHING_ECONOMIC_REFERENCE_REQUIRED','ECONOMIC_CALCULATION_OUT_OF_RANGE','FARM_GATE_PRICE_REQUIRED_WHOLESALE_IS_NOT_RECEIPTS','VALID_EXECUTABLE_TASK_COST_BASIS_REQUIRED','ORDINARY_LABOR_POLICY_REQUIRED','OPERATOR_LABOR_POLICY_REQUIRED','REGISTERED_EQUIPMENT_RATE_REQUIRED','STATISTICAL_TOTAL_BELOW_KNOWN_OPERATIONAL_COST','CURRENT_STATISTICAL_COST_REFERENCE_REQUIRED','CURRENT_COST_REFERENCE_REQUIRED','OTHER_COSTS_INCOMPLETE','UNPLACED_REQUIRED_TASK_COSTS','OWN_LABOR_AND_CAPITAL_NOT_INCLUDED','COST_EXCLUDED'];
 const summarize=(e:JointEvaluation)=>({id:e.id,status:e.status,metrics:e.metrics,mix:e.mix,totals:e.totals,staffing:e.staffing,equipment:e.equipment,requests:e.requests,unknowns:e.unknowns,reserved:false,approvalRequired:true,
  fields:(e.economics??[]).filter(row=>/^F\d+$/.test(row.field)&&centerRegistry.some(c=>c.id===row.centerId)).map(row=>{
   const own=current&&row.centerId===ownCenter;
   const item=own?e.views.find(v=>v.centerId===ownCenter)?.view.items.find(i=>i.pnu===row.pnu):undefined;
   const context=e.decisionContext?.fields.find(f=>f.field===row.field);
   const baselineCrop=(raw.baseline as JointEvaluation|undefined)?.economics?.find(f=>f.field===row.field)?.crop??(raw.baseline as JointEvaluation|undefined)?.decisionContext?.fields.find(f=>f.field===row.field)?.crop??null;
   const assessment=row.assessment,reference=assessment.reference;
   // Deliberately construct a DTO. Never spread an economics row, source,
   // production item or reference containing private supplier/field data.
   return {field:row.field,centerId:row.centerId,...(item?{label:item.address||item.pnu}:{}),crop:row.crop,baselineCrop,changed:baselineCrop===null?null:baselineCrop!==row.crop,areaM2:row.areaM2,
    context:{nationalOutlook:context?.nationalOutlook??'UNKNOWN',specialty:context?.specialty??'NOT_REVIEWED',participantSupply:context?.participantSupply??'INSUFFICIENT_DATA',neighborCompatible:context?.neighborCompatible??null},
    economics:{status:assessment.status,comparable:assessment.comparable,revenue:range(assessment.revenue),knownCost:range(assessment.knownCost),balanceAfterKnownCosts:range(assessment.balanceAfterKnownCosts),
     missingComponents:[...new Set(assessment.missingComponents.map(c=>c.split(':')[0]).filter(c=>knownMissing.includes(c)))],
     reference:reference?{asOf:reference.asOf,checkedOn:reference.checkedOn,validUntil:reference.validUntil,sourceDataKind:reference.sourceDataKind,priceBasis:reference.priceBasis,priceStage:reference.priceStage,costMode:reference.costMode,...(own?{sourceUrl:reference.sourceUrl,version:reference.version}:{})}:null}};
  })});
 return {requestId:raw.input?.requestId,audience:raw.input?.audience,status:raw.status,source:raw.source,createdAt:raw.createdAt,error:raw.error,
  freshness:currentFingerprint===undefined?'UNVERIFIED':raw.fingerprint===currentFingerprint?'CURRENT':'STALE',
  remaining:raw.remaining,excluded:raw.excluded,selected:raw.selected?summarize(raw.selected):null,baseline:raw.baseline?summarize(raw.baseline):null,
  alternatives:(raw.alternatives??[]).map(summarize),decision:raw.decision??null,fingerprint:raw.fingerprint};
}
/** Read-only freshness check. Never infer, refresh a plan, or rewrite history. */
export async function readJointDraftViews(tx:Prisma.TransactionClient,audience:string){
 const rows=await tx.workRecord.findMany({where:{workspace:audience==='network'?'shared':recordSpace(audience),kind:'integratedPlan'},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:5});
 if(!rows.length)return [];
 const scope=audience==='network'?centerRegistry.map(c=>c.id):[audience];
 const fingerprint=jointSourceHash(await readJointSources(tx),scope);
 return rows.map(r=>jointPublicView(r.payload,fingerprint));
}
export async function stageJointDraft(tx:Prisma.TransactionClient,input:{requestId:string;audience:string;fingerprint:string},actor:string){
 await lockProduction(tx);
 const row=await tx.workRecord.findUnique(jointKey(input.audience,input.requestId)),draft=row?.payload as any;
 if(!draft||draft.status!=='READY'||draft.fingerprint!==input.fingerprint)throw Error('검토할 통합계획을 다시 확인하세요.');
 const id=centerId(),scope=draft.input.audience==='network'?centerRegistry.map(c=>c.id):[draft.input.audience];
 if(!scope.includes(id))throw Error('소속 센터의 계획만 검토 목록에 반영할 수 있습니다.');
 const sources=await readJointSources(tx);
 if(jointSourceHash(sources,scope)!==draft.fingerprint)throw Error('기존 기록·자원이 변경되었습니다. 통합계획을 다시 계산하세요.');
 const own=(draft.selected as JointEvaluation).views.find(v=>v.centerId===id);
 if(!own||own.view.items.filter(i=>own.choices.some(c=>c.pnu===i.pnu)).some(i=>i.status!=='REVIEW'))throw Error('미확보 자원·작업 조건을 먼저 확인하세요. 확보안은 실행 가능한 예약이 아닙니다.');
 const source=sources.find(s=>s.scopeId===id)!,view=await calculateProduction(source,undefined,{choices:own.choices});
 if(view.items.filter(i=>own.choices.some(c=>c.pnu===i.pnu)).some(i=>i.status!=='REVIEW'))throw Error('현재 자원으로 전체 계획을 배치할 수 없습니다.');
 if(own.choices.some(c=>dispatchPlacementKey(own.view.items.find(i=>i.pnu===c.pnu)?.proposal?.dispatch.assignments??[])!==dispatchPlacementKey(view.items.find(i=>i.pnu===c.pnu)?.proposal?.dispatch.assignments??[])))throw Error('통합 검토와 센터 배치 결과가 다릅니다. 다른 센터 예약을 반영해 다시 계산하세요.');
 const key=productionKey('continuousProduction'),previous=(await tx.workRecord.findUnique(key))?.payload as any;
 if(previous?.integratedPlan?.requestId===input.requestId&&previous.sourceFingerprint===productionSourceHash(source))return {view:previous,alreadyStaged:true};
 const payload={...view,sourceFingerprint:productionSourceHash(source),fingerprint:integratedHash({source:productionSourceHash(source),integrated:input.requestId,previous:previous?.fingerprint}),calculatedAt:new Date().toISOString(),
  integratedPlan:{requestId:input.requestId,evaluationId:draft.selected.id,source:draft.source,choices:own.choices,staffing:draft.selected.proposal.staffing,actor,networkSourceHashes:sources.map(s=>[s.scopeId,productionSourceHash(s)])},inferenceCalled:draft.source==='NEBIUS'};
 await tx.workRecord.upsert({...key,create:{workspace:recordSpace(),kind:'continuousProduction',id:'current',payload:json(payload)},update:{payload:json(payload),version:{increment:1},updatedAt:new Date()}});
 await tx.audit.create({data:{centerId:id,action:'production.integrated.stage',detail:json({actor,...input,choices:own.choices,source:draft.source})}});
 return {view:payload,alreadyStaged:false};
}

/** An explicit center command covers inference, checked staging and approval.
 * Existing consent/resource validation is unchanged. Staging and approval share
 * one transaction, and replaying the request cannot call the model twice. */
export async function applyJointPlan(requestId:string,actor:string,complete?:JointCompletion){
 const audience=centerId(),key={workspace:recordSpace(),kind:'integratedApplication',id:requestId};
 const previous=await db.workRecord.findUnique({where:{workspace_kind_id:key}});
 if(previous){const p=previous.payload as any;if(p.actor!==actor)throw Error('다른 담당자가 사용한 요청입니다.');return {...p.result,alreadyApplied:true};}
 const draft=await createJointDraft({requestId,mode:'AI',audience},actor,complete);
 if(draft.source!=='NEBIUS')throw Error('AI 검토를 완료한 계획만 적용할 수 있습니다.');
 return db.$transaction(async tx=>{
  await lockProduction(tx);
  const existing=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if(existing){const p=existing.payload as any;if(p.actor!==actor)throw Error('다른 담당자가 사용한 요청입니다.');return {...p.result,alreadyApplied:true};}
  const staged=await stageJointDraft(tx,{requestId,audience,fingerprint:draft.fingerprint},actor);
  const pnus=staged.view.integratedPlan.choices.map((c:{pnu:string})=>c.pnu);
  if(!pnus.length)throw Error('확정할 신규 농지 계획이 없습니다.');
  const approved=await approveProduction(tx,{requestId,fingerprint:staged.view.fingerprint,pnus},actor);
  const result={...approved,remaining:draft.remaining??0,requestId,source:draft.source};
  await tx.workRecord.create({data:{...key,payload:json({actor,result,appliedAt:new Date().toISOString()})}});
  return result;
 },{timeout:60000});
}
