import {z} from 'zod';
import {cropCodeSchema,type SupportedCropCode} from './crop-registry';
import {supplySignal,type Range} from './crop-reference';

export const coordinationVersion='production-coordination-v2';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const text=z.string().trim().min(1).max(500);
const range=z.object({low:z.number().finite().nonnegative(),high:z.number().finite().nonnegative()}).strict().refine(v=>v.low<=v.high);
const evidence={sourceUrl:z.string().url().refine(v=>v.startsWith('https://')),method:text,checkedOn:day,validUntil:day};
export const coordinationPolicySchema=z.object({
 yields:z.array(z.object({crop:cropCodeSchema,commodity:text,kgPer1000m2:range,...evidence}).strict()).max(30),
 targets:z.array(z.object({commodity:text,year:z.number().int().min(2000).max(2200),kg:z.number().positive().finite(),origin:z.enum(['REGISTERED','DEMO']),...evidence}).strict()).max(300),
 specialties:z.array(z.object({centerId:z.string().min(1).max(80),crop:cropCodeSchema,status:z.enum(['ESTABLISHED','DEVELOPMENT_CANDIDATE']),bonus:z.number().min(0).max(5),...evidence}).strict()).max(300),
 // Reviewed outlook, not a price predictor. Its period must cover the harvest,
 // not simply the date when the operator happens to plan the crop.
 marketOutlooks:z.array(z.object({crop:cropCodeSchema,commodity:text,from:day,to:day,pressure:z.enum(['OVERSUPPLY_RISK','BALANCED','SHORTAGE_RISK']),...evidence}).strict()).max(300).optional(),
}).strict().superRefine((p,ctx)=>{
 for(const [key,values] of [['yields',p.yields.map(v=>v.crop)],['targets',p.targets.map(v=>`${v.commodity}:${v.year}:${v.origin}`)],['specialties',p.specialties.map(v=>`${v.centerId}:${v.crop}`)]] as const)if(new Set(values).size!==values.length)ctx.addIssue({code:'custom',path:[key],message:'기준 중복'});
 for(const values of [p.yields,p.targets,p.specialties,p.marketOutlooks??[]])for(const v of values)if(v.checkedOn>v.validUntil)ctx.addIssue({code:'custom',message:'검토일·유효기간 확인 필요'});
 for(const [i,m] of (p.marketOutlooks??[]).entries()){
  if(m.from>m.to)ctx.addIssue({code:'custom',path:['marketOutlooks',i],message:'수확 전망 기간 확인 필요'});
  if(p.marketOutlooks!.slice(0,i).some(o=>o.crop===m.crop&&o.commodity===m.commodity&&o.from<=m.to&&m.from<=o.to))ctx.addIssue({code:'custom',path:['marketOutlooks',i],message:'같은 생산물의 전망 기간이 중복됩니다.'});
 }
});
export type CoordinationPolicy=z.infer<typeof coordinationPolicySchema>;
export const emptyCoordinationPolicy=():CoordinationPolicy=>({yields:[],targets:[],specialties:[]});
export type ProductionContribution={id:string;centerId:string;crop:SupportedCropCode;areaM2:number|null;year:number|null;commodity:string|null;kg:Range|null;origin:'REGISTERED'|'DEMO';basis:string;harvestPeriod?:{from:string;to:string}|null};
export type ProductionBucket={commodity:string;year:number;origin:'REGISTERED'|'DEMO';kg:Range;cultivations:number};
export type CoordinationContext={policy:CoordinationPolicy;contributions:ProductionContribution[];centerId:string;today:string;origin:'REGISTERED'|'DEMO'};
export function aggregateProduction(entries:ProductionContribution[]):ProductionBucket[]{
 const ids=new Set<string>(),buckets=new Map<string,ProductionBucket>();
 for(const e of entries){
  if(ids.has(e.id))throw Error('재배 건 생산량 중복');ids.add(e.id);
  if(e.year===null||!e.commodity||!e.kg)continue;
  if(!Number.isFinite(e.kg.low)||!Number.isFinite(e.kg.high)||e.kg.low<0||e.kg.high<e.kg.low)throw Error('생산량 범위 확인 필요');
  const key=JSON.stringify([e.commodity,e.year,e.origin]),b=buckets.get(key)??{commodity:e.commodity,year:e.year,origin:e.origin,kg:{low:0,high:0},cultivations:0};
  b.kg.low+=e.kg.low;b.kg.high+=e.kg.high;b.cultivations++;buckets.set(key,b);
 }return [...buckets.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
const valid=(e:{checkedOn:string;validUntil:string},today:string)=>e.checkedOn<=today&&today<=e.validUntil;
export function candidateContribution(c:{id:string;centerId:string;crop:SupportedCropCode;areaM2:number|null;harvestYears:number[];origin:'REGISTERED'|'DEMO';harvestPeriod?:{from:string;to:string}|null},policy:CoordinationPolicy,today:string):ProductionContribution{
 const years=[...new Set(c.harvestYears)],yieldRef=policy.yields.find(y=>y.crop===c.crop&&valid(y,today));
 const area=c.areaM2&&Number.isFinite(c.areaM2)&&c.areaM2>0?c.areaM2:null;
 return {id:c.id,centerId:c.centerId,crop:c.crop,areaM2:area,origin:c.origin,year:years.length===1?years[0]:null,commodity:yieldRef?.commodity??null,kg:yieldRef&&area?{low:yieldRef.kgPer1000m2.low*area/1000,high:yieldRef.kgPer1000m2.high*area/1000}:null,basis:yieldRef?`${yieldRef.sourceUrl} / ${yieldRef.method}`:'YIELD_REFERENCE_REQUIRED',...(c.harvestPeriod?{harvestPeriod:c.harvestPeriod}:{})};
}
export function marketOutlook(c:ProductionContribution,context:CoordinationContext){
 const rows=(context.policy.marketOutlooks??[]).filter(o=>o.crop===c.crop&&o.commodity===c.commodity&&valid(o,context.today)&&c.harvestPeriod&&o.from<=c.harvestPeriod.from&&o.to>=c.harvestPeriod.to);
 // A future/expired/partial-period/basis-mismatched source is UNKNOWN, not safe.
 const ref=rows.length===1?rows[0]:null;
 return {status:ref?.pressure??'UNKNOWN',scope:'NATIONAL_REFERENCE_ONLY' as const,reference:ref?{sourceUrl:ref.sourceUrl,checkedOn:ref.checkedOn,validUntil:ref.validUntil,from:ref.from,to:ref.to}:null};
}
/** Apply only AFTER suitability and complete resource feasibility. Never a price forecast. */
export function coordinateCandidate(c:ProductionContribution,baseScore:number,context:CoordinationContext){
 const total=aggregateProduction([...context.contributions.filter(e=>e.id!==c.id),c]).find(b=>b.commodity===c.commodity&&b.year===c.year&&b.origin===c.origin);
 const target=context.policy.targets.find(t=>t.commodity===c.commodity&&t.year===c.year&&t.origin===c.origin&&valid(t,context.today));
 const signal=total&&c.kg&&c.year&&c.commodity?supplySignal(total.kg,c.commodity,{year:c.year},target?{...target,period:{year:target.year},unit:'kg',geography:'KR',basis:'DERIVED_REFERENCE',validUntil:target.validUntil+'T23:59:59+09:00'}:null,new Date(context.today+'T12:00:00+09:00')):{status:'INSUFFICIENT_DATA' as const,penalty:0,reason:'YIELD_HARVEST_PERIOD_OR_REFERENCE_REQUIRED',scope:'REGISTERED_ONLY' as const};
 const specialties=context.policy.specialties.filter(s=>s.centerId===context.centerId&&valid(s,context.today));
 const hasEstablished=specialties.some(s=>s.status==='ESTABLISHED'),specialty=specialties.find(s=>s.crop===c.crop&&(s.status==='ESTABLISHED'||!hasEstablished));
 const bonus=specialty?.bonus??0;
 const rankingScore=Math.round((baseScore+bonus-signal.penalty)*100)/100;
 return {baseScore,score:Math.max(0,Math.min(100,rankingScore)),rankingScore,specialtyBonus:bonus,specialtyStatus:specialty?.status??'NOT_REVIEWED',specialtyReference:specialty?{sourceUrl:specialty.sourceUrl,checkedOn:specialty.checkedOn,validUntil:specialty.validUntil}:null,market:marketOutlook(c,context),supply:signal,production:c,registeredTotal:total?.kg??null,coverage:'PARTICIPATING_CULTIVATIONS_ONLY' as const};
}
export type CandidateCoordination=ReturnType<typeof coordinateCandidate>;
