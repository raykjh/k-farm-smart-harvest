import {db} from '../lib/db';
import {randomUUID} from 'node:crypto';
import {checkCultivation,cultivationOperationKey,type Cultivation} from '../lib/cultivation';
import type {State} from '../lib/types';
import type {LinkedMission} from '../lib/operation-links';
import type {Prisma} from '@prisma/client';
const migration='cultivations-2026-09-11-v1',apply=process.argv.includes('--apply');
try{console.log(JSON.stringify(await db.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
 const done=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "WorkRecord" WHERE workspace='sandbox' AND kind='cultivationMigration' AND id=${migration}`;
 if(done.length)return {alreadyApplied:true};
 const rows=await tx.$queryRaw<{state:State}[]>`SELECT state FROM "Center" WHERE id='demo' FOR UPDATE`;
 const before=rows[0]?.state;if(!before||before.fields.length!==30||before.missions.length!==460)throw Error('30농지·460작업 기준 불일치');
 const existing=await tx.$queryRaw<{payload:Cultivation}[]>`SELECT payload FROM "WorkRecord" WHERE workspace='sandbox' AND kind='cultivation'`;
 const cycles=existing.map(r=>r.payload),next=structuredClone(before),created:Cultivation[]=[];
 const crops={'쌀':'rice','감자':'potato','고추':'pepper'} as const;
 for(const f of next.fields){
  const missions=next.missions.filter(m=>m.fieldId===f.id) as LinkedMission[];
  if(!f.crop||!missions.length||missions.some(m=>!m.operationCode||!m.occurrence||!m.scheduledDate||m.crop!==f.crop))throw Error('작업 단계·작물 확인 필요');
  const dates=missions.map(m=>m.scheduledDate!).sort();
  if(!Object.hasOwn(crops,f.crop))throw Error('기존 3작물 이관 대상이 아닙니다.');
  const c:Cultivation={id:randomUUID(),pnu:f.id,crop:crops[f.crop as keyof typeof crops],start:dates[0],end:dates.at(-1)!,source:'LEGACY_IMPORT'};
  checkCultivation(c,cycles);cycles.push(c);created.push(c);
  for(const m of missions)Object.assign(m,{cultivationId:c.id,cultivationOperationKey:cultivationOperationKey(c.id,m.operationCode!,m.occurrence!)});
 }
 if(!apply)return {dryRun:true,cultivations:created.length,missions:next.missions.length};
 for(const c of created)await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','cultivation',${c.id},1,${JSON.stringify(c)}::jsonb)`;
 next.planVersion++;for(const r of next.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','cultivationMigration',${migration},1,${JSON.stringify({before,created,at:new Date().toISOString(),periodBasis:'LEGACY_TASK_RANGE_NOT_AGRONOMIC_DATES'})}::jsonb)`;
 await tx.center.update({where:{id:'demo'},data:{state:next as unknown as Prisma.InputJsonValue,version:{increment:1}}});
 return {applied:true,cultivations:created.length,missions:next.missions.length,planVersion:next.planVersion};
},{timeout:20000})))}finally{await db.$disconnect()}
