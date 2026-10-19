import {z} from 'zod';
import {createHash} from 'node:crypto';
import {planningContext} from './planning-context';
import {guidelineTasks,type CropCode} from './crop-guidelines';
import {delegatedProposal,appendAssignments} from './delegated-planning';
import {recommendConditions} from './field-conditions';
import type {FieldEntry} from './field-record';
import type {Cultivation} from './cultivation';
import type {State} from './types';
import {isLegacyCrop,type SupportedCropCode} from './crop-registry';
import {catalogOperationTasks} from './catalog-operating-plan';
import {workloadCrop} from './crop-workload-catalog';
import {candidateContribution,coordinateCandidate,type CoordinationContext,type CandidateCoordination} from './production-coordination';
import {harvestYears,harvestPeriod} from './production-coordination-store';
import {adviseOperatingCrop,type OperatingCropFacts,type OperatingCropDecision} from './operating-crop-adviser';
import {isRecordedOptionalCancellation} from './task-lifecycle';
export type CropSelector=(pnu:string,candidates:OperatingCropFacts[])=>Promise<OperatingCropDecision>;

export const productionDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d);
export const serviceTerm=z.object({from:productionDay,until:productionDay.nullable().default(null),continuousConsent:z.literal(true)}).strict().refine(v=>!v.until||v.from<=v.until,'참여 기간 확인 필요');
export type ServiceTerm=z.infer<typeof serviceTerm>;
export type Participation={pnu:string;consultationId:string;receivedAt:string;status:'ACTIVE'|'PAUSED'|'ENDED';term:ServiceTerm;changedAt:string;reason:string};
export const productionCriteria=z.object({profiles:z.array(z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(120),context:planningContext,sourceBatchId:z.string().max(100).optional(),dataOrigin:z.literal('DEMO').optional()}).strict()).max(30)}).strict().refine(v=>new Set(v.profiles.map(p=>p.id)).size===v.profiles.length,'기준 ID 중복').refine(v=>v.profiles.every(p=>!p.context.catalog||p.dataOrigin==='DEMO'&&p.sourceBatchId===p.context.catalog.sourceBatchId),'공통 작업표의 입력 출처를 일치시키세요.');
export type ProductionCriteria=z.infer<typeof productionCriteria>;
type Plan=Awaited<ReturnType<typeof delegatedProposal>>['plans'][number];
export type ProductionChoice={pnu:string;crop:SupportedCropCode;profileId:string};
export type ProductionCandidate={pnu:string;crop:SupportedCropCode;profileId:string;plan:Plan;ready:boolean;score:number;coordination?:CandidateCoordination};
export type ProductionRunOptions={
 choices?:ProductionChoice[];
 // Collection is read-only and compares every candidate against existing work,
 // not against a provisional winner from a preceding field.
 collect?:(candidate:ProductionCandidate)=>void;
 independent?:boolean;
 targetPnus?:string[];
};
export type ProductionItem={pnu:string;address:string;farmer:string;receivedAt:string|null;participation:Participation|null;status:'CONSENT_REQUIRED'|'PAUSED'|'ENDED'|'EXPIRED'|'WAITING_START'|'BLOCKED'|'REVIEW'|'SCHEDULED';reason:string;current:Cultivation|null;history:Cultivation[];nextTask:{id:string;date:string;label:string}|null;proposal:Plan|null;criteriaName?:string;coordination?:CandidateCoordination;decision?:OperatingCropDecision;candidateFacts?:OperatingCropFacts[];comparisons:{crop:string;score:number|null;status:string;reason:string;coordination?:CandidateCoordination}[]};
export const nextDay=(d:string)=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10);
const later=(...days:string[])=>days.sort().at(-1)!;
const idFor=(pnu:string,previousId:string|undefined)=>{
 const h=createHash('sha256').update('continuous-production-v1:'+pnu+':'+(previousId??'first')).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
};

// A stored crop's actual work windows define its season. Never shift an expired
// window by a year or assume a winter shutdown just to produce a schedule.
export function cropPeriod(crop:SupportedCropCode,context:z.infer<typeof planningContext>,earliest:string,until:string|null){
 const broad={start:'2000-01-01',end:'2200-12-31'};
 const generic=context.catalog||!isLegacyCrop(crop);
 const compiled=generic?catalogOperationTasks(crop,'5274036023110930000',1000,context):null;
 const tasks=compiled?compiled.map(t=>({kind:workloadCrop(crop).operations.find(o=>o.code===t.operationCode)!.kind==='REQUIRED'?'PROCESS':'CONDITIONAL',window:{from:t.from,to:t.to}})):guidelineTasks(crop as CropCode,Number(earliest.slice(0,4)),context,broad);
 const required=tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT');
 if(!required.length||required.some(t=>!t.window))throw Error('파종·수확·정리까지의 작업기간 기준이 필요합니다.');
 if(required.some(t=>t.window!.to<earliest))throw Error('접수·이전 재배 종료 이후에 가능한 다음 작기 기준이 필요합니다.');
 const windows=tasks.flatMap(t=>t.window?[t.window]:[]);
 const start=later(earliest,windows.map(w=>w.from).sort()[0]);
 const end=windows.map(w=>w.to).sort().at(-1)!;
 if(end<start||Date.parse(end)-Date.parse(start)>730*86400000)throw Error('유효한 재배 기간 기준이 필요합니다.');
 if(until&&end>until)throw Error('수확·정리가 참여 종료일을 넘습니다. 기간 동의를 확인하세요.');
 // Clip only the leading open portion of a window, never extend its deadline.
 const clipped=structuredClone(context);
 if(compiled){
  clipped.operations={...clipped.operations,[crop]:{...clipped.operations?.[crop]}};
  for(const op of workloadCrop(crop).operations){const rows=compiled.filter(t=>t.operationCode===op.code&&t.part===1);
   clipped.operations[crop]![op.code]={...clipped.operations[crop]![op.code],occurrences:rows.map(t=>({occurrence:t.occurrence,from:t.from,to:t.to}))};
  }
 }
 const ops=clipped.operations?.[crop];
 if(ops)for(const rule of Object.values(ops)){
  if(rule.from&&rule.to&&rule.to>=start&&rule.from<start)rule.from=start;
  if(rule.occurrences)for(const r of rule.occurrences)if(r.to>=start&&r.from<start)r.from=start;
 }
 // A conditional window already in the past is not silently removed or shifted.
 return {start,end,context:clipped};
}

export async function planContinuousProduction(input:{fields:FieldEntry[];participations:Participation[];cycles:Cultivation[];state:State;criteria:ProductionCriteria;version:number;today:string;names:Record<string,string>;consentedPnus:string[];coordination?:CoordinationContext},selectCrop?:CropSelector,options:ProductionRunOptions={}){
 if(options.choices&&new Set(options.choices.map(c=>c.pnu)).size!==options.choices.length)throw Error('농지별 작물 선택 중복');
 const {fields,cycles,criteria,today,names}=input;
 let reserved=structuredClone(input.state);
 const coordination=input.coordination?structuredClone(input.coordination):undefined;
 const participants=new Map(input.participations.map(p=>[p.pnu,p]));
 // Stable inventory order breaks equal receive timestamps. No PNU-based queue.
 const ordered=fields.filter(f=>f.mode==='full').map((f,index)=>({f,index,p:participants.get(f.pnu)})).sort((a,b)=>(a.p?.receivedAt??'9999').localeCompare(b.p?.receivedAt??'9999')||a.index-b.index);
 const items:ProductionItem[]=[];
 for(const {f,p} of ordered){
  const history=cycles.filter(c=>c.pnu===f.pnu).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  const activeHistory=history.filter(c=>!c.closedAt),last=activeHistory.at(-1),current=activeHistory.find(c=>c.start<=today&&today<=c.end)??null;
  const nextTask=input.state.missions.filter(m=>m.fieldId===f.pnu&&m.scheduledDate&&m.scheduledDate>=today&&!['COMPLETED','CANCELLED'].includes(m.status)).sort((a,b)=>a.scheduledDate!.localeCompare(b.scheduledDate!)||a.start-b.start)[0];
  const item:ProductionItem={pnu:f.pnu,address:f.address,farmer:names[f.consultationId??'']??'',receivedAt:p?.receivedAt??null,participation:p??null,status:'BLOCKED',reason:'',current,history,nextTask:nextTask?{id:nextTask.id,date:nextTask.scheduledDate!,label:nextTask.label}:null,proposal:null,comparisons:[]};
  items.push(item);
  if(options.targetPnus&&!options.targetPnus.includes(f.pnu)){item.reason='이번 통합계획 대상 외';continue}
  if(input.state.fields.find(x=>x.id===f.pnu)?.serviceStatus==='CROP_REQUIRED'){item.reason='작물 선택 필요';continue}
  if(!p||!input.consentedPnus.includes(f.pnu)||p.consultationId!==f.consultationId){item.status='CONSENT_REQUIRED';item.reason='연속 관리 및 작물 선택 위임 동의 확인 필요';continue}
  if(p.status!=='ACTIVE'){item.status=p.status;item.reason=p.reason;continue}
  if(p.term.until&&p.term.until<today){item.status='EXPIRED';item.reason='참여 기간 종료 · 기존 기록은 보존';continue}
  if(p.term.from>today){item.status='WAITING_START';item.reason='참여 시작일부터 계획을 검토합니다.';continue}
  if(last&&last.start>today){item.status='SCHEDULED';item.reason='다음 재배가 이미 연결되어 있습니다.';continue}
  const previousTasks=last?input.state.missions.filter(m=>(m as typeof m&{cultivationId?:string}).cultivationId===last.id):[];
  if(last&&last.end<today&&(!previousTasks.length||previousTasks.some(m=>m.status!=='COMPLETED'&&!isRecordedOptionalCancellation(m)))){item.reason='이전 재배의 실제 완료·정리 상태를 확인하세요.';continue}
  if(last&&previousTasks.some(m=>['CANCELLED','HELD','UNSTAFFED'].includes(m.status)&&!isRecordedOptionalCancellation(m))){item.reason='이전 재배의 취소·보류 작업을 먼저 확인하세요.';continue}
  const earliest=later(nextDay(today),p.term.from,last?nextDay(last.end):p.term.from);
  const candidates: {plan:Plan;name:string;profileId:string;coordination?:CandidateCoordination}[]=[];
  const choice=options.choices?.find(c=>c.pnu===f.pnu);
  if(options.choices&&!choice){item.reason='이번 통합계획 대상 외';continue}
  const suitability=recommendConditions(f.conditions).filter(c=>c.score!==null&&!c.missing.length&&!c.blocked.length);
  if(!suitability.length){item.reason='농지·기후 적합성 및 현장 확인값을 보완하세요.';continue}
  for(const profile of criteria.profiles.filter(x=>x.context.region===f.conditions?.region))for(const c of suitability){
   if(choice&&(choice.crop!==c.crop||choice.profileId!==profile.id))continue;
   try{
    const period=cropPeriod(c.crop,profile.context,earliest,p.term.until);
    const result=(await delegatedProposal([f],input.version,reserved,cycles,period,()=>idFor(f.pnu,last?.id),today,names,{crops:[c.crop],preserveOrder:true,includeUnassigned:!!options.collect}));
    const proposal=result.plans[0],ready=!!proposal&&!result.approvalBlocked;
    const adjustment=proposal&&coordination?coordinateCandidate(candidateContribution({id:coordination.centerId+':proposal:'+proposal.cultivation.id,centerId:coordination.centerId,crop:c.crop,areaM2:f.area,harvestYears:harvestYears(proposal.plan),harvestPeriod:harvestPeriod(proposal.plan),origin:profile.dataOrigin==='DEMO'||profile.context.catalog?'DEMO':coordination.origin},coordination.policy,today),c.score!,coordination):undefined;
    item.comparisons.push({crop:c.crop,score:adjustment?.score??c.score,status:ready?'FEASIBLE':'BLOCKED',reason:result.pending.map(p=>p.reason).concat(proposal?.dispatch.feasibility.flatMap(f=>f.missing.map(m=>m.reason))??[]).join(' / '),...(adjustment?{coordination:adjustment}:{})});
    if(proposal)options.collect?.({pnu:f.pnu,crop:c.crop,profileId:profile.id,plan:proposal,ready,score:adjustment?.score??c.score!,coordination:adjustment});
    if(ready)candidates.push({plan:{...proposal,score:adjustment?.score??proposal.score},name:profile.name,profileId:profile.id,coordination:adjustment});
   }catch(e){item.comparisons.push({crop:c.crop,score:c.score,status:'BLOCKED',reason:e instanceof Error?e.message:'작기 기준 확인 필요'})}
  }
  candidates.sort((a,b)=>b.plan.score-a.plan.score||a.plan.cultivation.start.localeCompare(b.plan.cultivation.start)||a.name.localeCompare(b.name));
  const facts=candidates.map((c,index)=>({id:String(index).padStart(3,'0'),crop:c.plan.cultivation.crop,score:c.coordination?.rankingScore??c.plan.score,specialtyBonus:c.coordination?.specialtyBonus??0,supplyPenalty:c.coordination?.supply.penalty??0,borrowedEquipmentTasks:c.plan.dispatch.assignments.filter(a=>a.machineId&&reserved.machines.some(m=>m.id===a.machineId&&m.ownerCenterId&&m.ownerCenterId!==(reserved.centerSharing?.centerId??'demo'))).length,personMinutes:c.plan.dispatch.assignments.reduce((n,a)=>n+a.staff*a.durationMinutes,0)}));
  item.candidateFacts=facts;
  const decision=selectCrop&&!choice?await selectCrop(f.pnu,facts):await adviseOperatingCrop(facts,false);
  const winner=decision.candidateId===null?undefined:candidates[Number(decision.candidateId)];
  if(!choice)item.decision=decision;
  if(winner){item.status='REVIEW';item.reason='작물·계획 묶음 확인 대기';item.proposal=winner.plan;item.criteriaName=winner.name;item.coordination=winner.coordination;if(!options.independent){reserved=appendAssignments(reserved,winner.plan.plan,winner.plan.dispatch,names);if(coordination&&winner.coordination)coordination.contributions.push(winner.coordination.production)}}
  else item.reason=item.comparisons.map(c=>c.reason).filter(Boolean).join(' / ')||'적용 지역의 다음 작기 작업 기준이 필요합니다.';
 }
 return {items,asOf:today,approvalRequired:true as const,inferenceCalled:items.some(i=>i.decision?.inferenceCalled)};
}
