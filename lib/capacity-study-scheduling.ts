import {baselineResourcesSchema,studyIncidentSchema,contentHash,type BaselineResources,type StudyIncident,type CapacityStudyInput} from './capacity-study-input';
import {compileCapacityWorkload,workDates,type WorkloadTask} from './capacity-workload';
import {dateSlot,slotDate,solveSchedule,verifySchedule,assignedDuration,type SchedulingContract,type SchedulingJob,type SchedulingAssignment,type ScheduleResult} from './scheduling-engine';

export type StudyLoan={machineId:string;borrowerCenterId:string;from:string;to:string;operatorAndTransportConfirmed:boolean;permission:'ASSUMED_FOR_STUDY'|'CONFIRMED';transferSlots:number};
export type StudyCalculationContext={
 neighbors:Record<string,string[]>;loans:StudyLoan[];incidents:StudyIncident[];
 /** Immutable comparison output, not an operating reservation. */
 fixedAssignments?:SchedulingAssignment[];
};
type Calculation=typeof solveSchedule;
const on=(date:string,v:{from:string;to:string})=>v.from<=date&&date<=v.to;
/** Study assumptions are bounded to compatible operation windows, not a year-long permission. */
export function studyLoanWindows(tasks:WorkloadTask[],baseline:BaselineResources,neighbors:Record<string,string[]>):StudyLoan[]{
 const result:StudyLoan[]=[];
 for(const machine of baseline.machines)for(const [borrowerCenterId,adjacent] of Object.entries(neighbors)){
  if(borrowerCenterId===machine.ownerCenterId||!adjacent.includes(machine.ownerCenterId))continue;
  const dates=[...new Set(tasks.filter(t=>t.centerId===borrowerCenterId&&t.method.capability===machine.capability&&machine.compatibleCrops.includes(t.cropId)&&t.durationSlots+4<=32).flatMap(t=>workDates(t.from,t.to)))].sort();
  for(const date of dates){
   const prior=result.at(-1);
   if(prior?.machineId===machine.id&&prior.borrowerCenterId===borrowerCenterId&&dateSlot(date)===dateSlot(prior.to)+32)prior.to=date;
   else result.push({machineId:machine.id,borrowerCenterId,from:date,to:date,operatorAndTransportConfirmed:true,permission:'ASSUMED_FOR_STUDY',transferSlots:4});
  }
 }return result;
}
export function workloadSchedulingContract(tasks:WorkloadTask[],baseline:BaselineResources,context:StudyCalculationContext,allowBorrowing:boolean):SchedulingContract{
 baselineResourcesSchema.parse(baseline);context.incidents.forEach(i=>studyIncidentSchema.parse(i));
 const absences=context.incidents.filter(i=>i.kind==='LABOR_ABSENCE');
 for(let i=0;i<absences.length;i++)for(let j=i+1;j<absences.length;j++)if(absences[i].centerId===absences[j].centerId&&absences[i].from<=absences[j].to&&absences[j].from<=absences[i].to)throw Error('기간이 겹치는 인력 불참은 해당 기간의 총인원으로 통합해 입력하세요.');
 if(tasks.length>5000)throw Error('상세 계산 요청은 5,000작업까지입니다. 작업을 자동 생략하지 않습니다.');
 const limits:Record<string,number>={};for(const c of baseline.centers)for(const key of ['operators','workers','transport'] as const)limits[`${c.centerId}:${key}`]=c[key];
 const fixed=new Map((context.fixedAssignments??[]).map(a=>[a.id,a]));
 if(fixed.size!==(context.fixedAssignments?.length??0)||[...fixed.keys()].some(id=>!tasks.some(t=>t.id===id)))throw Error('고정 일정의 작업 식별자가 중복되거나 현재 작업 집합에 없습니다.');
 const fixedDays=new Map<string,Set<string>>();
 for(const a of fixed.values())if(a.resource){const key=JSON.stringify([a.resource,slotDate(a.start)]),centers=fixedDays.get(key)??new Set<string>();centers.add(tasks.find(t=>t.id===a.id)!.centerId);fixedDays.set(key,centers);}
 const jobs:SchedulingJob[]=tasks.map(t=>{
  const m=t.method,center=baseline.centers.find(c=>c.centerId===t.centerId)!;
  const candidates=m.capability?baseline.machines.filter(e=>e.capability===m.capability&&e.compatibleCrops.includes(t.cropId)&&(e.ownerCenterId===t.centerId||allowBorrowing&&context.neighbors[t.centerId]?.includes(e.ownerCenterId))):[null];
  const options=candidates.flatMap(e=>{
   const borrowed=!!e&&e.ownerCenterId!==t.centerId;
   const loans=borrowed?context.loans.filter(l=>l.machineId===e!.id&&l.borrowerCenterId===t.centerId&&l.operatorAndTransportConfirmed&&['ASSUMED_FOR_STUDY','CONFIRMED'].includes(l.permission)&&Number.isInteger(l.transferSlots)&&l.transferSlots>=0&&l.transferSlots<=16):[];
   const byDuration=new Map<number,number[]>();
   for(const date of workDates(t.from,t.to)){
    const windows=loans.filter(l=>on(date,l));if(borrowed&&!windows.length)continue;
    const duration=t.durationSlots+(borrowed?Math.min(...windows.map(l=>l.transferSlots)):0);if(duration>32)continue;
    if(e&&[...fixedDays.get(JSON.stringify([e.id,date]))??[]].some(c=>c!==t.centerId))continue;
    if(context.incidents.some(i=>on(date,i)&&(i.kind==='FAULT'?e?.id===i.machineId:i.centerId===t.centerId&&(i.kind==='HEAVY_RAIN'||i.kind==='WIND'&&t.weather==='DRONE'||i.kind==='LABOR_ABSENCE'&&Math.max(0,center.workers-i.workers)<m.workers))))continue;
    const allowed=byDuration.get(duration)??[];allowed.push(...Array.from({length:33-duration},(_,i)=>dateSlot(date)+i));byDuration.set(duration,allowed);
   }
   return [...byDuration].map(([duration,allowed])=>({resource:e?.id??null,allowed,duration,borrowed}));
  });
  const saved=fixed.get(t.id);
  const capacityDemands:Record<string,number>={[`${t.centerId}:operators`]:m.operators,[`${t.centerId}:workers`]:m.workers,[`${t.centerId}:transport`]:m.transport};
  // Daily absence is a separate qualified pool shared by all tasks on that day.
  return {id:t.id,field:t.pnu,person:null,resource:saved?.resource??options[0]?.resource??null,resourceDayCenter:t.centerId,staff:0,transport:0,capacityDemands,
   original:saved?.start??dateSlot(t.from),duration:saved?.duration??t.durationSlots,allowed:[],options,selected:true,preferred:null,
   predecessor:null,predecessors:t.predecessors,optional:!saved,required:!t.conditional,locked:!!saved};
 });
 // Absence occupies the unavailable workers in the same qualified pool; summing
 // independent jobs cannot silently exceed the reduced daily roster.
 const absent=new Map<string,{centerId:string;date:string;count:number}>();
 for(const i of context.incidents){if(i.kind!=='LABOR_ABSENCE')continue;
  for(const date of workDates(i.from,i.to)){if(!tasks.some(t=>t.centerId===i.centerId&&t.from<=date&&date<=t.to))continue;
   const key=i.centerId+date,prior=absent.get(key);absent.set(key,{centerId:i.centerId,date,count:Math.max(prior?.count??0,i.workers)});}
 }
 for(const [id,a] of absent){const amount=Math.min(limits[`${a.centerId}:workers`],a.count);jobs.push({id:'absence:'+id,field:null,person:null,resource:null,staff:0,transport:0,capacityDemands:{[`${a.centerId}:workers`]:amount},original:dateSlot(a.date),duration:32,allowed:[dateSlot(a.date)],selected:false,preferred:null,predecessor:null,locked:true});}
 if(jobs.length>5000)throw Error('상세 계산의 작업·인력 부재 합계가 5,000건을 초과합니다. 일부 작업을 생략하지 않았습니다.');
 return {tasks:jobs,freezeBefore:0,daily:false,staffCapacity:0,transportCapacity:0,capacityLimits:limits,purpose:'INITIAL'};
}
export type CapacityAlternative={
 id:'LOCAL_ONLY'|'AUTHORIZED_NEIGHBORS';status:'COMPLETE'|'PARTIAL'|'NO_FEASIBLE_PLAN'|'UNVERIFIED';optimal:boolean;
 assignments:SchedulingAssignment[];metrics:{requiredUnassigned:number;conditionalUnassigned:number;borrowedTasks:number;operatorHours:number;workerHours:number;transportHours:number};
 reason?:string;calculation?:{taskCount:number;components:number;largestComponent:number};approvalEligible:false;
};
export async function compareCapacityPlans(input:CapacityStudyInput,baseline:BaselineResources,context:StudyCalculationContext,calculate:Calculation=solveSchedule){
 const compiled=compileCapacityWorkload(input),baselineHash=contentHash(baseline),results:CapacityAlternative[]=[],calculated=new Map<string,ScheduleResult>();
 for(const [id,allow] of [['LOCAL_ONLY',false],['AUTHORIZED_NEIGHBORS',true]] as const){
  const empty={requiredUnassigned:compiled.tasks.filter(t=>!t.conditional).length,conditionalUnassigned:compiled.tasks.filter(t=>t.conditional).length,borrowedTasks:0,operatorHours:0,workerHours:0,transportHours:0};
  try{
   if(compiled.blockers.length)throw Error('적합성·과원 단계·작업 기준 확인이 필요합니다.');
   if(!compiled.tasks.length)throw Error('참여 소유자의 신청 농지·작업이 없습니다.');
   const contract=workloadSchedulingContract(compiled.tasks,baseline,context,allow),contractHash=contentHash(contract);
   // No second solve if the permitted-loan alternative changes no constraint.
   // The cache lives only for this immutable comparison, never across requests.
   const result:ScheduleResult=calculated.get(contractHash)??await calculate(contract);calculated.set(contractHash,result);
   const calculation={taskCount:contract.tasks.length,components:result.components??1,largestComponent:result.largestComponent??contract.tasks.length};
   if(result.status!=='FEASIBLE'){results.push({id,status:'NO_FEASIBLE_PLAN',optimal:false,assignments:[],metrics:empty,reason:result.reason,calculation,approvalEligible:false});continue;}
   verifySchedule(contract,result.assignments,result.phase);
   const assigned=result.assignments.filter(a=>!a.id.startsWith('absence:')),ids=new Set(assigned.map(a=>a.id));
   const metrics={...empty,requiredUnassigned:compiled.tasks.filter(t=>!t.conditional&&!ids.has(t.id)).length,conditionalUnassigned:compiled.tasks.filter(t=>t.conditional&&!ids.has(t.id)).length};
   for(const a of assigned){const t=compiled.tasks.find(t=>t.id===a.id)!,duration=assignedDuration(contract.tasks.find(t=>t.id===a.id)!,a);
    metrics.operatorHours+=duration/4*t.method.operators;metrics.workerHours+=duration/4*t.method.workers;metrics.transportHours+=duration/4*t.method.transport;
    if(a.resource&&baseline.machines.find(m=>m.id===a.resource)?.ownerCenterId!==t.centerId)metrics.borrowedTasks++;
   }
   results.push({id,status:metrics.requiredUnassigned?'PARTIAL':'COMPLETE',optimal:result.optimal,assignments:assigned,metrics,calculation,approvalEligible:false});
  }catch(e){results.push({id,status:'UNVERIFIED',optimal:false,assignments:[],metrics:empty,reason:e instanceof Error?e.message:'계산 실패',approvalEligible:false});}
 }
 if(contentHash(baseline)!==baselineHash)throw Error('고정 자원 스냅샷이 변경되었습니다.');
 const ranked=results.filter(r=>r.status==='COMPLETE'||r.status==='PARTIAL').sort((a,b)=>a.metrics.requiredUnassigned-b.metrics.requiredUnassigned||a.metrics.conditionalUnassigned-b.metrics.conditionalUnassigned||a.metrics.borrowedTasks-b.metrics.borrowedTasks);
 const recommended=ranked.at(0);
 return {inputHash:compiled.inputHash,baselineHash,results,recommendation:{source:'DEVELOPMENT_RULES' as const,inferenceCalled:false as const,alternativeId:recommended?.id??null,approval:'NOT_AN_OPERATIONAL_APPROVAL' as const},
  explanation:'동일한 공통 계산 엔진에서 자체 장비와 승인 조건을 입력한 인접 장비를 비교합니다. 실제 예약·차용·문자·작물 변경은 실행하지 않습니다.'};
}

/** LLM/adviser contract: grounded IDs only. A recommendation cannot edit a plan. */
export function validateCapacityChoice(comparison:Awaited<ReturnType<typeof compareCapacityPlans>>,raw:{alternativeId:string;baselineHash:string}){
 if(raw.baselineHash!==comparison.baselineHash)throw Error('오래된 자원 기준의 판단입니다.');
 const selected=comparison.results.find(r=>r.id===raw.alternativeId);
 if(!selected||selected.status!=='COMPLETE')throw Error('완료 가능한 검증 대안을 선택하세요.');
 return {alternativeId:selected.id,metrics:selected.metrics,approvalEligible:false as const,inferenceCalled:false};
}
