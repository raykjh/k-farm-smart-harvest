import {z} from 'zod';
import {createHash} from 'node:crypto';
import {workloadCrops,workloadEquipment,WORKLOAD_CATALOG_VERSION} from './crop-workload-catalog';

export const studyCenterIds=['demo','janggye','cheoncheon','gyenam'] as const;
export const studyCenter=z.enum(studyCenterIds);
export const studyDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'정확한 날짜를 입력하세요.');
const token=z.string().trim().regex(/^[a-zA-Z0-9:_-]{1,100}$/);
const cropId=z.string().refine(v=>workloadCrops.some(c=>c.id===v),'30작물 기준에서 선택하세요.');
export const studyParcelSchema=z.object({
 pnu:z.string().regex(/^\d{19}$/),centerId:studyCenter,areaM2:z.number().positive().max(1000000),
 ownerId:token,applied:z.boolean(),cropId,year:z.number().int().min(2020).max(2100),
 geographicBasis:z.enum(['PUBLIC_CADASTRE','SYNTHETIC_TEST_ONLY']),
 geographicSource:z.string().trim().min(1).max(500),
 suitability:z.enum(['SUITABLE','UNSUITABLE','UNKNOWN']),
 cropLocked:z.boolean(),existingBearingOrchard:z.boolean(),
 eligibleCropIds:z.array(cropId).min(1).max(30).optional(),
}).strict();
export type StudyParcel=z.infer<typeof studyParcelSchema>;
export const ownerPopulationSchema=z.object({
 basis:z.literal('SYNTHETIC_OWNER_POPULATION'),
 description:z.string().trim().min(1).max(500),
 owners:z.array(z.object({id:token}).strict()).min(1).max(20000),
 parcels:z.array(studyParcelSchema).max(20000),
 seed:token,participationRate:z.number().min(0).max(1).default(0.33),
}).strict().superRefine((v,c)=>{
 const owners=new Set(v.owners.map(o=>o.id)),plots=new Set<string>();
 for(const p of v.parcels){
  if(!owners.has(p.ownerId))c.addIssue({code:'custom',message:'모집단에 없는 소유자입니다.'});
  if(plots.has(p.pnu))c.addIssue({code:'custom',message:'한 필지는 한 번만 입력하세요. 공동소유는 별도 대표·동의 확인 전 제외합니다.'});plots.add(p.pnu);
 }
 const owning=new Set(v.parcels.map(p=>p.ownerId));
 if([...owners].some(id=>!owning.has(id)))c.addIssue({code:'custom',message:'모집단의 소유자는 대상 4개 면에 농지가 있어야 합니다.'});
});
export type OwnerPopulation=z.infer<typeof ownerPopulationSchema>;
export function contentHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function selectParticipatingOwners(raw:unknown){
 const input=ownerPopulationSchema.parse(raw),ids=[...new Set(input.owners.map(o=>o.id))].sort();
 const count=Math.floor(ids.length*input.participationRate+1e-9);
 const ranked=ids.map(id=>({id,rank:contentHash([input.seed,id])})).sort((a,b)=>a.rank.localeCompare(b.rank)||a.id.localeCompare(b.id));
 const selected=ranked.slice(0,count).map(x=>x.id).sort(),set=new Set(selected);
 const parcels=input.parcels.filter(p=>set.has(p.ownerId)&&p.applied).sort((a,b)=>a.pnu.localeCompare(b.pnu));
 const byCenter=studyCenterIds.map(centerId=>{const rows=parcels.filter(p=>p.centerId===centerId);return {centerId,owners:new Set(rows.map(p=>p.ownerId)).size,parcels:rows.length,areaM2:rows.reduce((n,p)=>n+p.areaM2,0)};});
 return {populationCount:ids.length,selectedCount:count,participationRate:input.participationRate,rounding:'FLOOR' as const,selectedOwnerIds:selected,parcels,areaM2:parcels.reduce((n,p)=>n+p.areaM2,0),byCenter,
  note:'소유자 기준 표본. 센터별 소유자 합계는 센터 간 중복 때문에 전체 소유자 수와 다를 수 있습니다. 면적·필지 비율은 33%가 아닙니다.'};
}

export const operationOverrideSchema=z.object({
 cropId,operationCode:token,
 windows:z.array(z.object({from:studyDate,to:studyDate}).strict().refine(w=>w.from<=w.to)).min(1).max(30),
 basis:z.enum(['DEMO_INPUT','WEATHER_DERIVED','REVIEWED_REGIONAL_INPUT']),
 source:z.string().trim().min(1).max(500),
}).strict().superRefine((v,c)=>{if(!workloadCrops.find(p=>p.id===v.cropId)?.operations.some(o=>o.code===v.operationCode))c.addIssue({code:'custom',message:'작물에 없는 작업 코드입니다.'});});
export const capacityStudySchema=z.object({
 title:z.string().trim().min(1).max(100),population:ownerPopulationSchema,
 includeConditionalReserve:z.boolean().default(true),
 overrides:z.array(operationOverrideSchema).max(500).default([]),
}).strict().superRefine((v,c)=>{const keys=v.overrides.map(o=>o.cropId+':'+o.operationCode);if(new Set(keys).size!==keys.length)c.addIssue({code:'custom',message:'작물별 작업기간 보정 중복'});});
export type CapacityStudyInput=z.infer<typeof capacityStudySchema>;
export const equipmentCapability=z.string().refine(v=>workloadEquipment.some(c=>c.id===v));
export const baselineResourcesSchema=z.object({
 version:z.literal('capacity-baseline-v1'),inputHash:z.string().length(64),
 catalogVersion:z.literal(WORKLOAD_CATALOG_VERSION),
 centers:z.array(z.object({centerId:studyCenter,operators:z.number().int().min(0).max(100),workers:z.number().int().min(0).max(100),transport:z.number().int().min(0).max(20)}).strict()).length(4),
 machines:z.array(z.object({id:token,ownerCenterId:studyCenter,capability:equipmentCapability,compatibleCrops:z.array(cropId).min(1).max(30)}).strict()).max(2000),
}).strict().superRefine((v,c)=>{
 if(new Set(v.centers.map(x=>x.centerId)).size!==4)c.addIssue({code:'custom',message:'센터 자원 중복'});
 if(new Set(v.machines.map(x=>x.id)).size!==v.machines.length)c.addIssue({code:'custom',message:'장비 식별자 중복'});
});
export type BaselineResources=z.infer<typeof baselineResourcesSchema>;
export const studyIncidentSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('FAULT'),machineId:token,from:studyDate,to:studyDate}).strict(),
 z.object({kind:z.literal('WIND'),centerId:studyCenter,from:studyDate,to:studyDate}).strict(),
 z.object({kind:z.literal('HEAVY_RAIN'),centerId:studyCenter,from:studyDate,to:studyDate}).strict(),
 z.object({kind:z.literal('LABOR_ABSENCE'),centerId:studyCenter,workers:z.number().int().min(1).max(100),from:studyDate,to:studyDate}).strict(),
]).refine(v=>v.from<=v.to);
export type StudyIncident=z.infer<typeof studyIncidentSchema>;

/** Scenario distributions are inputs, not statistics or crop recommendations. */
export const referenceCropWeights:Record<string,number>={rice:45,soybean:8,potato:6,pepper:6,apple:5,maize:4,sweetpotato:3,cabbage:3,radish:3,perilla:3,...Object.fromEntries(workloadCrops.filter(c=>!['rice','soybean','potato','pepper','apple','maize','sweetpotato','cabbage','radish','perilla'].includes(c.id)).map(c=>[c.id,1]))};
export function distributeScenarioCrops(raw:unknown,weights:Record<string,number>,seed:string){
 const input=capacityStudySchema.parse(raw),selected=new Set(selectParticipatingOwners(input.population).selectedOwnerIds);
 if(!Object.values(weights).every(v=>Number.isFinite(v)&&v>=0)||!Object.keys(weights).every(id=>workloadCrops.some(c=>c.id===id)))throw Error('작물 분포 가중치를 확인하세요.');
 for(const parcel of input.population.parcels){
  if(!selected.has(parcel.ownerId)||!parcel.applied||parcel.cropLocked||parcel.existingBearingOrchard||parcel.suitability!=='SUITABLE')continue;
  const candidates=(parcel.eligibleCropIds??[parcel.cropId]).filter(id=>(weights[id]??0)>0&&(!workloadCrops.find(c=>c.id===id)!.lifecycle.includes('ORCHARD')||parcel.existingBearingOrchard));
  const total=candidates.reduce((n,id)=>n+weights[id],0);if(!total)continue;
  let value=parseInt(contentHash([seed,parcel.pnu]).slice(0,8),16)/0x100000000*total;
  for(const id of [...candidates].sort()){value-=weights[id];if(value<0){parcel.cropId=id;break;}}
 }
 return input;
}
