import {z} from 'zod';
import {cropCodeSchema,isOrchardCrop} from './crop-registry';
import type {FieldConditions} from './field-conditions';
import type {ProductionContribution} from './production-coordination';

const day=z.string().date(),id=z.string().trim().min(1).max(80);
const range=z.object({low:z.number().finite().nonnegative(),high:z.number().finite().nonnegative()}).strict().refine(r=>r.low<=r.high);
export const orchardIdentitySchema=z.object({varietyId:id,plantedYear:z.number().int().min(1900).max(2200),stage:z.enum(['BEARING','NEW_PLANTING','RENEWAL']),changeConsent:z.boolean(),pollinizerVarietyIds:z.array(id).max(20)}).strict();
export const varietyReviewSchema=z.object({
 id,version:id,name:z.string().trim().min(1).max(100),crop:cropCodeSchema,commodity:id,
 regions:z.array(z.string().trim().min(1).max(100)).min(1).max(50),
 status:z.enum(['ESTABLISHED','TRIAL']),harvest:z.object({from:day,to:day}).strict(),
 supplyAreaM2:z.number().finite().nonnegative().nullable(),trialAreaM2:z.number().finite().nonnegative().nullable(),
 yieldKgPer1000m2:range.nullable(),
 orchard:z.object({minimumBearingYears:z.number().int().min(1).max(30),pollinationRequired:z.boolean(),compatiblePollinizers:z.array(id).max(20),ageYields:z.array(z.object({fromAge:z.number().int().nonnegative(),toAge:z.number().int().nonnegative(),kgPer1000m2:range}).strict()).max(30)}).strict().optional(),
 sourceKind:z.enum(['VERIFIED','SYNTHETIC']),sourceUrl:z.string().url().startsWith('https://'),checkedOn:day,validUntil:day,
}).strict().superRefine((v,ctx)=>{
 if(v.checkedOn>v.validUntil||v.harvest.from>v.harvest.to||new Set(v.regions).size!==v.regions.length)ctx.addIssue({code:'custom',message:'품종 기준 기간·지역 확인 필요'});
 if(isOrchardCrop(v.crop)!==!!v.orchard)ctx.addIssue({code:'custom',message:'과수 품종에는 수령·수분 기준이 필요합니다.'});
 for(const [i,r] of (v.orchard?.ageYields??[]).entries())if(r.fromAge>r.toAge||v.orchard!.ageYields.slice(0,i).some(p=>p.fromAge<=r.toAge&&r.fromAge<=p.toAge))ctx.addIssue({code:'custom',message:'수령별 수량 기준 중복'});
});
export type VarietyReview=z.infer<typeof varietyReviewSchema>;
export function varietyYield(review:VarietyReview,conditions:FieldConditions|undefined,harvestYear:number){
 if(!review.orchard)return review.yieldKgPer1000m2;
 const orchard=conditions?.orchard;if(!orchard||orchard.varietyId!==review.id)return null;
 const age=harvestYear-orchard.plantedYear;
 // A reviewed immature profile may estimate zero; it never creates an
 // executable planting conversion or a mature harvest operation.
 if(age<0)return null;if(age<review.orchard.minimumBearingYears)return {low:0,high:0};
 return review.orchard.ageYields.find(r=>r.fromAge<=age&&age<=r.toAge)?.kgPer1000m2??null;
}
export function checkVariety(input:{review:VarietyReview;conditions?:FieldConditions;crop:string;areaM2:number|null;centerId:string;origin:'DEMO'|'REGISTERED';today:string;harvest:{from:string;to:string}|null;existing:ProductionContribution[];candidateId:string}){
 const {review:r,conditions:c}=input,reasons:string[]=[];
 if(r.crop!==input.crop)reasons.push('VARIETY_CROP_MISMATCH');
 if(r.sourceKind==='SYNTHETIC'&&input.origin!=='DEMO')reasons.push('SYNTHETIC_VARIETY_SCOPE');
 if(r.checkedOn>input.today||r.validUntil<input.today||!input.harvest||input.harvest.from<r.harvest.from||input.harvest.to>r.harvest.to)reasons.push('VARIETY_PERIOD_REVIEW');
 if(!c||!r.regions.includes(c.region))reasons.push('VARIETY_REGION_REVIEW');
 if(!input.areaM2)reasons.push('VARIETY_AREA_REQUIRED');
 const prior=input.existing.filter(e=>e.id!==input.candidateId&&e.centerId===input.centerId&&e.origin===input.origin&&e.varietyId===r.id&&(!e.harvestPeriod||e.harvestPeriod.from<=r.harvest.to&&r.harvest.from<=e.harvestPeriod.to));
 const total=prior.reduce((n,e)=>n+(e.areaM2??0),0)+(input.areaM2??0);
 if(prior.some(e=>!e.areaM2))reasons.push('VARIETY_PRIOR_AREA_UNKNOWN');
 if(!r.orchard&&(r.supplyAreaM2===null||total>r.supplyAreaM2))reasons.push('VARIETY_SUPPLY_REVIEW');
 if(r.status==='TRIAL'&&(r.trialAreaM2===null||total>r.trialAreaM2))reasons.push('VARIETY_TRIAL_LIMIT');
 if(r.orchard){
  const tree=c?.orchard;
  if(!tree||tree.stage!=='BEARING'||!c?.existingBearingOrchard)reasons.push('ORCHARD_ESTABLISHMENT_REVIEW');
  if(tree&&tree.varietyId!==r.id)reasons.push('EXISTING_VARIETY_PRESERVED');
  if(tree&&Number(input.harvest?.from.slice(0,4)??input.today.slice(0,4))-tree.plantedYear<r.orchard.minimumBearingYears)reasons.push('IMMATURE_ORCHARD');
  if(r.orchard.pollinationRequired&&!tree?.pollinizerVarietyIds.some(id=>r.orchard!.compatiblePollinizers.includes(id)))reasons.push('POLLINATION_REVIEW');
 }
 const kgPer1000m2=varietyYield(r,c,Number(input.harvest?.from.slice(0,4)??input.today.slice(0,4)));
 if(kgPer1000m2===null)reasons.push('VARIETY_YIELD_REVIEW');
 return {eligible:reasons.length===0,reasons,varietyId:r.id,commodity:r.commodity,kgPer1000m2,areaUsedM2:total};
}
