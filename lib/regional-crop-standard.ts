import {z} from 'zod';
import {cropCatalog} from './crop-catalog';
import {environmentRuleSchema} from './environment-window';
const text=z.string().trim().min(1).max(500);
const url=z.url().refine(v=>/^https?:\/\//.test(v));
const day=z.string().regex(/^\d{2}-\d{2}$/).refine(v=>{const d=new Date(`2000-${v}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(5,10)===v;});
export const regionalOperationSchema=z.object({
 code:text,name:text,from:z.union([day,z.literal('')]),to:z.union([day,z.literal('')]),crossYear:z.boolean(),
 timingMode:z.enum(['CALENDAR_OVERRIDE','ENVIRONMENT']).optional(),environment:environmentRuleSchema.nullable().optional(),
 minTemperatureC:z.number().min(-50).max(60).nullable(),maxTemperatureC:z.number().min(-50).max(60).nullable(),
 basis:text,mode:z.enum(['MANUAL','MACHINE_WITH_OPERATOR','AUTOMATED_WITH_OPERATOR']),
 capability:z.string().trim().max(200),workers:z.number().int().min(0).max(1000),operators:z.number().int().min(0).max(100),
 minutesPer1000m2:z.number().positive().max(100000),sourceUrl:url,
}).strict().superRefine((v,c)=>{
 if(v.timingMode==='ENVIRONMENT'){
  if(!v.environment)c.addIssue({code:'custom',message:'환경 조건을 입력하세요.'});
 }else if(!v.from||!v.to||(v.from>v.to)!==v.crossYear)c.addIssue({code:'custom',message:'작업기간과 연도 넘김 여부를 확인하세요.'});
 if(v.minTemperatureC!==null&&v.maxTemperatureC!==null&&v.minTemperatureC>v.maxTemperatureC)c.addIssue({code:'custom',message:'기온 범위가 역전되었습니다.'});
 if(v.mode==='MANUAL'&&v.workers<1)c.addIssue({code:'custom',message:'인력 작업에는 최소 1명이 필요합니다.'});
 if(v.mode!=='MANUAL'&&(!v.capability||v.operators<1))c.addIssue({code:'custom',message:'장비 작업에는 장비 기능과 운영담당자가 필요합니다.'});
});
export const regionalStandardSchema=z.object({
 catalogProfileId:text,region:z.string().trim().max(500),scope:z.enum(['COMMON','REGIONAL_OVERRIDE']).optional(),practice:text,variety:z.string().trim().max(200),
 status:z.enum(['DRAFT','REVIEWED']),reviewer:z.string().trim().max(100),
 orchardStage:z.enum(['ESTABLISHMENT','IMMATURE','BEARING']).nullable(),
 yieldLowKgPer1000m2:z.number().nonnegative().nullable(),yieldHighKgPer1000m2:z.number().nonnegative().nullable(),
 sourceUrls:z.array(url).max(30),notes:z.string().trim().max(5000),
 operations:z.array(regionalOperationSchema).max(100),
}).strict().superRefine((v,c)=>{
 const crop=cropCatalog.find(p=>p.id===v.catalogProfileId);
 if(v.scope!=='COMMON'&&!v.region)c.addIssue({code:'custom',message:'지역 보정 기준에는 지역을 입력하세요.'});
 if(!crop)c.addIssue({code:'custom',message:'카탈로그의 작물을 선택하세요.'});
 if(crop?.category==='ORCHARD'&&!v.orchardStage)c.addIssue({code:'custom',message:'과수 생육 단계를 선택하세요.'});
 if(crop?.category!=='ORCHARD'&&v.orchardStage)c.addIssue({code:'custom',message:'과수가 아닌 작물에는 과수 단계를 지정할 수 없습니다.'});
 const lo=v.yieldLowKgPer1000m2,hi=v.yieldHighKgPer1000m2;
 if((lo===null)!==(hi===null)||(lo!==null&&hi!==null&&lo>hi))c.addIssue({code:'custom',message:'수확량은 양쪽 범위를 입력하거나 모두 비워두세요.'});
 if(new Set(v.operations.map(o=>o.code)).size!==v.operations.length)c.addIssue({code:'custom',message:'작업 코드가 중복되었습니다.'});
 if(v.status==='REVIEWED'&&(!v.reviewer||!v.sourceUrls.length||!v.operations.length))c.addIssue({code:'custom',message:'검토 완료에는 검토자·출처·작업 기준이 필요합니다.'});
});
export type RegionalStandard=z.infer<typeof regionalStandardSchema>;
export type SavedRegionalStandard={id:string;version:number;updatedAt:string;profile:RegionalStandard};
export const saveRegionalStandardSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),profile:regionalStandardSchema}).strict();
