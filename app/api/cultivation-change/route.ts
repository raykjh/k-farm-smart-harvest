import {cropCodeSchema} from '@/lib/crop-registry';
import {resourceView} from '@/lib/center-resources';
import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {NextResponse} from 'next/server';
import {isDeepStrictEqual} from 'node:util';
import {withAuth} from '@/lib/auth-route';
import {actorLabel} from '@/lib/auth';
import {db} from '@/lib/db';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {buildAnnualPlan,type AnnualPlan} from '@/lib/annual-plan';
import {checkCultivation,previousCultivationTerminals,type Cultivation} from '@/lib/cultivation';
import {fieldInventory} from '@/lib/field-record';
import {previewAnnualDispatch} from '@/lib/annual-dispatch';
import type {State} from '@/lib/types';
import {planningContext} from '@/lib/planning-context';
import {replaceCultivation} from '@/lib/cultivation-replacement';
import {readCropChangeOptions} from '@/lib/crop-change-options';
const schema=z.object({id:z.string().uuid(),crop:cropCodeSchema,area:z.number().positive().max(10000000),action:z.enum(['preview','save','approve']),token:z.string().optional(),candidateId:z.string().regex(/^[a-f0-9]{64}$/).optional(),context:planningContext.optional(),review:z.object({cost:z.string().trim().min(1).max(2000),consent:z.string().trim().min(1).max(2000)}).optional()}).strict();
export const POST=withAuth('cultivations',async req=>{
 try{const b:ReturnType<typeof schema.parse>&{period?:{start:string;end:string}}=schema.parse(await req.json());const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fields:${recordSpace()}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cultivation-plan:${b.id}`}))`;
  const key=(kind:string,id:string)=>({where:{workspace_kind_id:{workspace:recordSpace(),kind,id}}});
  if(b.action==='approve'&&b.token){const receipt=await tx.workRecord.findUnique(key('cultivationChangeApproval',b.token));if(receipt){const p=receipt.payload as any;if(!isDeepStrictEqual(p.request,JSON.parse(JSON.stringify({id:b.id,crop:b.crop,area:b.area,context:b.candidateId?null:b.context??null,...(b.candidateId?{candidateId:b.candidateId}:{}),review:b.review,actor:actorLabel()}))))throw Error('승인 요청과 저장 기록이 다릅니다.');return {...p,alreadyApplied:true};}}
  const [cycle,inventory,storedPlan,center]=await Promise.all([tx.workRecord.findUniqueOrThrow(key('cultivation',b.id)),tx.workRecord.findUniqueOrThrow(key('fields','current')),tx.workRecord.findUnique(key('cultivationPlan',b.id)),tx.center.findUniqueOrThrow({where:{id:activeCenterId()}})]);
  const c=cycle.payload as unknown as Cultivation,state=await resourceView(tx,center.state as unknown as State,activeCenterId()),fields=fieldInventory.parse(inventory.payload),field=fields.find(f=>f.pnu===c.pnu)!;
  if(c.closedAt||state.fields.find(f=>f.id===c.pnu)?.serviceStatus==='WITHDRAWN')throw Error('종료된 재배는 변경할 수 없습니다. 새 작물을 선택하세요.');
  if(!field)throw Error('등록 농지가 없습니다.');
  let old=storedPlan;
  if(!old){const legacy=await tx.workRecord.findFirst({where:{workspace:recordSpace(),kind:'annualPlan'}}),plan=legacy?.payload as unknown as AnnualPlan|undefined;if(plan?.plots.some(p=>p.pnu===c.pnu))old={...legacy!,payload:JSON.parse(JSON.stringify({...plan,cultivation:c,plots:plan.plots.filter(p=>p.pnu===c.pnu)}))};}
  if(!old)throw Error('기존 재배의 저장 계획 연결을 확인해주세요.');
  if(b.candidateId){
   if(b.area!==field.area)throw Error('작물 변경에서는 등록 면적을 변경할 수 없습니다.');
   const candidate=(await readCropChangeOptions(tx,field)).choices.find(x=>x.id===b.candidateId&&x.crop===b.crop);
   if(!candidate)throw Error('작물 후보의 시기·농지 조건이 변경되었습니다. 다시 선택해주세요.');
   b.context=planningContext.parse(candidate.context);b.period={start:candidate.start,end:candidate.end};
  }
  const linked=state.missions.filter(m=>(m as any).cultivationId===c.id||((m as any).operationKey??'').startsWith(`cultivation:${c.id}:`));
  const next={...c,crop:b.crop,...b.period};
  const cycles=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'cultivation'}});
  checkCultivation(next,cycles.map(r=>r.payload as unknown as Cultivation));
  const otherActive=cycles.some(r=>r.id!==c.id&&!(r.payload as unknown as Cultivation).closedAt&&(r.payload as unknown as Cultivation).pnu===c.pnu);
  if(otherActive&&b.area!==field.area)throw Error('같은 농지의 다른 재배에도 면적 변경 영향이 있습니다. 전체 영향 검토가 필요합니다.');
  const priorPlan=old.payload as unknown as AnnualPlan;
  if(linked.length){if(b.action==='save')throw Error('승인된 재배의 변경은 검토 후 일괄 승인해야 합니다.');return replaceCultivation(tx,b,actorLabel(),c,priorPlan,fields,inventory.version,state);}
  if(b.action==='approve')throw Error('배차 전 초안은 먼저 저장하고 배차 검토를 진행하세요.');
  // Never carry a rice-specific profile or environment approval into another crop.
  const context=b.context??(b.crop===c.crop?priorPlan.context:{region:priorPlan.context?.region});
  const updated={...field,crop:b.crop,area:b.area};
  const plan=buildAnnualPlan([updated],Number(next.start.slice(0,4)),inventory.version+1,context,next,undefined,state);
  if(next.previousId){const previous=cycles.find(x=>x.id===next.previousId)?.payload as unknown as Cultivation,stored=await tx.workRecord.findUnique(key('cultivationPlan',previous.id));const terminals=previousCultivationTerminals(previous,(stored?.payload as AnnualPlan|undefined)?.plots.flatMap(p=>p.tasks)??[]);for(const task of plan.plots[0].tasks)if(!task.predecessorKeys.length)task.predecessorKeys.push(...terminals);}
  const dispatch=(await previewAnnualDispatch(plan,state));
  const token=createHash('sha256').update(JSON.stringify({cycle,inventory,old,center,crop:b.crop,area:b.area,context,period:b.period,candidateId:b.candidateId})).digest('hex');
  if(b.action==='save'){
   if(b.token!==token)throw Error('농지·계획·자원이 변경되었습니다. 변경안을 다시 계산하세요.');
   await tx.workRecord.create({data:{workspace:recordSpace(),kind:'cultivationChangeHistory',id:crypto.randomUUID(),payload:JSON.parse(JSON.stringify({actor:actorLabel(),cycle,old,field}))}});
   await tx.workRecord.update({...key('fields','current'),data:{version:{increment:1},payload:fields.map(f=>f.pnu===c.pnu?updated:f) as any}});
   await tx.workRecord.update({...key('cultivation',c.id),data:{version:{increment:1},payload:next}});
   await tx.workRecord.upsert({...key('cultivationPlan',c.id),create:{workspace:recordSpace(),kind:'cultivationPlan',id:c.id,payload:JSON.parse(JSON.stringify(plan))},update:{version:{increment:1},payload:JSON.parse(JSON.stringify(plan))}});
  }
  return {token,saved:b.action==='save',before:{crop:c.crop,area:field.area},after:{crop:b.crop,area:b.area},tasks:plan.taskCount,dispatch,requiresApproval:true};
 },{timeout:20000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'변경 실패'},{status:409});}
});
