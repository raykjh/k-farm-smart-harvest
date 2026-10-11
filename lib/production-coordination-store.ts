import type {Prisma} from '@prisma/client';
import type {AnnualPlan} from './annual-plan';
import type {Cultivation} from './cultivation';
import {centerRegistry} from './center-registry';
import {recordSpace} from './workspace';
import {coordinationPolicySchema,emptyCoordinationPolicy,candidateContribution,aggregateProduction,type ProductionContribution} from './production-coordination';
export const coordinationPolicyKey={workspace:'shared',kind:'productionCoordinationPolicy',id:'current'};
export function harvestYears(plan:AnnualPlan){return [...new Set(plan.plots.flatMap(p=>p.tasks.filter(t=>t.operationCode==='harvest').flatMap(t=>t.window?[Number(t.window.from.slice(0,4)),Number(t.window.to.slice(0,4))]:[])))];}
/** Cross-center output contains aggregate crop quantities, never farmer contacts. */
export async function readProductionCoordination(tx:Prisma.TransactionClient,centerId:string,today:string){
 const policyRow=await tx.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}}),policy=coordinationPolicySchema.parse(policyRow?.payload??emptyCoordinationPolicy());
 const rows=await tx.workRecord.findMany({where:{workspace:{in:centerRegistry.map(c=>recordSpace(c.id))},kind:{in:['cultivation','cultivationPlan']}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]});
 const plans=new Map(rows.filter(r=>r.kind==='cultivationPlan').map(r=>[r.workspace+':'+r.id,r.payload as unknown as AnnualPlan]));
 const entries:ProductionContribution[]=[];
 for(const row of rows.filter(r=>r.kind==='cultivation')){
  const cycle=row.payload as unknown as Cultivation,plan=plans.get(row.workspace+':'+row.id);
  const owner=centerRegistry.find(c=>recordSpace(c.id)===row.workspace)!.id,plot=plan?.plots?.find(p=>p.pnu===cycle.pnu);
  const origin=plan?.context?.catalog?'DEMO':'REGISTERED';
  const entry=candidateContribution({id:row.workspace+':'+cycle.id,centerId:owner,crop:cycle.crop,areaM2:plot?.area??null,harvestYears:plan?harvestYears(plan):[],origin},policy,today);
  entries.push(entry);
 }
 return {policy,policyVersion:policyRow?.version??0,contributions:entries,centerId,today,origin:'REGISTERED' as const,totals:aggregateProduction(entries),unquantified:entries.filter(e=>!e.kg||!e.commodity||e.year===null).length,coverage:'PARTICIPATING_CULTIVATIONS_ONLY' as const};
}
