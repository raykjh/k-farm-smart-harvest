import type {Prisma} from '@prisma/client';
import type {delegatedProposal} from './delegated-planning';
import {centerId,recordSpace} from './workspace';
import {coordinationPolicyKey,readProductionCoordination,reviewPlanContribution} from './production-coordination-store';
import {coordinationPolicySchema,emptyCoordinationPolicy} from './production-coordination';
import {candidateLimitCheck} from './production-limits';
import {syntheticRegistrationPnus} from './registration-origin';

/** Same advisory lock as policy edits and every new cultivation commit. This
 * closes the race where two center approvals spend the same remaining target
 * or variety supply. Historical plans remain untouched. */
export async function assertDelegatedProductionBounds(tx:Prisma.TransactionClient,plans:Awaited<ReturnType<typeof delegatedProposal>>['plans'],today:string){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production-coordination'}))`;
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:coordinationPolicyKey}});
 const policy=coordinationPolicySchema.parse(row?.payload??emptyCoordinationPolicy());
 if(!policy.planningLimits?.length&&!plans.some(p=>p.plan.context.variety))return;
 const context=await readProductionCoordination(tx,centerId(),today),entries=[...context.contributions];
 const origins=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'registrationOrigin'}});
 const prepared=syntheticRegistrationPnus(origins.map(r=>r.payload));
 for(const p of plans){
  const origin=prepared.has(p.cultivation.pnu)||p.plan.context.catalog?'DEMO':'REGISTERED';
  const review=reviewPlanContribution(p.plan,{id:recordSpace()+':'+p.cultivation.id,centerId:centerId(),crop:p.cultivation.crop,origin},policy,today,entries);
  if(review.variety&&!review.variety.eligible)throw Error('품종·보급 면적·과수 조건이 변경되었습니다. 다시 검토하세요.');
  if(candidateLimitCheck(review.contribution,entries,policy.planningLimits??[],today).blocked)throw Error('참여 생산 목표의 잔여량 또는 근거가 변경되었습니다. 작물 구성을 다시 검토하세요.');
  entries.push(review.contribution);
 }
}
