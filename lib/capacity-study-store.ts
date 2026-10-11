import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {currentPrincipal} from './auth';
import {db} from './db';
import {capacityStudySchema,baselineResourcesSchema,contentHash,studyCenterIds,studyIncidentSchema,distributeScenarioCrops,type CapacityStudyInput,type BaselineResources} from './capacity-study-input';
import {summarizeCapacity} from './capacity-workload';
import {compareCapacityPlans,studyLoanWindows} from './capacity-study-scheduling';
import {geographicNeighbors} from './center-adjacency';

export type SavedCapacityStudy={id:string;version:number;input:CapacityStudyInput;baseline:BaselineResources;baselineHash:string;updatedAt:string};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export class CapacityStudyConflict extends Error {}
function scope(){const p=currentPrincipal();if(!p)throw Error('로그인이 필요합니다.');return 'capacity-study:'+(p.role==='SUPER_ADMIN'?'global':p.centerId);}
function key(id:string,workspace=scope()){return {workspace,kind:'baseline',id};}
const saved=(row:any):SavedCapacityStudy=>({id:row.id,version:row.version,...row.payload,updatedAt:row.updatedAt.toISOString()});
export async function listCapacityStudies(){return (await db.workRecord.findMany({where:{workspace:scope(),kind:'baseline'},orderBy:{updatedAt:'desc'},take:30})).map(saved);}
export async function listCapacityComparisons(){
 const workspace=scope(),rows=await db.workRecord.findMany({where:{workspace,kind:'comparison'},orderBy:{updatedAt:'desc'},take:20});
 const refs=rows.map(r=>r.payload as {baselineId?:string;baselineVersion?:number});
 const revisions=await db.workRecord.findMany({where:{workspace,kind:'baselineRevision',id:{in:refs.filter(r=>typeof r.baselineId==='string'&&Number.isInteger(r.baselineVersion)).map(r=>`${r.baselineId}:${r.baselineVersion}`)}}});
 return rows.map(r=>{
  const data=r.payload as Record<string,Prisma.JsonValue>,revision=revisions.find(v=>v.id===`${data.baselineId}:${data.baselineVersion}`)?.payload as {baseline:BaselineResources;baselineHash:string}|undefined;
  // Older comparisons hashed the JSONB-decoded object, whose key order can
  // differ from the saved revision. Repair only a proven legacy match on read;
  // never rewrite history or attach a result to an unrelated/new revision.
  const normalized=revision&&data.baselineHash!==revision.baselineHash&&data.baselineHash===contentHash(revision.baseline)?{...data,baselineHash:revision.baselineHash}:data;
  return {id:r.id,comparedAt:r.updatedAt.toISOString(),data:normalized};
 });
}
export const saveCapacityStudySchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),input:capacityStudySchema,resources:baselineResourcesSchema.optional()}).strict();
export async function saveCapacityStudy(raw:unknown){
 const b=saveCapacityStudySchema.parse(raw),calculated=summarizeCapacity(b.input),baseline=b.resources??calculated.baseline;
 if(calculated.blockers.length||!calculated.tasks.length)throw Error('미확인 농지·작업 기준을 보완하고 하나 이상의 신청 작업을 산출한 뒤 기준 자원을 고정하세요.');
 baselineResourcesSchema.parse(baseline);
 if(baseline.inputHash!==calculated.inputHash)throw new CapacityStudyConflict('다른 입력에서 산출된 자원 기준입니다.');
 const payload={input:b.input,baseline,baselineHash:contentHash(baseline)},workspace=scope();
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace+b.id}))`;
  const prior=await tx.workRecord.findUnique({where:{workspace_kind_id:key(b.id,workspace)}});
  if((prior?.version??0)!==b.expectedVersion)throw new CapacityStudyConflict('저장본이 변경되었습니다. 새로 불러오세요.');
  const version=b.expectedVersion+1,updatedAt=new Date();
  const row=await tx.workRecord.upsert({where:{workspace_kind_id:key(b.id,workspace)},create:{...key(b.id,workspace),version,payload:json(payload),updatedAt},update:{version,payload:json(payload),updatedAt}});
  await tx.workRecord.create({data:{workspace,kind:'baselineRevision',id:`${b.id}:${version}`,version,payload:json(payload),updatedAt}});
  return saved(row);
 });
}
export const compareStudySchema=z.object({
 id:z.string().uuid(),expectedVersion:z.number().int().positive(),baselineHash:z.string().length(64),
 scenario:z.enum(['REFERENCE','CONCENTRATION']),cropId:z.string().optional(),centerId:z.enum(studyCenterIds).optional(),
 incidents:z.array(studyIncidentSchema).max(20).default([]),
 /** No real loan is requested; this is an explicit study assumption. */
 assumeAdjacentLoans:z.boolean().default(false),
}).strict();
export async function calculateSavedCapacityStudy(raw:unknown,calculator=compareCapacityPlans){
 const b=compareStudySchema.parse(raw),workspace=scope(),row=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key(b.id,workspace)}}),snapshot=saved(row);
 if(row.version!==b.expectedVersion||snapshot.baselineHash!==b.baselineHash)throw new CapacityStudyConflict('오래된 기준 자원입니다.');
 if(summarizeCapacity(snapshot.input).inputHash!==snapshot.baseline.inputHash)throw new CapacityStudyConflict('작업 생성 기준이 갱신되었습니다. 기존 입력으로 자원을 다시 계산·확인한 뒤 비교하세요. 이전 기록은 보존됩니다.');
 let input=structuredClone(snapshot.input);
 if(b.scenario==='CONCENTRATION'){
  if(!b.cropId)throw Error('쏠림 작물을 선택하세요.');
  const changed=distributeScenarioCrops(input,{[b.cropId]:100},'concentration');
  input.population.parcels=changed.population.parcels.map((p,i)=>!b.centerId||p.centerId===b.centerId?p:input.population.parcels[i]);
 }
 for(const i of b.incidents)if(i.kind==='FAULT'&&!snapshot.baseline.machines.some(m=>m.id===i.machineId))throw Error('기준에 없는 고장 장비입니다.');
 const neighbors:Record<string,string[]>={};
 // Use saved boundary topology, not a client supplied all-centers-neighbor flag.
 for(const id of studyCenterIds)neighbors[id]=await geographicNeighbors(db,id);
 const loans=b.assumeAdjacentLoans?studyLoanWindows(summarizeCapacity(input).tasks,snapshot.baseline,neighbors):[];
 const result=await calculator(input,snapshot.baseline,{neighbors,loans,incidents:b.incidents});
 // The immutable stored revision is the comparison identity. The solver's
 // serialization hash still guards its own in-memory input against mutation.
 const details={...result,baselineHash:snapshot.baselineHash,scenario:b.scenario,incidents:b.incidents,assumeAdjacentLoans:b.assumeAdjacentLoans,geographicNeighbors:neighbors,changedParcels:input.population.parcels.filter((p,i)=>p.cropId!==snapshot.input.population.parcels[i].cropId).length};
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace+b.id}))`;
  const latest=await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:key(b.id,workspace)}});
  if(latest.version!==b.expectedVersion)throw new CapacityStudyConflict('계산 중 기준이 변경되었습니다. 다시 계산하세요.');
  await tx.workRecord.create({data:{workspace,kind:'comparison',id:crypto.randomUUID(),payload:json({baselineId:b.id,baselineVersion:b.expectedVersion,...details})}});
 });
 return details;
}
