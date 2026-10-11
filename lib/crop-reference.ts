import type {Crop} from './types';
export type Range={low:number;high:number};
export type Period={year:number;quarter?:1|2|3|4};
export type CropReference={id:string;version:string;crop:Crop;practice:string;commodity:string;sourceUrl:string;sourceYears:number[];checkedAt:string;yieldKgPer1000m2:Range;yieldMethod:'HISTORICAL_MIN_MAX_NOT_FORECAST';calendarStatus:'SOURCE_REVIEW_REQUIRED';calendarSourceUrl:string;operations:{name:string;window:null;staff:null;requiresConditionCheck:boolean}[];supplyThreshold:null};
const reference=(id:string,crop:Crop,practice:string,commodity:string,values:number[],sourceUrl:string,names:string[]):CropReference=>({id,version:'public-baseline-v1',crop,practice,commodity,sourceUrl,sourceYears:[2021,2022,2023,2024,2025],checkedAt:'2026-09-08',yieldKgPer1000m2:{low:Math.min(...values),high:Math.max(...values)},yieldMethod:'HISTORICAL_MIN_MAX_NOT_FORECAST',calendarStatus:'SOURCE_REVIEW_REQUIRED',calendarSourceUrl:'https://nongsaro.go.kr/portal/ps/psb/psbl/workScheduleLst.ps?code=210001&menuId=PS00087',operations:names.map(name=>({name,window:null,staff:null,requiresConditionCheck:true})),supplyThreshold:null});
// Official national annual averages. Historical range, NOT field forecast confidence bounds.
// Stored once; no per-request network or LLM calls. No invented supply targets or chemical doses.
export const cropReferences:CropReference[]=[
 reference('rice-paddy','쌀','논벼','MILLED_RICE_92_9',[530,518,523,514,522],'https://www.kostat.go.kr/boardDownload.es?bid=228&list_no=439216&seq=3',['육묘','논 준비','모내기·직파','시비·병해충 확인','수확']),
 reference('potato-spring','감자','봄감자','FRESH_SPRING_POTATO',[2661,2329,2436,2562,2383],'https://sri.kostat.go.kr/boardDownload.es?bid=228&list_no=438455&seq=3',['씨감자 준비','밭 준비','파종','북주기·생육 확인','병해충 확인','굴취·수확']),
 reference('pepper-statistical','고추','고추 생산통계 기준','PEPPER_STATISTICAL_BASIS',[278,232,227,258,239],'https://www.kostat.go.kr/boardDownload.es?bid=228&list_no=439388&seq=3',['육묘','밭 준비','정식','지주·유인','시비·병해충 확인','선택 수확']),
];
export function estimateProduction(areaM2:number,ref:CropReference):Range{
 const {low,high}=ref.yieldKgPer1000m2;
 if(!Number.isFinite(areaM2)||areaM2<=0||!Number.isFinite(low)||!Number.isFinite(high)||low<0||high<low)throw new Error('Invalid area or yield range');
 return {low:areaM2/1000*low,high:areaM2/1000*high};
}
export type Contribution={id:string;referenceId:string;referenceVersion:string;commodity:string;period:Period;areaM2:number;kg:Range;source:'REGISTERED'|'DEMO_ASSUMPTION'};
export type ProductionLedger={version:1;entries:Record<string,Contribution>;totals:Record<string,Range>};
export const emptyLedger=():ProductionLedger=>({version:1,entries:{},totals:{}});
export function periodKey(p:Period){
 if(!Number.isInteger(p.year)||p.year<2000||p.year>2200||(p.quarter!==undefined&&![1,2,3,4].includes(p.quarter)))throw new Error('Invalid period');
 return `${p.year}${p.quarter?`-Q${p.quarter}`:''}`;
}
export const bucketKey=(e:Pick<Contribution,'commodity'|'period'|'source'>)=>`${e.source}:${e.commodity}:${periodKey(e.period)}`;
// Copy-on-write incremental replacement. Existing plans and pinned versions stay untouched.
export function replaceContribution(ledger:ProductionLedger,id:string,next:Contribution|null):ProductionLedger{
 if(!id||['__proto__','constructor','prototype'].includes(id)||(next&&next.id!==id))throw new Error('Invalid contribution id');
 if(next){periodKey(next.period);if(!next.commodity||!Number.isFinite(next.areaM2)||next.areaM2<=0||!Number.isFinite(next.kg.low)||!Number.isFinite(next.kg.high)||next.kg.low<0||next.kg.high<next.kg.low)throw new Error('Invalid contribution');}
 const previous=ledger.entries[id];if(JSON.stringify(previous??null)===JSON.stringify(next))return ledger;
 const result=structuredClone(ledger);
 const adjust=(e:Contribution,sign:number)=>{const key=bucketKey(e),v=result.totals[key]??{low:0,high:0};result.totals[key]={low:Math.max(0,v.low+sign*e.kg.low),high:Math.max(0,v.high+sign*e.kg.high)};};
 if(previous)adjust(previous,-1);delete result.entries[id];
 if(next){result.entries[id]=structuredClone(next);adjust(next,1);}return result;
}
export type SupplyThreshold={commodity:string;period:Period;kg:number;unit:'kg';geography:'KR';sourceUrl:string;validUntil:string;basis:'OFFICIAL'|'DERIVED_REFERENCE';method:string};
export type SupplySignal={status:'INSUFFICIENT_DATA'|'BELOW_REFERENCE'|'POSSIBLE_CONCENTRATION'|'CONCENTRATION';penalty:number;reason:string;scope:'REGISTERED_ONLY'};
export function supplySignal(total:Range,commodity:string,period:Period,threshold:SupplyThreshold|null,now=new Date(),maxPenalty=3):SupplySignal{
 const out=(status:SupplySignal['status'],penalty:number,reason:string):SupplySignal=>({status,penalty,reason,scope:'REGISTERED_ONLY'});
 if(!Number.isFinite(maxPenalty)||maxPenalty<0||maxPenalty>3)throw new Error('Pilot penalty cap must be between 0 and 3');
 if(!threshold||!Number.isFinite(threshold.kg)||threshold.kg<=0||threshold.unit!=='kg'||threshold.geography!=='KR'||threshold.commodity!==commodity||periodKey(threshold.period)!==periodKey(period)||!/^https:\/\//.test(threshold.sourceUrl)||!threshold.method.trim()||!Number.isFinite(Date.parse(threshold.validUntil))||Date.parse(threshold.validUntil)<now.getTime()||!Number.isFinite(total.low)||!Number.isFinite(total.high)||total.low<0||total.high<total.low)return out('INSUFFICIENT_DATA',0,'MISSING_STALE_OR_INCOMPARABLE_REFERENCE');
 if(total.high<=threshold.kg)return out('BELOW_REFERENCE',0,'NOT_PROOF_OF_NATIONAL_BALANCE');
 const certain=total.low>threshold.kg,excess=(certain?total.low:total.high)/threshold.kg-1;
 // Configurable pilot policy; NOT an official economic coefficient or predicted price.
 const penalty=Math.round(Math.min(maxPenalty,Math.max(0,excess)*maxPenalty)*(certain?1:0.5)*100)/100;
 return out(certain?'CONCENTRATION':'POSSIBLE_CONCENTRATION',penalty,'PARTIAL_COVERAGE_CAUTION_ONLY');
}
