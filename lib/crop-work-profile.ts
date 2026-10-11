import {z} from 'zod';
/** Extensible contract only: activation requires a reviewed profile and planner adapter. */
const amount=z.number().finite().nonnegative();
const method=z.object({
 mode:z.enum(['AUTOMATED_WITH_OPERATOR','MACHINE_WITH_OPERATOR','MANUAL']),
 availability:z.enum(['CURRENT','FUTURE_ONLY']),
 capability:z.string().min(1).nullable(),operators:z.number().int().nonnegative(),
 workers:z.number().int().nonnegative(),transportVehicles:z.number().int().nonnegative(),
 minutesPer1000m2:z.number().finite().positive(),setupMinutes:amount,
 sourceUrl:z.url(),
}).strict().superRefine((m,ctx)=>{
 if(m.mode!=='MANUAL'&&(!m.capability||m.operators<1))ctx.addIssue({code:'custom',message:'Equipment requires a capability and an accompanying operator'});
 if(m.mode==='MANUAL'&&(m.workers<1||m.capability!==null))ctx.addIssue({code:'custom',message:'Manual work requires workers and no machine capability'});
});
export const cropWorkProfileSchema=z.object({
 catalogProfileId:z.string().min(1),version:z.string().min(1),region:z.string().min(1),practice:z.string().min(1),
 lifecycle:z.enum(['SEASONAL','PERENNIAL']),
 orchardStage:z.enum(['ESTABLISHMENT','IMMATURE','BEARING']).nullable(),
 status:z.enum(['DRAFT','REVIEWED']),reviewer:z.string().min(1).nullable(),
 sourceUrls:z.array(z.url()).min(1),
 operations:z.array(z.object({
  code:z.string().min(1),name:z.string().min(1),criticality:z.enum(['BLOCKING','YIELD','QUALITY','ROUTINE']),
  trigger:z.enum(['CALENDAR_WINDOW','PHENOLOGY','INSPECTION_REQUIRED']),
  windowBasis:z.string().min(1),predecessors:z.array(z.string()),
  recurrence:z.enum(['ONCE_PER_CULTIVATION','ANNUAL','REPEATED_HARVEST','CONDITIONAL']),
  methods:z.array(method).min(1),
 }).strict()).min(1),
}).strict().superRefine((p,ctx)=>{
 if(p.lifecycle==='PERENNIAL'&&!p.orchardStage)ctx.addIssue({code:'custom',message:'Perennial profile requires orchard stage'});
 if(p.lifecycle==='SEASONAL'&&p.orchardStage)ctx.addIssue({code:'custom',message:'Seasonal profile cannot have orchard stage'});
 if(p.status==='REVIEWED'&&!p.reviewer)ctx.addIssue({code:'custom',message:'Reviewer required'});
 const codes=new Set(p.operations.map(o=>o.code));
 if(codes.size!==p.operations.length)ctx.addIssue({code:'custom',message:'Duplicate operation'});
 const visited=new Set<string>(),active=new Set<string>();
 const visit=(code:string):boolean=>{
  if(active.has(code))return false;if(visited.has(code))return true;
  const op=p.operations.find(o=>o.code===code);if(!op)return false;
  active.add(code);for(const parent of op.predecessors)if(!visit(parent))return false;
  active.delete(code);visited.add(code);return true;
 };
 if(p.operations.some(o=>!visit(o.code)))ctx.addIssue({code:'custom',message:'Missing or cyclic predecessor'});
 if(p.status==='REVIEWED'&&p.operations.some(o=>!o.methods.some(m=>m.availability==='CURRENT')))ctx.addIssue({code:'custom',message:'Future automation alone cannot activate a work profile'});
});
export type CropWorkProfile=z.infer<typeof cropWorkProfileSchema>;
export function currentWorkMethods(profile:CropWorkProfile,code:string){
 const p=cropWorkProfileSchema.parse(profile);
 return p.operations.find(o=>o.code===code)?.methods.filter(m=>m.availability==='CURRENT')??[];
}
