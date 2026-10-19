import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {recordSpace} from './workspace';
import {cropPeriod,nextDay,type ProductionCriteria} from './continuous-production';
import {recommendConditions} from './field-conditions';
import type {FieldEntry} from './field-record';
import type {GuidelineContext} from './crop-guidelines';
import {guidelineTasks} from './crop-guidelines';
import {catalogOperationTasks} from './catalog-operating-plan';
import {cropDisplayNames,isLegacyCrop,isOrchardCrop,type SupportedCropCode} from './crop-registry';
import {WORKLOAD_CATALOG_VERSION,workloadCrop} from './crop-workload-catalog';
import {planningContext} from './planning-context';

export type CropChangeOption={id:string;crop:SupportedCropCode;name:string;start:string;end:string;plantingFrom:string;plantingTo:string;season:'THIS_YEAR'|'NEXT_YEAR';context:GuidelineContext};
export const cropChangeToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
/** Dated regional records never roll forward implicitly. Only an explicitly
 * selected annual catalog template can generate the next year's windows. */
export function cropChangeOptions(field:FieldEntry,profiles:ProductionCriteria['profiles'],today:string){
 const earliest=nextDay(today),year=Number(today.slice(0,4)),choices:CropChangeOption[]=[],notes=new Set<string>();
 if(!field.conditions?.landUse||field.conditions.landUse==='unknown')return {choices,notes:['농지 정보에서 토지 형태를 먼저 확인해주세요.']};
 const suitable=recommendConditions(field.conditions).filter(c=>!c.blocked.length&&!c.missing.length);
 if(!suitable.length)return {choices,notes:['농지의 지역·토양·작물 적합성 기준을 먼저 확인해주세요.']};
 for(const p of profiles.filter(p=>p.context.region===field.conditions?.region)){
  const contexts=p.context.catalog?[year,year+1].map(y=>({...structuredClone(p.context),catalog:{...p.context.catalog!,year:y}})):[structuredClone(p.context)];
  for(const input of contexts)for(const candidate of suitable){
   const crop=candidate.crop;if(isOrchardCrop(crop))continue; // Existing bearing trees are not new planting candidates.
   try{
    let context:GuidelineContext=structuredClone(input);
    if(context.catalog){
     // Coarse demo preparation may finish during its planting window, but never
     // after planting. Do not extend a reviewed or explicitly overridden rule.
     const profile=workloadCrop(crop),plant=profile.operations.find(o=>o.code==='plant')?.windows[0];
     if(plant&&!context.operations?.[crop]?.soil){const y=context.catalog.year+(plant.yearOffset??0),to=`${y}-${plant.to}`;
      context.operations={...context.operations,[crop]:{...context.operations?.[crop],soil:{from:`${y}-${profile.operations.find(o=>o.code==='soil')!.windows[0].from}`,to}}};
     }
    }
    const period=cropPeriod(crop,planningContext.parse(context),earliest,null);context=period.context;
    const planting=context.catalog?catalogOperationTasks(crop,field.pnu,field.area??1000,context).filter(t=>t.operationCode==='plant').map(t=>({from:t.from,to:t.to})):isLegacyCrop(crop)?guidelineTasks(crop,year,context,period).filter(t=>t.code==='plant'&&t.window).map(t=>t.window!):[];
    if(!planting.length)continue;
    const from=planting.map(w=>w.from).sort()[0],to=planting.map(w=>w.to).sort().at(-1)!;
    if(to<earliest||from.slice(0,4)>String(year+1))continue;
    const value={crop,start:period.start,end:period.end,plantingFrom:from,plantingTo:to,context};
    const id=createHash('sha256').update(JSON.stringify({policy:'crop-change-season-v1',today,field,profile:p.id,value})).digest('hex');
    if(!choices.some(c=>c.crop===crop&&c.plantingFrom===from&&c.plantingTo===to))choices.push({...value,id,name:cropDisplayNames(true)[crop],season:from.slice(0,4)===String(year)?'THIS_YEAR':'NEXT_YEAR'});
   }catch{/* An incomplete regional profile is not an executable crop option. */}
  }
 }
 if(!choices.length)notes.add('현재 이후에 적용할 수 있는 작물 작업 기준이 없습니다. 작물정보에서 지역 기준을 확인해주세요.');
 return {choices:choices.sort((a,b)=>a.plantingFrom.localeCompare(b.plantingFrom)||a.name.localeCompare(b.name)),notes:[...notes]};
}

export async function readCropChangeOptions(tx:Prisma.TransactionClient,field:FieldEntry,today=cropChangeToday()){
 const rows=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:{in:['productionCriteria','delegatedSettings','cultivationPlan','demoManifest']}},orderBy:{id:'asc'}});
 const profiles:ProductionCriteria['profiles']=[];
 for(const row of rows){const payload=row.payload as any;
  const raw=row.kind==='productionCriteria'?payload.profiles:row.kind==='delegatedSettings'?[{id:row.id,name:'센터 기준',context:payload.context}]:row.kind==='cultivationPlan'&&payload.plots?.some((p:any)=>p.pnu===field.pnu)?[{id:row.id,name:'저장 작물 기준',context:payload.context}]:[];
  for(const p of raw??[]){const parsed=planningContext.safeParse(p.context);if(parsed.success)profiles.push({...p,context:parsed.data});}
 }
 // Demo parameters are available only for fields explicitly in the installed
 // demo manifest. This never labels real parcels/unknown conditions as suitable.
 if(rows.some(r=>r.kind==='demoManifest'&&(r.payload as any).fields?.some((f:any)=>f.pnu===field.pnu)))profiles.push({id:'installed-demo-catalog',name:'등록 기준',dataOrigin:'DEMO',sourceBatchId:'installed-demo-catalog',context:{region:field.conditions?.region,catalog:{version:WORKLOAD_CATALOG_VERSION,year:Number(today.slice(0,4)),dataOrigin:'DEMO',sourceBatchId:'installed-demo-catalog'}}});
 return {asOf:today,...cropChangeOptions(field,profiles,today)};
}
