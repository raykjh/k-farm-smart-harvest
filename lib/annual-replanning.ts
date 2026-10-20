import {applyDowntimeForPlanning,type EquipmentDowntime} from './equipment-downtime';
import {withHarvestCarryover} from './harvest-carryover';
import {withMinimumLaborShifts} from './labor-shift';
import {missionPrerequisites} from './mission-prerequisites';
import {withManualFallback} from './replan-manual-fallback';
import {crewCapacityLimits} from './operating-capacity';
import {withLaborSupport,laborCapacityBlocks,supportKey} from './labor-capacity';
import {withNamedOperators,operatorScheduleKey} from './named-operators';
import {isClosedTask} from './task-lifecycle';
import {createHash} from 'node:crypto';
import type {State,Mission,MissionWindow} from './types';
import type {ForecastResult} from './kma-forecast';
import {registeredDemo,DEMO_BATCH} from './registered-demo';
import {readProviderArtifact} from './provider-artifacts';
import {demoOperationWindow} from './demo-operation-window';
import {restricted} from './weather';
import {simulationImpact,type Simulation} from './simulation';
import {replacementFor,type EquipmentReplacement} from './equipment-replacement';
import {checkEnvironmentExecution} from './environment-execution-check';
import {resourceUsable,resourceDuration,requiredLoanPool,supportsMissionCrop} from './replan-resource-options';
import {missionCandidates,splitReplanWork,type WorkMission,type WorkSplit} from './replan-work-split';
import {immovable,relatedReplanIds} from './replan-scope';
import {missionResourceUse} from './scheduling-constraints';
import {dateSlot,slotDate,solveSchedule,verifySchedule,assignedResource,assignedDuration,type SchedulingContract,type SchedulingAssignment,type SchedulingJob,type ResourceOption} from './scheduling-engine';
export {dateSlot,slotDate,assignedResource} from './scheduling-engine';
export const todayKst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const weatherHash=(w:ForecastResult)=>hash({status:w.status,issuedAt:w.issuedAt,grid:w.grid,points:w.points});
export const REPLANNING_RULE_VERSION='annual-resource-tradeoffs-v14-harvest-day-recovery';
export type ReplanInput={resourceReview?:boolean;manualFallback?:boolean;deferAfter?:string;outage?:EquipmentDowntime;allowBorrowing?:boolean;searchMode?:'LOCAL_FIRST';ids:string[];day?:string;preferred?:string;simulation?:Simulation;replacement?:EquipmentReplacement;reason?:string;scope?:'PRESERVE'|'EXPAND';automaticReplacement?:boolean;newLaborSupport?:boolean;decisionPriority?:import('./planning-priority').DecisionPriority};
type Window=MissionWindow;
type Job=SchedulingJob;
export type ReplanAssignment=SchedulingAssignment;
let fixtureMissions:Map<string,Mission>|undefined;
export type ReplanContract=SchedulingContract;
// Explicit per-operation tolerances for generated fixtures, never official safety limits.
function fixtureWindow(m:Mission):Window|undefined{
 if(!fixtureMissions){
  // Existing local legacy records still use their original fixture. New plans
  // carry explicit windows. Missing optional input is not invented or re-seeded.
  const input=readProviderArtifact('registeredParcels');if(input===null)return;
  fixtureMissions=new Map(registeredDemo(input as Parameters<typeof registeredDemo>[0]).state.missions.map(row=>[row.id,row]));
 }
 const original=fixtureMissions.get(m.id);if(!original?.scheduledDate)return;
 return demoOperationWindow(m,original);
}
export function makeContract(s:State,input:ReplanInput,w:ForecastResult,asOf=todayKst(),expandedParts=false){
 s=withHarvestCarryover(s,input,asOf);
 s=withMinimumLaborShifts(s,input.ids);
 if(input.outage)s=applyDowntimeForPlanning(s,input.outage,input.ids,expandedParts);
 // A comparison can restrict new support, never invent people or release an
 // existing commitment. The identical restriction is replayed at approval.
 if(input.newLaborSupport===false&&s.laborCapacity)s={...s,laborCapacity:{...s.laborCapacity,allowNewSupport:false}};
 const selected=new Set(input.ids);if(!selected.size||selected.size!==input.ids.length)throw Error('작업을 중복 없이 선택하세요.');
 if(input.replacement){const affected=s.missions.find(m=>selected.has(m.id)&&m.resourceId===input.replacement!.failedId&&!isClosedTask(m.status));if(!affected)throw Error('선택 작업에 고장 장비 작업이 없습니다.');replacementFor(s,affected,input.replacement);}
 if(!expandedParts&&!input.outage&&!input.day&&selected.size!==1&&!s.missions.filter(m=>selected.has(m.id)).every(m=>(m as WorkMission).equipmentSplit?.groupId===(s.missions.find(m=>selected.has(m.id)) as WorkMission)?.equipmentSplit?.groupId&&(m as WorkMission).equipmentSplit))throw Error('여러 작업은 동일한 작업일을 지정하세요.');
 for(const value of [asOf,input.day,input.preferred,input.deferAfter,input.simulation?.from,input.simulation?.to].filter(Boolean) as string[])if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<2000||Number(value.slice(0,4))>2200||!Number.isFinite(dateSlot(value))||slotDate(dateSlot(value))!==value)throw Error('유효한 계획 날짜가 필요합니다.');

 for(const id of selected){const m=s.missions.find(x=>x.id===id);if(!m||immovable(m)||!m.scheduledDate)throw Error('시작 전·잠금 없는 미완료 작업만 변경할 수 있습니다.');if(!expandedParts&&!input.outage&&input.day&&m.scheduledDate!==input.day)throw Error('같은 날짜의 작업만 일괄 선택하세요.');}
 const now=new Date(Date.now()+9*3600000),elapsed=asOf===todayKst()?Math.max(0,Math.min(32,Math.ceil((now.getUTCHours()*60+now.getUTCMinutes()-480)/15))):0;
 const from=dateSlot(asOf)+elapsed,freezeBefore=from;
 const scoped={...s,missions:s.missions.map(m=>({...m,planningWindow:(m as Mission&{planningWindow?:Window}).planningWindow??(s.ruleVersion===DEMO_BATCH?fixtureWindow(m):undefined)}))};
 const recoveryDays=new Set(scoped.missions.filter(m=>selected.has(m.id)).map(m=>m.harvestCarryover?.date));
 const recoveryDay=recoveryDays.size===1&&!recoveryDays.has(undefined)?[...recoveryDays][0]:undefined;
 // A next-day harvest recovery repairs that day's conflicts, not the remaining
 // annual care chain. Keep later jobs fixed; they must not pull unrelated,
 // historically incomplete work into this urgent bounded request.
 const related=relatedReplanIds(recoveryDay?{...scoped,missions:scoped.missions.filter(m=>selected.has(m.id)||m.scheduledDate===recoveryDay)}:scoped,input.ids,asOf);
 const recoveryWindow=(m:Mission,window:Window|undefined)=>window&&recoveryDay&&!selected.has(m.id)&&related.has(m.id)?{...window,from:window.from>recoveryDay?window.from:recoveryDay,to:window.to<recoveryDay?window.to:recoveryDay}:window;
 const changing=scoped.missions.filter(m=>selected.has(m.id)||input.scope!=='PRESERVE'&&related.has(m.id)).map(m=>({...m,planningWindow:recoveryWindow(m,m.planningWindow)}));
 const intersectsScope=(m:Mission,original:number)=>selected.has(m.id)||related.has(m.id)&&input.scope!=='PRESERVE'||changing.some(t=>{
  const window=t.planningWindow;if(!window)return false;
  return original<dateSlot(window.to)+32&&original+m.duration>Math.max(from,dateSlot(window.from))||(m as Mission&{predecessorMissionIds?:string[]}).predecessorMissionIds?.includes(t.id)||(t as Mission&{predecessorMissionIds?:string[]}).predecessorMissionIds?.includes(m.id);
 });
 const warnings=new Set<string>();const tasks:Job[]=[];
 if(input.scope==='EXPAND')warnings.add('해당 센터의 충돌 관련 미시작 작업만 함께 조정합니다. 다른 센터의 일정·완료 실적·잠긴 작업은 변경하지 않습니다.');
 if(!s.centerSharing?.neighborCenterIds.length)warnings.add('직접 인접 관계가 확인된 센터가 없어 새 인근 장비는 자동 차용하지 않습니다.');
 if(input.simulation){if(input.simulation.from>input.simulation.to||dateSlot(input.simulation.to)-dateSlot(input.simulation.from)>6*32)throw Error('상황 실험 기간은 최대 7일입니다.');warnings.add('개발용 가상 상황 적용: 실제 기상청 자료는 변경되지 않습니다.');if(input.simulation.kind==='DROUGHT')warnings.add('가뭄은 용수·토양 수분 확인이 필요합니다. 자료 없이 기존 작업을 취소하거나 관수 작업을 생성하지 않습니다.');}
 const ordered=[...s.missions].sort((a,b)=>a.fieldId.localeCompare(b.fieldId)||Number(a.id.split('-').at(-1))-Number(b.id.split('-').at(-1)));
 for(const m of ordered){
  if(!m.scheduledDate)continue;
  const original=dateSlot(m.scheduledDate)+((m.start%32)+32)%32;
  if(isClosedTask(m.status)||(original<dateSlot(asOf)&&!selected.has(m.id)))continue;
  if(!intersectsScope(m,original))continue;
  const locked=immovable(m)||!selected.has(m.id)&&original<from;
  const movable=!locked&&related.has(m.id);
  // Unrelated/started work is a fixed reservation, not a request to revalidate or
  // rewrite historical agronomy. It still consumes resources in this solve.
  if(!selected.has(m.id)&&(!movable||input.scope==='PRESERVE')){
   tasks.push({...missionResourceUse(s,m),id:m.id,original,duration:m.duration,allowed:[original],selected:false,preferred:null,predecessor:null,predecessors:(m as Mission&{predecessorMissionIds?:string[]}).predecessorMissionIds??[],movable:false,locked:true});continue;
  }
  const configured=(m as Mission&{planningWindow?:Window}).planningWindow;
  const window=recoveryWindow(m,configured??(s.ruleVersion===DEMO_BATCH?fixtureWindow(m):undefined));
  if(!window)throw Error(`${m.id}: 작업기간·소요시간 검증이 필요합니다.`);
  if(m.harvestCarryover&&selected.has(m.id))warnings.add(`${m.label}: 미완료 수확을 ${m.harvestCarryover.date}에 우선 배치합니다. 기존 권장기간은 이력에 보존합니다.`);
  if(window.basis==='DEMO_OPERATION_WINDOW')warnings.add('작물별 작업기간·소요시간·기상 한계는 시연 기준이며 실제 영농 검증 전입니다.');
  if(window.duration!==m.duration||!Number.isInteger(m.duration)||m.duration<=0||m.duration>32)throw Error('작업 소요시간 검증이 필요합니다.');
  const dependency=missionPrerequisites(s,m,asOf),priors=dependency.required;
  for(const prior of dependency.advisory)warnings.add(`${m.label}: 이전 '${prior.label}' 미완료·생략. 생육·품질 영향을 확인하며 후속 일정은 계속 계산합니다. 완료로 처리하지 않았습니다.`);
  const predecessors=priors.filter(p=>p.status!=='COMPLETED'&&p.scheduledDate&&(selected.has(p.id)||dateSlot(p.scheduledDate)>=dateSlot(asOf))).map(p=>p.id);
  const unresolvedPrior=priors.some(p=>p.status==='CANCELLED'||!p.scheduledDate||p.status!=='COMPLETED'&&!predecessors.includes(p.id));
  const predecessor=predecessors[0]??null;
  // An explicit start boundary takes precedence over the legacy original-day
  // default. Selecting future work must not silently override "from tomorrow".
  const postponeDay=selected.has(m.id)&&input.day&&!input.deferAfter&&!input.preferred&&s.machines.find(x=>x.id===m.resourceId)?.status!=='MAINTENANCE'?dateSlot(input.day)+32:from;
  const lower=Math.max(dateSlot(window.from),from,postponeDay,selected.has(m.id)&&input.deferAfter?dateSlot(input.deferAfter)+32:from,...priors.filter(p=>p.scheduledDate&&!predecessors.includes(p.id)).map(p=>dateSlot(p.scheduledDate!)+((p.start%32+32)%32)+p.duration));
  const upper=dateSlot(window.to)+32;
  const replacement=replacementFor(s,m,input.replacement);
  const candidates=missionCandidates(s,m,input);
  const options:ResourceOption[]=[];
  for(const candidate of candidates){
   if(!supportsMissionCrop(candidate.machine,m))continue;
  const machine=candidate.machine;
  const duration=resourceDuration(s,m,candidate);
  if(duration>32)continue;
  if(duration!==m.duration)warnings.add('장비 처리능력에 따라 작업시간을 다시 산정했습니다. 저장된 작업면적·준비시간을 우선 사용하며, 미확보된 기존 작업은 승인시간으로 작업량을 환산합니다. 현장 작업량을 검토한 뒤 승인하세요.');
  const available=!m.resourceId||!!machine&&!machine.safetyLock&&machine.status==='AVAILABLE';
  const allowed:number[]=[];
  if(available&&!unresolvedPrior)for(let start=lower;start+duration<=upper;start++){
   // A date-change request must move off its source date. Equipment repair is
   // different: replacing the machine may preserve the original appointment.
   if(selected.has(m.id)&&input.deferAfter&&input.day&&!input.outage&&input.preferred!==input.day&&slotDate(start)===input.day)continue;
   if(window.basis==='ENVIRONMENT_REVIEWED'&&(!window.growthReview?.ready||window.growthReview.checkedOn>asOf||window.growthReview.validUntil<slotDate(start)))continue;
   if(window.allowedWindows&&!window.allowedWindows.some(w=>w.from<=slotDate(start)&&slotDate(start)<=w.to))continue;
   if(window.basis==='ENVIRONMENT_REVIEWED'){
    try{checkEnvironmentExecution([{taskId:m.id,date:slotDate(start),startMinute:480+(start%32)*15,durationMinutes:duration*15}],{plots:[{tasks:[{id:m.id,operationCode:'current',requirements:window}],environmental:{operations:[{code:'current',rule:window.environmentRule}]}}]},w,window.growthReview!);}catch{continue;}
   }
   if(replacement&&(slotDate(start)<replacement.from||replacement.until&&slotDate(start)>replacement.until))continue;
   if(!resourceUsable(s,candidate,slotDate(start),start%32,duration))continue;
   if(input.replacement&&machine?.id===input.replacement.replacementId&&(slotDate(start)<input.replacement.availableFrom||input.replacement.availableUntil&&slotDate(start)>input.replacement.availableUntil))continue;
   if(start%32+duration>32)continue;
   if(input.simulation&&simulationImpact(m,input.simulation,slotDate(start)))continue;
   const legacy=start-dateSlot('2026-09-09');
   if(s.events.some(e=>restricted(s,m,e)&&legacy<e.end&&legacy+duration>e.start))continue;
   let blocked=false,unknown=false;
   for(let t=start;t<start+duration;t++){
    const at=slotDate(t)+'T'+String(8+Math.floor(t%32/4)).padStart(2,'0')+':00:00+09:00';
    const p=w.status==='READY'?w.points.find(p=>p.at===at):null;
    if(!p){unknown=true;continue;}
    if(window.windLimitMs===undefined||p.windMs===null||window.rainSensitive&&p.precipitation===null){unknown=true;continue;}
    if(p.windMs>=window.windLimitMs||window.rainSensitive&&p.precipitation!=='강수없음'&&p.precipitation!=='0'&&p.precipitation!=='0mm'){blocked=true;break;}
   }
   if(blocked)continue;
   if(unknown){warnings.add('예보 범위 밖·누락 시간은 작업 전 재확인이 필요한 잠정 일정입니다.');if(!['DEMO_OPERATION_WINDOW','OPERATOR_PROVISIONAL_WINDOW'].includes(window.basis))continue;}
   allowed.push(start);
  }
  const pools=[...new Set(allowed.map(t=>Math.floor(t/32)))].flatMap(day=>{const p=requiredLoanPool(s,candidate,slotDate(day*32));return p?[{day,...p}]:[]});
  options.push({resource:machine?.id??m.resourceId,allowed,duration,borrowed:candidate.borrowed,offerId:candidate.offer?.id,pools});
  }
  const resource=replacement?.machine.id??m.resourceId;
  // A repair request first substitutes equipment on each original workday.
  // "From tomorrow" is a lower boundary, not a request to pull every future
  // appointment onto tomorrow when its machine can simply be replaced.
  const target=input.preferred?dateSlot(input.preferred):input.outage?Math.max(original,from,input.deferAfter?dateSlot(input.deferAfter)+32:from):input.deferAfter?Math.max(dateSlot(input.deferAfter)+32,from):Math.max(original,from);
  tasks.push({...missionResourceUse(s,m),id:m.id,original,duration:m.duration,allowed:options.find(o=>o.resource===resource)?.allowed??[],resource,options,selected:selected.has(m.id),preferred:selected.has(m.id)?Math.floor(target/32):null,predecessor,predecessors,movable,locked});
 }
 if(tasks.filter(t=>t.selected).length!==selected.size)throw Error('선택 작업이 계산 범위에 없습니다.');
 return {contract:{tasks:tasks.map(t=>withLaborSupport(s,withNamedOperators(s,t,s.missions.find(m=>m.id===t.id)!),s.missions.find(m=>m.id===t.id)!)),capacityLimits:crewCapacityLimits(s),capacityBlocks:laborCapacityBlocks(s),freezeBefore,daily:!!input.day,staffCapacity:s.staffCount,transportCapacity:s.transportCount,rebuildMode:(input.scope??'AUTO') as ReplanContract['rebuildMode'],explicitPreferred:!!input.preferred},warnings:[...warnings]};
}
export const verifyAssignments=verifySchedule;
export function prepareAnnualReplan(s:State,input:ReplanInput,w:ForecastResult,asOf:string,split=false){
 s=withHarvestCarryover(s,input,asOf);
 s=withMinimumLaborShifts(s,input.ids);
 const manual=input.manualFallback?withManualFallback(s,input.ids):{state:s,conversions:[]};
 // Validate repair scope against the original machines before converting work.
 if(input.outage)applyDowntimeForPlanning(s,input.outage,input.ids);
 const contractInput=manual.conversions.length&&input.outage?{...input,outage:undefined}:input;
 s=manual.state;
 if(manual.conversions.length&&input.outage){const m=s.machines.find(m=>m.id===input.outage!.machineId)!;m.downtimes=[...m.downtimes??[],input.outage];}
 // Validate the original request before any generated children can be selected.
 const base=makeContract(s,contractInput,w,asOf,manual.conversions.length>0&&!!input.outage);
 if(!split)return {...base,state:s,input:contractInput,manualConversions:manual.conversions,splits:[] as WorkSplit[]};
 const source={...(contractInput.outage?applyDowntimeForPlanning(s,contractInput.outage,input.ids):s),missions:s.missions.map(m=>({...m,planningWindow:(m as WorkMission).planningWindow??(s.ruleVersion===DEMO_BATCH?fixtureWindow(m):undefined)}))};
 const expanded=splitReplanWork(source,contractInput,asOf);
 if(!expanded.splits.length)return {...base,state:s,input:contractInput,manualConversions:manual.conversions,splits:[] as WorkSplit[]};
 const next=makeContract(expanded.state,expanded.input,w,asOf,true);
 return {...next,...expanded,manualConversions:manual.conversions,warnings:[...new Set([...next.warnings,'하루 작업을 처리능력·이동시간에 맞춰 나눴습니다. 분할별 작업구역·준비시간과 전체 종료일을 확인하고 일괄 승인하세요. 시작·완료 실적은 변경하지 않습니다.'])]};
}
export function annualReplanDiff(original:State,prepared:ReturnType<typeof prepareAnnualReplan>,assignments:SchedulingAssignment[]){
 return assignments.flatMap(a=>{
  const next=prepared.state.missions.find(m=>m.id===a.id) as WorkMission;
  const existing=original.missions.find(m=>m.id===a.id) as WorkMission|undefined;
  const before=existing??original.missions.find(m=>m.id===(next.splitFromId??next.equipmentSplit?.sourceId))!;
  const job=prepared.contract.tasks.find(t=>t.id===a.id)!,afterResource=assignedResource(job,a),afterDuration=assignedDuration(job,a);
  const dependencyChanged=JSON.stringify((before as WorkMission).predecessorMissionIds??[])!==JSON.stringify(next.predecessorMissionIds??[]);
  const partitionChanged=JSON.stringify(existing?.equipmentSplit)!==JSON.stringify(next.equipmentSplit)||JSON.stringify(existing?.splitChildIds)!==JSON.stringify(next.splitChildIds);
  if(existing&&!(existing as Mission&{resumingCancelledReservation?:boolean}).resumingCancelledReservation&&a.start===job.original&&afterResource===before.resourceId&&afterDuration===before.duration&&!dependencyChanged&&!partitionChanged&&operatorScheduleKey(a.operatorIds)===operatorScheduleKey(before.operatorIds)&&supportKey(a.laborSupportIds)===supportKey(before.laborSupportIds)&&!prepared.splits.some(s=>s.sourceId===a.id))return [];
  return [{id:a.id,sourceId:existing?a.id:next.splitFromId??next.equipmentSplit!.sourceId,added:!existing,label:next.label,address:original.fields.find(f=>f.id===next.fieldId)?.address,
   before:dateSlot(before.scheduledDate!)+(before.start%32+32)%32,after:a.start,date:slotDate(a.start),beforeResource:before.resourceId,afterResource,
   beforeDuration:before.duration,afterDuration,split:next.equipmentSplit??null,dependencyChanged,
   beforeOperators:before.operatorIds??[],afterOperators:a.operatorIds??[],beforeLaborSupport:before.laborSupportIds??[],afterLaborSupport:a.laborSupportIds??[]}];
 });
}
export async function calculateAnnualReplan(s:State,input:ReplanInput,w:ForecastResult,asOf=todayKst()){
 let prepared=prepareAnnualReplan(s,input,w,asOf),result=await solveSchedule(prepared.contract);
 if(result.status==='NO_FEASIBLE_PLAN'){
  const split=prepareAnnualReplan(s,input,w,asOf,true);
  if(split.splits.length){prepared=split;result=await solveSchedule(prepared.contract);}
 }
 const {warnings,splits}=prepared;
 if(result.status==='NO_FEASIBLE_PLAN')return {...result,warnings,workSplit:splits,diff:[],phase:null,assignments:[]};
 if(result.status!=='FEASIBLE'||!['GAPS_ONLY','REBUILD_RELATED','REBUILD_APPROVED'].includes(result.phase))throw Error('계산 결과 형식 오류');
 return {...result,warnings,workSplit:splits,manualConversions:prepared.manualConversions,borrowedMachineIds:[...new Set(result.assignments.flatMap(a=>{const m=s.machines.find(m=>m.id===a.resource);return m?.ownerCenterId&&m.ownerCenterId!==s.centerSharing?.centerId?[m.id]:[]}))],preferredSatisfied:!input.preferred||result.assignments.filter(a=>prepared.input.ids.includes(a.id)).every(a=>slotDate(a.start)===input.preferred),diff:annualReplanDiff(s,prepared,result.assignments)};
}
