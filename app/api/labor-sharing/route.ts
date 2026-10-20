import {isCenterOperator} from '@/lib/auth-policy';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {centerId,recordSpace} from '@/lib/workspace';
import {geographicNeighbors} from '@/lib/center-adjacency';
import {centerDefinition} from '@/lib/center-registry';
import {lockCenterPool} from '@/lib/center-resources';
import {emptyLaborOps,type LaborOps} from '@/lib/labor-operations';
import {laborSharingLock,sharedLaborRows,eligibleShare,reconcileLaborShares,type LaborShare} from '@/lib/labor-sharing';
import {laborCapacityRows,capacityAllowsAttendance} from '@/lib/labor-capacity-store';
import type {LaborCapacityWindow} from '@/lib/labor-capacity';
import type {State} from '@/lib/types';
import {recordLaborRecovery,refreshLaborRecoveries} from '@/lib/labor-recovery-store';
const key=(id:string)=>({workspace:recordSpace(id),kind:'laborOperations',id:'current'});
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
export const GET=withAuth('labor-sharing',async()=>{
 const id=centerId(),neighbors=await geographicNeighbors(db,id),rows=await sharedLaborRows(db),offers=rows.map(r=>({...r.payload as unknown as LaborShare,version:r.version}));
 const own=await db.workRecord.findUnique({where:{workspace_kind_id:key(id)}}),ops=(own?.payload??emptyLaborOps()) as unknown as LaborOps;
 const rosters=await db.workRecord.findMany({where:{kind:'laborOperations',id:'current',workspace:{in:neighbors.map(c=>recordSpace(c))}}});
 const jobs=rosters.flatMap(r=>{const owner=neighbors.find(c=>recordSpace(c)===r.workspace)!;return (r.payload as unknown as LaborOps).jobs.filter(j=>j.status==='OPEN').map(j=>({centerId:owner,centerName:centerDefinition(owner).name,jobId:j.id,sourceHash:j.sourceHash,date:j.date,startMinute:j.startMinute,durationMinutes:j.durationMinutes,task:j.task,address:j.address,pay:j.pay,shortage:Math.max(0,j.count-j.assigned.length-offers.filter(s=>s.borrowerCenterId===owner&&s.jobId===j.id&&s.status==='ASSIGNED').length)})).filter(j=>j.shortage>0&&Date.parse(j.date+'T00:00:00+09:00')+j.startMinute*60000>Date.now())});
 const notices=await db.workRecord.findMany({where:{workspace:recordSpace(id),kind:'laborShareNotice'},orderBy:{updatedAt:'desc'},take:50});
 return NextResponse.json({centerId:id,canManage:isCenterOperator(currentPrincipal()),version:own?.version??0,workers:ops.people.filter(p=>p.active&&p.employment!=='CENTER_RESERVE').map(p=>({id:p.id,name:p.name})),jobs,offers:offers.filter(s=>s.ownerCenterId===id||s.borrowerCenterId===id),notices:notices.map(r=>r.payload)});
});
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('offer'),requestId:z.string().uuid(),version:z.number().int().nonnegative(),borrowerCenterId:z.string().min(1),jobId:z.string().min(1),sourceHash:z.string().min(1),workerId:z.string().uuid(),response:z.enum(['APP','SMS','PHONE']),travelMinutes:z.number().int().min(0).max(240),distanceKm:z.number().min(0).max(300),consent:z.literal(true)}).strict(),
 z.object({action:z.literal('cancel'),requestId:z.string().uuid(),id:z.string().uuid(),version:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict(),
 z.object({action:z.literal('complete'),requestId:z.string().uuid(),id:z.string().uuid(),version:z.number().int().positive(),worked:z.boolean()}).strict(),
]);
export const POST=withAuth('labor-sharing',async req=>{
 try{
  const b=command.parse(await req.json()),id=centerId(),actor=actorLabel(),hash=createHash('sha256').update(JSON.stringify({b,actor})).digest('hex');
  const result=await db.$transaction(async tx=>{
   await lockCenterPool(tx);await laborSharingLock(tx);
   const receiptKey={workspace:recordSpace(),kind:'laborShareReceipt',id:b.requestId},prior=await tx.workRecord.findUnique({where:{workspace_kind_id:receiptKey}});
   if(prior){if((prior.payload as any).hash!==hash)throw Error('요청 ID 충돌');return {ok:true,alreadyApplied:true};}
   if(b.action==='offer'){
    const neighbors=await geographicNeighbors(tx,id);if(!neighbors.includes(b.borrowerCenterId))throw Error('경계를 공유하는 인접센터만 지원할 수 있습니다.');
    const own=await tx.workRecord.findUnique({where:{workspace_kind_id:key(id)}}),owner=(own?.payload??emptyLaborOps()) as unknown as LaborOps;
    if((own?.version??0)!==b.version)throw Error('인력 정보 변경: 다시 조회하세요.');
    const worker=owner.people.find(p=>p.id===b.workerId),target=await tx.workRecord.findUnique({where:{workspace_kind_id:key(b.borrowerCenterId)}}),job=(target?.payload as unknown as LaborOps|undefined)?.jobs.find(j=>j.id===b.jobId);
    if(!worker||!job||job.sourceHash!==b.sourceHash||Date.parse(job.date+'T00:00:00+09:00')+(job.startMinute-b.travelMinutes)*60000<=Date.now())throw Error('작업 일정·출발 가능 시각·신청자 확인 필요');
    const offer:LaborShare={id:b.requestId,ownerCenterId:id,borrowerCenterId:b.borrowerCenterId,workerId:worker.id,workerName:worker.name,jobId:job.id,sourceHash:job.sourceHash,date:job.date,startMinute:job.startMinute,durationMinutes:job.durationMinutes,travelMinutes:b.travelMinutes,distanceKm:b.distanceKm,response:b.response,consent:true,status:'WAITLIST',reason:'참석 및 인접센터 지원 동의 확인',actor,createdAt:new Date().toISOString()};
    if(!eligibleShare(offer,owner,job,neighbors))throw Error('가능 시간·이동 시간·기존 배정·근무 가능 작업 확인 필요');
    const receiving=await tx.center.findUnique({where:{id:b.borrowerCenterId}}),mission=(receiving?.state as unknown as State|undefined)?.missions.find(m=>m.id===job.missionId);
    if(!capacityAllowsAttendance((await laborCapacityRows(tx)).map(r=>r.payload as unknown as LaborCapacityWindow),offer,mission))throw Error('확정된 지원 예약과 다른 작업입니다. 지원 예약·작업 연결을 먼저 확인하세요.');
    const all=(await sharedLaborRows(tx)).map(r=>r.payload as unknown as LaborShare);
    if(all.some(s=>s.ownerCenterId===id&&s.workerId===worker.id&&s.borrowerCenterId===b.borrowerCenterId&&s.jobId===job.id&&s.status!=='CANCELLED'))throw Error('이미 지원한 작업입니다.');
    await tx.workRecord.create({data:{workspace:'shared',kind:'laborShare',id:offer.id,payload:json(offer)}});
   }else{
    const k={workspace:'shared',kind:'laborShare',id:b.id},row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:k}}),offer=row.payload as unknown as LaborShare;
    if(row.version!==b.version)throw Error('지원 상태가 변경되었습니다. 다시 조회하세요.');
    if(![offer.ownerCenterId,offer.borrowerCenterId].includes(id)||['CANCELLED','COMPLETED'].includes(offer.status))throw Error('변경 권한 또는 상태 확인 필요');
    if(b.action==='complete'&&(id!==offer.borrowerCenterId||offer.status!=='ASSIGNED'||Date.now()<Date.parse(offer.date+'T00:00:00+09:00')+(offer.startMinute+offer.durationMinutes)*60000))throw Error('지원받은 센터에서 근무 종료 후 기록하세요.');
    if(offer.status==='ASSIGNED'&&(b.action==='cancel'||!b.worked)){
     const roster=await tx.workRecord.findUnique({where:{workspace_kind_id:key(offer.borrowerCenterId)}}),job=(roster?.payload as unknown as LaborOps|undefined)?.jobs.find(j=>j.id===offer.jobId);
     if(job)await recordLaborRecovery(tx,{id:b.requestId,kind:'SHARE_WITHDRAWAL',centerId:offer.borrowerCenterId,ownerCenterId:offer.ownerCenterId,workerId:offer.workerId,workerName:offer.workerName,jobId:job.id,date:job.date,startMinute:job.startMinute,endMinute:job.startMinute+job.durationMinutes,missionIds:[job.missionId],reason:b.action==='cancel'?b.reason:'근무 종료 후 확인된 불참',actor});
    }
    if(b.action==='complete'){offer.status='COMPLETED';offer.worked=b.worked;offer.reason=b.worked?'실제 근무 확인':'실제 불참 확인';}
    else{offer.status='CANCELLED';offer.reason=b.reason;}
    await tx.workRecord.update({where:{workspace_kind_id:k},data:{version:{increment:1},payload:json(offer)}});
    for(const c of [offer.ownerCenterId,offer.borrowerCenterId])await tx.workRecord.create({data:{workspace:recordSpace(c),kind:'laborShareNotice',id:crypto.randomUUID(),payload:json({offerId:offer.id,workerName:offer.workerName,status:offer.status,reason:offer.reason,date:offer.date,at:new Date().toISOString(),delivery:'INTERNAL_RECORD_ONLY'})}});
   }
   await reconcileLaborShares(tx);
   // Center pool locks precede the shared labor lock, so recovery flags never
   // overwrite a concurrent plan in either participating center.
   for(const c of await tx.center.findMany({select:{id:true}}))await refreshLaborRecoveries(tx,c.id);
   await tx.workRecord.create({data:{...receiptKey,payload:{hash}}});
   await tx.audit.create({data:{centerId:id,action:'labor.share.'+b.action,detail:json({actor,requestId:b.requestId})}});
   return {ok:true};
  },{timeout:30000});return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'센터 간 인력 처리 실패'},{status:409})}
});
