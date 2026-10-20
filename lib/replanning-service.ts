import {scheduleChangeRows} from '@/lib/schedule-display';
import {equipmentDowntimeSchema} from '@/lib/equipment-downtime';
import {resourceView,lockCenterPool} from '@/lib/center-resources';
import {commitAutomaticLoans} from '@/lib/equipment-sharing-offers';
import {assignedResource} from '@/lib/annual-replanning';
import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {requestRepairLoans} from '@/lib/repair-loan-requests';
import {resumeReservationState} from '@/lib/resume-reservation';
import {syncChangedPlanReservations} from '@/lib/plan-reservation-sync';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {readExecutionHistory,planningState} from './replan-history';
import {executionStatus} from './execution-view';
import {db} from './db';
import {readShortForecast} from './kma-forecast';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
import {calculateAnnualReplan,dateSlot,hash,prepareAnnualReplan,annualReplanDiff,REPLANNING_RULE_VERSION,slotDate,todayKst,verifyAssignments,weatherHash} from './annual-replanning';
import {splitKey,type WorkMission} from '@/lib/replan-work-split';
import {equipmentWork} from '@/lib/replan-resource-options';
import {assignedDuration} from '@/lib/scheduling-engine';
import type {State} from './types';
import type {Prisma} from '@prisma/client';
import {proposeAnnualReplan} from './annual-planning-agent';
import {replacementSchema} from './equipment-replacement';
import {compareReplanAlternatives,decisionSnapshot,replanAlternativesSchema} from '@/lib/planning-decision';
import {assertMissionEnvironmentReferences} from '@/lib/environment-approval';
import {recommendPlanningAlternative} from '@/lib/planning-adviser';
import {verifyPlanningReview,type PlanningReview} from '@/lib/planning-review';
import {SCHEDULING_ENGINE_VERSION} from '@/lib/scheduling-engine';
import {decisionPriorities} from '@/lib/planning-priority';
import {runAutomaticReplan,AUTOMATIC_REPLAN_POLICY} from '@/lib/automatic-replanning';
import {replanResolutionNeeds} from '@/lib/replan-resolution';
import {immovable} from '@/lib/replan-scope';
import {assertAutomaticLease,automaticLeaseWait,newAutomaticLease} from '@/lib/automatic-replan-lease';
const requestFields={resourceReview:z.boolean().optional(),manualFallback:z.boolean().optional(),deferAfter:z.string().date().optional(),outage:equipmentDowntimeSchema.optional(),allowBorrowing:z.boolean().optional(),searchMode:z.literal('LOCAL_FIRST').optional(),ids:z.array(z.string().min(1).max(200)).min(1).max(600),day:z.string().optional(),preferred:z.string().optional(),reason:z.string().trim().min(1).max(500).optional(),scope:z.enum(['PRESERVE','EXPAND']).optional(),automaticReplacement:z.boolean().optional(),newLaborSupport:z.boolean().optional(),replacement:replacementSchema.optional(),simulation:z.object({kind:z.enum(['WIND','RAIN','DROUGHT']),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).optional()};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('preview'),...requestFields,decisionPriority:z.enum(decisionPriorities).optional(),decisionSource:z.literal('DEVELOPMENT_REVIEW').optional(),comparisonSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),decisionId:z.string().uuid().optional(),alternativeId:z.string().min(1).max(80).optional()}).strict(),
 z.object({action:z.literal('compare'),...requestFields,decisionPriority:z.enum(decisionPriorities).optional(),alternatives:replanAlternativesSchema,useAi:z.boolean().optional()}).strict(),
 z.object({action:z.literal('approve'),proposalId:z.string().uuid()}).strict(),
 z.object({action:z.literal('automatic'),requestId:z.string().uuid(),resourceReview:z.boolean().optional(),ids:requestFields.ids,day:z.string().date().optional(),deferAfter:requestFields.deferAfter,preferred:z.string().date().optional(),reason:requestFields.reason,outage:requestFields.outage,simulation:requestFields.simulation}).strict(),
 z.object({action:z.literal('recoverAutomatic'),requestId:z.string().uuid()}).strict(),
]);
const forecast=async()=>readShortForecast(await readCenterWeatherConfig());
type AutomaticExecution={requestId:string;token:string};
const automaticKey=(id:string)=>({workspace:recordSpace(),kind:'automaticReplan',id});
async function lockedAutomatic(tx:Prisma.TransactionClient,id:string){
 const rows=await tx.$queryRaw<{payload:any;updatedAt:Date}[]>`SELECT payload,"updatedAt" FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='automaticReplan' AND id=${id} FOR UPDATE`;
 return rows[0];
}
async function refreshAutomatic(execution:AutomaticExecution){
 await db.$transaction(async tx=>{
  const row=await lockedAutomatic(tx,execution.requestId);if(!row)throw Error('재배치 요청 기록이 없습니다.');
  assertAutomaticLease(row.payload,execution.token);
  await tx.workRecord.update({where:{workspace_kind_id:automaticKey(execution.requestId)},data:{version:{increment:1},payload:{...row.payload,...newAutomaticLease(execution.token)}}});
 });
}
async function failAutomatic(execution:AutomaticExecution,error:string){
 return db.$transaction(async tx=>{
  const row=await lockedAutomatic(tx,execution.requestId);if(!row)return null;
  const p=row.payload;if(p.result)return p.result;
  // A superseded handler must not overwrite recovery or a committed receipt.
  if(p.status==='PROCESSING'&&p.executionToken===execution.token)await tx.workRecord.update({where:{workspace_kind_id:automaticKey(execution.requestId)},data:{version:{increment:1},payload:{...p,status:'FAILED',error,finishedAt:new Date().toISOString()}}});
  return null;
 });
}
async function invokeOwned(req:NextRequest,body:Record<string,unknown>,execution:AutomaticExecution){
 const headers=new Headers(req.headers);headers.delete('content-length');
 const response=await handleReplanning(new NextRequest(req.url,{method:'POST',headers,body:JSON.stringify(body)}),execution);
 const value=await response.json();if(!response.ok)throw Error(value.error??'일정 재배치 실패');return value;
}
export async function handleReplanning(req:NextRequest,execution?:AutomaticExecution){
 try{const b=schema.parse(await req.json());
 if((b.action==='preview'||b.action==='compare')&&(b.manualFallback||b.action==='compare'&&b.alternatives.some(a=>a.manualFallback)))throw Error('장비 작업의 인력 대체는 사용하지 않습니다. 장비와 일정으로 다시 계산하세요.');
 if(b.action==='recoverAutomatic'){
  const claimed=await db.$transaction(async tx=>{
   const row=await lockedAutomatic(tx,b.requestId),p=row?.payload;
   if(!row||!p)return {result:{status:'FAILED',requestId:b.requestId,error:'이 센터에 저장된 요청이 없습니다. 다시 배치 버튼을 눌러주세요.'}};
   if(p.result)return {result:p.result};
   if(p.status!=='PROCESSING')return {result:{status:'FAILED',requestId:b.requestId,error:p.error??'저장되지 않은 요청입니다. 다시 배치할 수 있습니다.'}};
   const retryAfterMs=automaticLeaseWait(p,row.updatedAt);
   if(retryAfterMs>0)return {result:{status:'PROCESSING',requestId:b.requestId,retryAfterMs}};
   if(!p.proposalId||p.preparedResult?.status!=='APPLIED'){
    const error='이전 처리가 중단되었고 저장할 계획이 남아 있지 않습니다. 기존 일정은 유지했습니다. 다시 배치를 요청할 수 있습니다.';
    await tx.workRecord.update({where:{workspace_kind_id:automaticKey(b.requestId)},data:{version:{increment:1},payload:{...p,status:'FAILED',error,finishedAt:new Date().toISOString()}}});
    return {result:{status:'FAILED',requestId:b.requestId,error}};
   }
   const token=crypto.randomUUID();
   await tx.workRecord.update({where:{workspace_kind_id:automaticKey(b.requestId)},data:{version:{increment:1},payload:{...p,...newAutomaticLease(token),recoveryCount:(p.recoveryCount??0)+1}}});
   return {proposalId:p.proposalId as string,token};
  });
  if('result' in claimed)return NextResponse.json(claimed.result);
  const resumed={requestId:b.requestId,token:claimed.token};
  try{
   // Resume only the previously checked proposal. Approval revalidates current
   // data and expiry; no comparison or model call is repeated here.
   await invokeOwned(req,{action:'approve',proposalId:claimed.proposalId},resumed);
   const row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:automaticKey(b.requestId)}});
   return NextResponse.json((row.payload as any).result);
  }catch(e){
   const error=e instanceof Error?e.message:'재배치 복구 실패',saved=await failAutomatic(resumed,error);
   return NextResponse.json(saved??{status:'FAILED',requestId:b.requestId,error});
  }
 }
 if(b.action==='automatic'){
  const {action,requestId,...input}=b,key={workspace:recordSpace(),kind:'automaticReplan',id:requestId},inputHash=hash(input);
  const old=await db.workRecord.findUnique({where:{workspace_kind_id:key}}),prior=old?.payload as any;
  if(prior){if(prior.inputHash!==inputHash)throw Error('동일한 요청번호로 내용을 바꿀 수 없습니다.');if(prior.result)return NextResponse.json(prior.result);throw Error(prior.error??'일정 재배치가 진행 중입니다. 잠시 후 결과를 확인하세요.');}
  const row=await db.center.findUniqueOrThrow({where:{id:activeCenterId()}}),state=planningState(await resumeReservationState(db,row.state as unknown as State,input.ids),await readExecutionHistory());
  if(new Set(input.ids).size!==input.ids.length||input.ids.some(id=>{const m=state.missions.find(x=>x.id===id);return !m||immovable(m)||!m.scheduledDate||input.day&&!input.outage&&m.scheduledDate!==input.day}))throw Error('이 센터의 같은 작업일에 있는 시작 전·잠금 없는 작업을 선택하세요.');
  const owned={requestId,token:crypto.randomUUID()};
  await db.workRecord.create({data:{...key,payload:{inputHash,input,policy:AUTOMATIC_REPLAN_POLICY,actor:actorLabel(),status:'PROCESSING',startedAt:new Date().toISOString(),...newAutomaticLease(owned.token)}}});
  try{
   const result=await runAutomaticReplan(input,requestId,async body=>{
    await refreshAutomatic(owned);
    return invokeOwned(req,body,owned);
   },process.env.AI_MODE==='nebius',async()=>{
    const row=await db.center.findUniqueOrThrow({where:{id:activeCenterId()}}),state=planningState(await resourceView(db,row.state as unknown as State,activeCenterId()),await readExecutionHistory());
    return replanResolutionNeeds(state,input,await forecast(),todayKst());
   },async(proposalId,preparedResult)=>{
    await db.$transaction(async tx=>{
     const rows=await tx.$queryRaw<{payload:any}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='replanning' AND id=${proposalId} FOR UPDATE`;
     const p=rows[0]?.payload;if(!p||p.status!=='REVIEW_REQUIRED')throw Error('재배치 저장 연결을 확인하세요.');
     const receipt=await lockedAutomatic(tx,requestId);if(!receipt)throw Error('재배치 요청 기록이 없습니다.');assertAutomaticLease(receipt.payload,owned.token);
     await tx.workRecord.update({where:{workspace_kind_id:{workspace:recordSpace(),kind:'replanning',id:proposalId}},data:{payload:{...p,automaticRequestId:requestId}}});
     await tx.workRecord.update({where:{workspace_kind_id:key},data:{version:{increment:1},payload:JSON.parse(JSON.stringify({...receipt.payload,...newAutomaticLease(owned.token),proposalId,preparedResult}))}});
    });
   });
   // APPLIED receipts were saved atomically with the plan in the approval path.
   if(result.status!=='APPLIED')await db.$transaction(async tx=>{
    // Use the same lock order as approval: centers, then the receipt.
    await lockCenterPool(tx);
    const receipt=await lockedAutomatic(tx,requestId);if(!receipt)throw Error('재배치 요청 기록이 없습니다.');assertAutomaticLease(receipt.payload,owned.token);
    if(input.outage){
     const live=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}});
     if(hash(live.state)!==hash(row.state))throw Error('계획이 변경되었습니다. 최신 일정에서 다시 요청하세요.');
     const current=planningState(live.state as unknown as State,await readExecutionHistory(tx));
     result.loanRequests=await requestRepairLoans(tx,current,input,result.requirements??[],currentPrincipal()!,todayKst());
    }
    await tx.workRecord.update({where:{workspace_kind_id:key},data:{version:{increment:1},payload:JSON.parse(JSON.stringify({...receipt.payload,status:result.status,result,finishedAt:new Date().toISOString(),externalPurchase:false,externalDispatch:false}))}});
   });
   return NextResponse.json(result);
  }catch(e){
   const error=e instanceof Error?e.message:'재배치 실패',saved=await failAutomatic(owned,error);
   if(saved)return NextResponse.json(saved);throw e;
  }
 }
 if(b.action==='preview'||b.action==='compare'){
  const row=await db.center.findUniqueOrThrow({where:{id:activeCenterId()}}),state=await resourceView(db,row.state as unknown as State,activeCenterId());
  const w=await forecast(),asOf=todayKst();
  const history=await readExecutionHistory();
  if(b.ids.some(id=>{const m=state.missions.find(m=>m.id===id);return m&&executionStatus(state,m,history)==='UNKNOWN'}))throw Error('실적 확인이 필요한 작업은 확인 후 재배치하세요.');
  const planning=await resumeReservationState(db,planningState(state,history),b.ids);
  if(b.action==='compare'){
   const comparison=await compareReplanAlternatives(planning,b,b.alternatives,w,asOf);
   const baseline=await recommendPlanningAlternative(comparison,b.reason,'RULES');
   if(b.useAi&&process.env.AI_MODE!=='nebius')throw Error('AI 연결이 비활성 상태입니다. 연결 설정을 확인하세요.');
   const recommendation=b.useAi?await recommendPlanningAlternative(comparison,b.reason):baseline;
   const decisionId=crypto.randomUUID(),review:PlanningReview={comparison,recommendation,baseline,historyHash:hash(history),expires:Date.now()+10*60000};
   await db.workRecord.create({data:{workspace:recordSpace(),kind:'planningDecision',id:decisionId,payload:JSON.parse(JSON.stringify(review))}});
   return NextResponse.json({...comparison,source:recommendation.source==='NEBIUS'?'NEBIUS':'RULES_AND_SOLVER',inferenceCalled:recommendation.inferenceCalled,calculationSource:'RULES_AND_SOLVER',decisionId,recommendation,baseline,results:comparison.results.map(r=>({...r,previewRequest:r.previewRequest?{...r.previewRequest,decisionId,alternativeId:r.id}:null}))});
  }
  if(b.comparisonSnapshot&&b.comparisonSnapshot!==decisionSnapshot(planning,w,asOf))throw Error('비교 이후 계획·자원·기상자료가 변경되었습니다. 대안을 다시 비교하세요.');
  let decision;
  if(b.decisionId||b.alternativeId){
   if(!b.decisionId||!b.alternativeId||!b.comparisonSnapshot)throw Error('대안 판단 연결 정보가 부족합니다.');
   const review=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'planningDecision',id:b.decisionId}}});
   if(!review)throw Error('이 센터의 판단 기록을 찾을 수 없습니다.');
   decision={decisionId:b.decisionId,...verifyPlanningReview(review.payload as unknown as PlanningReview,b,b.alternativeId,decisionSnapshot(planning,w,asOf),hash(history))};
  }
  const result=b.decisionSource==='DEVELOPMENT_REVIEW'
   ?{...await calculateAnnualReplan(planning,b,w,asOf),source:'DEVELOPMENT_REVIEW',trace:[{tool:'calculate_annual_schedule'}]}
   :await proposeAnnualReplan(planning,b,w,asOf);
  if(result.status!=='FEASIBLE')return NextResponse.json(result);
  const id=crypto.randomUUID(),payload={input:b,result,replanningVersion:REPLANNING_RULE_VERSION,decision:decision??null,historyHash:hash(history),hash:hash(state),weatherHash:weatherHash(w),asOf,expires:Date.now()+10*60000,status:'REVIEW_REQUIRED'};
  await db.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES (${recordSpace()},'replanning',${id},1,${JSON.stringify(payload)}::jsonb)`;
  return NextResponse.json({...result,proposalId:id,decision:decision??null});
 }
 // Refresh forecast outside the transaction; then lock and revalidate saved proposal.
 const w=await forecast();
 const response=await db.$transaction(async tx=>{
  await lockCenterPool(tx);
  const history=await readExecutionHistory(tx);
  const rows=await tx.$queryRaw<{payload:any}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='replanning' AND id=${b.proposalId} FOR UPDATE`;
  const p=rows[0]?.payload;if(!p)throw Error('변경계획을 찾을 수 없습니다.');
  if(p.status==='APPLIED')return {ok:true,alreadyApplied:true,changeRows:p.changeRows??[]};
  if(p.input?.manualFallback||p.result?.manualConversions?.length)throw Error('장비 작업의 인력 대체는 사용하지 않습니다. 장비와 일정으로 다시 계산하세요.');
  if(p.automaticRequestId){
   const receipt=await lockedAutomatic(tx,p.automaticRequestId);
   if(!receipt||execution?.requestId!==p.automaticRequestId)throw Error('자동 재배치 요청에서 저장 결과 확인을 진행하세요.');
   assertAutomaticLease(receipt.payload,execution?.token);
   if(receipt.payload.proposalId!==b.proposalId)throw Error('재배치 요청과 저장 결과 연결 오류');
  }
  if(p.result?.contractVersion!==SCHEDULING_ENGINE_VERSION||p.replanningVersion!==REPLANNING_RULE_VERSION)throw Error('계산 엔진이 변경되었습니다. 변경계획을 다시 계산하세요.');
  const row=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),s=await resourceView(tx,row.state as unknown as State,activeCenterId());
  await assertMissionEnvironmentReferences(tx,s);
  if(p.expires<Date.now()||p.asOf!==todayKst()||p.hash!==hash(s)||p.historyHash!==hash(history)||p.weatherHash!==weatherHash(w))throw Error('계획·기상자료가 변경되었거나 만료됐습니다. 다시 계산하세요.');
  const planned=await resumeReservationState(tx,planningState(s,history),p.input.ids);
  const prepared=prepareAnnualReplan(planned,p.input,w,p.asOf,!!p.result.workSplit?.length),{contract}=prepared;
  if(splitKey(prepared.splits)!==splitKey(p.result.workSplit??[]))throw Error('분할 작업량·연결이 변경되었습니다. 다시 계산하세요.');
  verifyAssignments(contract,p.result.assignments,p.result.phase);
  p.result.diff=annualReplanDiff(planned,prepared,p.result.assignments);
  const beforeState=structuredClone(s);
  if(p.input.outage){const o=equipmentDowntimeSchema.parse(p.input.outage),machine=s.machines.find(m=>m.id===o.machineId)!;machine.downtimes=[...machine.downtimes??[],o];}

  await commitAutomaticLoans(tx,s,p.result.assignments,contract.tasks,slotDate,b.proposalId);
  if(p.input.replacement){const r=p.input.replacement,m=s.machines.find(m=>m.id===r.replacementId)!;m.availableFrom=[m.availableFrom,r.availableFrom].filter(Boolean).sort().at(-1);m.availableUntil=[m.availableUntil,r.availableUntil].filter(Boolean).sort()[0];}
  const changed=new Set<string>();
  for(const d of p.result.diff){
   const template=prepared.state.missions.find(m=>m.id===d.id) as WorkMission;
   let m=s.missions.find(m=>m.id===d.id) as WorkMission|undefined;
   if(!m){m=structuredClone(template);s.missions.push(m);}
   const work=equipmentWork(prepared.state,template);
   if((work&&d.beforeResource!==d.afterResource)||template.equipmentWork)m.equipmentWork=template.equipmentWork??work!;
   if(template.workAreaM2!==undefined)m.workAreaM2=template.workAreaM2;
   if(template.equipmentSplit)m.equipmentSplit=template.equipmentSplit;
   if(template.splitFromId)m.splitFromId=template.splitFromId;
   if(template.splitChildIds)m.splitChildIds=template.splitChildIds;
   if(template.predecessorMissionIds)m.predecessorMissionIds=template.predecessorMissionIds;
   if(template.harvestCarryover)m.harvestCarryover=template.harvestCarryover;
   if(template.laborWorkMinutes!==undefined)m.laborWorkMinutes=template.laborWorkMinutes;
   m.label=template.label;m.originalScheduledDate??=m.scheduledDate;m.start=d.after-dateSlot('2026-09-09');m.scheduledDate=slotDate(d.after);m.month=Number(m.scheduledDate.slice(5,7));
   const job=contract.tasks.find(t=>t.id===m!.id)!,a=p.result.assignments.find((a:any)=>a.id===m!.id);
   m.duration=assignedDuration(job,a);if(template.planningWindow)m.planningWindow={...template.planningWindow,duration:m.duration};
   m.resourceId=assignedResource(job,a);m.status='PLANNED';changed.add(m.fieldId);
   if(prepared.manualConversions.includes(m.id)){m.owner=template.owner;m.staff=template.staff;m.transport=template.transport;m.machineOperators=0;m.ordinaryWorkers=template.ordinaryWorkers;m.farmerWorkers=0;m.operatorIds=[];m.laborSupportIds=[];m.executionMethod='MANUAL';}
  }
  // Solver output also includes unchanged/fixed work. Do not normalize those
  // persisted records (e.g. add empty support arrays) without a reviewed diff.
  const changedMissionIds=new Set(p.result.diff.map((d:any)=>d.id));
  for(const a of p.result.assignments)if(changedMissionIds.has(a.id)){
   const m=s.missions.find(m=>m.id===a.id);if(!m)continue;
   if(a.operatorIds)m.operatorIds=a.operatorIds;
   if(a.laborSupportIds)m.laborSupportIds=a.laborSupportIds;
  }
  if(p.result.diff.length)await syncChangedPlanReservations(tx,activeCenterId(),beforeState,s,p.result.diff.map((d:any)=>d.id),actorLabel());
  if(changed.size){s.planVersion++;for(const r of s.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
   // A farmer may own several changed fields. One idempotent notice per farmer,
   // not duplicate inserts with the same proposal/farmer key.
   const recipients=new Map(s.fields.filter(f=>changed.has(f.id)).map(f=>[f.farmerId,f]));
   for(const f of recipients.values()){
    await tx.outbox.updateMany({where:{centerId:activeCenterId(),farmerId:f.farmerId,status:{in:['PENDING','FAILED']}},data:{status:'SUPERSEDED'}});
    const owned=new Set(s.fields.filter(field=>field.farmerId===f.farmerId).map(field=>field.id));
    const dates=[...new Set(p.result.diff.filter((d:any)=>owned.has(s.missions.find(m=>m.id===d.id)!.fieldId)).map((d:any)=>slotDate(d.after)))].sort().join(', ');
    const dateChanged=p.result.diff.some((d:any)=>owned.has(s.missions.find(m=>m.id===d.id)!.fieldId)&&slotDate(d.before)!==slotDate(d.after));
    await tx.outbox.create({data:{status:'RECORDED_ONLY',id:`replan:${b.proposalId}:${f.farmerId}`,centerId:activeCenterId(),farmerId:f.farmerId,planVersion:s.planVersion,body:`${f.name}님 ${dateChanged?'작업 일정이 '+dates+'로 변경되었습니다.':'작업일('+dates+')은 유지하며 배정 자원·작업시간을 조정했습니다.'} 작업 전 기상·현장 조건을 재확인합니다.`}});
   }
  }
  for(const d of p.result.diff){const before=beforeState.missions.find(m=>m.id===d.id),after=s.missions.find(m=>m.id===d.id);await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES (${recordSpace()},'taskPlanChange',${b.proposalId+':'+d.id},1,${JSON.stringify({proposalId:b.proposalId,before,after,simulation:p.input.simulation??null,reason:p.input.reason??null,scope:p.input.scope??'AUTO',approvedAt:new Date().toISOString(),actor:actorLabel()})}::jsonb)`;}
  await tx.center.update({where:{id:activeCenterId()},data:{state:s as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  const changeRows=scheduleChangeRows(beforeState,s,p.result.diff.map((d:any)=>d.id));
  p.status='APPLIED';p.changeRows=changeRows;await tx.$executeRaw`UPDATE "WorkRecord" SET payload=${JSON.stringify(p)}::jsonb,version=version+1 WHERE workspace=${recordSpace()} AND kind='replanning' AND id=${b.proposalId}`;
  if(p.automaticRequestId){
   const key={workspace:recordSpace(),kind:'automaticReplan',id:p.automaticRequestId};
   const receipt=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key}}),payload=receipt.payload as any;
   if(payload.proposalId!==b.proposalId||payload.preparedResult?.status!=='APPLIED')throw Error('재배치 요청과 저장 결과 연결 오류');
   await tx.workRecord.update({where:{workspace_kind_id:key},data:{version:{increment:1},payload:{...payload,status:'APPLIED',result:{...payload.preparedResult,changeRows},finishedAt:new Date().toISOString(),externalPurchase:false,externalDispatch:false}}});
  }
  await tx.audit.create({data:{centerId:activeCenterId(),action:'annualReplan.approve',detail:{proposalId:b.proposalId,phase:p.result.phase,changes:p.result.diff.length,planVersion:s.planVersion,decision:p.decision??null}}});
  return {ok:true,planVersion:s.planVersion,changeRows};
 },{timeout:20000});return NextResponse.json(response);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'계산 실패'},{status:409})}
}

