import {demoInputBatchSchema,originSchema} from './registration-origin';
import {retirementHash,type RetirementSnapshot} from './demo-retirement';
import {recordSpace} from './workspace';
import type {State} from './types';

type Row={workspace:string;kind:string;id:string;payload:any};
type Patch={raw:string;arrays:{path:string[];key:string;ids:string[]}[];invalidatePlan?:boolean};
export function referencesPrepared(value:unknown,ids:Set<string>):boolean{
 if(typeof value==='string')return ids.has(value)||value.split(':').some(v=>ids.has(v));
 if(Array.isArray(value))return value.some(v=>referencesPrepared(v,ids));
 return !!value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>ids.has(k)||referencesPrepared(v,ids));
}
const kinds=new Set(['consultation','registrationOrigin','registrationReceipt','cultivation','cultivationPlan','fieldParticipation','productionApproval','annualReservation','laborDemand','taskPlanSnapshot','taskPlanChange','taskCancellation','taskExecutionAssessment','planningDecision','automaticReplan','replanning','laborOperationsReceipt','operatingLedger']);
const independent=new Set(['centerSettings','centerGeography','productionCriteria','delegatedSettings','removedDemo','removedDemoRecords','seasonBackup','annualPlanMigration','cultivationMigration','operationMigration']);
const domainKeys=new Set(['pnu','pnus','fieldId','fieldIds','farmerId','farmerIds','consultationId','consultationIds','missionId','missionIds','cultivationId','cultivationIds','taskId','taskIds']);
function foreignDomain(value:unknown,owned:Set<string>,key=''):boolean{
 if(typeof value==='string')return domainKeys.has(key)&&!!value&&!referencesPrepared(value,owned);
 if(Array.isArray(value))return value.some(v=>foreignDomain(v,owned,key));
 return !!value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>foreignDomain(v,owned,k));
}
/** Sealed input origins define ownership. Unknown, real or cross-center
 * descendants block retirement; they are never silently guessed or cascaded. */
export function planPreparedBatch(snapshot:RetirementSnapshot,centerId:string,batchId:string){
 const workspace=recordSpace(centerId),rows=snapshot.records.map(raw=>({raw,row:JSON.parse(raw) as Row})),centers=snapshot.centers.map(raw=>({raw,row:JSON.parse(raw)}));
 const batchRow=rows.find(r=>r.row.workspace===workspace&&r.row.kind==='demoInputBatch'&&r.row.id===batchId);
 const batch=demoInputBatchSchema.parse(batchRow?.row.payload);
 if(batch.id!==batchId||batch.centerId!==centerId)throw Error('입력 묶음 소속이 다릅니다.');
 const center=centers.find(c=>c.row.id===centerId);if(!center)throw Error('센터를 찾을 수 없습니다.');
 const origins=rows.filter(r=>r.row.workspace===workspace&&r.row.kind==='registrationOrigin'&&r.row.payload?.batchId===batchId).map(r=>originSchema.parse(r.row.payload));
 if(!origins.length)throw Error('등록된 입력 묶음이 없습니다.');
 for(const o of origins)if(!batch.registrations.some(r=>r.requestId===o.requestId&&r.inputHash===o.inputHash))throw Error('입력 출처와 승인 해시가 다릅니다.');
 const fieldIds=[...new Set(origins.flatMap(o=>o.pnus))],farmerIds=origins.map(o=>o.consultationId),owned=new Set([batchId,...fieldIds,...farmerIds,...origins.map(o=>o.requestId)]),state=center.row.state as State;
 const local=rows.filter(r=>r.row.workspace===workspace),inventory=local.find(r=>r.row.kind==='fields'&&r.row.id==='current');
 if(!Array.isArray(inventory?.row.payload)||fieldIds.some(id=>!inventory.row.payload.some((f:any)=>f.pnu===id&&farmerIds.includes(f.consultationId))))throw Error('농지의 현재 소속을 확인하세요.');
 const counts=new Map<string,{code:string;kind:string;count:number}>(),block=(code:string,kind:string)=>{const key=code+':'+kind,p=counts.get(key);counts.set(key,{code,kind,count:(p?.count??0)+1});};
 for(const r of local)if(r.row.kind==='cultivation'&&fieldIds.includes(r.row.payload?.pnu))owned.add(r.row.id);
 const missions=state.missions.filter(m=>fieldIds.includes(m.fieldId));for(const m of missions)owned.add(m.id);
 for(const r of local)if(r.row.kind==='cultivationPlan'&&owned.has(r.row.id))for(const p of r.row.payload?.plots??[])for(const t of p.tasks??[])owned.add(t.id);
 const labor=local.find(r=>r.row.kind==='laborOperations'&&r.row.id==='current'),jobs=(labor?.row.payload?.jobs??[]).filter((j:any)=>referencesPrepared([j.missionId,j.fieldId,j.cultivationId],owned));for(const j of jobs)owned.add(j.id);
 for(const j of jobs)if(j.status==='COMPLETED'||j.worked?.length||j.reserveWorked?.length||j.completedAt)block('ACTUAL_LABOR','laborOperations');
 for(const f of state.fields.filter(f=>fieldIds.includes(f.id)))if(f.source!=='DEMO_ASSUMPTION'||f.demoBatchId!==batchId||!farmerIds.includes(f.farmerId))block('ORIGIN_CHANGED','Center.fields');
 for(const m of state.missions.filter(m=>!fieldIds.includes(m.fieldId)))if(referencesPrepared(m,owned))block('MIXED_DEPENDENCY','Center.missions');
 if(referencesPrepared({...state,fields:[],missions:[],revisions:[],productionLedger:undefined},owned))block('SHARED_CONFIGURATION','Center');
 const revisionIds:string[]=[];for(const r of state.revisions)if(referencesPrepared(r,owned)){if(r.diff.some(d=>!owned.has(d.missionId)))block('MIXED_DEPENDENCY','Center.revisions');else revisionIds.push(r.id);}
 const selected:string[]=[],patches:Patch[]=[];
 for(const entry of rows){const {row:r,raw}=entry,p=r.payload,linked=referencesPrepared([r.id,p],owned);if(!linked)continue;
  if(r.workspace===workspace&&r.kind==='fields'&&r.id==='current'){patches.push({raw,arrays:[{path:[],key:'pnu',ids:fieldIds}]});continue;}
  if(r.workspace===workspace&&independent.has(r.kind))continue;
  if(r.workspace===workspace&&r.kind==='demoInputBatch'){if(r.id===batchId)selected.push(raw);else block('MIXED_BATCH',r.kind);continue;}
  if(r.workspace===workspace&&r.kind==='continuousProduction'&&r.id==='current'){
   if(!Array.isArray(p.items)||p.items.some((i:any)=>!fieldIds.includes(i.pnu)&&referencesPrepared(i,owned))){block('MIXED_DEPENDENCY',r.kind);continue;}
   patches.push({raw,arrays:[{path:['items'],key:'pnu',ids:fieldIds}],invalidatePlan:true});continue;
  }
  if(r.workspace===workspace&&r.kind==='laborOperations'&&r.id==='current'){
   const jobIds=jobs.map((j:any)=>j.id);if(referencesPrepared({...p,jobs:[],notices:[],penalties:[],workExceptions:[]},owned)){block('MIXED_DEPENDENCY',r.kind);continue;}
   patches.push({raw,arrays:[{path:['jobs'],key:'id',ids:jobIds},...['notices','penalties','workExceptions'].filter(k=>Array.isArray(p[k])).map(k=>({path:[k],key:'jobId',ids:jobIds}))]});continue;
  }
  if(r.workspace==='shared'&&r.kind==='resourceReservation'&&p.centerId===centerId&&owned.has(p.taskId)){selected.push(raw);continue;}
  if(r.workspace!==workspace){block('FOREIGN_DEPENDENCY',r.kind);continue;}
  if(r.kind==='operatingLedger'&&p.source!=='SIMULATED'){block('ACTUAL_EVIDENCE',r.kind);continue;}
  if(r.kind==='taskExecutionAssessment'&&(p.source!=='DEMO_SIMULATION'||p.actualStartedAt!=null||p.actualFinishedAt!=null||p.actualQuantity!=null)){block('ACTUAL_EVIDENCE',r.kind);continue;}
  if(!kinds.has(r.kind)){block('UNKNOWN_DEPENDENCY',r.kind);continue;}
  if(foreignDomain(p,owned)){block('MIXED_DEPENDENCY',r.kind);continue;}
  selected.push(raw);
 }
 for(const c of centers)if(c.row.id!==centerId&&referencesPrepared(c.row.state,owned))block('FOREIGN_CENTER','Center');
 const outbox=snapshot.outbox.filter(raw=>{const r=JSON.parse(raw);if(!referencesPrepared([r.farmerId,r.body],owned))return false;if(r.centerId!==centerId||!['DELIVERED','SUPERSEDED','CANCELLED'].includes(r.status)){block('NOTICE_NOT_CLOSED','Outbox');return false;}return true;});
 const receipts=snapshot.receipts.filter(raw=>{const r=JSON.parse(raw);if(!referencesPrepared([r.id,r.result],owned))return false;if(foreignDomain(r.result,owned)){block('MIXED_RECEIPT','Receipt');return false;}return true;});
 return {contract:'prepared-batch-retirement-v1' as const,centerId,batchId,workspace,token:retirementHash(snapshot),safe:counts.size===0,blockers:[...counts.values()],beforeCenter:center.raw,records:selected,patches,outbox,receipts,fieldIds,missionIds:missions.map(m=>m.id),revisionIds,counts:{fields:fieldIds.length,tasks:missions.length,records:selected.length,patchedRecords:patches.length,laborJobs:jobs.length,reservations:selected.filter(raw=>JSON.parse(raw).kind==='resourceReservation').length,outbox:outbox.length,receipts:receipts.length}};
}
