import type {Prisma} from '@prisma/client';
import {isDeepStrictEqual} from 'node:util';
import {DEMO_BATCH} from './registered-demo';
import {fieldInventory,type FieldEntry} from './field-record';
import {consultationSchema} from './consultation';
import {z} from 'zod';
type Tx=Prisma.TransactionClient;
type RecordRow={kind:string;id:string;version:number;payload:any};
const manifestSchema=z.object({fields:fieldInventory,consultations:z.array(z.object({id:z.string().min(1),payload:consultationSchema})),simulated:z.literal(true)});
/** Pure preflight, also repeated inside the removal transaction. */
export function verifiedDemoRegistrations(records:RecordRow[]){
 const manifest=records.find(r=>r.kind==='demoManifest'&&r.id===DEMO_BATCH);
 if(!manifest)throw Error('Missing demo manifest');
 const parsed=manifestSchema.safeParse(manifest.payload);
 if(!parsed.success||!parsed.data.fields.length||!parsed.data.consultations.length||new Set(parsed.data.consultations.map(c=>c.id)).size!==parsed.data.consultations.length)throw Error('Invalid demo manifest');
 const {fields,consultations}=parsed.data,current=records.find(r=>r.kind==='fields'&&r.id==='current');
 if(!current||!fieldInventory.safeParse(current.payload).success)throw Error('Invalid field inventory');
 for(const f of fields){const saved=(current.payload as FieldEntry[]).find(x=>x.pnu===f.pnu);if(!saved||!isDeepStrictEqual(saved,f))throw Error('Edited demo field');}
 for(const c of consultations){const saved=records.find(r=>r.kind==='consultation'&&r.id===c.id);if(!saved||saved.version!==1||!isDeepStrictEqual(saved.payload,c.payload))throw Error('Edited demo consultation');}
 return {manifest,fields,consultations,current};
}
// Legacy manifests remain readable for preservation and audited retirement.
// New inputs must not recreate this aggregate outside the common workflow.
export async function removeRegisteredDemo(tx:Tx){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
 const manifests=await tx.$queryRaw<RecordRow[]>`SELECT * FROM "WorkRecord" WHERE workspace='sandbox' AND kind='demoManifest' AND id=${DEMO_BATCH} FOR UPDATE`;
 if(!manifests[0])throw Error('Missing demo manifest');
 const records=await tx.$queryRaw<RecordRow[]>`SELECT * FROM "WorkRecord" WHERE workspace='sandbox' AND kind IN ('fields','consultation') FOR UPDATE`;
 // Refuse to delete user-edited registrations, even when they began as demo records.
 // JSON property whitelists omit nested keys. Compare the complete stored
 // structure so edited nested registration conditions cannot be discarded.
 const {fields,consultations,current}=verifiedDemoRegistrations([...manifests,...records]);
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','removedDemoRecords',${crypto.randomUUID()},1,${JSON.stringify(manifests[0].payload)}::jsonb)`;
 const keep=(current!.payload as FieldEntry[]).filter(f=>!fields.some(x=>x.pnu===f.pnu));
 await tx.$executeRaw`UPDATE "WorkRecord" SET payload=${JSON.stringify(keep)}::jsonb,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE workspace='sandbox' AND kind='fields' AND id='current'`;
 for(const c of consultations)await tx.$executeRaw`DELETE FROM "WorkRecord" WHERE workspace='sandbox' AND kind='consultation' AND id=${c.id}`;
 await tx.$executeRaw`DELETE FROM "WorkRecord" WHERE workspace='sandbox' AND kind='demoManifest' AND id=${DEMO_BATCH}`;
}
