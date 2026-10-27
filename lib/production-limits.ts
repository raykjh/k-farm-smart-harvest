import {z} from 'zod';
import {cropCodeSchema} from './crop-registry';
import type {ProductionContribution} from './production-coordination';

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
/** Explicit participant contracts/reviewed targets. National forecasts must not
 * be entered as a center quota. Annual and seasonal limits can both apply. */
export const productionLimitsSchema=z.array(z.object({
 id:z.string().min(1).max(80),version:z.string().min(1).max(80),
 commodity:z.string().min(1).max(100),crops:z.array(cropCodeSchema).min(1).max(30),
 centerIds:z.array(z.string().min(1).max(80)).min(1).max(100),
 origin:z.enum(['REGISTERED','DEMO']),from:day,to:day,maxKg:z.number().positive().finite(),
 mode:z.enum(['HARD','ADVISORY']),basis:z.enum(['PARTICIPANT_CONTRACT','REVIEWED_PARTICIPANT_TARGET']),
 sourceKind:z.enum(['VERIFIED','SYNTHETIC']),sourceUrl:z.string().url().startsWith('https://'),
 checkedOn:day,validUntil:day,
}).strict()).max(300).superRefine((rows,ctx)=>{
 const ids=new Set<string>();
 for(const [i,r] of rows.entries()){
  if(ids.has(r.id)||r.from>r.to||r.checkedOn>r.validUntil||new Set(r.crops).size!==r.crops.length||new Set(r.centerIds).size!==r.centerIds.length)ctx.addIssue({code:'custom',path:[i],message:'생산 목표 ID·기간·범위 중복 또는 오류'});
  if(r.sourceKind==='SYNTHETIC'&&r.origin!=='DEMO')ctx.addIssue({code:'custom',path:[i],message:'모의 목표는 모의 자료 범위에만 적용합니다.'});
  ids.add(r.id);
 }
});
export type ProductionLimit=z.infer<typeof productionLimitsSchema>[number];
const applies=(r:ProductionLimit,c:ProductionContribution)=>r.origin===c.origin&&r.centerIds.includes(c.centerId)&&r.crops.includes(c.crop);
const overlaps=(r:ProductionLimit,c:ProductionContribution)=>c.harvestPeriod?r.from<=c.harvestPeriod.to&&c.harvestPeriod.from<=r.to:c.year!==null?r.from<=`${c.year}-12-31`&&`${c.year}-01-01`<=r.to:true;
export function productionLimitUsage(limit:ProductionLimit,entries:ProductionContribution[],today:string){
 const matching=entries.filter(e=>applies(limit,e)&&overlaps(limit,e));
 if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('생산 목표 계산의 재배 ID 중복');
 const stale=limit.checkedOn>today||today>limit.validUntil;
 const unknown=matching.filter(e=>!e.kg||e.commodity!==limit.commodity||!e.harvestPeriod);
 const known=matching.filter(e=>e.kg&&e.commodity===limit.commodity&&e.harvestPeriod);
 // A period straddling the limit is counted in full, never prorated without a
 // reviewed harvest distribution. This is an upper envelope, not a prediction.
 const low=known.reduce((n,e)=>n+e.kg!.low,0),high=known.reduce((n,e)=>n+e.kg!.high,0);
 const partialPeriod=known.some(e=>e.harvestPeriod!.from<limit.from||e.harvestPeriod!.to>limit.to);
 return {id:limit.id,version:limit.version,commodity:limit.commodity,from:limit.from,to:limit.to,mode:limit.mode,
  maxKg:limit.maxKg,lowKg:low,highKg:high,remainingKg:Math.max(0,limit.maxKg-high),excessKg:Math.max(0,high-limit.maxKg),
  unknown:unknown.length,partialPeriod,status:stale?'STALE' as const:unknown.length?'UNKNOWN' as const:high>limit.maxKg+1e-6?'EXCEEDED' as const:'WITHIN_REFERENCE' as const,
  coverage:'EXPLICIT_PARTICIPANTS_ONLY' as const};
}
export function candidateLimitCheck(candidate:ProductionContribution,existing:ProductionContribution[],limits:ProductionLimit[],today:string){
 const rows=limits.filter(r=>applies(r,candidate)&&overlaps(r,candidate)).map(r=>productionLimitUsage(r,[...existing.filter(e=>e.id!==candidate.id),candidate],today));
 return {rows,blocked:rows.some(r=>r.mode==='HARD'&&r.status!=='WITHIN_REFERENCE')};
}
