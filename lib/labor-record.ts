import {z} from 'zod';
import {allocateLabor} from './labor';
const candidate=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(60),score:z.literal(100),distanceKm:z.number().min(0).max(1000).nullable(),recentAssignments:z.literal(0),eligible:z.boolean(),response:z.enum(['NONE','APP','PHONE'])}).strict();
export const laborRecord=z.object({people:z.array(candidate).max(1000),count:z.number().int().min(1).max(100),date:z.string().max(10),task:z.string().max(300),hours:z.string().max(100),pay:z.string().max(100),opened:z.boolean(),confirmed:z.boolean()}).strict().superRefine((d,ctx)=>{
 if(new Set(d.people.map(p=>p.id)).size!==d.people.length)ctx.addIssue({code:'custom',message:'Duplicate person ID'});
 if(d.opened&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date||!d.task.trim()||!d.hours.trim()||!d.pay.trim()))ctx.addIssue({code:'custom',message:'Invitation details required'});
 if(!d.opened&&d.people.some(p=>p.response!=='NONE'))ctx.addIssue({code:'custom',message:'Invitation must precede responses'});
 if(d.confirmed&&(!d.opened||!allocateLabor(d.people,d.count).selected.length))ctx.addIssue({code:'custom',message:'No eligible applicants'});
});
export type LaborRecord=z.infer<typeof laborRecord>;
export const emptyLabor=():LaborRecord=>({people:[],count:2,date:'',task:'',hours:'',pay:'',opened:false,confirmed:false});
