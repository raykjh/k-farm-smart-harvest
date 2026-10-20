import {nationalReferencesSchema,type NationalReference} from './production-evidence';

/** Checked numeric facts, not a price forecast, farm budget or policy approval.
 * Dates are deliberately fixed. A new month needs a reviewed version; runtime
 * never searches, extends expiry, or promotes an excluded source automatically. */
export const CROP_EVIDENCE_VERSION='rice-potato-pepper-2026-10-20-v1';
export const CROP_EVIDENCE_CHECKED_ON='2026-10-20';
export const CROP_EVIDENCE_REVIEW_UNTIL='2026-10-31';
export const focusedEvidenceCrops=['rice','potato','pepper'] as const;
const source={
 rice:{url:'https://aglook.krei.re.kr/upload/observeFiles/00172bedc3bf4cd89123eab359648905.pdf',asOf:'2026-09-28',sha256:'64dfd91009ec4dc34a4b1672ca41e751a65972ede729517bcc1f70ad87892e80',reuse:'REVIEW_REQUIRED'},
 potato:{url:'https://aglook.krei.re.kr/upload/observeFiles/50ddd04a374c45c9b382130f677113eb.pdf',asOf:'2026-09-28',sha256:'8915fdd3dc79e9d22a0a7fdb4d8f7765545b8a19d6eeb9e174eb364d4f987104',reuse:'REVIEW_REQUIRED'},
 pepper:{url:'https://aglook.krei.re.kr/upload/observeFiles/6dcd8ac031434a1fba37d174aae5991b.pdf',asOf:'2026-10-02',sha256:'5e95d208cb8a82f3af22d06fa2a505dd8d9fd4d7072e3395697044390cf1aaed',reuse:'ALLOWED'},
} as const;
export const cropEvidenceSources={...source,pepperReuse:'https://www.data.go.kr/data/15093889/fileData.do'};
type Crop=typeof focusedEvidenceCrops[number];
function fact(crop:Crop,commodity:string,from:string,to:string,unit:NationalReference['unit'],metric:NationalReference['facts']['metric'],value:number,priceStage:NationalReference['priceStage']=null):NationalReference{
 const s=source[crop];
 return {crop,sourceUrl:s.url,asOf:s.asOf,checkedOn:CROP_EVIDENCE_CHECKED_ON,validUntil:CROP_EVIDENCE_REVIEW_UNTIL,observationPeriod:{from,to},harvestPeriod:null,commodity,unit,version:CROP_EVIDENCE_VERSION,origin:'OBSERVED',geography:'KR',reuse:s.reuse,priceStage,facts:{metric,value}};
}
const price=(crop:Crop,commodity:string,from:string,to:string,value:number,unit:NationalReference['unit'],stage:NationalReference['priceStage'])=>fact(crop,commodity,from,to,unit,'PRICE',value,stage);
const outlook=(crop:Crop,commodity:string,metric:NationalReference['facts']['metric'],unit:NationalReference['unit'],value:number,from:string,to:string):NationalReference=>({...fact(crop,commodity,source[crop].asOf,source[crop].asOf,unit,metric,value),origin:'OUTLOOK',harvestPeriod:{from,to}});
const ricePrices=[
 price('rice','MILLED_RICE_PRODUCING_AREA','2026-06-01','2026-06-30',57124,'KRW/20kg','PRODUCING_AREA'),
 price('rice','MILLED_RICE_PRODUCING_AREA','2026-07-01','2026-07-31',57006,'KRW/20kg','PRODUCING_AREA'),
 price('rice','MILLED_RICE_PRODUCING_AREA','2026-08-01','2026-08-31',56910,'KRW/20kg','PRODUCING_AREA'),
 price('rice','MILLED_RICE_PRODUCING_AREA','2026-09-15','2026-09-15',56612,'KRW/20kg','PRODUCING_AREA'),
];
const potatoPrices=[53731,59350,75526,74827,50746,28078,29523,30656,29542].map((value,index)=>{
 const month=String(index+1).padStart(2,'0'),last=index===8?'28':String(new Date(Date.UTC(2026,index+1,0)).getUTCDate());
 // Garak market, all potato practices, premium grade: NOT spring farm receipts.
 return price('potato','POTATO_ALL_PRACTICES_GARAK_HIGH_GRADE',`2026-${month}-01`,`2026-${month}-${last}`,value,'KRW/20kg','WHOLESALE');
});
export const savedNationalCropReferences=nationalReferencesSchema.parse([
 ...ricePrices,
 fact('rice','PADDY_RICE_AREA','2026-08-27','2026-08-27','ha','CULTIVATED_AREA',670069),
 {...outlook('rice','MILLED_RICE_92_9','YIELD','kg/10a',523,'2026-09-28','2026-12-31'),facts:{metric:'YIELD',low:521,high:525}},
 ...potatoPrices,
 outlook('potato','FRESH_HIGHLAND_POTATO','PRODUCTION','tonne',154254,'2026-09-28','2026-10-31'),
 price('pepper','DRIED_RED_PEPPER_HOT_AIR_HIGH_GRADE','2026-08-01','2026-08-31',13908,'KRW/600g','WHOLESALE'),
 price('pepper','DRIED_RED_PEPPER_HOT_AIR_HIGH_GRADE','2026-09-01','2026-09-30',13639,'KRW/600g','WHOLESALE'),
 fact('pepper','DRIED_RED_PEPPER','2026-09-30','2026-09-30','ha','CULTIVATED_AREA',25376),
 outlook('pepper','DRIED_RED_PEPPER','PRODUCTION','tonne',60649,'2026-10-02','2026-10-31'),
 outlook('pepper','DRIED_RED_PEPPER','YIELD','kg/10a',239,'2026-10-02','2026-10-31'),
 {...outlook('pepper','DRIED_RED_PEPPER_HOT_AIR_HIGH_GRADE','PRICE','KRW/600g',13400,'2026-10-02','2026-10-31'),priceStage:'WHOLESALE'},
]);

/** Sources for review remain separate from executable plot/climate approval. */
export const focusedCropEvidenceScope={
 version:CROP_EVIDENCE_VERSION,crops:focusedEvidenceCrops,checkedOn:CROP_EVIDENCE_CHECKED_ON,validUntil:CROP_EVIDENCE_REVIEW_UNTIL,
 workCriteria:'EXISTING_CROP_GUIDELINES_AND_REVIEWED_PRODUCTION_PROFILES',
 specialty:{sourceUrl:'https://council.jangsu.go.kr/caster/xc_realdoc.xdo?m_chasu=4&m_code=A101&m_ymd=2023-01-12',asOf:'2023-01-12',centerId:'cheoncheon',crop:'pepper',status:'HISTORICAL_REVIEW_LEAD',automaticBonus:0,currentDesignation:'REVIEW_REQUIRED'},
 climate:{rice:{sourceUrl:'https://www.rda.go.kr/middlePopOpenPopNongsaroDBView.do?no=1905',scope:'POST_HEADING_RESEARCH_NOT_LOCAL_NORMALS'},potato:{sourceUrl:'https://www.rda.go.kr/middlePopOpenPopNongsaroDBView.do?no=1839',scope:'SEED_PREPARATION_NOT_OUTDOOR_PLANTING'},pepper:{scope:'LOCAL_REVIEW_REQUIRED'},localNormals:'NOT_SELECTED',schedulingEnabled:false},
 unresolved:['LOCAL_MARKETABLE_YIELD','FARM_GATE_PRICE_CONTRACT','REGISTERED_COST_RATES','LOCAL_CLIMATE_REVIEW','RICE_POTATO_REUSE_REVIEW'],
} as const;
