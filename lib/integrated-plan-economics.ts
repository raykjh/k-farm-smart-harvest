import {evaluateCropEconomics,type EconomicTask} from './crop-economics';
import {operatingTaskCrew} from './planned-labor-demand';
import {harvestPeriod} from './production-coordination-store';
import {cropReferences} from './crop-reference';
import type {ProductionCandidate} from './continuous-production';
import type {ProductionSource} from './production-service';

/** Price/cost arithmetic uses only registered references and executable work.
 * It neither supplies future prices nor treats acquisition requests as assets. */
export function optionEconomics(source:ProductionSource,option:ProductionCandidate){
 const plan=option.plan,required=plan.plan.plots.flatMap(p=>p.tasks.filter(t=>t.kind==='PROCESS'||t.kind==='REPEAT'));
 const assignments=plan.dispatch.assignments.filter(a=>required.some(t=>t.id===a.taskId));
 const origin=option.coordination?.production.origin??source.coordination.origin;
 const tasks:EconomicTask[]=assignments.map(a=>{
  const task=required.find(t=>t.id===a.taskId)!,crew=operatingTaskCrew(task);
  const owner=source.state?.machines.find(m=>m.id===a.machineId)?.ownerCenterId??source.scopeId;
  const rates=(source.coordination.policy.equipmentCostRates??[]).filter(r=>r.centerId===owner&&r.machineId===a.machineId&&r.origin===origin&&r.checkedOn<=source.today&&source.today<=r.validUntil&&a.date<=r.validUntil);
  const rate=rates.length===1?rates[0]:null;
  return {date:a.date,durationMinutes:a.durationMinutes,ordinaryWorkers:crew.ordinaryWorkers??0,machineOperators:crew.machineOperators??0,machineId:a.machineId??null,
   ...(rate?{equipmentRate:{machineId:rate.machineId,wonPerHour:rate.wonPerHour,unit:rate.unit,version:rate.version,sourceUrl:rate.sourceUrl,checkedOn:rate.checkedOn,validUntil:rate.validUntil}}:{})};
 });
 // A supply-volume policy is optional. The saved crop plan already identifies
 // its commodity basis; require every plot to agree before using that basis.
 const commodities=plan.plan.plots.map(p=>cropReferences.find(r=>r.id===p.referenceId)?.commodity);
 const planCommodity=commodities.length&&commodities.every(Boolean)&&new Set(commodities).size===1?commodities[0]!:null;
 const result=evaluateCropEconomics({areaM2:plan.plan.plots.reduce((n,p)=>n+p.area,0),crop:option.crop,commodity:option.coordination?.production.commodity??planCommodity,origin,
  // Crop-level statistical economics is not evidence for a reviewed variety,
  // tree age or trial premium. Keep it unknown until matching references exist.
  harvestPeriod:harvestPeriod(plan.plan),today:source.today,references:plan.plan.context.variety?[]:source.coordination.policy.economicReferences??[],tasks,payByYear:source.laborPayByYear,
  // A current annual rate must also cover every actual operator assignment in
  // that year. A partially covered year remains unknown; it is never extended.
  operatorPayByYear:Object.fromEntries((source.coordination.policy.operatorCostRates??[]).filter(r=>r.centerId===source.scopeId&&r.origin===origin&&r.checkedOn<=source.today&&source.today<=r.validUntil&&tasks.filter(t=>t.machineOperators>0&&Number(t.date.slice(0,4))===r.year).every(t=>r.checkedOn<=t.date&&t.date<=r.validUntil)).map(r=>[String(r.year),{year:r.year,hourlyWon:r.hourlyWon,halfDayWon:r.hourlyWon*4,policyVersion:r.policyVersion,source:r.sourceUrl}]))});
 if(required.some(t=>!assignments.some(a=>a.taskId===t.id)))return {...result,status:'PARTIAL' as const,comparable:false,missingComponents:[...result.missingComponents,'UNPLACED_REQUIRED_TASK_COSTS'],metrics:{...result.metrics,comparable:0,missingComponents:result.metrics.missingComponents+1,unfavorableBalanceWon:null,baseBalanceWon:null}};
 return result;
}
export type OptionEconomics=ReturnType<typeof optionEconomics>;
const values=(r:{low:number;base:number;high:number}|null)=>r?[r.low,r.base,r.high]:null;
/** No document text, supplier identity, free-form method or URL enters the model. */
export function economicModelFacts(result:OptionEconomics){
 if(result.status==='UNKNOWN')return {status:'UNKNOWN' as const};
 return {status:result.status,comparable:result.comparable,receiptsWon:values(result.revenue),knownCostsWon:values(result.knownCost),
  downsideWon:result.metrics.unfavorableBalanceWon,baseBalanceWon:result.metrics.baseBalanceWon,
  ...(result.reference?{basis:result.reference.priceBasis,costBasis:result.reference.costMode,evidence:result.reference.sourceDataKind}:{}),missing:result.missingComponents};
}
