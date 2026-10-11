import {z} from 'zod';
import type {FieldConditions} from './field-conditions';
import type {CropCode} from './crop-guidelines';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const regionalProfileSchema=z.object({
 region:z.string().trim().min(1).max(100),version:z.string().trim().min(1).max(100),
 sourceUrl:z.string().url().max(1000),reviewer:z.string().trim().min(1).max(100),reviewedOn:date,
 validFrom:date,validUntil:date,station:z.string().trim().min(1).max(100),normalPeriod:z.string().trim().min(1).max(100),
 varieties:z.object({rice:z.string().min(1).optional(),potato:z.string().min(1).optional(),pepper:z.string().min(1).optional()}).strict(),
}).strict().refine(p=>p.validFrom<=p.validUntil,'지역 기준 유효기간 오류');
export type RegionalProfile=z.infer<typeof regionalProfileSchema>;
export function validateRegionalProfile(raw:RegionalProfile,crop:CropCode,dates:string[],conditions?:FieldConditions){
 const p=regionalProfileSchema.parse(raw);
 if(conditions?.region&&conditions.region!==p.region)throw Error('농지와 작업 기준의 지역이 다릅니다.');
 if(!p.varieties[crop])throw Error('지역 기준의 작물·품종 확인이 필요합니다.');
 if(p.reviewedOn>new Date(Date.now()+9*3600000).toISOString().slice(0,10))throw Error('지역 기준 확인일 오류');
 if(dates.some(d=>d<p.validFrom||d>p.validUntil))throw Error('지역 작업 기준 유효기간을 벗어났습니다.');
 return p;
}
