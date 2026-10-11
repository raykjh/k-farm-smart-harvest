import {db} from '../lib/db';
import {linkLegacyOperations,mappingVersion} from '../lib/operation-links';
import {seasonalOperations,DEMO_BATCH} from '../lib/registered-demo';
import type {State} from '../lib/types';
import type {Prisma} from '@prisma/client';
const apply=process.argv.includes('--apply');
try{
 const result=await db.$transaction(async tx=>{
  const rows=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
  const before=rows[0]?.state;if(!before||before.ruleVersion!==DEMO_BATCH||before.missions.length!==460)throw Error('예상된 460개 작업 배치가 아닙니다.');
  const prior=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "WorkRecord" WHERE workspace='sandbox' AND kind='operationMigration' AND id=${mappingVersion}`;
  if(prior.length)return {alreadyApplied:true};
  const after=linkLegacyOperations(before,seasonalOperations);
  // This migration only adds linkage metadata. Dates, statuses, IDs and execution tables stay intact.
  for(let i=0;i<before.missions.length;i++)for(const [k,v] of Object.entries(before.missions[i]))if(JSON.stringify(v)!==JSON.stringify((after.missions[i] as any)[k]))throw Error('기존 작업 값 변경 거부: '+k);
  if(!apply)return {dryRun:true,count:after.missions.length,uniqueKeys:new Set(after.missions.map((m:any)=>m.operationKey)).size};
  after.planVersion++;
  for(const r of after.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
  await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','operationMigration',${mappingVersion},1,${JSON.stringify({before,appliedAt:new Date().toISOString(),count:460})}::jsonb)`;
  await tx.center.update({where:{id:'demo'},data:{state:after as unknown as Prisma.InputJsonValue,version:{increment:1}}});
  await tx.audit.create({data:{centerId:'demo',action:'operationMigration.apply',detail:{mappingVersion,count:460,planVersion:after.planVersion}}});
  return {applied:true,count:460,planVersion:after.planVersion};
 },{timeout:20000});console.log(JSON.stringify(result));
}finally{await db.$disconnect()}
