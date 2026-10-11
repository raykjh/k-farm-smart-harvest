import {crewCapacityLimits} from './operating-capacity';
import {withLaborSupport,laborCapacityBlocks} from './labor-capacity';
import {withNamedOperators} from './named-operators';
import {operatingTaskCrew} from './planned-labor-demand';
import {isClosedTask} from './task-lifecycle';
import type {AnnualPlan} from './annual-plan';
import {machineAvailableToCenter} from './center-sharing';
import type {State,Mission} from './types';
import {operationRequirement} from './operation-requirements';
import type {CropCode} from './crop-guidelines';
import {missionResourceUse} from './scheduling-constraints';
import {dateSlot,slotDate,solveSchedule,assignedDuration,assignedResource,SCHEDULING_ENGINE_VERSION,type SchedulingJob,type ResourceOption} from './scheduling-engine';

type Plot=AnnualPlan['plots'][number];
type Task=Plot['tasks'][number];
type Candidate={plot:Plot;task:Task;operationKey:string;req:ReturnType<typeof operationRequirement>;job:SchedulingJob;predecessorMissionIds:string[]};
const missionKeys=(m:Mission)=>[(m as Mission&{operationKey?:string}).operationKey,(m as Mission&{cultivationOperationKey?:string}).cultivationOperationKey];
const keyMatches=(key:string,record:string|undefined)=>record===key||key.endsWith(':soil')&&record?.startsWith(key+':')&&!/^part\d+(?:$|:)/.test(record.slice(key.length+1));

/** Stable through JSONB key reordering, and independent of solver search metadata. */
export const dispatchPlacementKey=(assignments:any[])=>JSON.stringify([...assignments].sort((a,b)=>a.taskId.localeCompare(b.taskId)).map(a=>[
 a.taskId,a.operationKey,a.pnu,a.date,a.startMinute,a.durationMinutes,a.machineId,a.owner,a.staff,a.transport,[...(a.predecessorMissionIds??[])].sort(),[...(a.operatorIds??[])].sort(),[...(a.laborSupportIds??[])].sort(),
]));

/** Initial admission adapter. Existing work is immutable; all NEW work in this
 * candidate is solved together by the same CP-SAT engine used for replanning. */
export async function previewAnnualDispatch(plan:AnnualPlan,state:State,today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)){
 const assignments:any[]=[],pending:{id:string;reason:string}[]=[],candidates:Candidate[]=[];
 const wait=(id:string,reason:string)=>{if(!pending.some(p=>p.id===id))pending.push({id,reason});};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(dateSlot(today))||slotDate(dateSlot(today))!==today)throw Error('계획 날짜 확인 필요');
 for(const plot of plan.plots)for(const task of plot.tasks){
  const operationKey=task.operationKey??[plan.year,plot.pnu,plot.crop,task.id.split(':').at(-1)].join(':');
  if(state.missions.some(m=>m.id===task.id||missionKeys(m).includes(operationKey))){wait(task.id,'기존 계획·실적 연결됨');continue;}
  if(state.missions.some(m=>m.fieldId===plot.pnu&&m.scheduledDate?.startsWith(plan.year+'-')&&!missionKeys(m)[0])){wait(task.id,'기존 작업 단계 연결 확인 필요: 중복 배차 차단');continue;}
  if(!task.predecessorKeys){wait(task.id,'선후행 규칙이 포함된 최신 초안 생성 필요');continue;}
  if('executionBlocked' in task&&task.executionBlocked){wait(task.id,task.executionBlocked);continue;}
  if(!task.window){wait(task.id,'작업 기간 확인 필요');continue;}
  const req=task.requirements??operationRequirement(plot.crop as CropCode,task.id.split(':').at(-1)!,plot.mode);
  if(!req.machineCode&&req.laborMinutesPer1000m2===null){wait(task.id,'인력 작업속도 확인 필요');continue;}
  const resources=req.machineCode?state.machines.filter(m=>m.id.includes(req.machineCode!)&&m.status==='AVAILABLE'&&!m.safetyLock&&m.capacityHaHour>0&&(!('compatibilityCrop' in task)||!task.compatibilityCrop||m.compatibleCrops?.includes(task.compatibilityCrop))):[null];
  const options:ResourceOption[]=[];
  const lower=Math.max(dateSlot(task.window.from),dateSlot(today)+32),upper=dateSlot(task.window.to)+32;
  if(!Number.isFinite(lower)||!Number.isFinite(upper)||upper-lower>731*32){wait(task.id,'작업 기간 확인 필요');continue;}
  for(const machine of resources){
   const workArea='workAreaM2' in task?task.workAreaM2:plot.area;
   const duration=Math.max(1,Math.ceil(((machine?workArea/10000/machine.capacityHaHour*60:workArea/1000*req.laborMinutesPer1000m2!)+req.setupMinutes)/15-1e-9));
   if(!Number.isFinite(duration)||duration>32)continue;
   const allowed:number[]=[];
   for(let day=lower;day<upper;day+=32){
    const date=slotDate(day);
    if(task.allowedWindows&&!task.allowedWindows.some(w=>w.from<=date&&date<=w.to))continue;
    if(machine&&(!machineAvailableToCenter(machine,date,state.centerSharing)||machine.availableFrom&&date<machine.availableFrom||machine.availableUntil&&date>machine.availableUntil||state.centerSharing?.blocks?.some(b=>b.machineId===machine.id&&b.date===date)))continue;
    for(let slot=0;slot+duration<=32;slot++)allowed.push(day+slot);
   }
   if(allowed.length)options.push({resource:machine?.id??null,allowed,duration,borrowed:!!machine?.ownerCenterId&&machine.ownerCenterId!==(state.centerSharing?.centerId??'demo')});
  }
  if(!options.length){wait(task.id,'확인된 작업기간 안에 자원 여유 없음');continue;}
  const first=options[0],use=missionResourceUse(state,{fieldId:plot.pnu,resourceId:first.resource,owner:req.owner as Mission['owner'],staff:req.staff,transport:req.transport,...operatingTaskCrew(task)},plot.consultationId??undefined);
  const job:SchedulingJob={...use,id:task.id,original:lower,duration:first.duration!,allowed:first.allowed,options,
   selected:true,movable:true,optional:true,required:task.kind!=='CONDITIONAL'&&task.kind!=='INSPECTION',preferred:null,predecessor:null,predecessors:[]};
  candidates.push({plot,task,operationKey,req,job:withLaborSupport(state,withNamedOperators(state,job,{resourceId:first.resource,staff:req.staff,...operatingTaskCrew(task)}),{owner:req.owner as Mission['owner'],resourceId:first.resource,staff:req.staff,...operatingTaskCrew(task),operationCode:task.operationCode}),predecessorMissionIds:[]});
 }
 // Resolve the entire graph, not just tasks that happened to appear earlier in
 // the array. Completed records supply a lower bound without being rescheduled.
 for(const c of candidates){
  let earliest=-Infinity;
  for(const key of c.task.predecessorKeys){
   const linked=state.missions.filter(m=>missionKeys(m).some(k=>keyMatches(key,k)));
   const childIds=new Set(linked.flatMap(m=>(m as Mission&{splitChildIds?:string[]}).splitChildIds??[]));
   const records=state.missions.filter(m=>linked.includes(m)||childIds.has(m.id));
   const generated=candidates.filter(other=>keyMatches(key,other.operationKey));
   if(!records.length&&!generated.length){wait(c.task.id,'선행 작업의 계획·실적 확인 필요');break;}
   for(const m of records){
    if(!m.scheduledDate||['CANCELLED','HELD','UNSTAFFED'].includes(m.status)||!Number.isInteger(m.start)||!Number.isInteger(m.duration)){wait(c.task.id,'선행 작업의 계획·실적 확인 필요');break;}
    c.predecessorMissionIds.push(m.id);
    earliest=Math.max(earliest,dateSlot(m.scheduledDate)+(m.start%32+32)%32+m.duration);
   }
   c.job.predecessors!.push(...generated.map(other=>other.job.id));
   c.predecessorMissionIds.push(...generated.map(other=>other.job.id));
  }
  c.job.options=c.job.options!.map(o=>({...o,allowed:o.allowed.filter(start=>start>=earliest)}));
  if(!c.job.options.some(o=>o.allowed.length))wait(c.task.id,'선행 작업 이후 작업기간 안에 자원 여유 없음');
 }
 // Broken references and cycles cannot acquire a schedule just because partial
 // admission is allowed. Exclude descendants of structurally blocked tasks.
 const visited=new Set<string>(),visiting=new Set<string>();
 const visit=(c:Candidate):boolean=>{
  if(pending.some(p=>p.id===c.job.id))return false;
  if(visiting.has(c.job.id)){wait(c.job.id,'선후행 작업 연결 순환 오류');return false;}
  if(visited.has(c.job.id))return true;
  visiting.add(c.job.id);
  for(const id of c.job.predecessors??[]){const prev=candidates.find(p=>p.job.id===id);if(!prev||!visit(prev)){wait(c.job.id,'선행 작업의 계획·실적 확인 필요');visiting.delete(c.job.id);return false;}}
  visiting.delete(c.job.id);visited.add(c.job.id);return true;
 };
 const eligible=candidates.filter(visit),jobs=eligible.map(c=>c.job);
 // Only occupancy intersecting a new domain matters; unrelated historical
 // inconsistencies never cause an annual plan to rewrite old records.
 const days=new Set(jobs.flatMap(j=>j.options!.flatMap(o=>o.allowed.map(s=>Math.floor(s/32)))));
 const fixed:SchedulingJob[]=state.missions.filter(m=>m.scheduledDate&&!isClosedTask(m.status)&&days.has(Math.floor(dateSlot(m.scheduledDate)/32))).map(m=>{
  const original=dateSlot(m.scheduledDate!)+(m.start%32+32)%32;
  return withLaborSupport(state,withNamedOperators(state,{...missionResourceUse(state,m),id:m.id,original,duration:m.duration,allowed:[original],locked:true,movable:false,selected:false,preferred:null,predecessor:null},m),m);
 });
 let optimal:boolean|null=null;
 if(jobs.length){
  const result=await solveSchedule({tasks:[...fixed,...jobs],capacityLimits:crewCapacityLimits(state),capacityBlocks:laborCapacityBlocks(state),purpose:'INITIAL',freezeBefore:dateSlot(today)+32,daily:false,staffCapacity:state.staffCount,transportCapacity:state.transportCount,rebuildMode:'PRESERVE'});
  if(result.status==='FEASIBLE'){
   optimal=result.optimal;
   for(const c of eligible){const a=result.assignments.find(a=>a.id===c.job.id);if(!a){wait(c.job.id,'확인된 작업기간 안에 자원 여유 없음');continue;}
    assignments.push({taskId:c.task.id,operationKey:c.operationKey,predecessorMissionIds:[...new Set(c.predecessorMissionIds)],pnu:c.plot.pnu,date:slotDate(a.start),machineId:assignedResource(c.job,a),...(a.operatorIds?{operatorIds:a.operatorIds}:{}),...(a.laborSupportIds?{laborSupportIds:a.laborSupportIds}:{}),owner:c.req.owner,staff:c.job.staff,transport:c.job.transport,startMinute:480+(a.start%32+32)%32*15,durationMinutes:assignedDuration(c.job,a)*15,status:'CAPACITY_PREVIEW_ONLY'});
   }
  }else for(const c of eligible)wait(c.job.id,result.reason);
 }
 const feasibility=plan.plots.map(plot=>{
  const required=plot.tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT');
  const missing=required.filter(task=>!assignments.some(a=>a.taskId===task.id)&&!state.missions.some(m=>(m.id===task.id||!!task.operationKey&&missionKeys(m).includes(task.operationKey))&&!!m.scheduledDate&&(m.status==='PLANNED'||m.status==='COMPLETED'))).map(t=>({taskId:t.id,name:t.name,reason:pending.find(p=>p.id===t.id)?.reason??'필수 단계 배차 확인 필요'}));
  return {pnu:plot.pnu,status:missing.length||!required.length?'INCOMPLETE':'CAPACITY_FEASIBLE',missing,policy:'PROCESS_AND_REPEAT_REQUIRED_V1'};
 });
 return {assignments,pending,feasibility,status:'NOT_RESERVED',engineVersion:SCHEDULING_ENGINE_VERSION,optimal,warning:'저장된 장비 처리능력으로 계산한 검토용 배차. 실제 예약·작업명령 없음. 권한·장비 제원·작업 전 기상·토양 조건 확인 필요.'};
}
