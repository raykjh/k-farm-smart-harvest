import {z} from 'zod';
import {cropCodeSchema,type SupportedCropCode} from './crop-registry';
import {laborEarnings,type PayBasis} from './labor-policy';
import {priceEvidenceSchema} from './price-reference';

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const text=z.string().trim().min(1).max(1000);
const url=z.string().url().refine(v=>v.startsWith('https://'));
const scenario=z.object({low:z.number().finite().nonnegative(),base:z.number().finite().nonnegative(),high:z.number().finite().nonnegative()}).strict().refine(v=>v.low<=v.base&&v.base<=v.high,'Scenario bounds must be ordered');
const period=z.object({from:day,to:day}).strict().refine(v=>v.from<=v.to);
const provenance={version:text,sourceUrl:url,method:text,checkedOn:day,validUntil:day};
const costComponent=z.object({category:z.enum(['SEED_MATERIALS','FERTILIZER','CROP_PROTECTION','WATER_ENERGY','TRANSPORT','LAND','OTHER']),wonPer1000m2:scenario,...provenance}).strict();
const cost=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('ITEMIZED'),components:z.array(costComponent).max(7),coverage:z.enum(['PARTIAL','ALL_OTHER_COSTS_REVIEWED'])}).strict(),
 // The statistical total ALREADY includes labor/equipment. Its operational
 // detail is shown separately and must never be deducted a second time.
 z.object({mode:z.literal('STATISTICAL_TOTAL'),totalWonPer1000m2:scenario,includesLabor:z.literal(true),includesEquipment:z.literal(true),basis:z.enum(['OPERATING_COST','PRODUCTION_COST']).optional(),exclusions:z.array(text).max(20).optional(),...provenance}).strict(),
]);
export const economicReferenceSchema=z.object({
 crop:cropCodeSchema,commodity:text,unit:z.literal('kg'),...provenance,asOf:day,
 sourceDataKind:z.enum(['OFFICIAL_STATISTICS','REGISTERED_CONTRACT','REVIEWED_REFERENCE','SYNTHETIC_FIXTURE']),
 origin:z.enum(['REGISTERED','DEMO']),harvestPeriod:period,
 priceEvidence:priceEvidenceSchema.optional(),
 yieldKgPer1000m2:scenario,marketableFraction:scenario.refine(v=>v.high<=1,'Marketable fraction must be within 0..1'),
 price:z.object({low:z.number().finite().nonnegative(),base:z.number().finite().nonnegative(),high:z.number().finite().nonnegative(),unit:z.literal('KRW_PER_KG'),stage:z.enum(['FARM_GATE','WHOLESALE']),basis:z.enum(['HISTORICAL_SCENARIO','CONTRACT'])}).strict().refine(v=>v.low<=v.base&&v.base<=v.high),
 cost,
}).strict().superRefine((r,ctx)=>{
 if(r.priceEvidence&&(r.price.stage!=='WHOLESALE'||r.price.basis!=='HISTORICAL_SCENARIO'||r.priceEvidence.query.crop!==r.crop))ctx.addIssue({code:'custom',message:'Linked aT history must remain a wholesale historical scenario of the same crop'});
 if(r.asOf>r.checkedOn||r.checkedOn>r.validUntil)ctx.addIssue({code:'custom',message:'Reference dates are inconsistent'});
 if(r.sourceDataKind==='SYNTHETIC_FIXTURE'&&r.origin!=='DEMO')ctx.addIssue({code:'custom',message:'Synthetic economic evidence is demo-only'});
 if(r.price.basis==='CONTRACT'&&r.sourceDataKind!=='REGISTERED_CONTRACT'&&r.sourceDataKind!=='SYNTHETIC_FIXTURE')ctx.addIssue({code:'custom',message:'A contract price needs registered contract evidence'});
 const costs=r.cost.mode==='STATISTICAL_TOTAL'?[r.cost]:r.cost.components;
 if(costs.some(c=>c.checkedOn>c.validUntil))ctx.addIssue({code:'custom',message:'Cost reference dates are inconsistent'});
 if(r.cost.mode==='ITEMIZED'){
  if(new Set(r.cost.components.map(c=>c.category)).size!==r.cost.components.length)ctx.addIssue({code:'custom',message:'Cost categories overlap'});
  if(r.cost.coverage==='ALL_OTHER_COSTS_REVIEWED'&&!r.cost.components.length)ctx.addIssue({code:'custom',message:'Reviewed other costs need explicit evidence, including an evidenced zero'});
 }
});
export const economicReferencesSchema=z.array(economicReferenceSchema).max(90);
export type EconomicReference=z.infer<typeof economicReferenceSchema>;
export type EconomicScenario={low:number;base:number;high:number};
export type RegisteredEquipmentRate={machineId:string;wonPerHour:number;unit:'KRW_PER_HOUR';version:string;sourceUrl:string;checkedOn:string;validUntil:string};
export type EconomicTask={date:string;durationMinutes:number;ordinaryWorkers:number;machineOperators:number;machineId:string|null;equipmentRate?:RegisteredEquipmentRate};
export type CropEconomicsInput={
 areaM2:number;crop:SupportedCropCode;commodity:string|null;origin:'REGISTERED'|'DEMO';harvestPeriod:{from:string;to:string}|null;today:string;
 references:unknown;tasks:EconomicTask[];payBasis?:PayBasis;payByYear?:Record<string,PayBasis|undefined>;
 // Operator wages are NOT inferred from ordinary-worker wages.
 operatorPayBasis?:PayBasis;operatorPayByYear?:Record<string,PayBasis|undefined>;
};
const zero=():EconomicScenario=>({low:0,base:0,high:0});
const scale=(x:EconomicScenario,n:number):EconomicScenario=>({low:x.low*n,base:x.base*n,high:x.high*n});
const add=(a:EconomicScenario,b:EconomicScenario):EconomicScenario=>({low:a.low+b.low,base:a.base+b.base,high:a.high+b.high});
const money=(x:EconomicScenario):EconomicScenario=>({low:Math.round(x.low),base:Math.round(x.base),high:Math.round(x.high)});
const valid=(r:{checkedOn:string;validUntil:string},today:string)=>r.checkedOn<=today&&today<=r.validUntil;
const payFor=(basis:PayBasis|undefined,year:number)=>basis&&basis.year===year&&Number.isInteger(basis.hourlyWon)&&basis.hourlyWon>0&&Number.isFinite(basis.halfDayWon)&&basis.halfDayWon===basis.hourlyWon*4&&Number.isInteger(basis.policyVersion)&&basis.policyVersion>=0&&url.safeParse(basis.source).success?basis:undefined;
const rateSchema=z.object({machineId:text,wonPerHour:z.number().finite().nonnegative(),unit:z.literal('KRW_PER_HOUR'),version:text,sourceUrl:url,checkedOn:day,validUntil:day}).strict();
const taskSchema=z.object({date:day,durationMinutes:z.number().finite().positive().max(480),ordinaryWorkers:z.number().int().nonnegative(),machineOperators:z.number().int().nonnegative(),machineId:z.string().min(1).nullable(),equipmentRate:rateSchema.optional()}).strict();

/** Deterministic scenario arithmetic, not a calibrated price/yield forecast.
 * Partial known costs are never silently promoted to complete profitability. */
export function evaluateCropEconomics(input:CropEconomicsInput){
 const gaps:string[]=[],missingCosts:string[]=[];
 const unknown=(reason:string)=>({
  status:'UNKNOWN' as const,comparable:false,scenarioOnly:true as const,forecast:false as const,
  reference:null,marketableKg:null,revenue:null,wholesaleScenarioValue:null,knownCost:null,balanceAfterKnownCosts:null,unfavorableBalance:null,
  costCoverage:'UNKNOWN' as const,operationalCost:{ordinaryLabor:null,operatorLabor:null,equipment:null,additive:false,missingComponents:[reason]},
  missingComponents:[reason],metrics:{comparable:0,missingComponents:1,unfavorableBalanceWon:null,baseBalanceWon:null},
 });
 if(!Number.isFinite(input.areaM2)||input.areaM2<=0||!day.safeParse(input.today).success||!input.commodity||!period.safeParse(input.harvestPeriod).success)return unknown('AREA_COMMODITY_OR_HARVEST_PERIOD_REQUIRED');
 const parsed=economicReferencesSchema.safeParse(input.references);
 if(!parsed.success)return unknown('INVALID_ECONOMIC_REFERENCE');
 const harvest=input.harvestPeriod!;
 const matching=parsed.data.filter(r=>r.crop===input.crop&&r.commodity===input.commodity&&r.origin===input.origin&&valid(r,input.today)&&r.asOf<=input.today&&r.harvestPeriod.from<=harvest.from&&r.harvestPeriod.to>=harvest.to);
 if(matching.length!==1)return unknown(matching.length?'AMBIGUOUS_ECONOMIC_REFERENCE':'CURRENT_MATCHING_ECONOMIC_REFERENCE_REQUIRED');
 const ref=matching[0],factor=input.areaM2/1000;
 const marketableKg: EconomicScenario={low:ref.yieldKgPer1000m2.low*factor*ref.marketableFraction.low,base:ref.yieldKgPer1000m2.base*factor*ref.marketableFraction.base,high:ref.yieldKgPer1000m2.high*factor*ref.marketableFraction.high};
 const value=money({low:marketableKg.low*ref.price.low,base:marketableKg.base*ref.price.base,high:marketableKg.high*ref.price.high});
 if([...Object.values(marketableKg),...Object.values(value)].some(v=>!Number.isFinite(v)))return unknown('ECONOMIC_CALCULATION_OUT_OF_RANGE');
 const revenue=ref.price.stage==='FARM_GATE'?value:null;
 if(!revenue)gaps.push('FARM_GATE_PRICE_REQUIRED_WHOLESALE_IS_NOT_RECEIPTS');
 let ordinary=0,operator=0,machine=0,ordinaryKnown=true,operatorKnown=true,machineKnown=true,ordinaryRequired=false,operatorRequired=false,machineRequired=false;
 const tasks=z.array(taskSchema).safeParse(input.tasks);
 if(!tasks.success||!tasks.data.length){ordinaryKnown=operatorKnown=machineKnown=false;missingCosts.push('VALID_EXECUTABLE_TASK_COST_BASIS_REQUIRED');}
 else for(const task of tasks.data){
  const year=Number(task.date.slice(0,4));
  if(task.ordinaryWorkers){ordinaryRequired=true;const basis=payFor(input.payByYear?.[String(year)]??input.payBasis,year);if(basis)ordinary+=laborEarnings(basis,task.durationMinutes)!*task.ordinaryWorkers;else {ordinaryKnown=false;missingCosts.push(`ORDINARY_LABOR_POLICY_REQUIRED:${year}`);}}
  if(task.machineOperators){operatorRequired=true;const basis=payFor(input.operatorPayByYear?.[String(year)]??input.operatorPayBasis,year);if(basis)operator+=laborEarnings(basis,task.durationMinutes)!*task.machineOperators;else {operatorKnown=false;missingCosts.push(`OPERATOR_LABOR_POLICY_REQUIRED:${year}`);}}
  if(task.machineId){machineRequired=true;const rate=task.equipmentRate;if(rate&&rate.machineId===task.machineId&&valid(rate,input.today)&&rate.checkedOn<=task.date&&task.date<=rate.validUntil)machine+=task.durationMinutes/60*rate.wonPerHour;else {machineKnown=false;missingCosts.push('REGISTERED_EQUIPMENT_RATE_REQUIRED');}}
 }
 let knownCost=zero(),knownComponents=0;
 // Individual known tasks remain known even when another task's rate is absent.
 if(ordinary>0||ordinaryKnown&&ordinaryRequired){knownCost=add(knownCost,{low:ordinary,base:ordinary,high:ordinary});knownComponents++;}
 if(operator>0||operatorKnown&&operatorRequired){knownCost=add(knownCost,{low:operator,base:operator,high:operator});knownComponents++;}
 if(machine>0||machineKnown&&machineRequired){knownCost=add(knownCost,{low:machine,base:machine,high:machine});knownComponents++;}
 let complete=ordinaryKnown&&operatorKnown&&machineKnown;
 if(ref.cost.mode==='STATISTICAL_TOTAL'){
  // Operational prices are supplementary detail, not an addition to this total.
  if(valid(ref.cost,input.today)) {
   knownCost=scale(ref.cost.totalWonPer1000m2,factor);knownComponents=1;
   // An historical total does not resolve this proposal's unregistered wages
   // or equipment rates. Keep the source value, but do not promote it to a
   // complete field comparison until every operating cost basis is known.
   // A historical total smaller than even the known operational subtotal
   // cannot substantiate a complete cost comparison for this actual proposal.
   if(ordinary+operator+machine>knownCost.high){complete=false;gaps.push('STATISTICAL_TOTAL_BELOW_KNOWN_OPERATIONAL_COST');}
  }
  else {knownCost=zero();knownComponents=0;complete=false;gaps.push('CURRENT_STATISTICAL_COST_REFERENCE_REQUIRED');}
  if(ref.cost.basis==='OPERATING_COST'){complete=false;gaps.push('OWN_LABOR_AND_CAPITAL_NOT_INCLUDED');}
  if(ref.cost.exclusions?.length){complete=false;gaps.push(...ref.cost.exclusions.map(e=>'COST_EXCLUDED:'+e));}
  gaps.push(...missingCosts);
 }else{
  for(const component of ref.cost.components){if(valid(component,input.today)){knownCost=add(knownCost,scale(component.wonPer1000m2,factor));knownComponents++;}else {complete=false;missingCosts.push(`CURRENT_COST_REFERENCE_REQUIRED:${component.category}`);}}
  if(ref.cost.coverage==='PARTIAL'){complete=false;missingCosts.push('OTHER_COSTS_INCOMPLETE');}
  gaps.push(...missingCosts);
 }
 const costAmount=knownComponents?money(knownCost):null;
 if([...Object.values(knownCost),ordinary,operator,machine].some(v=>!Number.isFinite(v)))return unknown('ECONOMIC_CALCULATION_OUT_OF_RANGE');
 const balance=revenue&&costAmount?{low:revenue.low-costAmount.high,base:revenue.base-costAmount.base,high:revenue.high-costAmount.low}:null;
 const comparable=!!revenue&&complete&&costAmount!==null;
 const uniqueGaps=[...new Set(gaps)];
 return {
  status:comparable?'ASSESSED' as const:'PARTIAL' as const,comparable,scenarioOnly:true as const,forecast:false as const,
  reference:{version:ref.version,sourceUrl:ref.sourceUrl,asOf:ref.asOf,checkedOn:ref.checkedOn,validUntil:ref.validUntil,sourceDataKind:ref.sourceDataKind,priceBasis:ref.price.basis,priceStage:ref.price.stage,harvestPeriod:ref.harvestPeriod,costMode:ref.cost.mode},
  marketableKg,revenue,wholesaleScenarioValue:ref.price.stage==='WHOLESALE'?value:null,knownCost:costAmount,balanceAfterKnownCosts:balance,unfavorableBalance:balance?.low??null,
  costCoverage:complete?'COMPLETE_REFERENCE' as const:ref.cost.mode==='STATISTICAL_TOTAL'&&costAmount?'REFERENCE_TOTAL_ONLY' as const:'PARTIAL_KNOWN_COSTS' as const,
  operationalCost:{ordinaryLabor:ordinaryKnown?Math.round(ordinary):null,operatorLabor:operatorKnown?Math.round(operator):null,equipment:machineKnown?Math.round(machine):null,additive:ref.cost.mode==='ITEMIZED',missingComponents:[...new Set(missingCosts)]},
  missingComponents:uniqueGaps,metrics:{comparable:Number(comparable),missingComponents:uniqueGaps.length,unfavorableBalanceWon:comparable?balance!.low:null,baseBalanceWon:comparable?balance!.base:null},
 };
}
export type CropEconomicsResult=ReturnType<typeof evaluateCropEconomics>;
