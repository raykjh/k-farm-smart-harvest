import {resourceView} from '@/lib/center-resources';
import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel} from '@/lib/auth';
import {syncChangedPlanReservations} from '@/lib/plan-reservation-sync';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {previewAnnualDispatch,dispatchPlacementKey} from '@/lib/annual-dispatch';
import type {AnnualPlan} from '@/lib/annual-plan';
import type {State} from '@/lib/types';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {planFieldsCurrent} from '@/lib/planning-fields';
import {appendAssignments} from '@/lib/plan-missions';
import type {FieldEntry} from '@/lib/field-record';
import {plannedLaborDemand} from '@/lib/planned-labor-demand';
import {assertEnvironmentReferences} from '@/lib/environment-approval';
import {checkEnvironmentExecution} from '@/lib/environment-execution-check';
import {readShortForecast} from '@/lib/kma-forecast';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
import {weatherHash} from '@/lib/annual-replanning';
import {SCHEDULING_ENGINE_VERSION} from '@/lib/scheduling-engine';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify({engine:SCHEDULING_ENGINE_VERSION,value:x})).digest('hex');
async function handleGET(req:NextRequest){try{
 const cultivationId=req.nextUrl.searchParams.get('cultivationId');
 const year=Number(req.nextUrl.searchParams.get('year'));if(cultivationId)z.string().uuid().parse(cultivationId);else if(!Number.isInteger(year)||year<2000||year>2200)throw Error();
 const kind=cultivationId?'cultivationPlan':'annualPlan',id=cultivationId??String(year);
 const plans=await db.$queryRaw<{payload:AnnualPlan}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind=${kind} AND id=${id}`;
 const fields=await db.$queryRaw<{version:number;payload:FieldEntry[]}[]>`SELECT version,payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='fields' AND id='current'`;
 const state=await db.center.findUniqueOrThrow({where:{id:activeCenterId()}});if(!plans[0]||!fields[0]||!planFieldsCurrent(plans[0].payload,fields[0].version,fields[0].payload))throw Error();
 const resources=await resourceView(db,state.state as unknown as State,activeCenterId());
 const preview=await previewAnnualDispatch(plans[0].payload,resources);
 return NextResponse.json({...preview,token:hash({plan:plans[0].payload,state:resources,placement:dispatchPlacementKey(preview.assignments)}),year:plans[0].payload.year,cultivationId},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'최신 농지 기준 계획 초안을 먼저 생성하세요.'},{status:409})}}
async function handlePOST(req:NextRequest){
 if(!['127.0.0.1:3100','localhost:3100'].includes(req.headers.get('host')??'')||(req.headers.get('origin')&&!['http://127.0.0.1:3100','http://localhost:3100'].includes(req.headers.get('origin')!)))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const b=z.object({year:z.number().int().min(2000).max(2200).optional(),cultivationId:z.string().uuid().optional(),token:z.string().regex(/^[a-f0-9]{64}$/),demoAcknowledged:z.literal(true)}).strict().refine(b=>!!b.cultivationId||b.year!==undefined).parse(await req.json());
 const kind=b.cultivationId?'cultivationPlan':'annualPlan',id=b.cultivationId??String(b.year);
 const result=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
 const prior=await tx.$queryRaw<{payload:any}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='annualDispatchApproval' AND id=${b.token}`;
 if(prior[0])return {...prior[0].payload,alreadyApplied:true};
 const fields=await tx.$queryRaw<{version:number;payload:FieldEntry[]}[]>`SELECT version,payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='fields' AND id='current' FOR UPDATE`;
 const plans=await tx.$queryRaw<{payload:AnnualPlan}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind=${kind} AND id=${id} FOR UPDATE`;
 const row=await tx.center.findUniqueOrThrow({where:{id:activeCenterId()}}),s=await resourceView(tx,row.state as unknown as State,activeCenterId()),plan=plans[0]?.payload;
 if(!plan||!fields[0]||!planFieldsCurrent(plan,fields[0].version,fields[0].payload))throw Error('계획·농지·자원이 변경됐습니다. 다시 계산하세요.');
 await assertEnvironmentReferences(tx,plan);
 const preview=(await previewAnnualDispatch(plan,s));if(!preview.assignments.length)throw Error('승인 가능한 배차 후보가 없습니다.');
 if(hash({plan,state:s,placement:dispatchPlacementKey(preview.assignments)})!==b.token)throw Error('계획·자원 또는 계산된 배치가 변경됐습니다. 새 배치를 확인하세요.');
 if(preview.feasibility.some(f=>f.status!=='CAPACITY_FEASIBLE'))throw Error('필수 작업의 기간·장비·인력 조건을 먼저 보완하세요. 부분 배차만으로 재배계획을 확정할 수 없습니다.');
 if(plan.plots.some(p=>p.environmental)){
  const weather=await readShortForecast(await readCenterWeatherConfig());
  if(!plan.environmentReview||!plan.environmentForecastHash||weatherHash(weather)!==plan.environmentForecastHash)throw Error('예보 또는 생육 확인을 갱신하고 재배계획을 다시 저장하세요.');
  // Annual reservations are not equipment-start authority. Validate forecast-covered
  // dates now; later dates remain provisional and require an execution-time review.
  const lastForecastDate=weather.status==='READY'?weather.points.map(p=>p.at.slice(0,10)).sort().at(-1):undefined;
  const covered=preview.assignments.filter(a=>lastForecastDate&&a.date<=lastForecastDate);
  if(covered.length)checkEnvironmentExecution(covered,plan,weather,plan.environmentReview);
 }
 const beforeState=structuredClone(s);
 const names:Record<string,string>={};
 for(const p of plan.plots)if(p.consultationId){const contacts=await tx.$queryRaw<{payload:{farmer:{name:string}}}[]>`SELECT payload FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='consultation' AND id=${p.consultationId}`;if(contacts[0])names[p.consultationId]=contacts[0].payload.farmer.name;}
 const planned=appendAssignments(s,plan,preview,names);s.fields=planned.fields;s.missions=planned.missions;
 const farmers=new Set<string>();
 for(const a of preview.assignments){const f=s.fields.find(f=>f.id===a.pnu)!;if(f.farmerId)farmers.add(f.farmerId);
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES (${recordSpace()},'annualReservation',${a.taskId},1,${JSON.stringify({...a,source:'PLANNING_SIMULATION',status:'RESERVED',approvedAt:new Date().toISOString(),approvedBy:actorLabel()})}::jsonb)`;
 await tx.workRecord.create({data:{workspace:recordSpace(),kind:'laborDemand',id:a.taskId,payload:plannedLaborDemand(plan,a) as Prisma.InputJsonValue}});
 }
 await syncChangedPlanReservations(tx,activeCenterId(),beforeState,s,preview.assignments.map(a=>a.taskId),actorLabel());
 s.planVersion++;await tx.center.update({where:{id:activeCenterId()},data:{state:s as unknown as Prisma.InputJsonValue,version:{increment:1}}});
 for(const farmerId of farmers)await tx.outbox.create({data:{id:'annual:'+b.token+':'+farmerId,centerId:activeCenterId(),farmerId,planVersion:s.planVersion,body:'[모의 알림] 연간계획의 장비 작업이 배정되었습니다. 작업 전 현장·기상 확인 후 진행합니다.'}});
 const saved={ok:true,assigned:preview.assignments.length,pending:preview.pending.length,planVersion:s.planVersion,notifications:farmers.size};
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES (${recordSpace()},'annualDispatchApproval',${b.token},1,${JSON.stringify(saved)}::jsonb)`;
 return saved;
 },{timeout:20000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'승인 실패'},{status:409})}
}

export const GET=withAuth('annual-dispatch',handleGET);
export const POST=withAuth('annual-dispatch',handlePOST);
