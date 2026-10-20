import {createHash} from 'node:crypto';
import {z} from 'zod';
import {calculateProduction,productionSourceHash,type ProductionSource} from './production-service';
import type {ProductionCandidate,ProductionChoice} from './continuous-production';
import {aggregateProduction} from './production-coordination';
import {dispatchPlacementKey} from './annual-dispatch';
import {operatingTaskCrew,ordinaryWorkerDemand} from './planned-labor-demand';
import {equipmentAcquisitionPlan} from './integrated-resource-demand';
import {jointFieldContext,jointDecisionContext} from './integrated-plan-context';
import {optionEconomics,economicModelFacts,type OptionEconomics} from './integrated-plan-economics';
import {selectNationalReferences} from './production-evidence';
import {cropCodes} from './crop-registry';

export const INTEGRATED_PLAN_VERSION='crop-resource-plan-v4';
export const integratedHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const staffingStrategies=['CORE_AND_PEAK','PEAK_ONLY'] as const;
// Design assumptions, not observations, prices, employment agreements or capacity.
export const acquisitionAssumptions={version:'staffing-scenario-v1',hoursPerWeek:40,shiftHours:4,reserveRatio:0.1} as const;
export const choiceSchema=z.object({field:z.string().regex(/^F\d+$/),option:z.string().regex(/^O\d+$/)}).strict();
export const jointProposalSchema=z.object({choices:z.array(choiceSchema).min(1).max(12),staffing:z.enum(staffingStrategies)}).strict();
export type JointProposal=z.infer<typeof jointProposalSchema>;
export type JointOption=ProductionCandidate&{id:string};
export type JointField={id:string;centerId:string;pnu:string;options:JointOption[]};
export type JointSnapshot={version:typeof INTEGRATED_PLAN_VERSION;fingerprint:string;sources:ProductionSource[];scope:string[];fields:JointField[];excluded:{centerId:string;count:number}[];remaining:number};

export async function collectJointSnapshot(sources:ProductionSource[],scope:string[]):Promise<JointSnapshot>{
 const fields:JointField[]=[],excluded:JointSnapshot['excluded']=[];let optionIndex=0;
 for(const source of [...sources].filter(s=>scope.includes(s.scopeId)).sort((a,b)=>a.scopeId.localeCompare(b.scopeId))){
  const collected:ProductionCandidate[]=[];
  const view=await calculateProduction(source,undefined,{independent:true,collect:c=>collected.push(c)});
  let missing=0;
  for(const item of view.items){
   const candidates=collected.filter(c=>c.pnu===item.pnu).sort((a,b)=>cropCodes.indexOf(a.crop)-cropCodes.indexOf(b.crop)||a.profileId.localeCompare(b.profileId));
   if(!candidates.length){if(item.status==='BLOCKED'||item.status==='CONSENT_REQUIRED')missing++;continue}
   fields.push({id:`F${fields.length+1}`,centerId:source.scopeId,pnu:item.pnu,options:candidates.map(c=>({...c,id:`O${++optionIndex}`}))});
  }
  excluded.push({centerId:source.scopeId,count:missing});
 }
 // A bounded first-in queue is explicit. Further fields are NOT assumed planned.
 fields.sort((a,b)=>(sources.find(s=>s.scopeId===a.centerId)!.participations.find(p=>p.pnu===a.pnu)?.receivedAt??'9999').localeCompare(sources.find(s=>s.scopeId===b.centerId)!.participations.find(p=>p.pnu===b.pnu)?.receivedAt??'9999')||a.centerId.localeCompare(b.centerId)||a.pnu.localeCompare(b.pnu));
 optionIndex=0;fields.forEach((f,i)=>{f.id=`F${i+1}`;f.options.forEach(o=>{o.id=`O${++optionIndex}`})});
 const selected=fields.slice(0,12);
 // Bound the paid context by whole fields; never prune a field's crop options
 // merely to force the model into a favored crop. Remaining fields stay visible.
 while(selected.length>1&&Buffer.byteLength(JSON.stringify(selected.map(f=>modelField(f,{fields:selected,sources}))),'utf8')>4200)selected.pop();
 return {version:INTEGRATED_PLAN_VERSION,fingerprint:jointSourceHash(sources,scope),sources,scope,fields:selected,excluded,remaining:fields.length-selected.length};
}
export const jointSourceHash=(sources:ProductionSource[],scope:string[])=>integratedHash({version:INTEGRATED_PLAN_VERSION,assumptions:acquisitionAssumptions,scope:[...scope].sort(),sources:[...sources].sort((a,b)=>a.scopeId.localeCompare(b.scopeId)).map(s=>[s.scopeId,productionSourceHash(s)])});
export function validateJointProposal(snapshot:JointSnapshot,raw:unknown){
 const proposal=jointProposalSchema.parse(raw);
 if(proposal.choices.length!==snapshot.fields.length||new Set(proposal.choices.map(c=>c.field)).size!==proposal.choices.length)throw Error('통합계획은 대상 농지마다 작물 하나를 선택해야 합니다.');
 for(const choice of proposal.choices)if(!snapshot.fields.find(f=>f.id===choice.field)?.options.some(o=>o.id===choice.option))throw Error('검증된 농지·작기 후보가 아닙니다.');
 return {...proposal,choices:[...proposal.choices].sort((a,b)=>a.field.localeCompare(b.field,undefined,{numeric:true}))};
}
export function jointRuleProposal(snapshot:JointSnapshot):JointProposal{
 return {staffing:'CORE_AND_PEAK',choices:snapshot.fields.map(f=>{
  const context=jointFieldContext(snapshot,f),risk=(o:JointOption)=>Number(o.coordination?.market.status==='OVERSUPPLY_RISK'||['CONCENTRATION','POSSIBLE_CONCENTRATION'].includes(o.coordination?.supply.status??'')),specialty=(o:JointOption)=>Number(o.coordination?.specialtyStatus==='ESTABLISHED'),near=(o:JointOption)=>Number(context.option(o).establishedNeighborCrops.includes(o.crop));
  return {field:f.id,option:[...f.options].sort((a,b)=>Number(b.ready)-Number(a.ready)||risk(a)-risk(b)||specialty(b)-specialty(a)||b.score-a.score||near(b)-near(a)||a.id.localeCompare(b.id))[0].id};
 })};
}
const week=(day:string)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)};
export type WorkDemand={centerId:string;date:string;machineCode:string|null;machineHours:number;laborHours:number;operatorHours:number;transportHours:number};
export function staffingPlan(rows:WorkDemand[],centerId:string,from:string,to:string,strategy:JointProposal['staffing']){
 const weeks:{week:string;laborHours:number;operatorHours:number;transportHours:number}[]=[];
 if(Date.parse(to)-Date.parse(from)>731*86400000)throw Error('자원 계획 기간은 2년 이내입니다.');
 for(let time=Date.parse(week(from));time<=Date.parse(week(to));time+=7*86400000){
  const key=new Date(time).toISOString().slice(0,10),work=rows.filter(r=>r.centerId===centerId&&week(r.date)===key);
  weeks.push({week:key,laborHours:work.reduce((n,r)=>n+r.laborHours,0),operatorHours:work.reduce((n,r)=>n+r.operatorHours,0),transportHours:work.reduce((n,r)=>n+r.transportHours,0)});
 }
 const hours=weeks.map(w=>w.laborHours).sort((a,b)=>a-b),baseline=hours.length?hours[Math.floor((hours.length-1)*0.25)]:0;
 const contractWorkers=strategy==='CORE_AND_PEAK'?Math.floor(baseline/acquisitionAssumptions.hoursPerWeek):0;
 const dailyPersonShifts=weeks.reduce((n,w)=>n+Math.ceil(Math.max(0,w.laborHours-contractWorkers*acquisitionAssumptions.hoursPerWeek)/acquisitionAssumptions.shiftHours),0);
 const peakWeeklyHours=Math.max(0,...hours),reserveWorkers=peakWeeklyHours?Math.ceil(peakWeeklyHours/acquisitionAssumptions.hoursPerWeek*acquisitionAssumptions.reserveRatio):0;
 return {centerId,strategy,contractWorkers,dailyPersonShifts,reserveWorkers,peakWeeklyHours,weeks,
  status:'ACQUISITION_SCENARIO' as const,assumptions:acquisitionAssumptions};
}
export type ResourceRequest={centerId:string;resource:string;from:string;to:string;tasks:number;quantity:number|null;status:'REVIEW_REQUIRED';route:'ADJACENT_THEN_ACQUIRE'|'STAFFING_REVIEW'|'CRITERIA_REVIEW'};
export function assertCrossCenterPeople(rows:{centerId:string;date:string;startMinute:number;durationMinutes:number;operatorIds?:string[];laborSupportIds?:string[]}[],sources:ProductionSource[]=[]){
 // Support IDs identify availability windows, not people. Resolve to the same
 // employee across two different offers and include the registered travel time.
 const people=new Map<string,{id:string;travel:number}>();
 for(const source of sources){
  for(const w of [...source.state?.laborCapacity?.incoming??[],...source.state?.laborCapacity?.outgoing??[]])people.set(w.id,{id:`worker:${w.ownerCenterId}:${w.workerId}`,travel:w.travelMinutes});
  for(const r of source.state?.laborCapacity?.reserves??[])people.set(r.id,{id:`worker:${source.scopeId}:${r.workerId}`,travel:0});
 }
 const occupied=new Map<string,{centerId:string;start:number;end:number}[]>();
 for(const r of rows){
  const assigned=[...(r.operatorIds??[]).map(id=>({id:`operator:${id}`,travel:0})),...(r.laborSupportIds??[]).map(id=>people.get(id)??{id:`support-window:${id}`,travel:0})];
  for(const person of assigned){
   const key=JSON.stringify([person.id,r.date]),previous=occupied.get(key)??[],start=r.startMinute-person.travel,end=r.startMinute+r.durationMinutes+person.travel;
   if(previous.some(p=>p.centerId!==r.centerId&&p.start<end&&start<p.end))throw Error('센터 간 운영자·지원 인력 중복 배정입니다. 자원 배정을 확인하세요.');
   previous.push({centerId:r.centerId,start,end});occupied.set(key,previous);
  }
 }
}
export async function evaluateJointProposal(snapshot:JointSnapshot,raw:unknown){
 const proposal=validateJointProposal(snapshot,raw);
 const sources=structuredClone(snapshot.sources).sort((a,b)=>a.scopeId.localeCompare(b.scopeId)),views:{centerId:string;view:Awaited<ReturnType<typeof calculateProduction>>;choices:ProductionChoice[]}[]=[],requests:ResourceRequest[]=[],demands:WorkDemand[]=[];
 // Each center reads the same network totals. Union by cultivation identity,
 // rejecting disagreeing snapshots instead of counting the network repeatedly.
 const existing=new Map<string,ProductionSource['coordination']['contributions'][number]>();
 for(const source of sources)for(const entry of source.coordination.contributions){const prior=existing.get(entry.id);if(prior&&integratedHash(prior)!==integratedHash(entry))throw Error('참여 생산량의 센터별 기준이 다릅니다. 다시 읽어주세요.');existing.set(entry.id,entry)}
 const production=[...existing.values()].sort((a,b)=>a.id.localeCompare(b.id));
 const selected=[...snapshot.fields].sort((a,b)=>a.centerId.localeCompare(b.centerId)||a.pnu.localeCompare(b.pnu)).map(f=>({field:f,option:f.options.find(o=>o.id===proposal.choices.find(c=>c.field===f.id)!.option)!}));
 let score=0,requiredTasks=0,missingTasks=0,borrowedTasks=0,personHours=0;
 const economics:{field:string;centerId:string;pnu:string;crop:JointOption['crop'];areaM2:number;assessment:OptionEconomics}[]=[];
 const placements:string[]=[];
 for(const source of sources){
  const own=selected.filter(s=>s.field.centerId===source.scopeId);
  if(!own.length)continue;
  source.coordination.contributions=structuredClone(production);
  const choices=own.map(({field,option})=>({pnu:field.pnu,crop:option.crop,profileId:option.profileId}));
  const captured:ProductionCandidate[]=[];
  const view=await calculateProduction(source,undefined,{choices,collect:c=>captured.push(c)});
  views.push({centerId:source.scopeId,view,choices});
  for(const {field,option} of own){
   const item=view.items.find(i=>i.pnu===field.pnu),candidate=captured.find(c=>c.pnu===field.pnu);
   if(!candidate)throw Error('공통 계산에서 선택한 작물의 조건이 달라졌습니다.');
   const p=candidate.plan,required=p.plan.plots.flatMap(p=>p.tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT'));
   economics.push({field:field.id,centerId:source.scopeId,pnu:field.pnu,crop:candidate.crop,areaM2:p.plan.plots.reduce((n,p)=>n+p.area,0),assessment:optionEconomics(source,candidate)});
   // Suitability is the field assessment before sequential supply adjustments.
   // Whole-batch risk is evaluated independently below.
   requiredTasks+=required.length;score+=candidate.coordination?.baseScore??candidate.score;
   if(candidate.coordination)production.push(candidate.coordination.production);
   const assignments=item?.status==='REVIEW'?item.proposal!.dispatch.assignments:[];
   placements.push(dispatchPlacementKey(assignments));
   missingTasks+=required.filter(t=>!assignments.some(a=>a.taskId===t.id)).length;
   for(const task of required.filter(t=>!assignments.some(a=>a.taskId===t.id))){
    const req=task.requirements;
    requests.push({centerId:source.scopeId,resource:req.machineCode??'LABOR',from:task.window?.from??p.cultivation.start,to:task.window?.to??p.cultivation.end,tasks:1,quantity:null,status:'REVIEW_REQUIRED',route:!task.window||!req.machineCode&&req.laborMinutesPer1000m2===null?'CRITERIA_REVIEW':req.machineCode?'ADJACENT_THEN_ACQUIRE':'STAFFING_REVIEW'});
   }
   for(const a of assignments){
    const task=p.plan.plots.flatMap(p=>p.tasks).find(t=>t.id===a.taskId)!,machine=source.state?.machines.find(m=>m.id===a.machineId),h=a.durationMinutes/60,crew=operatingTaskCrew(task);
    personHours+=a.staff*h;
    if(machine?.ownerCenterId&&machine.ownerCenterId!==source.scopeId)borrowedTasks++;
    demands.push({centerId:source.scopeId,date:a.date,machineCode:task.requirements.machineCode,machineHours:a.machineId?h:0,laborHours:Math.max(4,h)*(crew.ordinaryWorkers??0),operatorHours:h*(crew.machineOperators??0),transportHours:h*a.transport});
    // A physical machine cannot commute between different centers on the same
    // draft day. This mirrors the operational day-exclusive loan contract.
    if(a.machineId)for(const other of sources.filter(s=>s.scopeId!==source.scopeId))other.shared.push({id:`joint:${a.taskId}`,centerId:source.scopeId,resourceId:a.machineId,taskId:a.taskId,from:`${a.date}T08:00:00+09:00`,to:`${a.date}T16:00:00+09:00`});
   }
  }
 }
 // Existing planned workload is never modified and remains part of the hiring
 // forecast. Registrations / unconfirmed attendance are not added as capacity.
 for(const s of sources)for(const m of s.state?.missions??[]){
  if(!m.scheduledDate||m.scheduledDate<s.today||!['PLANNED','HELD','UNSTAFFED'].includes(m.status)||m.resourceOccupancyOnly)continue;
  const h=m.duration/4;
  const workers=ordinaryWorkerDemand(m);
  demands.push({centerId:s.scopeId,date:m.scheduledDate,machineCode:m.resourceId?s.state?.machines.find(x=>x.id===m.resourceId)?.type??'EQUIPMENT':null,machineHours:m.resourceId?h:0,laborHours:Math.max(4,h)*workers,operatorHours:h*(m.machineOperators??(m.resourceId?Math.max(0,m.staff-workers):0)),transportHours:h*m.transport});
 }
 const until=selected.map(s=>s.option.plan.cultivation.end).concat(demands.map(d=>d.date)).sort().at(-1)??sources[0].today;
 assertCrossCenterPeople([
  ...views.flatMap(v=>v.view.items.flatMap(i=>(i.proposal?.dispatch.assignments??[]).map(a=>({...a,centerId:v.centerId})))),
  ...sources.flatMap(s=>(s.state?.missions??[]).filter(m=>m.scheduledDate&&!m.resourceOccupancyOnly&&!['COMPLETED','CANCELLED'].includes(m.status)).map(m=>({centerId:s.scopeId,date:m.scheduledDate!,startMinute:480+(m.start%32+32)%32*15,durationMinutes:m.duration*15,operatorIds:m.operatorIds,laborSupportIds:m.laborSupportIds}))),
 ],sources);
 const staffing=sources.map(s=>staffingPlan(demands,s.scopeId,s.today,until,proposal.staffing));
 const equipment=equipmentAcquisitionPlan(sources,selected.map(s=>({centerId:s.field.centerId,candidate:s.option})));
 for(const request of requests){const need=equipment.find(e=>e.centerId===request.centerId&&e.code===request.resource);if(need?.additionalLowerBound)request.quantity=need.additionalLowerBound;}
 const totals=aggregateProduction(production);
 const cropAreas=new Map<string,number>();
 for(const s of selected)cropAreas.set(s.option.crop,(cropAreas.get(s.option.crop)??0)+s.option.plan.plan.plots.reduce((n,p)=>n+p.area,0));
 const area=[...cropAreas.values()].reduce((a,b)=>a+b,0),mix=[...cropAreas].map(([crop,areaM2])=>({crop,areaM2,share:area?areaM2/area:0}));
 const decisionContext=jointDecisionContext(snapshot,selected,production);
 const comparable=economics.every(e=>e.assessment.comparable),assessed=economics.filter(e=>e.assessment.comparable).length;
 const economicMetrics={assessedEconomicsFields:assessed,unassessedEconomicsFields:economics.length-assessed,unfavorableBalanceWon:comparable?economics.reduce((n,e)=>n+e.assessment.metrics.unfavorableBalanceWon!,0):null,baseBalanceWon:comparable?economics.reduce((n,e)=>n+e.assessment.metrics.baseBalanceWon!,0):null};
 const metrics={fields:selected.length,readyFields:views.reduce((n,v)=>n+v.view.items.filter(i=>i.status==='REVIEW').length,0),requiredTasks,missingTasks,borrowedTasks,personHours:Math.round(personHours*100)/100,meanSuitability:Math.round(score/selected.length*100)/100,largestCropShare:Math.max(0,...mix.map(m=>m.share)),contractWorkers:staffing.reduce((n,s)=>n+s.contractWorkers,0),dailyPersonShifts:staffing.reduce((n,s)=>n+s.dailyPersonShifts,0),reserveWorkers:staffing.reduce((n,s)=>n+s.reserveWorkers,0),...decisionContext.metrics,...economicMetrics};
 return {id:integratedHash({source:snapshot.fingerprint,proposal,placements,metrics,economics}),proposal,metrics,decisionContext,views,mix,totals,staffing,equipment,demands,requests,economics,
  status:missingTasks?'RESOURCE_REQUIRED' as const:'REVIEW_READY' as const,reserved:false as const,approvalRequired:true as const,
  coverage:'PARTICIPATING_CULTIVATIONS_ONLY' as const,priceForecast:null,costEstimate:{basis:'REFERENCE_SCENARIOS_NOT_NET_PROFIT' as const,complete:comparable,assessedFields:assessed},
  unknowns:['PRICE_MODEL_NOT_CALIBRATED','ACQUISITION_COSTS_NOT_ENTERED',...(assessed<economics.length?['ECONOMIC_REFERENCE_OR_COSTS_INCOMPLETE']:[]),...(requests.length?['UNSCHEDULED_DEMAND_EXCLUDED_FROM_STAFFING_TOTAL']:[])],
  inputFingerprint:snapshot.fingerprint,assumptions:acquisitionAssumptions};
}
export type JointEvaluation=Awaited<ReturnType<typeof evaluateJointProposal>>;
export type JointMetrics=JointEvaluation['metrics'];
const modelField=(f:JointField,snapshot:Pick<JointSnapshot,'fields'|'sources'>)=>{
 const context=jointFieldContext(snapshot,f);
 const source=snapshot.sources.find(s=>s.scopeId===f.centerId)!;
 return {id:f.id,center:f.centerId,conditions:context.conditions,neighborhood:context.neighborhood,options:f.options.map(o=>({id:o.id,crop:o.crop,score:o.coordination?.baseScore??o.score,ready:o.ready,start:o.plan.cultivation.start,end:o.plan.cultivation.end,area:o.plan.plan.plots.reduce((n,p)=>n+p.area,0),required:o.plan.plan.plots.flatMap(p=>p.tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT')).length,machines:[...new Set(o.plan.plan.plots.flatMap(p=>p.tasks.flatMap(t=>t.requirements.machineCode?[t.requirements.machineCode]:[])))],...context.option(o),economics:economicModelFacts(optionEconomics(source,o))}))};
};
// Only opaque IDs and aggregates leave the server. No PNU, address, contact,
// consultation, named operator, free-form source text or document is sent.
export function jointModelInput(snapshot:JointSnapshot,baseline:JointEvaluation){
 return {version:INTEGRATED_PLAN_VERSION,coverage:'PARTICIPATING_ONLY',remaining:snapshot.remaining,
  fields:snapshot.fields.map(f=>modelField(f,snapshot)),
  centers:snapshot.sources.map(s=>({id:s.scopeId,fields:s.fields.length,machines:s.state?.machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===s.scopeId).length??0,registeredStaff:s.state?.staffCount??0,neighbors:s.state?.centerSharing?.neighborCenterIds??[]})),
  nationalBackground:[...new Set(snapshot.fields.flatMap(f=>f.options.map(o=>o.crop)))].map(crop=>{
   const source=snapshot.sources[0],selected=selectNationalReferences(crop,source.today,source.coordination.policy.nationalReferences??[]);
   return {crop,status:selected.status,scope:selected.scope,observations:selected.references.slice(0,3).map(r=>({reference:integratedHash(r).slice(0,16),commodity:r.commodity,asOf:r.asOf,period:r.observationPeriod,harvestPeriod:r.harvestPeriod,origin:r.origin,unit:r.unit,priceStage:r.priceStage,facts:r.facts})),remaining:Math.max(0,selected.references.length-3)};
  }),
  production:baseline.totals,baseline:{id:baseline.id,proposal:baseline.proposal,metrics:baseline.metrics},assumptions:acquisitionAssumptions,unknowns:baseline.unknowns};
}
