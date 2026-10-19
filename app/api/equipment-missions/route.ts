import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {withAuth} from '@/lib/auth-route';
import {actorLabel,currentPrincipal} from '@/lib/auth';
import {centerId,recordSpace} from '@/lib/workspace';
import {resourceView,assertResourceBooking} from '@/lib/center-resources';
import {missionPacket,workAreaInput,type WorkArea} from '@/lib/equipment-mission';
import {splitAreaInput,splitGroup,splitReviewFingerprint,validateSplitReview,resolveSplitArea,draftSplitReview,type SplitWorkArea} from '@/lib/split-work-area';
import {validateWorkGeometry} from '@/lib/work-area-geometry';
import {legacyWorkGroups,legacyPartsInput,linkLegacyWorkParts} from '@/lib/legacy-work-parts';
import {immovable} from '@/lib/replan-scope';
import type {WorkMission} from '@/lib/replan-work-split';
import {withRegisteredInventory} from '@/lib/inventory-view';
import type {FieldEntry} from '@/lib/field-record';
import {reservationSchema} from '@/lib/shared-reservations';
import type {State} from '@/lib/types';
import type {Prisma} from '@prisma/client';
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10),key=(kind:string,id:string)=>({workspace:recordSpace(),kind,id}),json=(v:unknown)=>JSON.parse(JSON.stringify(v));
async function source(tx:Prisma.TransactionClient){
 const c=await tx.center.findUnique({where:{id:centerId()}}),s=c?await resourceView(tx,c.state as unknown as State,centerId()):null;
 const inventory=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'fields',id:'current'}}});
 const state=s?withRegisteredInventory(s,(inventory?.payload??[]) as FieldEntry[]):null;
 const rows=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:{in:['equipmentMission','workArea','splitWorkArea']}}}),r=await tx.workRecord.findMany({where:{workspace:'shared',kind:'resourceReservation'}});
 // Registration owns the access status; the geometry record remains separate.
 for(const row of rows.filter(r=>r.kind==='workArea')){const access=state?.fields.find(f=>f.id===row.id)?.machineAccess;if(access!==undefined)row.payload={...(row.payload as any),machineAccessConfirmed:access==='yes'};}
 return {state,rows,reservations:r.map(x=>reservationSchema.parse(x.payload))};
}
export const GET=withAuth('equipment-missions',async()=>{
 const s=await source(db),areas=s.rows.filter(r=>r.kind==='workArea').map(r=>r.payload as unknown as WorkArea),packets=s.rows.filter(r=>r.kind==='equipmentMission');
 const splitAreas=s.rows.filter(r=>r.kind==='splitWorkArea').map(r=>r.payload as unknown as SplitWorkArea);
 const groupIds=[...new Set((s.state?.missions as WorkMission[]??[]).filter(m=>m.equipmentSplit&&!['CANCELLED','COMPLETED'].includes(m.status)).map(m=>m.equipmentSplit!.groupId))];
 const groups=groupIds.map(groupId=>{
  try{const g=splitGroup(s.state!,groupId),parent=areas.find(a=>a.pnu===g.fieldId)??null,saved=splitAreas.find(a=>a.groupId===groupId)??null,review=resolveSplitArea(s.state!,groupId,parent,saved,today());
   return {groupId,sourceId:g.sourceId,fieldId:g.fieldId,label:g.members[0].label.replace(/ \(분할 \d+\/\d+\)$/,''),editable:g.editable,parent,saved,...review,members:g.members.map(m=>({id:m.id,part:m.equipmentSplit!.part,label:m.label,date:m.scheduledDate,status:m.status,frozen:immovable(m),areaHa:m.equipmentWork!.areaHa}))};
  }catch(e){return {groupId,editable:false,ready:false,reason:e instanceof Error?e.message:'분할 구역 검토 필요',members:[]};}
 });
 return NextResponse.json({canManage:currentPrincipal()?.role==='CENTER_ADMIN',areas,groups,legacyGroups:s.state?legacyWorkGroups(s.state):[],fields:s.state?.fields.map(f=>({id:f.id,address:f.address,machineAccess:f.machineAccess}))??[],tasks:s.state?.missions.filter(m=>m.resourceId&&!m.resourceOccupancyOnly&&!['CANCELLED','COMPLETED'].includes(m.status)).map(m=>{
  const check=missionPacket(s.state!,centerId(),m.id,areas.find(a=>a.pnu===m.fieldId)??null,s.reservations,today(),splitAreas),stored=packets.find(r=>(r.payload as any).missionId===m.id)?.payload as any;
  return {id:m.id,label:m.label,fieldId:m.fieldId,date:m.scheduledDate,equipmentId:m.resourceId,...check,status:stored?(stored.fingerprint!==check.fingerprint||!check.ready?'STALE':stored.status):'NOT_PREPARED'};
 })??[]});
});
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('linkLegacyParts'),review:legacyPartsInput}).strict(),
 z.object({action:z.literal('area'),version:z.number().int().nonnegative(),area:workAreaInput}).strict(),
 z.object({action:z.literal('splitDraft'),groupId:z.string().min(1).max(100),fingerprint:z.string().length(64),axis:z.enum(['EW','NS'])}).strict(),
 z.object({action:z.literal('splitArea'),version:z.number().int().nonnegative(),fingerprint:z.string().length(64),area:splitAreaInput}).strict(),
 z.object({action:z.enum(['prepare','localReceipt']),missionId:z.string().min(1),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid()}).strict(),
]);
export const POST=withAuth('equipment-missions',async req=>{
 try{
  const b=command.parse(await req.json()),actor=actorLabel();
  const result=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Center" WHERE id=${centerId()} FOR UPDATE`;
   const s=await source(tx);if(!s.state)throw Error('센터 등록 필요');
   if(b.action==='linkLegacyParts'){
    const linked=linkLegacyWorkParts(s.state,b.review);
    // Persist only the stored center state, not transient cross-center resources.
    const row=await tx.center.findUniqueOrThrow({where:{id:centerId()}}),stored=row.state as unknown as State;
    for(const id of linked.missionIds){
     const before=stored.missions.find(m=>m.id===id)!,after=linked.state.missions.find(m=>m.id===id)!;
     await tx.workRecord.create({data:{...key('workPartLinkHistory',linked.groupId+':'+id),payload:json({before,after,note:b.review.note,actor,at:new Date().toISOString()})}});
     stored.missions=stored.missions.map(m=>m.id===id?after:m);
    }
    stored.planVersion++;
    await tx.center.update({where:{id:centerId()},data:{state:json(stored),version:{increment:1}}});
    await tx.audit.create({data:{centerId:centerId(),action:'equipment.legacy-parts.link',detail:json({actor,groupId:linked.groupId,missionIds:linked.missionIds,note:b.review.note})}});
    return {ok:true,groupId:linked.groupId,areaReviewRequired:true,executionAuthorized:false};
   }
   if(b.action==='area'){
    if(!s.state.fields.some(f=>f.id===b.area.pnu)||b.area.reviewedOn>today())throw Error('등록 농지·현장 확인일 검토 필요');
    const k=key('workArea',b.area.pnu),prior=await tx.workRecord.findUnique({where:{workspace_kind_id:k}});if((prior?.version??0)!==b.version)throw Error('작업구역이 변경되었습니다.');
    validateWorkGeometry(b.area.geometry);
    const fieldTasks=(s.state.missions as WorkMission[]).filter(m=>m.fieldId===b.area.pnu);
    if(fieldTasks.some(m=>!['COMPLETED','CANCELLED'].includes(m.status)&&immovable(m))||fieldTasks.some(m=>m.equipmentSplit&&immovable(m)&&fieldTasks.some(n=>n.equipmentSplit?.groupId===m.equipmentSplit!.groupId&&!['COMPLETED','CANCELLED'].includes(n.status))))throw Error('시작·완료·잠금 회차가 포함된 진행 중 작업의 전체 구역은 변경할 수 없습니다.');
    const area:WorkArea={...b.area,version:b.version+1,reviewedBy:actor};
    if(prior)await tx.workRecord.create({data:{...key('workAreaHistory',`${b.area.pnu}:${prior.version}`),payload:prior.payload as Prisma.InputJsonValue}});
    await tx.workRecord.upsert({where:{workspace_kind_id:k},create:{...k,version:area.version,payload:json(area)},update:{version:area.version,payload:json(area)}});
    await tx.audit.create({data:{centerId:centerId(),action:'equipment.work-area.review',detail:json({actor,pnu:area.pnu,version:area.version})}});
    return {ok:true};
   }
   if(b.action==='splitDraft'||b.action==='splitArea'){
    const groupId=b.action==='splitDraft'?b.groupId:b.area.groupId,g=splitGroup(s.state,groupId),parent=s.rows.find(r=>r.kind==='workArea'&&r.id===g.fieldId)?.payload as unknown as WorkArea??null;
    if(!g.editable)throw Error('시작·완료·취소·잠금 회차가 있어 분할 구역을 변경할 수 없습니다.');
    const fingerprint=splitReviewFingerprint(s.state,groupId,parent);
    if(fingerprint!==b.fingerprint)throw Error('작업량·전체 구역이 변경되었습니다. 새로 확인하세요.');
    if(!parent?.machineAccessConfirmed||parent.reviewedOn>today())throw Error('전체 작업구역과 진입 확인을 먼저 저장하세요.');
    if(b.action==='splitDraft'){
     const prior=s.rows.find(r=>r.kind==='splitWorkArea'&&r.id===groupId)?.payload as unknown as SplitWorkArea??null;
     const parts=draftSplitReview(s.state,groupId,parent,prior,b.axis);
     return {ok:true,approved:false,saved:false,parts:g.members.map((m,i)=>({missionId:m.id,geometry:parts[i]}))};
    }
    const k=key('splitWorkArea',groupId),prior=s.rows.find(r=>r.kind==='splitWorkArea'&&r.id===groupId);
    if((prior?.version??0)!==b.version)throw Error('다른 담당자가 분할 구역을 변경했습니다. 새로 불러오세요.');
    const metrics=validateSplitReview(s.state,groupId,parent,b.area,today(),prior?.payload as unknown as SplitWorkArea??null);
    const area:SplitWorkArea={...b.area,version:b.version+1,parentVersion:parent.version,reviewFingerprint:fingerprint,reviewedBy:actor,savedAt:new Date().toISOString()};
    if(prior)await tx.workRecord.create({data:{...key('splitWorkAreaHistory',`${groupId}:${prior.version}`),payload:prior.payload as Prisma.InputJsonValue}});
    await tx.workRecord.upsert({where:{workspace_kind_id:k},create:{...k,version:area.version,payload:json(area)},update:{version:area.version,payload:json(area)}});
    await tx.audit.create({data:{centerId:centerId(),action:'equipment.split-area.review',detail:json({actor,groupId,version:area.version,parentVersion:parent.version,fingerprint,missionIds:g.members.map(m=>m.id)})}});
    return {ok:true,metrics,version:area.version,executionAuthorized:false};
   }
   const mission=s.state.missions.find(m=>m.id===b.missionId),area=s.rows.find(r=>r.kind==='workArea'&&r.id===mission?.fieldId)?.payload as unknown as WorkArea|null;
   const check=missionPacket(s.state,centerId(),b.missionId,area??null,s.reservations,today(),s.rows.filter(r=>r.kind==='splitWorkArea').map(r=>r.payload as unknown as SplitWorkArea));
   if(check.fingerprint!==b.fingerprint||!check.ready)throw Error('계획·장비·작업구역 조건 변경: 다시 확인하세요. '+check.blockers.join(', '));
   await assertResourceBooking(tx,centerId(),mission!.resourceId!,mission!.scheduledDate!);
   const k=key('equipmentMission',b.missionId),previous=await tx.workRecord.findUnique({where:{workspace_kind_id:k}}),old=previous?.payload as any;
   if(old?.requestId===b.requestId){if(old.action!==b.action||old.fingerprint!==b.fingerprint)throw Error('요청 ID 충돌');return {ok:true,alreadyApplied:true,executionAuthorized:false};}
   if(b.action==='localReceipt'&&(!old||old.fingerprint!==check.fingerprint))throw Error('최신 전달자료를 먼저 생성하세요.');
   const payload={...check,missionId:b.missionId,status:b.action==='prepare'?'PREPARED':'LOCAL_RECEIPT_RECORDED',action:b.action,requestId:b.requestId,actor,at:new Date().toISOString(),hardwareSent:false,executionAuthorized:false};
   if(previous)await tx.workRecord.create({data:{...key('equipmentMissionHistory',`${b.missionId}:${previous.version}`),payload:previous.payload as Prisma.InputJsonValue}});
   await tx.workRecord.upsert({where:{workspace_kind_id:k},create:{...k,payload:json(payload)},update:{payload:json(payload),version:{increment:1}}});
   await tx.audit.create({data:{centerId:centerId(),action:'equipment.mission.'+b.action,detail:json({actor,missionId:b.missionId,fingerprint:check.fingerprint,hardwareSent:false})}});
   return {ok:true,status:payload.status,hardwareSent:false,executionAuthorized:false};
  });return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'장비 임무 처리 실패'},{status:409})}
});
