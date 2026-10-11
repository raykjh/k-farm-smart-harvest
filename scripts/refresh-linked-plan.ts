import {db} from '../lib/db';
import {buildAnnualPlan,type AnnualPlan} from '../lib/annual-plan';
import {guidelineVersion,type GuidelineContext,type CropCode} from '../lib/crop-guidelines';
import {fieldInventory,type FieldEntry} from '../lib/field-record';
const year=2026;
try{console.log(JSON.stringify(await db.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fields:sandbox'))`;
 const fields=await tx.$queryRaw<{version:number;payload:FieldEntry[]}[]>`SELECT version,payload FROM "WorkRecord" WHERE workspace='sandbox' AND kind='fields' AND id='current' FOR UPDATE`;
 const plans=await tx.$queryRaw<{version:number;payload:AnnualPlan}[]>`SELECT version,payload FROM "WorkRecord" WHERE workspace='sandbox' AND kind='annualPlan' AND id='2026' FOR UPDATE`;
 const old=plans[0];if(!old||!fields[0])throw Error('기존 초안/농지 없음');
 if(old.payload.plots.every(p=>p.guidelineVersion===guidelineVersion))return {alreadyCurrent:true};
 const context:GuidelineContext=structuredClone(old.payload.context??{region:'계북면'});context.anchors??={};
 for(const crop of ['rice','potato','pepper'] as CropCode[])for(const [code,anchor] of [['plant','planting'],['heading','heading']] as const){
  const dates=[...new Set(old.payload.plots.filter(p=>p.crop===crop).flatMap(p=>p.tasks.filter(t=>(t.operationCode??t.id.split(':').at(-1))===code&&t.window?.from===t.window?.to&&t.window).map(t=>t.window!.from)))];
  if(dates.length>1)throw Error('필지별 기준일이 다릅니다. 개별 보존 처리 필요');
  if(dates[0]){context.anchors[crop]??={};context.anchors[crop]![anchor]??=dates[0];}
 }
 const plan=buildAnnualPlan(fieldInventory.parse(fields[0].payload),year,fields[0].version,context);
 const id='2026:'+guidelineVersion;
 await tx.$executeRaw`INSERT INTO "WorkRecord" (workspace,kind,id,version,payload) VALUES ('sandbox','annualPlanMigration',${id},1,${JSON.stringify(old)}::jsonb)`;
 await tx.$executeRaw`UPDATE "WorkRecord" SET payload=${JSON.stringify(plan)}::jsonb,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE workspace='sandbox' AND kind='annualPlan' AND id='2026'`;
 return {refreshed:true,version:old.version+1,tasks:plan.taskCount,anchors:context.anchors};
},{timeout:20000})))}finally{await db.$disconnect()}
