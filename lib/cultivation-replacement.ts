import {cropNames} from './crop-registry';
import {centerId as activeCenterId,recordSpace} from './workspace';
import {isClosedTask} from './task-lifecycle';
import {createHash,randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {buildAnnualPlan,type AnnualPlan} from './annual-plan';
import {previewAnnualDispatch,dispatchPlacementKey} from './annual-dispatch';
import {previousCultivationTerminals,type Cultivation} from './cultivation';
import type {FieldEntry} from './field-record';
import type {GuidelineContext} from './crop-guidelines';
import type {State} from './types';
import {syncChangedPlanReservations} from './plan-reservation-sync';
import {plannedLaborDemand,ordinaryWorkerDemand} from './planned-labor-demand';
import {appendAssignments} from './plan-missions';
import {availableFor,notice,emptyLaborOps,type LaborOps,type LaborJob} from './labor-operations';
import {validateReservations,reservationSchema} from './shared-reservations';
import {SCHEDULING_ENGINE_VERSION} from './scheduling-engine';
import {preserveCompletedWorkAreas} from './completed-work-area';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=(kind:string,id:string)=>({workspace:recordSpace(),kind,id});
export type ReplacementInput={id:string;crop:import('./crop-registry').SupportedCropCode;area:number;action:string;token?:string;context?:GuidelineContext;review?:{cost:string;consent:string}};
/** Caller holds center, inventory and cultivation locks. All writes commit together. */
export async function replaceCultivation(tx:Prisma.TransactionClient,b:ReplacementInput,actor:string,c:Cultivation,old:AnnualPlan,fields:FieldEntry[],version:number,state:State){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace()}`}))`;
 const inventory=fields.find(f=>f.pnu===c.pnu)!;
 const linked=state.missions.filter(m=>(m as any).cultivationId===c.id||((m as any).operationKey??'').startsWith(`cultivation:${c.id}:`));
 const preserved=linked.filter(m=>isClosedTask(m.status)),removed=linked.filter(m=>!isClosedTask(m.status));
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const blockers:string[]=[];
 if(removed.some(m=>!m.scheduledDate||m.scheduledDate<=today))blockers.push('당일·과거 미완료 작업의 실제 수행 상태를 먼저 확인하세요.');
 if(removed.some(m=>(m as any).safetyLock||(m as any).executionStartedAt))blockers.push('실행 중 또는 안전 잠금 작업은 별도 안전 절차가 필요합니다.');
 if(removed.some(m=>!['PLANNED','HELD','UNSTAFFED'].includes(m.status)||state.machines.some(r=>r.id===m.resourceId&&(r.safetyLock||r.status==='WORKING'))))blockers.push('가동 중 장비 또는 안전 잠금 상태를 먼저 확인하세요.');
 if(state.missions.some(m=>!linked.includes(m)&&(m as any).predecessorMissionIds?.some((id:string)=>removed.some(r=>r.id===id))))blockers.push('다른 재배의 후속 작업이 연결되어 있습니다. 함께 변경 검토해야 합니다.');
 if(old.plots.some(p=>p.environmental))blockers.push('환경 기준 연결 계획은 최신 예보·생육 검토를 다시 저장한 뒤 변경해야 합니다.');
 const cropChanged=c.crop!==b.crop;
 const next={...c,crop:b.crop},updated={...inventory,crop:b.crop,area:b.area};
 const context=b.context??(cropChanged?{region:old.context.region}:old.context);
 const plan=buildAnnualPlan([updated],Number(c.start.slice(0,4)),version+1,context,next,undefined,state);
 if(!cropChanged){const mapping=new Map<string,string>();for(const t of plan.plots[0].tasks){const previous=old.plots[0].tasks.find(p=>p.operationCode===t.operationCode&&p.occurrence===t.occurrence&&('part' in p?p.part:1)===('part' in t?t.part:1));if(previous){mapping.set(t.operationKey,previous.operationKey);t.id=previous.id;}}for(const t of plan.plots[0].tasks){t.operationKey=mapping.get(t.operationKey)??t.operationKey;t.predecessorKeys=t.predecessorKeys.map(k=>mapping.get(k)??k);}}
 if(!cropChanged)blockers.push(...preserveCompletedWorkAreas(plan,old,preserved));
 // Crop replacement must never count the former crop's completed operations as new work.
 if(cropChanged){const suffix=':replacement:'+hash({c,version,crop:b.crop}).slice(0,12),mapping=new Map(plan.plots[0].tasks.map(t=>[t.operationKey,t.operationKey+suffix]));for(const t of plan.plots[0].tasks){t.id+=suffix;t.operationKey=mapping.get(t.operationKey)!;t.predecessorKeys=t.predecessorKeys.map(k=>mapping.get(k)??k);}}
 if(cropChanged&&preserved.length){const last=preserved.filter(m=>m.status==='COMPLETED').map(m=>m.scheduledDate).filter((d):d is string=>!!d).sort().at(-1);if(last){const first=new Date(Date.parse(last)+86400000).toISOString().slice(0,10);for(const t of plan.plots[0].tasks)if(t.window&&t.window.from<first)t.window={...t.window,from:first};}}
 if(c.previousId){const previous=await tx.workRecord.findUnique({where:{workspace_kind_id:key('cultivation',c.previousId)}});if(previous){const terminals=previousCultivationTerminals(previous.payload as unknown as Cultivation,state.missions);for(const t of plan.plots[0].tasks)if(!t.predecessorKeys.length)t.predecessorKeys.push(...terminals);}}
 const base=structuredClone(state);base.missions=base.missions.filter(m=>!removed.some(r=>r.id===m.id));
 const dispatch=(await previewAnnualDispatch(plan,base,today));
 if(dispatch.feasibility.some(f=>f.status!=='CAPACITY_FEASIBLE'))blockers.push('필수 작업의 기간·장비·인력 조건이 부족합니다. 기준을 보완하세요.');
 const rows=await tx.workRecord.findMany({where:{OR:[{workspace:'shared',kind:'resourceReservation'},{workspace:recordSpace(),kind:'laborOperations',id:'current'}]}});
 const laborRow=rows.find(r=>r.kind==='laborOperations'),labor=laborRow?.payload as unknown as LaborOps|undefined;
 const reservations=rows.filter(r=>r.kind==='resourceReservation'&&removed.some(m=>m.id===(r.payload as any).taskId));
 const jobs=labor?.jobs.filter(j=>removed.some(m=>m.id===j.missionId))??[];
 if(!state.fields.find(f=>f.id===c.pnu)?.farmerId)blockers.push('농부 연락 대상 연결을 먼저 확인하세요.');
 try{validateReservations(dispatch.assignments.filter(a=>a.machineId).map(a=>reservationSchema.parse({id:'preview:'+a.taskId,centerId:activeCenterId(),taskId:a.taskId,resourceId:a.machineId,from:new Date(Date.parse(a.date+'T08:00:00+09:00')+(a.startMinute-480)*60000).toISOString(),to:new Date(Date.parse(a.date+'T08:00:00+09:00')+(a.startMinute-480+a.durationMinutes)*60000).toISOString()})),rows.filter(r=>r.kind==='resourceReservation'&&!reservations.includes(r)).map(r=>reservationSchema.parse(r.payload)));}catch{blockers.push('센터 간 공통 예약과 충돌합니다. 자원·작업기간을 조정하세요.');}
 if(jobs.some(j=>j.status==='COMPLETED'))blockers.push('근무 실적이 연결된 작업입니다. 작업 완료 기록을 먼저 정합화하세요.');
 const impact={preserved:preserved.map(m=>({id:m.id,name:m.label,date:m.scheduledDate})),removed:removed.map(m=>({id:m.id,name:m.label,date:m.scheduledDate,resourceId:m.resourceId})),reservations:reservations.map(r=>r.payload),labor:jobs.map(j=>({id:j.id,missionId:j.missionId,date:j.date,assigned:j.assigned,invited:j.invited})),cost:{status:'REVIEW_REQUIRED',amount:null,note:'기발생 실비·취소 비용·추가 작업비를 담당자가 확인합니다. 미확인 단가로 금액을 만들지 않습니다.'},consent:{status:'REVIEW_REQUIRED',note:'작물·면적 변경에 대한 농부 동의 또는 유효한 위임 근거를 확인합니다.'}};
 const token=hash({engine:SCHEDULING_ENGINE_VERSION,placement:dispatchPlacementKey(dispatch.assignments),b:{id:b.id,crop:b.crop,area:b.area,context},c,old,fields,version,state,rows,today});
 if(b.action!=='approve')return {token,saved:false,requiresApproval:true,approvedPlan:true,blockers,impact,tasks:plan.taskCount,dispatch};
 if(b.token!==token)throw Error('변경안 이후 계획·예약·인력이 변경되었습니다. 다시 계산하세요.');
 if(blockers.length)throw Error(blockers.join(' '));
 if(!b.review?.cost.trim()||!b.review?.consent.trim())throw Error('비용 검토와 농부 동의·위임 근거를 기록하세요.');
 const after=appendAssignments(base,plan,dispatch);after.fields=after.fields.map(f=>f.id===c.pnu?{...f,area:b.area,crop:cropNames[b.crop]}:f);
 const changed=[...new Set([...removed.map(m=>m.id),...dispatch.assignments.map(a=>a.taskId)])];
 await tx.workRecord.create({data:{...key('cultivationChangeHistory',token),payload:json({actor,at:new Date().toISOString(),review:b.review,cycle:c,old,field:inventory,missions:linked,reservations:reservations.map(r=>r.payload),laborJobs:jobs})}});
 // Materialize the authoritative new demand before the shared reconciler runs.
 // Otherwise it creates split-day demand from the parent and a later INSERT
 // collides with that same new day. All writes still share this transaction.
 for(const m of removed)for(const kind of ['annualReservation','laborDemand'])await tx.workRecord.deleteMany({where:key(kind,m.id)});
 for(const a of dispatch.assignments){await tx.workRecord.create({data:{...key('annualReservation',a.taskId),payload:json({...a,status:'RESERVED',approvedBy:actor,source:'COMMON_PLAN_CHANGE'})}});await tx.workRecord.create({data:{...key('laborDemand',a.taskId),payload:json(plannedLaborDemand(plan,a))}});}
 await syncChangedPlanReservations(tx,activeCenterId(),state,after,changed,actor,true);
 // Existing jobs are invalidated/reconfirmed by the shared reconciler. Add new demands
 // without inheriting previous attendance or manual assignments.
 const latestLabor=await tx.workRecord.findUnique({where:{workspace_kind_id:key('laborOperations','current')}});
 const ops=latestLabor?latestLabor.payload as unknown as LaborOps:emptyLaborOps();
 for(const a of dispatch.assignments){const mission=after.missions.find(m=>m.id===a.taskId)!,count=ordinaryWorkerDemand(mission);if(!count||ops.jobs.some(j=>j.missionId===a.taskId&&j.status==='OPEN'))continue;
  const value={id:a.taskId,missionId:a.taskId,task:mission.label,address:inventory.address,date:a.date,startMinute:a.startMinute,durationMinutes:a.durationMinutes,count,workCode:plan.plots[0].tasks.find(t=>t.id===a.taskId)!.operationCode,held:false};
  const job:LaborJob={...value,id:randomUUID(),sourceHash:hash(value),pay:'담당자 확인 필요',status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]};job.invited=ops.people.filter(p=>availableFor(p,job)).map(p=>p.id);ops.jobs.push(job);for(const worker of job.invited)notice(ops,job,worker,'RECONFIRM',new Date().toISOString());
 }
 await tx.workRecord.upsert({where:{workspace_kind_id:key('laborOperations','current')},create:{...key('laborOperations','current'),payload:json(ops)},update:{payload:json(ops),version:{increment:1}}});
 await tx.workRecord.update({where:{workspace_kind_id:key('fields','current')},data:{version:{increment:1},payload:json(fields.map(f=>f.pnu===c.pnu?updated:f))}});
 await tx.workRecord.update({where:{workspace_kind_id:key('cultivation',c.id)},data:{version:{increment:1},payload:json(next)}});
 await tx.workRecord.update({where:{workspace_kind_id:key('cultivationPlan',c.id)},data:{version:{increment:1},payload:json(plan)}});
 after.planVersion++;await tx.center.update({where:{id:activeCenterId()},data:{version:{increment:1},state:json(after)}});
 const farmer=after.fields.find(f=>f.id===c.pnu)?.farmerId;
 if(farmer)await tx.outbox.create({data:{id:'cultivation-change:'+token,centerId:activeCenterId(),farmerId:farmer,planVersion:after.planVersion,body:`[모의 알림] ${inventory.address} 재배계획 변경: ${after.fields.find(f=>f.id===c.pnu)?.crop}, ${b.area}㎡. 이전 안내보다 최신 계획을 확인해주세요.`}});
 const result={token,request:{id:b.id,crop:b.crop,area:b.area,context:b.context??null,review:b.review,actor},saved:true,approvedPlan:true,impact,dispatch,blockers:[],tasks:plan.taskCount,notifications:farmer?1:0,planVersion:after.planVersion};
 await tx.workRecord.create({data:{...key('cultivationChangeApproval',token),payload:json(result)}});
 return result;
}
