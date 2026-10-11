import {actorLabel,currentPrincipal} from './auth';
import {db} from './db';
import type {Prisma} from '@prisma/client';
import {saveRegionalStandardSchema,type SavedRegionalStandard} from './regional-crop-standard';
// Reference records are not demo records and are not removed by demo cleanup.
const workspace='reference',kind='regionalCropStandard';
export class StandardConflict extends Error {}
export async function listRegionalStandards():Promise<SavedRegionalStandard[]>{
 const rows=await db.workRecord.findMany({where:{workspace,kind},orderBy:{updatedAt:'desc'}});
 return rows.map(r=>({id:r.id,version:r.version,updatedAt:r.updatedAt.toISOString(),profile:r.payload as unknown as SavedRegionalStandard['profile']}));
}
export async function saveRegionalStandard(raw:unknown):Promise<SavedRegionalStandard>{
 const b=saveRegionalStandardSchema.parse(raw);if(currentPrincipal()&&b.profile.status==='REVIEWED')b.profile.reviewer=actorLabel();
 return db.$transaction(async tx=>{
  // Serializes create/update, including the absent-row case.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace+kind+b.id}))`;
  const key={workspace,kind,id:b.id};
  const prior=await tx.workRecord.findUnique({where:{workspace_kind_id:key}});
  if((prior?.version??0)!==b.expectedVersion)throw new StandardConflict('Revision conflict');
  const version=b.expectedVersion+1,updatedAt=new Date(),payload=b.profile as unknown as Prisma.InputJsonValue;
  await tx.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,version,payload,updatedAt},update:{version,payload,updatedAt}});
  await tx.workRecord.create({data:{workspace,kind:'regionalCropStandardRevision',id:`${b.id}:${version}`,version,payload,updatedAt}});
  return {id:b.id,version,updatedAt:updatedAt.toISOString(),profile:b.profile};
 });
}
