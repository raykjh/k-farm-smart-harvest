import {randomUUID,createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import type {Prisma} from '@prisma/client';
import {db} from './db';
import {asPrincipal,type Principal} from './auth';
import {isCenterOperator} from './auth-policy';
import {geographicNeighbors} from './center-adjacency';
import {sameEquipmentKind} from './equipment-code';
import {recordSpace} from './workspace';
import {planningState,readExecutionHistory} from './replan-history';
import {immovable} from './replan-scope';
import {resumeReservationState} from './resume-reservation';
import {resourceView} from './center-resources';
import {handleReplanning} from './replanning-service';
import type {State} from './types';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
type ReviewEvent={machineId:string;ownerCenterId:string;requestedBy:string;reason:string;centers:string[];status:'PENDING'|'PROCESSING'|'COMPLETE'|'NEEDS_ATTENTION';results:ReviewResult[];leaseUntil?:number;token?:string};
type ReviewResult={centerId:string;status:string;requestId?:string;changes?:number;source?:string;error?:string};
const eventKey=(id:string)=>({workspace:'shared',kind:'equipmentScheduleReview',id});

/** Called under the center-pool lock. Region is derived, never client supplied. */
export async function queueEquipmentReview(tx:Prisma.TransactionClient,machineId:string,actor:Principal,reason:string,id=randomUUID()){
 if(!isCenterOperator(actor))throw Error('장비 소속 센터 권한이 필요합니다.');
 const owner=await tx.center.findUniqueOrThrow({where:{id:actor.centerId}}),machine=(owner.state as unknown as State).machines.find(m=>m.id===machineId&&(!m.ownerCenterId||m.ownerCenterId===actor.centerId));
 if(!machine)throw Error('소유 장비만 지역 일정 재검토를 요청할 수 있습니다.');
 const neighbors=await geographicNeighbors(tx,actor.centerId);
 const event:ReviewEvent={machineId,ownerCenterId:actor.centerId,requestedBy:actor.id,reason,centers:[actor.centerId,...neighbors.filter(id=>id!==actor.centerId)],status:'PENDING',results:[]};
 await tx.workRecord.create({data:{...eventKey(id),payload:json(event)}});
 return id;
}

/** A fixed, auditable background identity executes the owner-authorized event.
 * It has no login/session. Each run is limited to verified neighboring centers,
 * compatible future work, existing sharing consent and the normal approval path.
 */
export async function processEquipmentReview(id:string){
 const token=randomUUID();
 const event=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`equipment-review:${id}`}))`;
  const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:eventKey(id)}}),p=row.payload as unknown as ReviewEvent;
  if(p.status==='COMPLETE'||p.status==='PROCESSING'&&(p.leaseUntil??0)>Date.now())return {...p,claimed:false};
  const next={...p,status:'PROCESSING' as const,token,leaseUntil:Date.now()+30*60*1000};
  await tx.workRecord.update({where:{workspace_kind_id:eventKey(id)},data:{version:{increment:1},payload:json(next)}});
  return {...next,claimed:true};
 });
 if(!event.claimed)return {id,status:event.status,results:event.results};
 const results=[...event.results.filter(r=>['APPLIED','UNCHANGED','NO_WORK'].includes(r.status))];
 try{
  const owner=await db.center.findUniqueOrThrow({where:{id:event.ownerCenterId}}),machine=(owner.state as unknown as State).machines.find(m=>m.id===event.machineId);
  if(!machine||machine.ownerCenterId&&machine.ownerCenterId!==owner.id)throw Error('장비 소유 정보가 변경되었습니다.');
  const allowed=new Set([owner.id,...await geographicNeighbors(db,owner.id)]);
  for(const center of event.centers.filter(c=>allowed.has(c)&&!results.some(r=>r.centerId===c))){
   const worker:Principal={id:'equipment-schedule-service',username:'equipment-schedule-service',name:`장비 일정 자동관리 (${event.requestedBy})`,role:'CENTER_ADMIN',centerId:center,enabled:true};
   const result=await asPrincipal(worker,async():Promise<ReviewResult>=>{
    const row=await db.center.findUnique({where:{id:center}});
    if(!row)return {centerId:center,status:'NO_WORK'};
    const raw=row.state as unknown as State;
    const held=raw.missions.filter(m=>m.status==='HELD'&&!m.scheduledDate).map(m=>m.id);
    // Only resumable cancellations are restored; unrelated held work is skipped.
    let state=structuredClone(raw);
    for(const task of held)try{state=await resumeReservationState(db,state,[task]);}catch{}
    state=planningState(await resourceView(db,state,center),await readExecutionHistory(db,recordSpace(center)));
    const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    const ids=state.missions.filter(m=>{
     const current=state.machines.find(r=>r.id===m.resourceId);
     return !immovable(m)&&!!m.scheduledDate&&m.scheduledDate>=today&&!!current&&(current.id===machine.id||sameEquipmentKind(current,machine));
    }).map(m=>m.id);
    if(!ids.length)return {centerId:center,status:'NO_WORK'};
    if(ids.length>600)return {centerId:center,status:'NEEDS_ATTENTION',error:'600개를 초과한 관련 작업은 기간을 나누어 재검토해야 합니다.'};
    if(process.env.AI_MODE!=='nebius')return {centerId:center,status:'PENDING_AI',error:'AI 연결 후 일정 재검토를 적용할 수 있습니다.'};
    const digest=createHash('sha256').update(id+':'+center).digest('hex'),requestId=[digest.slice(0,8),digest.slice(8,12),'4'+digest.slice(13,16),'a'+digest.slice(17,20),digest.slice(20,32)].join('-');
    const prior=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(center),kind:'automaticReplan',id:requestId}}});
    const body=prior?{action:'recoverAutomatic',requestId}:{action:'automatic',requestId,ids,resourceReview:true,reason:event.reason};
    const response=await handleReplanning(new NextRequest('http://localhost/api/replanning',{method:'POST',body:JSON.stringify(body)})),value=await response.json();
    if(!response.ok)return {centerId:center,status:'NEEDS_ATTENTION',requestId,error:value.error};
    return {centerId:center,requestId,status:value.status==='APPLIED'?(value.changes?'APPLIED':'UNCHANGED'):value.status,changes:value.changes,source:value.source,...(value.error?{error:value.error}:{})};
   });
   results.push(result);
  }
 }catch(e){results.push({centerId:event.ownerCenterId,status:'NEEDS_ATTENTION',error:e instanceof Error?e.message:String(e)});}
 const status=results.every(r=>['APPLIED','UNCHANGED','NO_WORK'].includes(r.status))?'COMPLETE':'NEEDS_ATTENTION';
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`equipment-review:${id}`}))`;
  const row=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:eventKey(id)}}),p=row.payload as unknown as ReviewEvent;
  if(p.token!==token)return;
  await tx.workRecord.update({where:{workspace_kind_id:eventKey(id)},data:{version:{increment:1},payload:json({...p,status,results,leaseUntil:0})}});
  await tx.audit.create({data:{centerId:event.ownerCenterId,action:'equipment.scheduleReview',detail:json({id,machineId:event.machineId,requestedBy:event.requestedBy,status,results})}});
 });
 return {id,status,results};
}
