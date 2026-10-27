import type {Prisma} from '@prisma/client';
import type {AnnualPlan} from './annual-plan';
import type {Cultivation} from './cultivation';
import {centerRegistry} from './center-registry';
import {recordSpace} from './workspace';
import {coordinationPolicySchema,emptyCoordinationPolicy,candidateContribution,aggregateProduction,type ProductionContribution} from './production-coordination';
import {savedNationalCropReferences} from './crop-evidence-library';
import {validatePriceEvidence,type PriceDay} from './price-reference';
import {syntheticRegistrationPnus} from './registration-origin';
import {checkVariety} from './crop-variety';
import type {CoordinationPolicy} from './production-coordination';
import {readCoordinationRecords} from './coordination-record-reader';
export const coordinationPolicyKey={workspace:'shared',kind:'productionCoordinationPolicy',id:'current'};
export function harvestYears(plan:AnnualPlan){return [...new Set(plan.plots.flatMap(p=>p.tasks.filter(t=>t.operationCode==='harvest').flatMap(t=>t.window?[Number(t.window.from.slice(0,4)),Number(t.window.to.slice(0,4))]:[])))];}
export function harvestPeriod(plan:AnnualPlan){
 const tasks=plan.plots.flatMap(p=>p.tasks.filter(t=>t.operationCode==='harvest'));
 if(!tasks.length||tasks.some(t=>!t.window))return null;
 return {from:tasks.map(t=>t.window!.from).sort()[0],to:tasks.map(t=>t.window!.to).sort().at(-1)!};
}
export function reviewPlanContribution(plan:AnnualPlan,input:{id:string;centerId:string;pnu?:string;crop:ProductionContribution['crop'];origin:ProductionContribution['origin']},policy:CoordinationPolicy,today:string,existing:ProductionContribution[]=[]){
 const plot=input.pnu?plan.plots.find(p=>p.pnu===input.pnu):plan.plots[0],scoped={...plan,plots:plot?[plot]:[]},period=harvestPeriod(scoped);
 const contribution=candidateContribution({...input,areaM2:plot?.area??null,harvestYears:harvestYears(scoped),harvestPeriod:period},policy,today);
 const review=plan.context.variety;
 const variety=review?checkVariety({review,conditions:plot?.conditions??undefined,crop:input.crop,areaM2:plot?.area??null,centerId:input.centerId,origin:input.origin,today,harvest:period,existing,candidateId:input.id}):null;
 if(variety){contribution.varietyId=variety.varietyId;contribution.commodity=variety.commodity;contribution.kg=variety.kgPer1000m2&&plot?.area&&!variety.reasons.includes('VARIETY_PERIOD_REVIEW')?{low:variety.kgPer1000m2.low*plot.area/1000,high:variety.kgPer1000m2.high*plot.area/1000}:null;}
 return {contribution,variety};
}
/** Cross-center output contains aggregate crop quantities, never farmer contacts. */
export async function readProductionCoordination(tx:Prisma.TransactionClient,centerId:string,today:string){
 const policyRow=await tx.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),saved=coordinationPolicySchema.parse(policyRow?.payload??emptyCoordinationPolicy());
 // Read-time background only. Preserve explicit overrides (including []) and
 // every stored policy revision; never seed prices, targets or crop approvals.
 const policy:typeof saved={...saved,nationalReferences:saved.nationalReferences??structuredClone(savedNationalCropReferences)};
 const linked=(policy.economicReferences??[]).filter(r=>r.priceEvidence);
 const priceKeys=[...new Set(linked.flatMap(r=>r.priceEvidence!.revisions.map(d=>`${r.crop}:${d.date}`)))];
 const priceRows=priceKeys.length?await tx.workRecord.findMany({where:{workspace:'shared',kind:'atPriceDay',id:{in:priceKeys}}}):[];
 const priceDays=priceRows.map(r=>r.payload as unknown as PriceDay);
 const excludedEconomicReferences=linked.filter(r=>!validatePriceEvidence(r.priceEvidence!,priceDays,r.price,r.crop)).map(r=>({version:r.version,reason:'PRICE_HISTORY_CHANGED_OR_INCOMPLETE'}));
 if(excludedEconomicReferences.length)policy.economicReferences=policy.economicReferences?.filter(r=>!excludedEconomicReferences.some(e=>e.version===r.version));
 const registeredCenters=await tx.center.findMany({select:{id:true},orderBy:{id:'asc'}}),owners=new Map(registeredCenters.map(c=>[recordSpace(c.id),c.id]));
 const entries:ProductionContribution[]=[];
 for(const [space,owner] of [...owners].sort(([a],[b])=>a.localeCompare(b))){
 const rows=await readCoordinationRecords(tx,space);
 const prepared=syntheticRegistrationPnus(rows.filter(r=>r.kind==='registrationOrigin').map(r=>r.payload));
 const plans=new Map(rows.filter(r=>r.kind==='cultivationPlan').map(r=>[r.id,r.payload as unknown as AnnualPlan]));
 for(const row of rows.filter(r=>r.kind==='cultivation')){
  const cycle=row.payload as unknown as Cultivation,plan=plans.get(row.id);
  if(cycle.closedAt)continue;
  const plot=plan?.plots?.find(p=>p.pnu===cycle.pnu);
  const origin=prepared.has(cycle.pnu)||plan?.context?.catalog?'DEMO':'REGISTERED';
  const entry=plan?reviewPlanContribution(plan,{id:row.workspace+':'+cycle.id,centerId:owner,pnu:cycle.pnu,crop:cycle.crop,origin},policy,today).contribution:candidateContribution({id:row.workspace+':'+cycle.id,centerId:owner,crop:cycle.crop,areaM2:plot?.area??null,harvestYears:[],origin},policy,today);
  entries.push(entry);
 }
 }
 return {policy,policyVersion:policyRow?.version??0,excludedEconomicReferences,contributions:entries,centerId,today,origin:'REGISTERED' as const,totals:aggregateProduction(entries),unquantified:entries.filter(e=>!e.kg||!e.commodity||e.year===null).length,coverage:'PARTICIPATING_CULTIVATIONS_ONLY' as const};
}
