import {z} from 'zod';

export const priceSourceUrl='https://www.data.go.kr/data/15156057/openapi.do';
export const priceProducts={
 rice:{name:'쌀',en:'Rice',category:'100',item:'111'},
 potato:{name:'감자',en:'Potato',category:'100',item:'152'},
 pepper:{name:'건고추',en:'Dried pepper',category:'200',item:'241'},
} as const;
export type PriceCrop=keyof typeof priceProducts;
export const evidenceDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const priceQuerySchema=z.object({crop:z.enum(['rice','potato','pepper']),from:evidenceDay,to:evidenceDay}).strict().refine(v=>v.from<=v.to&&Date.parse(v.to)-Date.parse(v.from)<=30*86400000,'한 번에 31일 이내의 기간을 선택하세요.');
export type PriceQuery=z.infer<typeof priceQuerySchema>;
export type PriceObservation={
 id:string;crop:PriceCrop;date:string;categoryCode:string;itemCode:string;itemName:string;
 varietyCode:string;varietyName:string;gradeCode:string;gradeName:string;stageCode:string;stageName:string;
 stage:'WHOLESALE'|'RETAIL'|'OTHER';regionCode:string;regionName:string;marketCode:string;marketName:string;
 unit:string;unitSize:number|null;priceWon:number|null;wonPerKg:number|null;providerWonPerKg:number|null;
 providerUpdatedAt:string;quality:'VALID'|'MISSING_PRICE'|'UNSUPPORTED_UNIT'|'CONVERSION_MISMATCH';
};
export type PriceDay={crop:PriceCrop;date:string;sourceUrl:string;retrievedAt:string;revision:string;observations:PriceObservation[];coverage:'PROVIDER_MARKETS';status:'OBSERVED'|'NO_OBSERVATIONS'};
const numeric=(value:unknown)=>{const s=String(value??'').trim().replace(/,/g,'');return /^\d+(\.\d+)?$/.test(s)&&Number.isFinite(Number(s))&&Number(s)>0?Number(s):null;};
const field=(r:Record<string,unknown>,key:string)=>String(r[key]??'').trim();
export function normalizePrice(raw:unknown,crop:PriceCrop):PriceObservation{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('가격 응답 형식이 잘못되었습니다.');
 const r=raw as Record<string,unknown>,product=priceProducts[crop],compact=field(r,'exmn_ymd');
 const date=evidenceDay.parse(`${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`);
 if(field(r,'ctgry_cd')!==product.category||field(r,'item_cd')!==product.item)throw Error('조회 품목과 응답 품목이 다릅니다.');
 const stageCode=field(r,'se_cd'),unit=field(r,'unit'),unitSize=numeric(r.unit_sz),priceWon=numeric(r.exmn_dd_prc),providerWonPerKg=numeric(r.exmn_dd_cnvs_prc);
 const kg=unitSize===null?null:unit.toLowerCase()==='kg'?unitSize:unit.toLowerCase()==='g'?unitSize/1000:null;
 const converted=priceWon!==null&&kg!==null?priceWon/kg:null;
 // Keep the provider's value but do not silently accept a contradictory conversion.
 const quality=priceWon===null?'MISSING_PRICE':converted===null?'UNSUPPORTED_UNIT':providerWonPerKg!==null&&Math.abs(converted-providerWonPerKg)>Math.max(1,converted*0.005)?'CONVERSION_MISMATCH':'VALID';
 const keys=['vrty_cd','grd_cd','se_cd','sgg_cd','mrkt_cd'];
 if(keys.some(k=>!field(r,k)))throw Error('가격 식별 정보가 누락되었습니다.');
 return {id:[product.item,date,...keys.map(k=>field(r,k)),unit,unitSize??'unknown'].map(encodeURIComponent).join(':'),crop,date,categoryCode:product.category,itemCode:product.item,itemName:field(r,'item_nm'),
  varietyCode:field(r,'vrty_cd'),varietyName:field(r,'vrty_nm'),gradeCode:field(r,'grd_cd'),gradeName:field(r,'grd_nm'),stageCode,stageName:field(r,'se_nm'),stage:stageCode==='02'?'WHOLESALE':stageCode==='01'?'RETAIL':'OTHER',
  regionCode:field(r,'sgg_cd'),regionName:field(r,'sgg_nm'),marketCode:field(r,'mrkt_cd'),marketName:field(r,'mrkt_nm'),unit,unitSize,priceWon,providerWonPerKg,wonPerKg:quality==='VALID'?converted:null,providerUpdatedAt:field(r,'orgnl_reg_dt'),quality};
}
export function priceDays(query:PriceQuery){const out:string[]=[];for(let n=Date.parse(query.from);n<=Date.parse(query.to);n+=86400000)out.push(new Date(n).toISOString().slice(0,10));return out;}
export function uniquePrices(rows:PriceObservation[]){
 const map=new Map<string,PriceObservation>();
 for(const row of rows){const previous=map.get(row.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw Error('동일 가격의 상충하는 개정이 있습니다. 다시 수집하세요.');map.set(row.id,row);}
 return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export type PriceSelection={varietyCode:string;gradeCode:string;stage:'WHOLESALE'|'RETAIL';regionCode:string;marketCode:string};
export const priceEvidenceSchema=z.object({query:priceQuerySchema,selection:z.object({varietyCode:z.string().min(1),gradeCode:z.string().min(1),stage:z.enum(['WHOLESALE','RETAIL']),regionCode:z.string().min(1),marketCode:z.string().min(1)}).strict(),revisions:z.array(z.object({date:evidenceDay,revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(31)}).strict();
export type PriceEvidence=z.infer<typeof priceEvidenceSchema>;
/** One market/grade/variety, equal weight per observed day. No national price or forecast inference. */
export function historicalPriceScenario(rows:PriceObservation[],selection:PriceSelection){
 const selected=uniquePrices(rows).filter(r=>r.varietyCode===selection.varietyCode&&r.gradeCode===selection.gradeCode&&r.stage===selection.stage&&r.regionCode===selection.regionCode&&r.marketCode===selection.marketCode&&r.quality==='VALID'&&r.wonPerKg!==null);
 if(!selected.length)return null;
 if(new Set(selected.map(r=>r.crop)).size!==1||new Set(selected.map(r=>r.itemCode)).size!==1)throw Error('서로 다른 생산물을 결합할 수 없습니다.');
 const byDay=new Map<string,number[]>();for(const r of selected){const values=byDay.get(r.date)??[];values.push(r.wonPerKg!);byDay.set(r.date,values);}
 // Multiple package sizes do not give the same day more statistical weight.
 const values=[...byDay.values()].map(v=>v.reduce((a,b)=>a+b,0)/v.length).sort((a,b)=>a-b),mid=Math.floor(values.length/2);
 return {low:values[0],base:values.length%2?values[mid]:(values[mid-1]+values[mid])/2,high:values.at(-1)!,unit:'KRW_PER_KG' as const,stage:selection.stage,basis:'HISTORICAL_SCENARIO' as const,forecast:false as const,observedDays:values.length,from:[...byDay.keys()].sort()[0],to:[...byDay.keys()].sort().at(-1)!,observationIds:selected.map(r=>r.id),method:'Observed daily minimum / median / maximum; one selected market, variety and grade; not a forecast.'};
}
export function validatePriceEvidence(link:PriceEvidence,days:PriceDay[],price:{low:number;base:number;high:number;stage:string},crop:string){
 if(link.query.crop!==crop||link.selection.stage!=='WHOLESALE'||price.stage!=='WHOLESALE')return false;
 const expected=priceDays(link.query);
 if(link.revisions.length!==expected.length||new Set(link.revisions.map(d=>d.date)).size!==expected.length||expected.some(date=>!link.revisions.some(d=>d.date===date)))return false;
 if(link.revisions.some(r=>!days.some(d=>d.date===r.date&&d.crop===crop&&d.revision===r.revision)))return false;
 const scenario=historicalPriceScenario(days.filter(d=>expected.includes(d.date)&&d.crop===crop).flatMap(d=>d.observations),link.selection);
 return !!scenario&&(['low','base','high'] as const).every(k=>Math.abs(scenario[k]-price[k])<0.00001);
}
