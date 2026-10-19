import {createHash} from 'node:crypto';
import {verifiedDemoRegistrations} from './registered-demo-storage';
import {DEMO_BATCH} from './registered-demo';
import type {State} from './types';

/** Raw PostgreSQL rows retain JSON numeric precision and timestamp precision in
 * the archive. Parsed copies below are used for inspection only, never restore. */
export type RetirementSnapshot={centers:string[];records:string[];outbox:string[];receipts:string[]};
export type RetirementRecord={workspace:string;kind:string;id:string;version:number;payload:any};
export type RetirementBlocker={code:string;kind:string;count:number};
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export const retirementHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const recordIdentity=(r:Pick<RetirementRecord,'workspace'|'kind'|'id'>)=>JSON.stringify([r.workspace,r.kind,r.id]);
const historyKinds=new Set(['removedDemo','removedDemoRecords','seasonBackup','annualPlanMigration','cultivationMigration','operationMigration']);
const independentKinds=new Set(['centerGeography','centerSettings','productionCriteria','delegatedSettings']);
const ownedKinds=new Set(['annualPlan','cultivation','cultivationPlan','fieldParticipation','registrationReceipt','registrationOrigin','demoInputBatch','continuousProduction','productionApproval','annualReservation','laborDemand','taskPlanSnapshot','taskExecutionAssessment','taskPlanChange','taskCancellation','automaticReplan','replanning','planningDecision','historicalReplay']);

function references(value:unknown,ids:Set<string>):boolean{
 if(typeof value==='string')return ids.has(value)||value.split(':').some(part=>ids.has(part));
 if(Array.isArray(value))return value.some(v=>references(v,ids));
 if(value&&typeof value==='object')return Object.entries(value).some(([k,v])=>ids.has(k)||references(v,ids));
 return false;
}
function domainReferences(value:unknown,owned:Set<string>):{owned:number;foreign:number}{
 const result={owned:0,foreign:0};
 const visit=(v:unknown,key='',container='')=>{
  if(Array.isArray(v)){for(const item of v)visit(item,key,container);return;}
  if(v&&typeof v==='object'){for(const [k,item] of Object.entries(v))visit(item,k,key);return;}
  // Do not treat operator/user IDs, weather IDs or a resource ID as a farmer/task.
  const domain=['pnu','pnus','fieldId','fieldIds','farmerId','farmerIds','consultationId','consultationIds','missionId','missionIds','taskId','taskIds','cultivationId','cultivationIds','previousId','predecessorMissionIds','predecessorKeys','ids'].includes(key)||key==='id'&&['missions','assignments','diff','changes','before','after','missionSnapshot'].includes(container);
  if(typeof v==='string'&&v&&domain)result[references(v,owned)?'owned':'foreign']++;
 };
 visit(value);return result;
}

/** Deliberately scoped to the verified legacy 30-registration batch. It is NOT
 * a whole-center reset or a generic recursive/cross-center delete. Equipment,
 * operators, roster, geography, criteria, historical archives and unknown
 * unrelated records remain. Unrecognized or mixed descendants block execution. */
export function planDemoRetirement(snapshot:RetirementSnapshot){
 const centers=snapshot.centers.map(raw=>({raw,row:JSON.parse(raw)})),records=snapshot.records.map(raw=>({raw,row:JSON.parse(raw) as RetirementRecord}));
 const center=centers.find(c=>c.row.id==='demo');if(!center)throw Error('데모 센터를 확인하세요.');
 const state=center.row.state as State,local=records.filter(r=>r.row.workspace==='sandbox');
 const manifest=verifiedDemoRegistrations(local.map(r=>r.row));
 const fieldIds=new Set(manifest.fields.map(f=>f.pnu)),farmerIds=new Set(manifest.consultations.map(c=>c.id));
 if(state.fields.length!==fieldIds.size||new Set(state.fields.map(f=>f.id)).size!==fieldIds.size||state.fields.some(f=>f.source!=='DEMO_ASSUMPTION'||manifest.fields.find(p=>p.pnu===f.id)?.consultationId!==f.farmerId)||state.missions.some(m=>!fieldIds.has(m.fieldId)))throw Error('데모 원본과 운영 농지의 범위가 다릅니다.');
 const owned=new Set([...fieldIds,...farmerIds,...state.missions.map(m=>m.id)]),counts=new Map<string,RetirementBlocker>();
 const block=(code:string,kind:string)=>{const key=code+':'+kind,old=counts.get(key);counts.set(key,{code,kind,count:(old?.count??0)+1});};
 // Cultivation IDs are linked by a verified parcel, not by a UUID prefix.
 for(const {row:r} of local)if(r.kind==='cultivation'&&fieldIds.has(r.payload?.pnu))owned.add(r.id);
 const selected:typeof records=[];
 for(const entry of records){const r=entry.row,p=r.payload,linked=references([r.id,p],owned);
  if(r.workspace==='sandbox'&&r.kind==='fields'&&r.id==='current')continue;
  if(r.workspace==='sandbox'&&r.kind==='demoManifest'&&r.id===DEMO_BATCH){selected.push(entry);continue;}
  if(r.workspace==='sandbox'&&r.kind==='consultation'){
   if(farmerIds.has(r.id))selected.push(entry);else if(linked)block('MIXED_REGISTRATION',r.kind);
   continue;
  }
  // Existing immutable backups are evidence, not live descendants to erase.
  if(r.workspace==='sandbox'&&(historyKinds.has(r.kind)||independentKinds.has(r.kind)))continue;
  if(!linked)continue;
  if(r.workspace==='shared'&&r.kind==='resourceReservation'){
   if(p.centerId==='demo'&&owned.has(p.taskId)&&state.missions.some(m=>m.id===p.taskId&&m.resourceId===p.resourceId))selected.push(entry);
   else block('FOREIGN_RESERVATION',r.kind);
   continue;
  }
  if(r.workspace!=='sandbox'&&r.workspace!=='reports'){block('FOREIGN_DEPENDENCY',r.kind);continue;}
  const refs=domainReferences(p,owned);
  if(refs.foreign){block('MIXED_DEPENDENCY',r.kind);continue;}
  if(r.workspace==='reports'&&r.kind==='confirmedReport'){
   if(p.content?.filter?.source!=='SIMULATED'||!p.content?.rows?.length||p.content.rows.some((v:any)=>v.source!=='SIMULATED'||!owned.has(v.missionId)))block('NON_SYNTHETIC_REPORT',r.kind);
   else selected.push(entry);
   continue;
  }
  if(!ownedKinds.has(r.kind)){block('UNKNOWN_DEPENDENCY',r.kind);continue;}
  if(r.kind==='taskExecutionAssessment'&&(p.source!=='DEMO_SIMULATION'||p.actualStartedAt!=null||p.actualFinishedAt!=null||p.actualQuantity!=null)){block('ACTUAL_EVIDENCE',r.kind);continue;}
  selected.push(entry);
 }
 for(const c of centers)if(c.row.id!=='demo'&&references(c.row.state,owned))block('FOREIGN_CENTER','Center');
 const outbox=snapshot.outbox.filter(raw=>{
  const r=JSON.parse(raw);if(!farmerIds.has(r.farmerId))return false;
  if(r.centerId!=='demo'){block('FOREIGN_NOTICE','Outbox');return false;}
  if(!['DELIVERED','SUPERSEDED','CANCELLED'].includes(r.status)){block('NOTICE_NOT_CLOSED','Outbox');return false;}
  return true;
 });
 const receipts=snapshot.receipts.filter(raw=>{
  const r=JSON.parse(raw);if(!references([r.id,r.operation,r.result],owned))return false;
  const refs=domainReferences(r.result,owned);
  if(r.id.includes(':')&&!r.id.startsWith('demo:')||refs.foreign){block('MIXED_RECEIPT','Receipt');return false;}
  return true;
 });
 return {contract:'demo-retirement-v1' as const,batchId:DEMO_BATCH,token:retirementHash(snapshot),safe:counts.size===0,blockers:[...counts.values()],fieldIds:[...fieldIds],farmerIds:[...farmerIds],missionIds:state.missions.map(m=>m.id),
  records:selected.map(e=>e.raw),outbox,receipts,beforeCenter:center.raw,beforeInventory:local.find(r=>r.row.kind==='fields'&&r.row.id==='current')!.raw,
  counts:{fields:fieldIds.size,tasks:state.missions.length,records:selected.length,outbox:outbox.length,receipts:receipts.length},equipmentRetained:state.machines.length};
}
