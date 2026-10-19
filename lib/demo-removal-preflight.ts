import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {demoRemoval} from './demo-data';
import {verifiedDemoRegistrations} from './registered-demo-storage';
import type {State} from './types';

type RecordRow={workspace:string;kind:string;id:string;version:number;payload:unknown};
export type DemoRemovalSnapshot={
 centerVersion:number;
 records:RecordRow[];
 outbox:{id:string;centerId:string;farmerId:string;status:string}[];
 receipts:{id:string;operation:string;result:unknown}[];
 otherCenters:{id:string;version:number;state:unknown}[];
};
export type DemoRemovalBlocker={code:string;count:number;ko:string;en:string};
// These are not operational descendants of a registration. They are retained.
const retainedKinds=new Set(['removedDemo','removedDemoRecords','centerGeography','centerSettings','productionCriteria','delegatedSettings']);
const cachedSharedKinds=['weatherHourly','weatherObservation','climateNormals'];
const labels:Record<string,[string,string]>={
 MIXED_DATA:['직접 입력한 자료가 함께 있습니다.','Manually entered data is present.'],
 REGISTRATION_CHANGED:['기존 데모의 등록 원본 또는 변경 여부를 확인해야 합니다.','The original demo registration or its edits require review.'],
 WORKFLOW:['재배·계획·인력·실적 등 연결 기록','Linked cultivation, planning, staffing or execution records'],
 SHARED:['센터 간 예약·공유 기록','Cross-center reservation or sharing records'],
 OTHER_CENTER:['다른 센터에 연결된 기록','Linked records in another center'],
 REPORT:['보관 중인 보고 기록','Retained report records'],
 NOTICE:['연결된 안내 기록','Linked notification records'],
 RECEIPT:['처리 결과 및 중복 방지 기록','Operation result and idempotency records'],
};

/** Fail closed for legacy data without per-record deletion provenance.
 * This is a guard, not a cascading-delete implementation or permission to reset.
 * A later chronological replay must record its owned graph explicitly.
 */
export function inspectDemoRemoval(state:State,snapshot:DemoRemovalSnapshot){
 const basic=demoRemoval(state),counts=new Map<string,number>();
 const add=(code:string,n=1)=>{if(n)counts.set(code,(counts.get(code)??0)+n);};
 const ids=new Set([...state.fields.flatMap(f=>[f.id,f.farmerId]),...state.missions.map(m=>m.id),...state.machines.map(m=>m.id)].filter(Boolean));
 const hasReference=(value:unknown):boolean=>{
  if(typeof value==='string')return ids.has(value)||value.startsWith('demo:')||value.split(':').some(part=>ids.has(part));
  if(Array.isArray(value))return value.some(hasReference);
  if(value&&typeof value==='object')return Object.entries(value).some(([key,v])=>ids.has(key)||(/centerid$/i.test(key)&&v==='demo')||hasReference(v));
  return false;
 };
 const local=snapshot.records.filter(r=>r.workspace==='sandbox');
 let consultationIds=new Set<string>();
 if(!basic.safe)add('MIXED_DATA');
 if(state.fields.length||state.missions.length||state.machines.length){
  try{
   const manifest=verifiedDemoRegistrations(local);
   consultationIds=new Set(manifest.consultations.map(c=>c.id));
   if(manifest.fields.length!==state.fields.length||state.fields.some(f=>!manifest.fields.some(p=>p.pnu===f.id)||!consultationIds.has(f.farmerId)))throw Error('Aggregate does not match manifest');
  }catch{add('REGISTRATION_CHANGED');}
 }
 for(const row of snapshot.records){
  if(row.workspace==='auth')continue;
  if(row.workspace==='sandbox'){
   if(retainedKinds.has(row.kind)||row.kind==='demoManifest'||row.kind==='fields')continue;
   if(row.kind==='consultation'&&(consultationIds.has(row.id)||!hasReference(row.payload)))continue;
   // A standalone roster can remain. Assigned jobs are operational descendants.
   if(row.kind==='labor'&&!hasReference(row.payload))continue;
   add('WORKFLOW');
  }else if(row.workspace==='reports')add('REPORT');
  else if(row.workspace==='shared'){
   if(!cachedSharedKinds.includes(row.kind)&&hasReference([row.id,row.payload]))add('SHARED');
  }else if(hasReference([row.id,row.payload]))add('OTHER_CENTER');
 }
 for(const c of snapshot.otherCenters)if(hasReference(c.state))add('OTHER_CENTER');
 add('NOTICE',snapshot.outbox.filter(row=>row.centerId==='demo').length);
 // Legacy demo receipts have no center prefix; retaining them would replay old results.
 add('RECEIPT',snapshot.receipts.filter(r=>!r.id.includes(':')||r.id.startsWith('demo:')||hasReference(r.result)).length);
 const blockers:DemoRemovalBlocker[]=[...counts].map(([code,count])=>({code,count,ko:labels[code][0],en:labels[code][1]}));
 const token=createHash('sha256').update(JSON.stringify({contract:'demo-removal-preflight-v1',state,...snapshot})).digest('hex');
 return {...basic,safe:basic.safe&&!blockers.length,token,blockers};
}

export async function readDemoRemoval(tx:Prisma.TransactionClient,state:State,centerVersion:number){
 const [records,outbox,receipts,otherCenters]=await Promise.all([
  tx.workRecord.findMany({where:{workspace:{not:'auth'},NOT:{workspace:'shared',kind:{in:cachedSharedKinds}}},orderBy:[{workspace:'asc'},{kind:'asc'},{id:'asc'}]}),
  tx.outbox.findMany({where:{centerId:'demo'},select:{id:true,centerId:true,farmerId:true,status:true},orderBy:{id:'asc'}}),
  tx.receipt.findMany({orderBy:{id:'asc'}}),
  tx.center.findMany({where:{id:{not:'demo'}},select:{id:true,version:true,state:true},orderBy:{id:'asc'}}),
 ]);
 return inspectDemoRemoval(state,{centerVersion,records,outbox,receipts,otherCenters});
}
