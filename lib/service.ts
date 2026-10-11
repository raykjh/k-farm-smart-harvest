import {isClosedTask} from './task-lifecycle';
import {centerId,receiptId,workspace} from './workspace';
import {actorLabel} from './auth';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {db} from './db';
import {initialState,annualMissions} from './seed';
import {snapshot,solve,validate,jobs} from './scheduler';
import {propose} from './ai';
import {recommend} from './recommend';
import {readProduction,syncProduction} from './production';
import {weatherBlocked} from './weather';
import {slotLabel,type State,type Crop,type Mode,type Revision} from './types';
export class Conflict extends Error {}
const json=(v:unknown)=>v as Prisma.InputJsonValue;
export async function read(){
 const c=await db.center.findUnique({where:{id:centerId()}});if(!c)throw new Error('pnpm seed를 먼저 실행하세요.');
 const notices=await db.outbox.findMany({where:{centerId:centerId()},orderBy:{createdAt:'desc'}});
 const state=c.state as unknown as State;
 return {state,production:readProduction(state),notices,aiMode:process.env.AI_MODE==='nebius'?'NEBIUS':'DEMO_RULES'};
}
type Tx=Prisma.TransactionClient;
async function mutate(operation:string,key:string,fn:(s:State,tx:Tx)=>Promise<unknown>){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id = ${centerId()} FOR UPDATE`;
  const receipt=await tx.receipt.findUnique({where:{id:receiptId(key)}});
  if(receipt){if(receipt.operation!==operation)throw new Conflict('중복 키의 요청 내용이 다릅니다.');return receipt.result;}
  const row=await tx.center.findUniqueOrThrow({where:{id:centerId()}});const s=row.state as unknown as State;
  const result=await fn(s,tx);
  await tx.center.update({where:{id:centerId()},data:{state:json(s),version:{increment:1}}});
  await tx.receipt.create({data:{id:receiptId(key),operation,result:json(result)}});
  await tx.audit.create({data:{centerId:centerId(),action:operation,detail:json(result)}});
  return result;
 },{timeout:20000});
}
export async function register(key:string,fieldId:string,area:number,access:boolean,water:boolean,confirmed:boolean){
 return mutate(`register:${fieldId}:${area}:${access}:${water}:${confirmed}`,key,async s=>{
  if(s.planned)throw new Conflict('확정된 계획의 농지 변경은 새 계획이 필요합니다.');
  const f=s.fields.find(f=>f.id===fieldId);if(!f)throw new Error('농지 없음');
  Object.assign(f,{area,access,water,confirmed});s.registered=true;s.productionLedger=syncProduction(s);return {fieldId,recommendations:recommend(f)};
 });
}
export async function choose(key:string,choices:{fieldId:string;crop:Crop;mode:Mode}[]){
 return mutate(`choose:${JSON.stringify(choices)}`,key,async s=>{
  if(!s.registered||s.planned)throw new Conflict('농지 등록 후, 계획 확정 전에 선택하세요.');
  if(choices.length!==3||new Set(choices.map(x=>x.fieldId)).size!==3)throw new Error('A·B·C의 선택을 모두 입력하세요.');
  for(const c of choices){const f=s.fields.find(x=>x.id===c.fieldId);if(!f||!['A','B','C'].includes(f.id))throw new Error('선택 범위 오류');const rec=recommend(f).find(x=>x.crop===c.crop);if(!rec||rec.blocked||rec.provisional)throw new Error('추천 필수조건/현장확인 미충족');f.crop=c.crop;f.mode=c.mode;}
  s.productionLedger=syncProduction(s);return {selected:choices.length};
 });
}
export async function plan(key:string){
 const {state:s}=await read();if(!s.registered||s.fields.some(f=>!f.crop))throw new Error('농지와 작물 선택을 완료하세요.');if(s.planned)throw new Conflict('이미 연간계획이 있습니다.');
 const hash=snapshot(s);s.missions=annualMissions(s);const result=await solve(s,true);
 if(!result.feasible)throw new Error(result.reason);
 return mutate('plan',key,async current=>{
  if(snapshot(current)!==hash)throw new Conflict('입력이 변경되어 다시 계획해야 합니다.');
  current.missions=s.missions;for(const d of result.diff)current.missions.find(m=>m.id===d.missionId)!.start=d.after;
  validate(current);current.planned=true;current.planVersion=1;return {planVersion:1,missions:current.missions.length};
 });
}
export async function wind(key:string){return mutate('wind',key,async s=>{
 if(!s.planned)throw new Error('먼저 계획을 생성하세요.');
 if(s.events.some(e=>e.id==='wind-demo-1'))return {eventId:'wind-demo-1',deduplicated:true};
 s.events.push({id:'wind-demo-1',start:0,end:32,windMs:9,source:'DEMO_ASSUMPTION'});
 for(const m of jobs(s))if(weatherBlocked(s,m))m.status='HELD';
 for(const r of s.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
 return {eventId:'wind-demo-1',held:s.missions.filter(m=>m.status==='HELD').length};
});}
export async function replan(key:string,selectedIds?:string[]){
 const ids=selectedIds?[...new Set(selectedIds)].sort():[];
 if(selectedIds&&(!ids.length||ids.length!==selectedIds.length))throw new Error('작업 선택을 확인하세요.');
 const operation=selectedIds?`replan:${JSON.stringify(ids)}`:'replan';
 const previous=await db.receipt.findUnique({where:{id:receiptId(key)}});if(previous){if(previous.operation!==operation)throw new Conflict('중복 키의 요청 내용이 다릅니다.');return previous.result;}
 const {state:s}=await read();if(!s.events.length)throw new Error('강풍 이벤트를 먼저 발생시키세요.');
 for(const id of ids){const m=s.missions.find(m=>m.id===id);if(!m||!m.resourceId||isClosedTask(m.status)||m.status==='UNSTAFFED')throw new Error('선택 작업은 날짜가 정해진 미완료 장비 작업이어야 합니다.');}
 const hash=snapshot(s);const result=selectedIds?await solve(s,true,ids).then(r=>({...r,summary:`선택 ${ids.length}건 · 전체 변경 ${r.diff.length}건. 선택 작업은 기존 날짜 다음 날 이후로 재배치합니다. 일괄 승인 전이며 실행·발송되지 않았습니다.`,source:'DEMO_RULES' as const,trace:[{tool:'selected_reschedule',result:JSON.stringify({selectedIds:ids,feasible:r.feasible,reason:r.reason??null})}]})):await propose(s);
 if(result.feasible&&!result.diff.length)throw new Error('현재 계획에서 변경할 일정이 없습니다.');
 return mutate(operation,key,async current=>{
  if(snapshot(current)!==hash)throw new Conflict('계산 중 입력 변경. 최신 자료로 다시 계산하세요.');
  for(const r of current.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
  const r:Revision={id:randomUUID(),basePlanVersion:current.planVersion,inputSnapshotHash:hash,ruleVersion:current.ruleVersion,expiresAt:new Date(Date.now()+30*60*1000).toISOString(),status:result.feasible?'REVIEW_REQUIRED':'NO_FEASIBLE_PLAN',diff:result.diff,summary:result.summary,source:result.source,trace:result.trace,createdAt:new Date().toISOString()};
  current.revisions.push(r);return {revisionId:r.id,status:r.status};
 });
}
export async function approve(key:string,id:string){return mutate(`approve:${id}`,key,async(s,tx)=>{
 const r=s.revisions.find(x=>x.id===id);if(!r)throw new Error('변경계획 없음');
 if(r.status==='APPLIED')return {planVersion:s.planVersion,alreadyApplied:true};
 if(r.status!=='REVIEW_REQUIRED'||r.basePlanVersion!==s.planVersion||r.inputSnapshotHash!==snapshot(s)||r.ruleVersion!==s.ruleVersion||Date.parse(r.expiresAt)<Date.now())throw new Conflict('오래된 변경계획입니다. 재계산 후 승인하세요.');
 for(const d of r.diff){const m=s.missions.find(m=>m.id===d.missionId);if(!m||m.start!==d.before)throw new Conflict('작업 상태 변경');m.start=d.after;if(m.scheduledDate)m.scheduledDate=new Date(Date.UTC(2026,8,9+Math.floor(d.after/32))).toISOString().slice(0,10);if(m.status==='HELD')m.status='PLANNED';}
 validate(s);s.planVersion++;r.status='APPLIED';r.approvedBy=actorLabel();
 await tx.outbox.updateMany({where:{centerId:centerId(),status:{in:['PENDING','FAILED']}},data:{status:'SUPERSEDED'}});
 const fieldIds=[...new Set(r.diff.map(d=>s.missions.find(m=>m.id===d.missionId)!.fieldId))];
 for(const fid of fieldIds){const f=s.fields.find(f=>f.id===fid)!;const d=r.diff.find(d=>s.missions.find(m=>m.id===d.missionId)!.fieldId===fid)!;
  await tx.outbox.create({data:{id:`${centerId()}:${s.planVersion}:${f.farmerId}`,centerId:centerId(),farmerId:f.farmerId,planVersion:s.planVersion,body:`[모의 알림] ${f.name} 작업 일정이 ${slotLabel(d.after)}로 변경되었습니다. 센터가 장비·인력을 배정합니다. 직접 장비에 접근하지 마세요. 문의는 지원센터로 연락해 주세요.`}});
 }
 return {planVersion:s.planVersion,notifications:fieldIds.length};
});}
export async function lock(key:string,machineId:string){return mutate(`lock:${machineId}`,key,async s=>{
 const m=s.machines.find(x=>x.id===machineId);if(!m)throw new Error('장비 없음');m.safetyLock=true;
 for(const job of s.missions)if(job.resourceId===machineId&&!isClosedTask(job.status))job.status='HELD';
 return {machineId,safetyLock:true};
});}
export async function deliver(failFirst=false){
 // Mock provider + local delivery receipt in one DB transaction. Real provider needs its own idempotent receipt reconciliation.
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Center" WHERE id = ${centerId()} FOR UPDATE`;
  const rows=await tx.outbox.findMany({where:{centerId:centerId(),status:{in:['PENDING','FAILED']},attempts:{lt:3},availableAt:{lte:new Date()}}});
  let delivered=0;
  for(const n of rows){const fail=failFirst&&n.attempts===0;await tx.outbox.update({where:{id:n.id},data:{status:fail?'FAILED':'DELIVERED',attempts:{increment:1},sentAt:fail?null:new Date(),availableAt:new Date(Date.now()+(fail?2000:0))}});if(!fail)delivered++;}
  return {delivered,attempted:rows.length,provider:'MOCK_SMS'};
 });
}
