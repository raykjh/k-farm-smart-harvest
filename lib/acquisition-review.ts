import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {JointEvaluation} from './integrated-plan';
import {recordSpace} from './workspace';

export async function recordAcquisitionReviews(tx:Prisma.TransactionClient,evaluation:JointEvaluation,input:{draftId:string;fingerprint:string;actor:string;source:'NEBIUS'|'RULES'}){
 const saved:string[]=[];
 for(const e of evaluation.equipment){
  if(!evaluation.requests.some(r=>r.centerId===e.centerId&&r.resource===e.code&&r.route==='ADJACENT_THEN_ACQUIRE'))continue;
  const workspace=recordSpace(e.centerId),kind='equipmentAcquisitionReview';
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace+':acquisition:'+e.code}))`;
  const records=await tx.workRecord.findMany({where:{workspace,kind},orderBy:{id:'asc'}});
  const overlaps=records.filter(r=>{const p=r.payload as any;return p.code===e.code&&p.status==='REVIEW_REQUIRED'&&p.from<=e.to&&e.from<=p.to});
  const old=overlaps[0],prior=old?.payload as any;
  const id=old?.id??createHash('sha256').update(JSON.stringify([e.centerId,e.code,e.from,e.to])).digest('hex').slice(0,32);
  if(prior?.evaluationId===evaluation.id&&prior?.fingerprint===input.fingerprint){saved.push(id);continue;}
  const evidence=[...new Set([...(prior?.draftIds??[]),input.draftId])];
  const years=[...new Set(evaluation.views.filter(v=>v.centerId===e.centerId).flatMap(v=>v.view.items.flatMap(i=>i.proposal?[i.proposal.cultivation.start.slice(0,4)]:[])))];
  const priorYears=overlaps.flatMap(r=>(r.payload as any).forecastYears??[]);
  const forecastYears=[...new Set([...years,...priorYears])].sort();
  const payload={id,centerId:e.centerId,code:e.code,status:'REVIEW_REQUIRED',
   from:[e.from,...overlaps.map(r=>(r.payload as any).from)].sort()[0],to:[e.to,...overlaps.map(r=>(r.payload as any).to)].sort().at(-1),
   evaluationId:evaluation.id,fingerprint:input.fingerprint,draftIds:evidence,forecastYears,
   recurrence:forecastYears.length>1?'MULTIPLE_FORECAST_YEARS':'SINGLE_FORECAST_YEAR',
   minimumUnits:e.minimumUnits,ownedUnits:e.ownedUnits,additionalLowerBound:e.additionalLowerBound,
   quantityBasis:'NECESSARY_WINDOW_LOWER_BOUND_NOT_PURCHASE_QUANTITY',workHours:e.workHours,
   alternatives:['SCHEDULE_REVIEW','CONFIRMED_ADJACENT_CAPACITY_REVIEW','RENTAL_REVIEW','PURCHASE_REVIEW'],
   availabilityConfirmed:false,costAssessment:'UNKNOWN',subsidyAssessment:'UNKNOWN',purchaseAuthorized:false,
   source:input.source,reviewedBy:null,updatedBy:input.actor,updatedAt:new Date().toISOString()};
  await tx.workRecord.upsert({where:{workspace_kind_id:{workspace,kind,id}},create:{workspace,kind,id,payload},update:{payload,version:{increment:1}}});
  for(const other of overlaps.slice(1))await tx.workRecord.update({where:{workspace_kind_id:{workspace,kind,id:other.id}},data:{payload:{...other.payload as object,status:'SUPERSEDED',supersededBy:id},version:{increment:1}}});
  await tx.audit.create({data:{centerId:e.centerId,action:'production.acquisition.review',detail:JSON.parse(JSON.stringify({id,before:prior??null,after:payload,merged:overlaps.slice(1).map(r=>r.id)}))}});
  saved.push(id);
 }
 return saved;
}
