import type {Prisma} from '@prisma/client';
import type {AnnualPlan} from './annual-plan';
import type {Cultivation} from './cultivation';
import {centerRegistry} from './center-registry';
import {recordSpace} from './workspace';
import {coordinationPolicySchema,emptyCoordinationPolicy,candidateContribution,aggregateProduction,type ProductionContribution} from './production-coordination';
import {savedNationalCropReferences} from './crop-evidence-library';
import {validatePriceEvidence,type PriceDay} from './price-reference';
import {syntheticRegistrationPnus} from './registration-origin';
export const coordinationPolicyKey={workspace:'shared',kind:'productionCoordinationPolicy',id:'current'};
export function harvestYears(plan:AnnualPlan){return [...new Set(plan.plots.flatMap(p=>p.tasks.filter(t=>t.operationCode==='harvest').flatMap(t=>t.window?[Number(t.window.from.slice(0,4)),Number(t.window.to.slice(0,4))]:[])))];}
export function harvestPeriod(plan:AnnualPlan){
 const tasks=plan.plots.flatMap(p=>p.tasks.filter(t=>t.operationCode==='harvest'));
 if(!tasks.length||tasks.some(t=>!t.window))return null;
 return {from:tasks.map(t=>t.window!.from).sort()[0],to:tasks.map(t=>t.window!.to).sort().at(-1)!};
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
 const rows=await tx.workRecord.findMany({where:{workspace:{in:[...owners.keys()]},kind:{in:['cultivation','cultivationPlan','registrationOrigin']}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]});
 const preparedBySpace=new Map([...owners.keys()].map(space=>[space,syntheticRegistrationPnus(rows.filter(r=>r.workspace===space&&r.kind==='registrationOrigin').map(r=>r.payload))]));
 const plans=new Map(rows.filter(r=>r.kind==='cultivationPlan').map(r=>[r.workspace+':'+r.id,r.payload as unknown as AnnualPlan]));
 const entries:ProductionContribution[]=[];
 for(const row of rows.filter(r=>r.kind==='cultivation')){
  const cycle=row.payload as unknown as Cultivation,plan=plans.get(row.workspace+':'+row.id);
  if(cycle.closedAt)continue;
  const owner=owners.get(row.workspace)!,plot=plan?.plots?.find(p=>p.pnu===cycle.pnu);
  const origin=preparedBySpace.get(row.workspace)?.has(cycle.pnu)||plan?.context?.catalog?'DEMO':'REGISTERED';
  const entry=candidateContribution({id:row.workspace+':'+cycle.id,centerId:owner,crop:cycle.crop,areaM2:plot?.area??null,harvestYears:plan?harvestYears(plan):[],harvestPeriod:plan?harvestPeriod(plan):null,origin},policy,today);
  entries.push(entry);
 }
 return {policy,policyVersion:policyRow?.version??0,excludedEconomicReferences,contributions:entries,centerId,today,origin:'REGISTERED' as const,totals:aggregateProduction(entries),unquantified:entries.filter(e=>!e.kg||!e.commodity||e.year===null).length,coverage:'PARTICIPATING_CULTIVATIONS_ONLY' as const};
}
