import {Prisma} from '@prisma/client';

// Supply coordination needs harvest windows, area, conditions and variety.
// Project those fields in PostgreSQL instead of transferring every work step.
// The persisted plans are read-only and remain complete in the database.
export async function readCoordinationRecords(tx:Prisma.TransactionClient,workspace:string){
 const rows:{workspace:string;kind:string;id:string;payload:Prisma.JsonValue}[]=[];
 let cursor:{kind:string;id:string}|undefined;
 for(;;){
  const page=await tx.$queryRaw<typeof rows>(Prisma.sql`
   SELECT workspace, kind, id,
    CASE WHEN kind = 'cultivationPlan' THEN jsonb_build_object(
     'context',jsonb_build_object('variety',payload#>'{context,variety}',
      'catalog',CASE WHEN payload#>'{context,catalog}' IS NULL OR payload#>'{context,catalog}' = 'null'::jsonb THEN NULL ELSE true END),
     'plots',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'pnu',p->'pnu','area',p->'area','conditions',p->'conditions',
      'tasks',(SELECT COALESCE(jsonb_agg(jsonb_build_object('operationCode',t->'operationCode','window',t->'window') ORDER BY ti),'[]'::jsonb)
       FROM jsonb_array_elements(p->'tasks') WITH ORDINALITY AS task(t,ti) WHERE t->>'operationCode'='harvest')
     ) ORDER BY pi),'[]'::jsonb) FROM jsonb_array_elements(payload->'plots') WITH ORDINALITY AS plot(p,pi))
    ) ELSE payload END AS payload
   FROM "WorkRecord"
   WHERE workspace=${workspace} AND kind IN ('cultivation','cultivationPlan','registrationOrigin')
    ${cursor?Prisma.sql`AND (kind,id)>(${cursor.kind},${cursor.id})`:Prisma.empty}
   ORDER BY kind,id LIMIT 200`);
  rows.push(...page);if(page.length<200)return rows;
  const last=page.at(-1)!;cursor={kind:last.kind,id:last.id};
 }
}
