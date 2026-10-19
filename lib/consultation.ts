import {z} from 'zod';
import {fieldConditions} from './field-conditions';
import {optionalCropSchema} from './crop-registry';
import {parcelBoundarySchema} from './parcel-boundary';
const text=z.string().max(200);
const date=z.string().refine(v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),'Invalid date');
export const consultationSchema=z.object({
 application:z.object({policy:z.literal('OWNER_SERVICE_V1'),residence:text,cultivationHistory:text,supportReason:text,exceptionReason:text,review:z.literal('pending')}).strict().optional(),
 farmer:z.object({name:text,birth:date.refine(v=>!v||v<=new Date().toISOString().slice(0,10),'Future birth date'),phone:z.string().max(40),contact:z.enum(['sms','phone','app'])}).strict(),
fields:z.array(z.object({id:z.string().uuid(),pnu:z.string().regex(/^(?:\d{19})?$/),address:text,area:z.string().max(30).refine(v=>!v||(Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=10000000)),crop:optionalCropSchema,mode:z.enum(['joint','delegated']),tenure:z.enum(['unknown','owned','lease','family','other']),ownerName:text,ownerPhone:z.string().max(40),evidence:z.enum(['none','ownership','lease','free','authorization','family']),end:date,callAt:z.string().max(30),operator:text,callResult:z.enum(['pending','confirmed','refused','unreachable']),scope:text,verified:z.literal('pending'),conditions:fieldConditions.optional(),boundary:parcelBoundarySchema.optional()}).strict()).max(30),
 consent:z.boolean(),step:z.number().int().min(0).max(3),
}).strict().superRefine((v,ctx)=>{
 if(new Set(v.fields.map(f=>f.id)).size!==v.fields.length)ctx.addIssue({code:'custom',message:'Duplicate field ID'});
 const pnus=v.fields.map(f=>f.pnu).filter(Boolean);if(new Set(pnus).size!==pnus.length)ctx.addIssue({code:'custom',message:'Duplicate PNU'});
});
export type Consultation=z.infer<typeof consultationSchema>;
