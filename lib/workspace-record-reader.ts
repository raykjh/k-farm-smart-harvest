import type {Prisma,WorkRecord} from '@prisma/client';

// Keep each JSON result below the driver string limit. The caller retains one
// center's records only; the enclosing transaction owns snapshot consistency.
export async function readWorkspaceRecords(tx:Prisma.TransactionClient,workspace:string,kinds:string[],latestFirst=false){
 const records:WorkRecord[]=[];
 let cursor:Prisma.WorkRecordWhereUniqueInput|undefined;
 for(;;){
  const page=await tx.workRecord.findMany({where:{workspace,kind:{in:kinds}},take:200,
   orderBy:latestFirst?[{updatedAt:'desc'},{id:'asc'},{kind:'asc'}]:[{kind:'asc'},{id:'asc'}],
   ...(cursor?{cursor,skip:1}:{})});
  records.push(...page);
  if(page.length<200)return records;
  const last=page.at(-1)!;cursor={workspace_kind_id:{workspace:last.workspace,kind:last.kind,id:last.id}};
 }
}
