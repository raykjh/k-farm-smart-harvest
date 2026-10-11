import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel} from '@/lib/auth';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/db';
import {emptyLaborOps,workerSchema,availableFor,notice,allocateJob,respond,overrideJob,completeJob,addPenalty,laborScore,type LaborOps,type LaborJob} from '@/lib/labor-operations';
import type {State} from '@/lib/types';
import {ordinaryWorkerDemand} from '@/lib/planned-labor-demand';
import type {Prisma} from '@prisma/client';
import {laborSharingLock,externalLaborBusy,reconcileLaborShares,sharedLaborRows,type LaborShare} from '@/lib/labor-sharing';
import {assertCapacityRoster} from '@/lib/labor-capacity-store';
import {absenceInput,recordLaborRecovery,refreshLaborRecoveries} from '@/lib/labor-recovery-store';
const key=()=>({workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}});
const local=(r:NextRequest)=>['127.0.0.1:3100','localhost:3100'].includes(r.headers.get('host')??'')&&(!r.headers.get('origin')||['http://127.0.0.1:3100','http://localhost:3100'].includes(r.headers.get('origin')!));
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function demands(tx:Prisma.TransactionClient){
 const rows=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'laborDemand'}}),c=await tx.center.findUnique({where:{id:activeCenterId()}}),s=c?.state as unknown as State|undefined;
 return rows.flatMap(row=>{const m=s?.missions.find(m=>m.id===row.id),count=m?ordinaryWorkerDemand(m):0;if(!m||m.status==='CANCELLED'||!m.scheduledDate||count<1)return [];
  const f=s?.fields.find(f=>f.id===m.fieldId);const value={id:m.id,missionId:m.id,task:m.label,address:f?.address??m.fieldId,date:m.scheduledDate,startMinute:480+((m.start%32+32)%32)*15,durationMinutes:m.duration*15,count,workCode:(m as any).operationCode??'general',held:m.status==='HELD'||m.status==='UNSTAFFED'};
  return [{...value,completed:m.status==='COMPLETED',sourceHash:hash(value)}];
 });
}
const ids=z.array(z.string().uuid()).max(100);
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('person'),person:workerSchema,testDataOnly:z.literal(true)}),
 z.object({action:z.literal('open'),demandId:z.string().min(1).max(300),pay:z.string().trim().min(1).max(150),simpleWorkConfirmed:z.literal(true)}),
 z.object({action:z.literal('response'),jobId:z.string(),workerId:z.string().uuid(),response:z.enum(['APP','PHONE','DECLINED'])}),
 z.object({action:z.literal('absence'),jobId:z.string(),workerId:z.string().uuid(),reason:z.string().trim().min(3).max(500)}),
 z.object({action:z.literal('distance'),jobId:z.string(),workerId:z.string().uuid(),distanceKm:z.number().min(0).max(1000).nullable()}),
 z.object({action:z.literal('override'),jobId:z.string(),ids:ids.nullable(),reason:z.string().trim().min(1).max(500)}),
 z.object({action:z.literal('complete'),jobId:z.string(),worked:ids}),
 z.object({action:z.literal('penalty'),jobId:z.string(),workerId:z.string().uuid(),points:z.number().int().min(1).max(100),reason:z.string().trim().min(1).max(500)}),
 z.object({action:z.literal('sync')})
]);
async function handleGET(req:NextRequest){
 if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{
  const row=await db.workRecord.findUnique({where:key()}),payload=(row?.payload??emptyLaborOps()) as unknown as LaborOps;
  payload.externalBusy=await externalLaborBusy(db,activeCenterId());
  const incoming=(await sharedLaborRows(db)).map(r=>r.payload as unknown as LaborShare).filter(s=>s.borrowerCenterId===activeCenterId()&&(s.status==='ASSIGNED'||s.status==='COMPLETED'&&s.worked));
  for(const j of payload.jobs)j.borrowedNames=incoming.filter(s=>s.jobId===j.id&&s.sourceHash===j.sourceHash).map(s=>s.workerName);
  return NextResponse.json({version:row?.version??0,payload,demands:await demands(db),scores:Object.fromEntries(payload.people.map(p=>[p.id,laborScore(payload,p.id)]))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'인력 운영 자료 조회 실패'},{status:503})}
}
async function handlePOST(req:NextRequest){
 if(!local(req))return NextResponse.json({error:'출처 거부'},{status:403});
 try{const raw=await req.text();if(raw.length>100000)throw Error('입력 크기 초과');const b=JSON.parse(raw),version=z.number().int().nonnegative().parse(b.version),requestId=z.string().uuid().parse(b.requestId),operator=actorLabel(),a=action.parse(b);
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  await laborSharingLock(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace()}`}))`;
  const receiptKey={workspace_kind_id:{workspace:recordSpace(),kind:'laborOperationReceipt',id:requestId}};
  const receipt=await tx.workRecord.findUnique({where:receiptKey});if(receipt){if((receipt.payload as any).hash!==hash(b))throw Error('중복 요청 내용 불일치');return {ok:true,alreadyApplied:true};}
  const row=await tx.workRecord.findUnique({where:key()});if((row?.version??0)!==version)throw Error('다른 화면에서 변경되었습니다. 다시 불러오세요.');
  const s=(row?.payload??emptyLaborOps()) as unknown as LaborOps,now=new Date().toISOString(),ds=await demands(tx);
  s.externalBusy=await externalLaborBusy(tx,activeCenterId());
  const stale=s.jobs.filter(j=>j.status==='OPEN'&&!ds.some(d=>d.id===j.missionId&&d.sourceHash===j.sourceHash));
  // A separate reconciliation commit cancels previous notices before accepting new responses.
  if(stale.length&&a.action!=='sync')throw Error('작업 일정이 변경되었습니다. 일정 변경 반영을 먼저 실행하세요.');
  if(a.action==='sync')for(const j of stale){for(const id of j.assigned)notice(s,j,id,'CANCELLED',now);j.status='STALE';j.assigned=[];}
  if(a.action==='person'){
   if(a.person.birth>new Date(Date.now()+9*3600000).toISOString().slice(0,10))throw Error('생년월일 확인 필요');
   const index=s.people.findIndex(p=>p.id===a.person.id);if(index<0){if(s.people.length>=1000)throw Error('등록 인원 한도');s.people.push(a.person)}else s.people[index]=a.person;
   for(const j of s.jobs.filter(j=>j.status==='OPEN')){if(a.person.employment!=='CENTER_RESERVE'&&availableFor(a.person,j)&&!j.invited.includes(a.person.id)){j.invited.push(a.person.id);notice(s,j,a.person.id,'INVITE',now)}allocateJob(s,j,now);}
  }
  if(a.action==='open'){
   const d=ds.find(d=>d.id===a.demandId);if(!d||d.held||d.completed)throw Error('현재 배정 가능한 단순 인력 수요가 아닙니다.');
   if(s.jobs.some(j=>j.missionId===d.id&&j.status!=='STALE'))throw Error('이미 모집한 작업입니다.');
   const j:LaborJob={...d,id:crypto.randomUUID(),pay:a.pay,status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]};
   j.invited=s.people.filter(p=>p.employment!=='CENTER_RESERVE'&&availableFor(p,j)).map(p=>p.id);s.jobs.push(j);for(const id of j.invited)notice(s,j,id,'INVITE',now);
  }
  if(a.action==='response'||a.action==='absence'){
   const j=s.jobs.find(j=>j.id===a.jobId),wasAssigned=j?.assigned.includes(a.workerId);
   if(a.action==='absence'&&!wasAssigned)throw Error('현재 배정된 사람의 불참만 기록할 수 있습니다.');
   if(j&&wasAssigned&&(a.action==='absence'||a.response==='DECLINED')){
    const d=ds.find(d=>d.id===j.missionId);if(!d||d.completed)throw Error('완료 실적은 불참 처리로 변경하지 않습니다.');
    await recordLaborRecovery(tx,absenceInput(requestId,activeCenterId(),a.workerId,s.people.find(p=>p.id===a.workerId)!.name,j,a.action==='absence'?a.reason:'배정자의 참석 취소 확인',operator));
   }
   respond(s,a.jobId,a.workerId,a.action==='absence'?'DECLINED':a.response,now);
  }
  if(a.action==='distance'){const j=s.jobs.find(j=>j.id===a.jobId);if(!j||j.status!=='OPEN'||!j.invited.includes(a.workerId))throw Error('작업·안내 대상 확인 필요');j.distances[a.workerId]=a.distanceKm;allocateJob(s,j,now);}
  if(a.action==='override')overrideJob(s,a.jobId,a.ids,now);
  if(a.action==='complete')completeJob(s,a.jobId,a.worked,now);
  if(a.action==='penalty')addPenalty(s,a.jobId,a.workerId,a.points,a.reason,operator,now);
  delete s.externalBusy;
  await assertCapacityRoster(tx,activeCenterId(),s);
  await tx.workRecord.upsert({where:key(),create:{workspace:recordSpace(),kind:'laborOperations',id:'current',version:1,payload:json(s)},update:{version:version+1,payload:json(s)}});
  await reconcileLaborShares(tx);
  await refreshLaborRecoveries(tx,activeCenterId());
  await tx.workRecord.create({data:{workspace:recordSpace(),kind:'laborOperationReceipt',id:requestId,payload:json({hash:hash(b),at:now})}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:'labor.'+a.action,detail:json({requestId,operator,version:version+1,...('jobId' in a?{jobId:a.jobId}:{}),...(a.action==='override'?{ids:a.ids,reason:a.reason}:{})})}});
  return {ok:true,version:version+1};
 },{timeout:20000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'처리 실패'},{status:409})}
}

export const GET=withAuth('labor-operations',handleGET);
export const POST=withAuth('labor-operations',handlePOST);
