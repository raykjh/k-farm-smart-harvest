import {z} from 'zod';

/** A source directory is not an agronomic approval or an executable profile. */
export const catalogVersion='crop-catalog-v1';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const cropProfileSchema=z.object({
 id:z.string().min(1),version:z.string().min(1),name:z.string().min(1),
 category:z.enum(['PADDY','UPLAND','VEGETABLE','ORCHARD']),
 lifecycle:z.enum(['SEASONAL','PERENNIAL','UNREVIEWED']),
 practice:z.string().min(1),region:z.string().nullable(),variety:z.string().nullable(),
 source:z.object({publisher:z.string(),url:z.url(),checkedOn:date,scope:z.literal('DIRECTORY_ONLY'),reuse:z.literal('TERMS_REVIEW_REQUIRED')}).strict(),
 legacyPlanner:z.enum(['rice','potato','pepper']).nullable(),
 // Null means unknown, never zero yield or no work required.
 yieldKgPer1000m2:z.object({low:z.number().nonnegative(),high:z.number().nonnegative(),commodity:z.string(),sourceUrl:z.url()}).refine(x=>x.high>=x.low).nullable(),
 orchard:z.object({establishment:z.enum(['NEW','EXISTING','UNREVIEWED']),treeAgeYears:z.number().nonnegative().nullable(),bearing:z.enum(['IMMATURE','BEARING','UNREVIEWED']),occupancyEnd:date.nullable()}).strict().nullable(),
 status:z.enum(['CATALOG_ONLY','LEGACY_PROFILE_REVIEW_REQUIRED']),
}).strict();
export type CropProfile=z.infer<typeof cropProfileSchema>;

// Names and source links only. Do not reproduce the source's restricted calendar text.
const directories:[CropProfile['category'],string,string][]=[
 ['PADDY','210004','녹두|들깨|벼 기계이앙재배|벼 직파재배|사료용벼|옥수수|참깨|콩(논재배)|팥'],
 ['UPLAND','210005','감자|강낭콩|고구마|녹두|들깨(잎)|들깨(종실)|땅콩|맥주보리|메밀|밀|수수|옥수수|완두|유채|일반보리|조|참깨|콩|팥|풋콩'],
 ['VEGETABLE','210001','가지|갓|결구상추|고들빼기|고사리|고추(꽈리고추 반촉성)|고추(보통재배)|고추(촉성재배)|곰취|근대|냉이|당근|두릅|딸기(사계성여름재배)|딸기(촉성재배)|마늘|마늘(잎마늘)|멜론|무|무(고랭지재배)|미나리|배추|배추(고랭지재배)|부추|브로콜리(녹색꽃양배추 고랭지재배)|브로콜리(평야지재배)|비트|상추|생강|셀러리(양미나리)|수박|시금치|신선초|쑥갓|아스파라거스|아욱|양배추|양파|연근|오이|적채|쪽파|참외|참취|청경채|치커리(쌈용, 잎치커리)|치커리(치콘,뿌리치커리)|컬리플라워(백색꽃양배추 고랭지재배)|토란|토마토,방울토마토|파|파드득나물|파슬리(향미나리)|파프리카|피망|호박|호박(늙은호박)|호박(단호박)'],
 ['ORCHARD','210002','감귤(노지재배)|감귤(시설재배)|단감|매실|무화과(노지재배)|무화과(무가온 시설재배)|배|복숭아|블루베리|사과|살구|양앵두(체리)|유자|자두|참다래|포도(무가온)|포도(표준가온)|플럼코트|한라봉(부지화)'],
];
export const cropCatalog:CropProfile[]=directories.flatMap(([category,code,names])=>names.split('|').map(name=>{
 const legacyPlanner=category==='PADDY'&&name==='벼 기계이앙재배'?'rice':category==='UPLAND'&&name==='감자'?'potato':name==='고추(보통재배)'?'pepper':null;
 return cropProfileSchema.parse({id:`nongsaro:${code}:${name}`,version:catalogVersion,name,category,
 lifecycle:category==='ORCHARD'?'PERENNIAL':'UNREVIEWED',practice:name,region:null,variety:null,
 source:{publisher:'농촌진흥청 농사로',url:`https://nongsaro.go.kr/portal/ps/psb/psbl/workScheduleLst.ps?code=${code}&menuId=PS00087`,checkedOn:'2026-09-20',scope:'DIRECTORY_ONLY',reuse:'TERMS_REVIEW_REQUIRED'},
 legacyPlanner,yieldKgPer1000m2:null,orchard:category==='ORCHARD'?{establishment:'UNREVIEWED',treeAgeYears:null,bearing:'UNREVIEWED',occupancyEnd:null}:null,status:legacyPlanner?'LEGACY_PROFILE_REVIEW_REQUIRED':'CATALOG_ONLY'});
}));
export function legacyCatalogProfile(crop:string){return cropCatalog.find(c=>c.legacyPlanner===crop)??null;}

/** Reviewed comparison is scoped to a particular region, practice and area band. */
export const serviceReviewSchema=z.object({
 profileId:z.string(),region:z.string().trim().min(1),practice:z.string().trim().min(1),
 minAreaM2:z.number().positive(),maxAreaM2:z.number().positive(),reviewedBy:z.string().trim().min(1),
 validUntil:date,evidenceUrls:z.array(z.url()).min(1),
 deliverable:z.enum(['YES','NO','UNKNOWN']),
 smartFarm:z.enum(['CLEARLY_BETTER','NOT_CLEARLY_BETTER','UNKNOWN']),
 cooperativeBenefit:z.enum(['BETTER','NOT_BETTER','UNKNOWN']),
 rationale:z.string().trim().min(1),commercialReuseCleared:z.boolean(),
}).strict().refine(v=>v.maxAreaM2>=v.minAreaM2);
export type ServiceReview=z.infer<typeof serviceReviewSchema>;
export function assessCropService(profile:CropProfile,raw:unknown,context:{region:string;practice:string;areaM2:number;today:string}){
 const result=(decision:'REVIEW_REQUIRED'|'OUT_OF_SCOPE'|'SMART_FARM_FIRST'|'KFARM_CANDIDATE',reason:string)=>({decision,reason,automaticScheduling:false as const});
 const parsed=serviceReviewSchema.safeParse(raw);
 if(!date.safeParse(context.today).success||!Number.isFinite(context.areaM2)||context.areaM2<=0||!parsed.success)return result('REVIEW_REQUIRED','MISSING_VALID_COMPARISON');
 const r=parsed.data;
 if(r.profileId!==profile.id||r.region!==context.region||r.practice!==context.practice||r.validUntil<context.today||context.areaM2<r.minAreaM2||context.areaM2>r.maxAreaM2)return result('REVIEW_REQUIRED','STALE_OR_DIFFERENT_SCOPE');
 if(r.smartFarm==='CLEARLY_BETTER')return result('SMART_FARM_FIRST','REVIEWED_COMPARISON');
 if(r.deliverable==='NO'||r.cooperativeBenefit==='NOT_BETTER')return result('OUT_OF_SCOPE','NO_CONFIRMED_SERVICE_ADVANTAGE');
 if(r.deliverable==='UNKNOWN'||r.smartFarm==='UNKNOWN'||r.cooperativeBenefit==='UNKNOWN'||!r.commercialReuseCleared)return result('REVIEW_REQUIRED','INCOMPLETE_SERVICE_EVIDENCE');
 return result('KFARM_CANDIDATE','REGIONAL_OPERATIONS_AND_RESOURCE_CHECK_STILL_REQUIRED');
}
