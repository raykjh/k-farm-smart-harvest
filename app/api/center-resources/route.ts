import {queueEquipmentReview,processEquipmentReview} from '@/lib/equipment-scheduling';
import {isCenterOperator} from '@/lib/auth-policy';
import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal} from '@/lib/auth';
import {db} from '@/lib/db';
import {centerRegistry} from '@/lib/center-registry';
import {saveLoan,markSharedFailure,lockCenterPool} from '@/lib/center-resources';
import type {State} from '@/lib/types';
import {recordSpace} from '@/lib/workspace';
import {z} from 'zod';
import {geographicNeighbors} from '@/lib/center-adjacency';
import {saveSharingOffer} from '@/lib/equipment-sharing-offers';
import {fetchCenterGeography} from '@/lib/center-demo-fixture';
import {manageLoan} from '@/lib/loan-lifecycle';
import {acknowledgeResourceNotice} from '@/lib/center-resource-notices';
export const GET=withAuth('center-resources',async()=>{
 const p=currentPrincipal()!,centers=await db.center.findMany({orderBy:{id:'asc'}});
 const rows=await db.workRecord.findMany({where:{workspace:'shared',kind:'equipmentLoan'},orderBy:{updatedAt:'desc'}});
 const impacts=p.centerId?await db.workRecord.findMany({where:{workspace:recordSpace(p.centerId),kind:'resourceImpact'},orderBy:{updatedAt:'desc'}}):[];
 const notices=p.centerId?await db.workRecord.findMany({where:{workspace:recordSpace(p.centerId),kind:'centerResourceNotice'},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:100}):[];
 const neighborCenterIds=p.centerId?await geographicNeighbors(db,p.centerId):[];
 const offers=(await db.workRecord.findMany({where:{workspace:'shared',kind:'equipmentSharingOffer'},orderBy:{id:'asc'}})).map(r=>({...r.payload as any,version:r.version})).filter(o=>p.role==='SUPER_ADMIN'||o.ownerCenterId===p.centerId||o.borrowerCenterId===p.centerId);
 // Resource-only sharing: no other center's farmers, land records or workforce PII.
 return NextResponse.json({centerId:p.centerId,canManage:isCenterOperator(p),neighborCenterIds,offers,centers:centerRegistry.map(c=>({id:c.id,name:c.name,office:c.office})),resources:centers.flatMap(c=>(c.state as unknown as State).machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===c.id).map(m=>({id:m.id,name:m.name,type:m.type,status:m.status,safetyLock:m.safetyLock,capacityHaHour:m.capacityHaHour,ownerCenterId:c.id}))),loans:rows.filter(r=>p.role==='SUPER_ADMIN'||[(r.payload as any).ownerCenterId,(r.payload as any).borrowerCenterId].includes(p.centerId)).map(r=>({...r.payload as object,version:r.version})),impacts:impacts.map(r=>({id:r.id,...r.payload as object})),notices:notices.map(r=>r.payload)});
});
export const POST=withAuth('center-resources',async req=>{
 try{const b=await req.json(),p=currentPrincipal()!;
  if(b.action==='refreshGeography'){
   if(!isCenterOperator(p))throw Error('센터 관리자 권한 필요');
   const maps=await Promise.all(centerRegistry.map(async c=>({id:c.id,geography:await fetchCenterGeography(c.id)})));
   await db.$transaction(async tx=>{await lockCenterPool(tx);for(const m of maps){const key={workspace:recordSpace(m.id),kind:'centerGeography',id:'current'};await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload:JSON.parse(JSON.stringify(m.geography))},update:{payload:JSON.parse(JSON.stringify(m.geography)),version:{increment:1}}});}await tx.audit.create({data:{centerId:p.centerId!,action:'centerGeography.refresh',detail:{actorId:p.id,source:'VWorld',centers:maps.map(m=>m.id)}}});});
   return NextResponse.json({ok:true});
  }
  const result=await db.$transaction(async tx=>{
  if(b.action==='previewLoan'||b.action==='manageLoan')return manageLoan(tx,b,p);
  if(b.action==='ackNotice'){const q=z.object({action:z.literal('ackNotice'),id:z.string().min(1).max(300)}).strict().parse(b);return acknowledgeResourceNotice(tx,q.id,p);}
  if(b.action==='sharingOffer')return saveSharingOffer(tx,b.offer,p);
  if(b.action==='failure'){
   const q=z.object({action:z.literal('failure'),machineId:z.string().min(1),from:z.string().date(),expectedRepairOn:z.string().date().optional()}).strict().parse(b);
   if(q.expectedRepairOn&&q.expectedRepairOn<q.from)throw Error('수리 예정일을 확인하세요.');
   const impacts=await markSharedFailure(tx,q.machineId,q.from,p.centerId!,p.id,q.expectedRepairOn);const reviewId=await queueEquipmentReview(tx,q.machineId,p,'장비 고장에 따른 지역 일정 재검토');return {impacts,reviewId};
  }
  if(b.action==='capacity'){
   const q=z.object({action:z.literal('capacity'),version:z.number().int().nonnegative(),staffCount:z.number().int().min(0).max(1000),transportCount:z.number().int().min(0).max(1000)}).strict().parse(b);
   await lockCenterPool(tx);const row=await tx.center.findUniqueOrThrow({where:{id:p.centerId!}}),s=row.state as unknown as State;
   if(row.version!==q.version)throw Error('자원 자료가 변경되었습니다. 다시 확인하세요.');
   if(s.missions.some(m=>!['COMPLETED','CANCELLED'].includes(m.status))&&(q.staffCount<s.staffCount||q.transportCount<s.transportCount))throw Error('미완료 작업이 있어 자원 감소의 일정 영향 검토가 필요합니다.');
   s.staffCount=q.staffCount;s.transportCount=q.transportCount;s.planVersion++;
   await tx.center.update({where:{id:row.id},data:{state:JSON.parse(JSON.stringify(s)),version:{increment:1}}});
   await tx.audit.create({data:{centerId:row.id,action:'resources.capacity',detail:{actorId:p.id,...q}}});return {ok:true};
  }
  return saveLoan(tx,b,p);
 },{timeout:30000});const reviewId='reviewId' in result?result.reviewId:null;return NextResponse.json({...result,...(typeof reviewId==='string'?{review:await processEquipmentReview(reviewId)}:{})});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'공유 장비 처리 실패'},{status:409})}
});
