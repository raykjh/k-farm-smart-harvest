import {z} from 'zod';
import {fieldConditions} from './field-conditions';
import {optionalCropSchema} from './crop-registry';
export const fieldEntry=z.object({
 pnu:z.string().regex(/^\d{19}$/),address:z.string().trim().min(1).max(200),
 crop:optionalCropSchema,group:z.string().max(60),
 area:z.number().positive().max(10000000).nullable(),mode:z.enum(['joint','full']),
 rights:z.literal('pending'),
 consultationId:z.string().uuid().optional(),
 conditions:fieldConditions.optional(),
}).strict();
export const fieldInventory=z.array(fieldEntry).max(1000).superRefine((items,ctx)=>{
 if(new Set(items.map(p=>p.pnu)).size!==items.length)ctx.addIssue({code:'custom',message:'중복 PNU'});
 const groups=new Set(items.map(p=>p.group).filter(Boolean));
 for(const id of groups){const g=items.filter(p=>p.group===id);if(g.length<2||!g[0].crop||g.some(p=>p.crop!==g[0].crop))ctx.addIssue({code:'custom',message:'같은 작물 2필지 이상 필요'});}
});
export type FieldEntry=z.infer<typeof fieldEntry>;
