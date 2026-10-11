import {cropCodes,type SupportedCropCode} from './crop-registry';
import type {CoordinationPolicy} from './production-coordination';

/** Reviewed source facts. Never an automatic policy seed or an agronomic approval. */
export const PUBLIC_CRITERIA_VERSION='public-criteria-2026-10-03-v1';
export const PUBLIC_CRITERIA_CHECKED_ON='2026-10-03';
type Bilingual=readonly [string,string];
export type PublicYieldCriterion={
 id:string;crop:SupportedCropCode;commodity:string;basis:Bilingual;years:number[];values:number[];
 kgPer1000m2:{low:number;high:number};sourceUrl:string;locator:string;publishedOn:string;
 qualification:Bilingual;method:'HISTORICAL_NATIONAL_MIN_MAX';
};
const source=(list:number,seq:number)=>`https://mods.go.kr/boardDownload.es?bid=228&list_no=${list}&seq=${seq}`;
function yieldFact(crop:SupportedCropCode,commodity:string,basis:Bilingual,years:number[],values:number[],list:number,seq:number,locator:string,publishedOn:string,qualification:Bilingual):PublicYieldCriterion{
 return {id:`${crop}-${years.at(-1)}-${commodity.toLowerCase()}`,crop,commodity,basis,years,values,kgPer1000m2:{low:Math.min(...values),high:Math.max(...values)},sourceUrl:source(list,seq),locator,publishedOn,qualification,method:'HISTORICAL_NATIONAL_MIN_MAX'};
}
const historical:Bilingual=['전국 연평균 단수의 과거 범위이며 개별 농지의 예측 신뢰구간이 아닙니다.','Historical national means, not a field prediction interval.'];
export const publicYieldCriteria:PublicYieldCriterion[]=[
 yieldFact('rice','MILLED_RICE_92_9',['논벼·현백률 92.9%','Paddy rice, milling yield 92.9%'],[2021,2022,2023,2024,2025],[530,518,523,514,522],439216,3,'통계표 1-가 / PDF 8쪽','2025-11-13',historical),
 yieldFact('potato','FRESH_SPRING_POTATO',['봄감자·생서','Spring potato, fresh tuber'],[2021,2022,2023,2024,2025],[2661,2329,2436,2562,2383],438455,3,'통계표 1 / PDF 8쪽','2025-09-09',['봄감자 기준입니다. 고랭지·가을감자와 합산하거나 대체하지 않습니다.','Spring crop only; do not substitute highland or autumn potatoes.']),
 yieldFact('pepper','PEPPER_STATISTICAL_BASIS',['건조용 홍고추·원 통계 기준','Red pepper grown for drying, statistical basis'],[2021,2022,2023,2024,2025],[278,232,227,258,239],439388,3,'일러두기·고추 표 / PDF 2·6쪽','2025-11-21',['생고추·풋고추 중량으로 임의 환산하지 않습니다.','Do not convert to fresh or green pepper weight.']),
 yieldFact('sesame','SESAME_SEED',['참깨·종실','Sesame seed'],[2021,2022,2023,2024,2025],[53,53,42,48,56],439388,3,'참깨 표 / PDF 8쪽','2025-11-21',historical),
 yieldFact('barley','BARLEY_RAW_ALL_TYPES',['보리 전체·조곡','All barley types, raw grain'],[2025,2026],[365,365],446236,4,'요약·보리 표 / PDF 5·6쪽','2026-07-30',['겉보리·쌀보리·맥주보리의 합계 단수입니다. 두 해의 반올림값이 같아도 수확량이 확정된 것은 아닙니다.','Aggregate barley types. Equal rounded annual means do not mean certain yield.']),
 yieldFact('garlic','GARLIC_ALL_TYPES',['마늘 전체·원 통계 기준','Garlic, all types'],[2025,2026],[1351,1295],446236,4,'요약 / PDF 5쪽','2026-07-30',['한지형·난지형 합계입니다. 품종·지역 단수는 따로 검토합니다.','Aggregates garlic types; review local variety yields separately.']),
 yieldFact('onion','ONION_ALL_TYPES',['양파 전체','Onion, all types'],[2025,2026],[6684,6873],446236,4,'요약 / PDF 5쪽','2026-07-30',['숙기별 합계입니다. 해당 작형 적용 여부를 확인합니다.','Aggregate maturity types; confirm the applicable practice.']),
 yieldFact('cabbage','FRESH_AUTUMN_CABBAGE',['가을배추','Autumn Chinese cabbage'],[2024,2025],[8902,7768],442570,1,'요약 / PDF 5쪽','2025-12-24',['가을 작형만 해당합니다. 봄·고랭지·시설 작형은 제외합니다.','Autumn only; excludes spring, highland and protected cultivation.']),
 yieldFact('radish','FRESH_AUTUMN_RADISH',['가을무','Autumn radish'],[2024,2025],[7243,6423],442570,1,'요약 / PDF 5쪽','2025-12-24',['가을 작형만 해당합니다. 다른 작형 단수로 사용하지 않습니다.','Autumn only; not a yield reference for other practices.']),
 yieldFact('soybean','SOYBEAN_GRAIN',['콩·곡실','Soybean grain'],[2024,2025],[209,211],442570,1,'요약 / PDF 5쪽','2025-12-24',historical),
 yieldFact('apple','APPLE_BEARING_ORCHARD',['사과·수확 과원','Apple, bearing orchard'],[2024,2025],[1912,1933],442570,1,'요약 / PDF 5쪽','2025-12-24',['신규 식재·미성목에 적용하지 않습니다. 품종·수령·결실 상태를 확인합니다.','Not for new or immature orchards; review variety, age and bearing status.']),
 yieldFact('pear','PEAR_BEARING_ORCHARD',['배·수확 과원','Pear, bearing orchard'],[2024,2025],[2092,2373],442570,1,'요약 / PDF 5쪽','2025-12-24',['신규 식재·미성목에 적용하지 않습니다. 품종·수령·결실 상태를 확인합니다.','Not for new or immature orchards; review variety, age and bearing status.']),
];
export const publicRegionalCriteria={
 sourceUrl:'https://www.jangsu.go.kr/index.jangsu',scope:'COUNTY_CONTEXT_ONLY' as const,
 county:'장수군',centerIds:['demo','janggye','cheoncheon','gyenam'],crops:['pepper','apple'] as SupportedCropCode[],
 checkedOn:PUBLIC_CRITERIA_CHECKED_ON,
 review:['군청 농특산물 목록의 확인이며 면별 특화·기후 적합성·우선점수의 근거는 별도 검토합니다.','County specialty listing only; township suitability and preference points require separate review.'] as Bilingual,
};
export const publicCriteriaCoverage=cropCodes.map(crop=>({crop,yield:publicYieldCriteria.some(r=>r.crop===crop)?'SOURCE_CHECKED':'NOT_COLLECTED',supply:'NOT_ESTABLISHED',regionalOperations:'LOCAL_REVIEW_REQUIRED'}));
export function yieldPolicyDraft(id:string):Omit<CoordinationPolicy['yields'][number],'validUntil'>{
 const r=publicYieldCriteria.find(x=>x.id===id);if(!r)throw Error('공개 단수 기준을 확인하세요.');
 return {crop:r.crop,commodity:r.commodity,kgPer1000m2:{...r.kgPer1000m2},sourceUrl:r.sourceUrl,checkedOn:PUBLIC_CRITERIA_CHECKED_ON,
  method:`${PUBLIC_CRITERIA_VERSION}; ${r.years.join(',')} 전국 연평균 kg/1000m²의 최솟값~최댓값. ${r.locator}. ${r.qualification[0]} 예측 신뢰구간·공급 적정량 아님.`};
}
export function regionalPolicyDraft(centerId:string,crop:SupportedCropCode):Omit<CoordinationPolicy['specialties'][number],'validUntil'>{
 if(!publicRegionalCriteria.centerIds.includes(centerId)||!publicRegionalCriteria.crops.includes(crop))throw Error('지역 근거 확인 필요');
 return {centerId,crop,status:'DEVELOPMENT_CANDIDATE',bonus:0,sourceUrl:publicRegionalCriteria.sourceUrl,checkedOn:PUBLIC_CRITERIA_CHECKED_ON,
  method:`${PUBLIC_CRITERIA_VERSION}; 장수군 농특산물 목록 참고. 면별 확인 전 검토 후보이며 가점 0. 적합성·실행 가능성 검토 후 센터가 근거와 유효기간을 확정.`};
}
