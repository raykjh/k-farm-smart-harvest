import {db} from './db';
import {centerId,recordSpace} from './workspace';
import {actorLabel} from './auth';
import {reportHash} from './execution-records';
import {ledgerInput,effectiveEntries,forecastRows,type OperatingEntry} from './operating-ledger';
import type {Cultivation} from './cultivation';
import type {AnnualPlan} from './annual-plan';
import type {State} from './types';
import type {Prisma} from '@prisma/client';
import {cropDisplayNames} from './crop-registry';
import {laborEarnings} from './labor-policy';
import type {LaborOps} from './labor-operations';
import {reportMissions,type ReportEvidence} from './work-report';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function readOperatingLedger(tx:Prisma.TransactionClient,year:number){
 const center=await tx.center.findUniqueOrThrow({where:{id:centerId()}}),state=center.state as unknown as State;
 const records=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:{in:['operatingLedger','cultivation','cultivationPlan','laborOperations','taskExecutionAssessment']}},orderBy:[{updatedAt:'desc'},{id:'asc'}]});
 const missions=reportMissions(state,records.filter(r=>r.kind==='taskExecutionAssessment').map(r=>r.payload as unknown as ReportEvidence));
 const cycles=records.filter(r=>r.kind==='cultivation').map(r=>r.payload as unknown as Cultivation),plans=records.filter(r=>r.kind==='cultivationPlan').map(r=>r.payload as unknown as AnnualPlan);
 const entries=records.filter(r=>r.kind==='operatingLedger').map(r=>r.payload as unknown as OperatingEntry),names=cropDisplayNames(true);
 const ops=records.find(r=>r.kind==='laborOperations')?.payload as unknown as LaborOps|undefined;
 const laborCosts=(ops?.jobs??[]).filter(j=>j.status==='COMPLETED'&&j.date.startsWith(String(year))).map(j=>{
  const m=missions.find(m=>m.id===j.missionId),f=state.fields.find(f=>f.id===(j.fieldId??m?.fieldId));
  const ordinary=j.worked.filter(id=>(j.employmentSnapshot?.[id]??ops?.people.find(p=>p.id===id)?.employment)!=='CENTER_RESERVE');
  const estimates=ordinary.map(workerId=>laborEarnings(j.payBasis,j.durationMinutes,ops?.workExceptions?.filter(e=>e.workerId===workerId&&e.jobId===j.id).at(-1)?.halfDays));
  return {jobId:j.id,missionId:j.missionId,fieldId:j.fieldId??m?.fieldId??null,task:j.task,address:j.address,date:j.date,workers:ordinary.length,employeeSlots:(j.reserveWorked?.length??0)+j.worked.length-ordinary.length,source:f?.source==='DEMO_ASSUMPTION'?'SIMULATED':'ACTUAL',calculatedWon:estimates.length&&estimates.every(v=>v!==null)?estimates.reduce<number>((n,v)=>n+v!,0):null};
 });
 return {entries,laborCosts,forecast:forecastRows(state,cycles,plans,year),cycles:cycles.map(c=>{const plot=plans.flatMap(p=>p.plots).find(p=>p.cultivationId===c.id),f=state.fields.find(f=>f.id===c.pnu);return {...c,cropName:names[c.crop],address:plot?.address??f?.address??c.pnu,areaM2:plot?.area??f?.area??null};}),tasks:missions.filter(m=>!m.resourceOccupancyOnly).map(m=>({id:m.id,fieldId:m.fieldId,cultivationId:(m as any).cultivationId??null,task:m.label,date:m.scheduledDate,status:m.status})),year};
}
export async function saveOperatingEntry(raw:unknown){
 const b=ledgerInput.parse(raw),hash=reportHash(b),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 if(b.date>today)throw Error('미래의 출하·지출·지급을 실적으로 기록할 수 없습니다.');
 return db.$transaction(async tx=>{
  const centers=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id=${centerId()} FOR UPDATE`;
  const key={workspace:recordSpace(),kind:'operatingLedger',id:b.id},same=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if(same){if((same.payload as any).requestHash!==hash)throw Error('요청 ID가 다른 기록에 사용되었습니다.');return same.payload;}
  const state=centers[0]?.state;if(!state)throw Error('센터 확인 필요');
  const rawCycle=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'cultivation',id:b.cultivationId}}}),cycle=rawCycle?.payload as unknown as Cultivation|undefined;
  if(!cycle)throw Error('이 센터의 재배 기록을 선택하세요.');
  let prior:OperatingEntry|undefined;
  if(b.supersedesId){
   const row=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'operatingLedger',id:b.supersedesId}}});prior=row?.payload as unknown as OperatingEntry|undefined;
   const all=(await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'operatingLedger'}})).map(r=>r.payload as unknown as OperatingEntry);
   if(!prior||!effectiveEntries(all).some(e=>e.id===prior!.id))throw Error('이미 정정되었거나 취소된 기록입니다. 다시 불러오세요.');
   if(prior.cultivationId!==b.cultivationId||prior.kind!==b.kind||prior.missionId!==b.missionId)throw Error('정정 시 농지·재배·기록 종류·작업을 바꿀 수 없습니다.');
  }
  const plan=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'cultivationPlan',id:cycle.id}}});
  const evidence=b.missionId?await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'taskExecutionAssessment',payload:{path:['missionId'],equals:b.missionId}},orderBy:[{updatedAt:'desc'},{id:'asc'}]}):[];
  const plot=(plan?.payload as unknown as AnnualPlan|undefined)?.plots?.find(p=>p.pnu===cycle.pnu),f=state.fields.find(f=>f.id===cycle.pnu),m=reportMissions(state,evidence.map(e=>e.payload as unknown as ReportEvidence)).find(m=>m.id===b.missionId);
  if(b.kind==='WORK_COST'&&!prior&&(!m||m.fieldId!==cycle.pnu||(m as any).cultivationId!==cycle.id||m.resourceOccupancyOnly))throw Error('해당 농지·재배 건의 작업을 선택하세요.');
  const areaM2=prior?.areaM2??plot?.area??f?.area;
  if(!areaM2)throw Error('농지 면적 기록을 확인하세요.');
  if(!f&&!prior)throw Error('이관된 농지의 자료 출처를 먼저 확인하세요. 기존 원본 기록은 유지됩니다.');
  const entry:OperatingEntry={...b,fieldId:cycle.pnu,address:prior?.address??plot?.address??f?.address??cycle.pnu,areaM2,crop:prior?.crop??cropDisplayNames(true)[cycle.crop],source:prior?.source??(f?.source==='DEMO_ASSUMPTION'?'SIMULATED':'ACTUAL'),task:prior?.task??m?.label??null,actor:actorLabel(),at:new Date().toISOString(),requestHash:hash};
  await tx.workRecord.create({data:{...key,payload:json(entry)}});
  await tx.audit.create({data:{centerId:centerId(),action:'operating-ledger.record',detail:{id:b.id,kind:b.kind,fieldId:entry.fieldId,supersedesId:b.supersedesId,actor:entry.actor}}});
  return entry;
 });
}
