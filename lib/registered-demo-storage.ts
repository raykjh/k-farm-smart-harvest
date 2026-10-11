import type {Prisma} from '@prisma/client';
import {registeredDemo,DEMO_BATCH} from './registered-demo';
import {fieldInventory,type FieldEntry} from './field-record';
type Tx=Prisma.TransactionClient;
type RecordRow={kind:string;id:string;version:number;payload:any};
// Uses exactly the consultation and field schemas used by registration. No SMS or equipment commands.
export async function insertRegisteredDemo(tx:Tx){
 const b=registeredDemo();
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
 const old=await tx.$queryRaw<RecordRow[]>`SELECT * FROM "WorkRecord" WHERE workspace='sandbox' AND kind='fields' AND id='current' FOR UPDATE`;
 const merged=fieldInventory.parse([...(old[0]?.payload??[]),...b.fields]);
 const ids=b.consultations.map(c=>c.id);
 const existing=await tx.$queryRaw<RecordRow[]>`SELECT * FROM "WorkRecord" WHERE workspace='sandbox' AND kind='consultation'`;
 if(existing.some(r=>ids.includes(r.id)))throw Error('Demo already exists');
 for(const c of b.consultations){await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','consultation',${c.id},1,${JSON.stringify(c.payload)}::jsonb)`;}
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','fields','current',${(old[0]?.version??0)+1},${JSON.stringify(merged)}::jsonb) ON CONFLICT (workspace,kind,id) DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload,"updatedAt"=CURRENT_TIMESTAMP`;
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','demoManifest',${DEMO_BATCH},1,${JSON.stringify({fields:b.fields,consultations:b.consultations,simulated:true})}::jsonb)`;
 return b.state;
}
export async function removeRegisteredDemo(tx:Tx){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
 const manifests=await tx.$queryRaw<RecordRow[]>`SELECT * FROM "WorkRecord" WHERE workspace='sandbox' AND kind='demoManifest' AND id=${DEMO_BATCH} FOR UPDATE`;
 if(!manifests[0])return;
 const {fields,consultations}=manifests[0].payload as ReturnType<typeof registeredDemo>;
 const records=await tx.$queryRaw<RecordRow[]>`SELECT * FROM "WorkRecord" WHERE workspace='sandbox' AND kind IN ('fields','consultation') FOR UPDATE`;
 const current=records.find(r=>r.kind==='fields'&&r.id==='current');
 // Refuse to delete user-edited registrations, even when they began as demo records.
 const canonical=(v:any):string=>JSON.stringify(v,Object.keys(v).sort());
 for(const f of fields){const saved=(current?.payload as FieldEntry[]??[]).find(x=>x.pnu===f.pnu);if(!saved||canonical(saved)!==canonical(f))throw Error('Edited demo field');}
 for(const c of consultations){const r=records.find(r=>r.kind==='consultation'&&r.id===c.id);if(!r||r.version!==1)throw Error('Edited demo consultation');}
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','removedDemoRecords',${crypto.randomUUID()},1,${JSON.stringify(manifests[0].payload)}::jsonb)`;
 const keep=(current!.payload as FieldEntry[]).filter(f=>!fields.some(x=>x.pnu===f.pnu));
 await tx.$executeRaw`UPDATE "WorkRecord" SET payload=${JSON.stringify(keep)}::jsonb,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE workspace='sandbox' AND kind='fields' AND id='current'`;
 for(const c of consultations)await tx.$executeRaw`DELETE FROM "WorkRecord" WHERE workspace='sandbox' AND kind='consultation' AND id=${c.id}`;
 await tx.$executeRaw`DELETE FROM "WorkRecord" WHERE workspace='sandbox' AND kind='demoManifest' AND id=${DEMO_BATCH}`;
}
