import {z} from 'zod';
import {cropCodeSchema,type SupportedCropCode} from './crop-registry';

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const text=z.string().trim().min(1).max(500);
const period=z.object({from:day,to:day}).strict().refine(value=>value.from<=value.to,{message:'자료 기간의 시작·종료일 확인 필요'});
const amount=z.number().finite().nonnegative();
const unitSchema=z.enum(['ha','tonne','kg/10a','KRW/kg','KRW/20kg','KRW/600g','KRW/10a','percent']);
const metricSchema=z.enum(['CULTIVATED_AREA','PRODUCTION','YIELD','PRICE','PRODUCTION_COST','LABOR_COST','REVENUE','YEAR_ON_YEAR_CHANGE']);
const unitsByMetric:Record<z.infer<typeof metricSchema>,readonly z.infer<typeof unitSchema>[]>= {
 CULTIVATED_AREA:['ha'],PRODUCTION:['tonne'],YIELD:['kg/10a'],PRICE:['KRW/kg','KRW/20kg','KRW/600g'],
 PRODUCTION_COST:['KRW/10a'],LABOR_COST:['KRW/10a'],REVENUE:['KRW/10a'],YEAR_ON_YEAR_CHANGE:['percent'],
};

/** One metric and exact commodity/unit per row. No conversion or operational preset. */
export const nationalReferenceSchema=z.object({
 crop:cropCodeSchema,sourceUrl:z.string().url().refine(value=>value.startsWith('https://')),
 asOf:day,checkedOn:day,validUntil:day,observationPeriod:period,harvestPeriod:period.nullable(),
 commodity:text,unit:unitSchema,version:text,origin:z.enum(['OBSERVED','OUTLOOK']),geography:z.literal('KR'),
 reuse:z.enum(['ALLOWED','REVIEW_REQUIRED']),
 priceStage:z.enum(['FARM_GATE','PRODUCING_AREA','WHOLESALE','RETAIL']).nullable(),
 facts:z.object({metric:metricSchema,value:z.number().finite().optional(),low:z.number().finite().optional(),high:z.number().finite().optional(),yearOnYearPct:z.number().finite().min(-100).optional()}).strict(),
}).strict().superRefine((row,ctx)=>{
 const issue=(path:(string|number)[],message:string)=>ctx.addIssue({code:'custom',path,message});
 if(row.asOf>row.checkedOn||row.checkedOn>row.validUntil)issue(['checkedOn'],'자료기준일·검토일·유효기간 확인 필요');
 if(row.observationPeriod.to>row.asOf)issue(['observationPeriod'],'관측 대상 기간은 자료기준일 이후일 수 없습니다.');
 if(row.origin==='OBSERVED'&&row.harvestPeriod!==null)issue(['harvestPeriod'],'과거 관측을 수확 전망으로 자동 전환할 수 없습니다.');
 if(row.origin==='OUTLOOK'&&(!row.harvestPeriod||row.harvestPeriod.to<row.asOf))issue(['harvestPeriod'],'전망에는 자료기준일에 유효한 수확 적용기간이 필요합니다.');
 if(!unitsByMetric[row.facts.metric].includes(row.unit))issue(['unit'],'지표와 단위가 일치하지 않습니다.');
 if((row.facts.metric==='PRICE')!==(row.priceStage!==null))issue(['priceStage'],'가격에는 유통단계가 필요하며 다른 지표와 혼합할 수 없습니다.');
 const {value,low,high}=row.facts;
 if((low===undefined)!==(high===undefined))issue(['facts'],'범위의 낮음·높음 값이 모두 필요합니다.');
 if(low!==undefined&&high!==undefined&&(low>high||(value!==undefined&&(value<low||value>high))))issue(['facts'],'관측값·범위의 순서 확인 필요');
 if(row.facts.metric!=='YEAR_ON_YEAR_CHANGE'&&[value,low,high].some(v=>v!==undefined&&!amount.safeParse(v).success))issue(['facts'],'면적·물량·가격·비용은 음수일 수 없습니다.');
 if(row.facts.metric==='YEAR_ON_YEAR_CHANGE'&&[value,low,high].some(v=>v!==undefined&&v< -100))issue(['facts'],'증감률은 -100%보다 작을 수 없습니다.');
});
export type NationalReference=z.infer<typeof nationalReferenceSchema>;

// A changed version does not turn the same source observation into a second fact.
const identity=(row:NationalReference)=>JSON.stringify([row.crop,row.sourceUrl,row.commodity,row.unit,row.origin,row.facts.metric,row.priceStage,row.observationPeriod,row.harvestPeriod]);
export const nationalReferencesSchema=z.array(nationalReferenceSchema).max(300).superRefine((rows,ctx)=>{
 const seen=new Set<string>();
 rows.forEach((row,index)=>{const key=identity(row);if(seen.has(key))ctx.addIssue({code:'custom',path:[index],message:'동일 전국 근거가 중복됩니다.'});seen.add(key);});
});
export type NationalReferenceExclusion={sourceUrl:string;version:string;reasons:string[]};
export type NationalReferenceSelection={
 scope:'NATIONAL_BACKGROUND_ONLY';status:'AVAILABLE'|'INSUFFICIENT_DATA';references:NationalReference[];
 excluded:NationalReferenceExclusion[];forecastSupport:'NOT_ASSESSED_FOR_HARVEST';participatingDemandCap:null;
};

/**
 * Historical facts stay background. Even a reviewed outlook needs a separate
 * exact commodity/full harvest-period check before any planning application.
 * This function cannot supply a price forecast, a safety score or a demand cap.
 */
export function selectNationalReferences(crop:SupportedCropCode,today:string,references:readonly unknown[]):NationalReferenceSelection{
 cropCodeSchema.parse(crop);day.parse(today);
 const selected:NationalReference[]=[],excluded:NationalReferenceExclusion[]=[];
 const candidates:NationalReference[]=[];
 for(const item of references){
  const parsed=nationalReferenceSchema.safeParse(item);
  if(!parsed.success){
   const raw=typeof item==='object'&&item!==null?item as Record<string,unknown>:{};
   if(raw.crop===crop||raw.crop===undefined)excluded.push({sourceUrl:typeof raw.sourceUrl==='string'?raw.sourceUrl:'UNKNOWN',version:typeof raw.version==='string'?raw.version:'UNKNOWN',reasons:['INVALID_REFERENCE_CONTRACT']});
   continue;
  }
  if(parsed.data.crop===crop)candidates.push(parsed.data);
 }
 const counts=new Map<string,number>();
 for(const row of candidates){const key=identity(row);counts.set(key,(counts.get(key)??0)+1);}
 for(const row of candidates){
  const reasons:string[]=[];
  if(references.length>300)reasons.push('REFERENCE_LIMIT_EXCEEDED');
  if((counts.get(identity(row))??0)>1)reasons.push('DUPLICATE_REFERENCE');
  if(row.asOf>today||row.checkedOn>today)reasons.push('FUTURE_REFERENCE');
  if(row.validUntil<today)reasons.push('EXPIRED_REFERENCE');
  if(row.reuse!=='ALLOWED')reasons.push('REUSE_REVIEW_REQUIRED');
  if(reasons.length)excluded.push({sourceUrl:row.sourceUrl,version:row.version,reasons});else selected.push(row);
 }
 const compare=(a:unknown,b:unknown)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;};
 selected.sort(compare);excluded.sort(compare);
 const hasNumericFact=selected.some(row=>row.facts.value!==undefined||row.facts.low!==undefined||row.facts.yearOnYearPct!==undefined);
 return {scope:'NATIONAL_BACKGROUND_ONLY',status:hasNumericFact?'AVAILABLE':'INSUFFICIENT_DATA',references:selected,excluded,forecastSupport:'NOT_ASSESSED_FOR_HARVEST',participatingDemandCap:null};
}
