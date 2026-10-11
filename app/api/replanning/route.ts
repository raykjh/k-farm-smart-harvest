import {resourceView,lockCenterPool} from '@/lib/center-resources';
import {commitAutomaticLoans} from '@/lib/equipment-sharing-offers';
import {assignedResource} from '@/lib/annual-replanning';
import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel} from '@/lib/auth';
import {resumeReservationState} from '@/lib/resume-reservation';
import {syncChangedPlanReservations} from '@/lib/plan-reservation-sync';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {readExecutionHistory,planningState} from '../../../lib/replan-history';
import {executionStatus} from '../../../lib/execution-view';
import {db} from '../../../lib/db';
import {readShortForecast} from '../../../lib/kma-forecast';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
import {calculateAnnualReplan,dateSlot,hash,prepareAnnualReplan,annualReplanDiff,REPLANNING_RULE_VERSION,slotDate,todayKst,verifyAssignments,weatherHash} from '../../../lib/annual-replanning';
import {splitKey,type WorkMission} from '@/lib/replan-work-split';
import {equipmentWork} from '@/lib/replan-resource-options';
import {assignedDuration} from '@/lib/scheduling-engine';
import type {State} from '../../../lib/types';
import type {Prisma} from '@prisma/client';
import {proposeAnnualReplan} from '../../../lib/annual-planning-agent';
import {replacementSchema} from '../../../lib/equipment-replacement';
import {compareReplanAlternatives,decisionSnapshot,replanAlternativesSchema} from '@/lib/planning-decision';
import {assertMissionEnvironmentReferences} from '@/lib/environment-approval';
import {recommendPlanningAlternative} from '@/lib/planning-adviser';
import {verifyPlanningReview,type PlanningReview} from '@/lib/planning-review';
import {SCHEDULING_ENGINE_VERSION} from '@/lib/scheduling-engine';
import {decisionPriorities} from '@/lib/planning-priority';
export const runtime='nodejs';
const requestFields={ids:z.array(z.string().min(1).max(200)).min(1).max(600),day:z.string().optional(),preferred:z.string().optional(),reason:z.string().trim().min(1).max(500).optional(),scope:z.enum(['PRESERVE','EXPAND']).optional(),automaticReplacement:z.boolean().optional(),newLaborSupport:z.boolean().optional(),replacement:replacementSchema.optional(),simulation:z.object({kind:z.enum(['WIND','RAIN','DROUGHT']),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).optional()};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('preview'),...requestFields,decisionPriority:z.enum(decisionPriorities).optional(),decisionSource:z.literal('DEVELOPMENT_REVIEW').optional(),comparisonSnapshot:z.string().regex(/^[a-f0-9]{64}$/).optional(),decisionId:z.string().uuid().optional(),alternativeId:z.string().min(1).max(80).optional()}).strict(),
 z.object({action:z.literal('compare'),...requestFields,decisionPriority:z.enum(decisionPriorities).optional(),alternatives:replanAlternativesSchema,useAi:z.boolean().optional()}).strict(),
 z.object({action:z.literal('approve'),proposalId:z.string().uuid()}).strict(),
]);
const forecast=async()=>readShortForecast(await readCenterWeatherConfig());
async function handlePOST(req:NextRequest){
 const origin=req.headers.get('origin');if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(origin&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(origin)))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const b=schema.parse(await req.json());
 if(b.action==='preview'||b.action==='compare'){
  const row=await db.center.findUniqueOrThrow({where:{id:activeCenterId()}}),state=await resourceView(db,row.state as unknown as State,activeCenterId());
  const w=await forecast(),asOf=todayKst();
  const history=await readExecutionHistory();
  if(b.ids.some(id=>{const m=state.missions.find(m=>m.id===id);return m&&executionStatus(state,m,history)==='UNKNOWN'}))throw Error('실적 확인이 필요한 작업은 확인 후 재배치하세요.');
  const planning=await resumeReservationState(db,planningState(state,history),b.ids);
  if(b.action==='compare'){
   const comparison=await compareReplanAlternatives(planning,b,b.alternatives,w,asOf);
   const baseline=await recommendPlanningAlternative(comparison,b.reason,'RULES');
   if(b.useAi&&process.env.AI_MODE!=='nebius')throw Error('AI 연결이 비활성 상태입니다. AI 판단을 해제하면 계산 기준으로 비교할 수 있습니다.');
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
  if(p.status==='APPLIED')return {ok:true,alreadyApplied:true};
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
   m.label=template.label;m.originalScheduledDate??=m.scheduledDate;m.start=d.after-dateSlot('2026-09-09');m.scheduledDate=slotDate(d.after);m.month=Number(m.scheduledDate.slice(5,7));
   const job=contract.tasks.find(t=>t.id===m!.id)!,a=p.result.assignments.find((a:any)=>a.id===m!.id);
   m.duration=assignedDuration(job,a);if(template.planningWindow)m.planningWindow={...template.planningWindow,duration:m.duration};
   m.resourceId=assignedResource(job,a);m.status='PLANNED';changed.add(m.fieldId);
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
    await tx.outbox.create({data:{id:`replan:${b.proposalId}:${f.farmerId}`,centerId:activeCenterId(),farmerId:f.farmerId,planVersion:s.planVersion,body:`${f.name}님 ${dateChanged?'작업 일정이 '+dates+'로 변경되었습니다.':'작업일('+dates+')은 유지하며 배정 자원·작업시간을 조정했습니다.'} 작업 전 기상·현장 조건을 재확인합니다.`}});
   }
  }
  for(const d of p.result.diff){const before=beforeState.missions.find(m=>m.id===d.id),after=s.missions.find(m=>m.id===d.id);await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES (${recordSpace()},'taskPlanChange',${b.proposalId+':'+d.id},1,${JSON.stringify({proposalId:b.proposalId,before,after,simulation:p.input.simulation??null,reason:p.input.reason??null,scope:p.input.scope??'AUTO',approvedAt:new Date().toISOString(),actor:actorLabel()})}::jsonb)`;}
  await tx.center.update({where:{id:activeCenterId()},data:{state:s as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  p.status='APPLIED';await tx.$executeRaw`UPDATE "WorkRecord" SET payload=${JSON.stringify(p)}::jsonb,version=version+1 WHERE workspace=${recordSpace()} AND kind='replanning' AND id=${b.proposalId}`;
  await tx.audit.create({data:{centerId:activeCenterId(),action:'annualReplan.approve',detail:{proposalId:b.proposalId,phase:p.result.phase,changes:p.result.diff.length,planVersion:s.planVersion,decision:p.decision??null}}});
  return {ok:true,planVersion:s.planVersion};
 },{timeout:20000});return NextResponse.json(response);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'계산 실패'},{status:409})}
}

export const POST=withAuth('replanning',handlePOST);
