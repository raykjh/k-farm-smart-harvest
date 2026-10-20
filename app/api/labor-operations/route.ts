import {saveAttendanceChanges} from '@/lib/labor-attendance-save';
import {centerId as activeCenterId,recordSpace} from '@/lib/workspace';
import {actorLabel,accountBirthSchema,accountPhoneSchema} from '@/lib/auth';
import {withAuth} from '@/lib/auth-route';
import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/db';
import {emptyLaborOps,workerSchema,availableFor,notice,allocateJob,respond,overrideJob,completeJob,addPenalty,laborScore,type LaborOps,type LaborJob,newAttendance,advanceAttendance,reviewAttendance} from '@/lib/labor-operations';
import {currentLaborDemands} from '@/lib/labor-demands';
import type {Prisma} from '@prisma/client';
import {laborSharingLock,externalLaborBusy,reconcileLaborShares,sharedLaborRows,type LaborShare} from '@/lib/labor-sharing';
import {assertCapacityRoster} from '@/lib/labor-capacity-store';
import {absenceInput,recordLaborRecovery,refreshLaborRecoveries} from '@/lib/labor-recovery-store';
import {recordWorkException} from '@/lib/labor-operations';
import {laborPoliciesForDates} from '@/lib/labor-policy-store';
import {payBasis,payLabel} from '@/lib/labor-policy';
import {prepareRecruitment} from '@/lib/labor-recruitment';
import {attendanceChange,employeeInput,applyAttendanceReview,saveEmployees} from '@/lib/labor-attendance-review';
import {ordinaryLaborAvailability} from '@/lib/labor-operations';
import {readLaborPolicy} from '@/lib/labor-policy-store';
import {prepareSms} from '@/lib/sms-store';
const key=()=>({workspace_kind_id:{workspace:recordSpace(),kind:'laborOperations',id:'current'}});
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const demands=(tx:Prisma.TransactionClient)=>currentLaborDemands(tx,activeCenterId());
const ids=z.array(z.string().uuid()).max(100);
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('saveWorker'),id:z.string().uuid(),profile:z.object({name:z.string().trim().min(1).max(60),birth:accountBirthSchema,phone:accountPhoneSchema,address:z.string().trim().min(1).max(200)}).strict()}),
 z.object({action:z.literal('employees'),input:employeeInput}),
 z.object({action:z.literal('saveAttendance'),jobIds:z.array(z.string().min(1).max(300)).min(1).max(1000),changes:z.array(attendanceChange).max(2000)}),
 z.object({action:z.literal('person'),person:workerSchema,testDataOnly:z.literal(true)}),
 z.object({action:z.literal('open'),demandId:z.string().min(1).max(300),pay:z.string().trim().min(1).max(150).optional(),simpleWorkConfirmed:z.literal(true).optional(),attendancePolicy:z.literal('SEVEN_TWO').optional()}),
 z.object({action:z.literal('attendance'),jobId:z.string()}),
 z.object({action:z.literal('reviewAttendance'),jobId:z.string()}),
 z.object({action:z.literal('response'),jobId:z.string(),workerId:z.string().uuid(),response:z.enum(['APP','SMS','PHONE','DECLINED'])}),
 z.object({action:z.literal('absence'),jobId:z.string(),workerId:z.string().uuid(),reason:z.string().trim().min(3).max(500)}),
 z.object({action:z.literal('distance'),jobId:z.string(),workerId:z.string().uuid(),distanceKm:z.number().min(0).max(1000).nullable()}),
 z.object({action:z.literal('override'),jobId:z.string(),ids:ids.nullable(),reason:z.string().trim().min(1).max(500)}),
 z.object({action:z.literal('complete'),jobId:z.string(),worked:ids,reserveWorked:z.array(z.string().regex(/^\d+$/)).max(100).default([])}),
 z.object({action:z.literal('workException'),jobId:z.string(),workerId:z.string().uuid(),halfDays:z.number().min(0).max(2),reason:z.string().trim().min(3).max(500)}),
 z.object({action:z.literal('penalty'),jobId:z.string(),workerId:z.string().uuid(),points:z.number().int().min(1).max(100),reason:z.string().trim().min(1).max(500)}),
 z.object({action:z.literal('sync')})
]);
async function handleGET(req:NextRequest){
 try{
  const row=await db.workRecord.findUnique({where:key()}),payload=(row?.payload??emptyLaborOps()) as unknown as LaborOps;
  payload.externalBusy=await externalLaborBusy(db,activeCenterId());
  const incoming=(await sharedLaborRows(db)).map(r=>r.payload as unknown as LaborShare).filter(s=>s.borrowerCenterId===activeCenterId()&&(s.status==='ASSIGNED'||s.status==='COMPLETED'&&s.worked));
  for(const j of payload.jobs)j.borrowedNames=incoming.filter(s=>s.jobId===j.id&&s.sourceHash===j.sourceHash).map(s=>s.workerName);
  const year=Number(new Date(Date.now()+9*3600000).toISOString().slice(0,4)),policy=await readLaborPolicy(db,activeCenterId(),year);
  return NextResponse.json({version:row?.version??0,payload,reserveCount:payload.reserveRoster?.count??policy.policy?.reserveCount??3,demands:await demands(db),scores:Object.fromEntries(payload.people.map(p=>[p.id,laborScore(payload,p.id)]))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'인력 운영 자료 조회 실패'},{status:503})}
}
async function handlePOST(req:NextRequest){
 try{const raw=await req.text();if(raw.length>100000)throw Error('입력 크기 초과');const b=JSON.parse(raw),version=z.number().int().nonnegative().parse(b.version),requestId=z.string().uuid().parse(b.requestId),operator=actorLabel(),a=action.parse(b);
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${activeCenterId()} FOR UPDATE`;
  await laborSharingLock(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labor-operations:${recordSpace()}`}))`;
  const receiptKey={workspace_kind_id:{workspace:recordSpace(),kind:'laborOperationReceipt',id:requestId}};
  const receipt=await tx.workRecord.findUnique({where:receiptKey});if(receipt){if((receipt.payload as any).hash!==hash(b))throw Error('중복 요청 내용 불일치');return {ok:true,alreadyApplied:true};}
  const row=await tx.workRecord.findUnique({where:key()});if((row?.version??0)!==version)throw Error('다른 화면에서 변경되었습니다. 다시 불러오세요.');
  const s=(row?.payload??emptyLaborOps()) as unknown as LaborOps,now=new Date().toISOString(),ds=await demands(tx);
  const policies=await laborPoliciesForDates(tx,activeCenterId(),[...ds.map(d=>d.date),...s.jobs.filter(j=>j.status==='OPEN').map(j=>j.date)]);
  s.reserveCapacityByYear=Object.fromEntries(Object.entries(policies).map(([year,p])=>[year,p.policy?.reserveCount??3]));
  s.externalBusy=await externalLaborBusy(tx,activeCenterId());
  const incoming=(await sharedLaborRows(tx)).map(r=>r.payload as unknown as LaborShare).filter(o=>o.borrowerCenterId===activeCenterId()&&o.status==='ASSIGNED');
  for(const j of s.jobs)j.borrowedNames=incoming.filter(o=>o.jobId===j.id&&o.sourceHash===j.sourceHash).map(o=>o.workerName);
  const stale=s.jobs.filter(j=>j.status==='OPEN'&&!ds.some(d=>d.id===j.missionId&&d.sourceHash===j.sourceHash));
  // A separate reconciliation commit cancels previous notices before accepting new responses.
  if(stale.length&&a.action!=='sync')throw Error('작업 일정이 변경되었습니다. 일정 변경 반영을 먼저 실행하세요.');
  if(a.action==='sync'){for(const j of stale){for(const id of j.assigned)notice(s,j,id,'CANCELLED',now);j.status='STALE';j.assigned=[];j.reserveSlots=[];}prepareRecruitment(s,ds,policies,now);}
  for(const j of s.jobs)if(ds.some(d=>d.id===j.missionId&&d.sourceHash===j.sourceHash&&!d.held&&!d.completed))advanceAttendance(s,j,now);
  if(a.action==='attendance'){
   const j=s.jobs.find(j=>j.id===a.jobId),d=ds.find(d=>d.id===j?.missionId);
   if(!j||j.status!=='OPEN'||!d||d.held||d.completed||Date.parse(j.date+'T00:00:00+09:00')+j.startMinute*60000<=Date.parse(now))throw Error('진행 전 작업의 배정 방식만 변경할 수 있습니다.');
   if(!j.attendance)j.attendance={...newAttendance(),proposed:[...j.assigned]};advanceAttendance(s,j,now);
  }
  if(a.action==='person'||a.action==='saveWorker'){
   const old=a.action==='saveWorker'?s.people.find(p=>p.id===a.id):undefined;
   if(old?.employment==='CENTER_RESERVE')throw Error('상시인력 관리에서 수정하세요.');
   const person=a.action==='person'?a.person:workerSchema.parse({...old,id:a.id,registeredFarmer:old?.registeredFarmer??false,usesApp:false,...ordinaryLaborAvailability(),active:old?.active??true,employment:'VOLUNTEER',...a.profile});
   if(person.birth>new Date(Date.now()+9*3600000).toISOString().slice(0,10))throw Error('생년월일 확인 필요');
   const index=s.people.findIndex(p=>p.id===person.id);if(index<0){if(s.people.length>=1000)throw Error('등록 인원 한도');s.people.push(person)}else s.people[index]=person;
   for(const j of s.jobs.filter(j=>j.status==='OPEN'&&(!j.attendance||Date.parse(j.date+'T00:00:00+09:00')+j.startMinute*60000>Date.parse(now)))){if(!j.attendance&&person.employment!=='CENTER_RESERVE'&&availableFor(person,j)&&!j.invited.includes(person.id)){j.invited.push(person.id);notice(s,j,person.id,'INVITE',now)}allocateJob(s,j,now);}
  }
  if(a.action==='employees')saveEmployees(s,a.input,new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10));
  if(a.action==='saveAttendance'){
   await saveAttendanceChanges(tx,activeCenterId(),s,a.jobIds,a.changes,operator,now);
  }
  if(a.action==='open'){
   const d=ds.find(d=>d.id===a.demandId);if(!d||d.held||d.completed)throw Error('현재 배정 가능한 단순 인력 수요가 아닙니다.');
   const existing=s.jobs.find(j=>j.missionId===d.id&&j.status!=='STALE');
   const p=policies[d.date.slice(0,4)],basis=payBasis(p?.policy??null,p?.version??0);
   if(existing?.status==='COMPLETED')throw Error('완료한 모집 기록은 다시 열지 않습니다.');
   const j:LaborJob=existing??{...d,id:crypto.randomUUID(),pay:a.pay??payLabel(basis),...(!a.pay?{payBasis:basis}:{}),...(!a.pay||a.attendancePolicy?{attendance:newAttendance()}:{}),status:'OPEN',invited:[],responses:{},distances:{},assigned:[],manual:null,worked:[]};
   if(!existing)s.jobs.push(j);
   // Backward-compatible explicit invitations may start an untouched generated
   // job early. They cannot overwrite responses, assignments or completed pay.
   if(existing&&a.pay&&!existing.attendance?.startedAt&&!Object.keys(existing.responses).length&&!existing.assigned.length){existing.pay=a.pay;delete existing.payBasis;if(a.attendancePolicy)existing.attendance=newAttendance();else delete existing.attendance;}
   if(j.attendance)advanceAttendance(s,j,now);else{for(const person of s.people.filter(p=>p.employment!=='CENTER_RESERVE'&&availableFor(p,j)&&!j.invited.includes(p.id))){j.invited.push(person.id);notice(s,j,person.id,'INVITE',now);}}
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
  if(a.action==='complete')completeJob(s,a.jobId,a.worked,now,a.reserveWorked);
  if(a.action==='workException')recordWorkException(s,{...a,id:requestId,actor:operator,at:now});
  if(a.action==='penalty')addPenalty(s,a.jobId,a.workerId,a.points,a.reason,operator,now);
  if(a.action==='reviewAttendance'){const j=s.jobs.find(j=>j.id===a.jobId);if(!j)throw Error('작업 확인 필요');reviewAttendance(j,operator,now);}
  delete s.externalBusy;for(const j of s.jobs)delete j.borrowedNames;
  await assertCapacityRoster(tx,activeCenterId(),s);
  await tx.workRecord.upsert({where:key(),create:{workspace:recordSpace(),kind:'laborOperations',id:'current',version:1,payload:json(s)},update:{version:version+1,payload:json(s)}});
  await reconcileLaborShares(tx);
  await refreshLaborRecoveries(tx,activeCenterId());
  await prepareSms(tx,activeCenterId(),now);
  await tx.workRecord.create({data:{workspace:recordSpace(),kind:'laborOperationReceipt',id:requestId,payload:json({hash:hash(b),at:now})}});
  await tx.audit.create({data:{centerId:activeCenterId(),action:'labor.'+a.action,detail:json({requestId,operator,version:version+1,...('jobId' in a?{jobId:a.jobId}:{}),...(a.action==='saveAttendance'?{jobIds:a.jobIds,changes:a.changes,selectionPolicy:'SCORE_THEN_DISTANCE',realMessages:0}:{}),...(a.action==='employees'?{employeeCount:a.input.count}:{}),...(a.action==='override'?{ids:a.ids,reason:a.reason}:{})})}});
  return {ok:true,version:version+1};
 },{timeout:20000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'처리 실패'},{status:409})}
}

export const GET=withAuth('labor-operations',handleGET);
export const POST=withAuth('labor-operations',handlePOST);
