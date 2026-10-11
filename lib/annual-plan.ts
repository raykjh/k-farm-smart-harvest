import {cropReferences,estimateProduction} from './crop-reference';
import type {FieldEntry} from './field-record';
import {cropGuidelines,guidelineTasks,guidelineVersion,type CropCode,type GuidelineContext} from './crop-guidelines';
import {operationRequirement} from './operation-requirements';
import {prerequisiteInstances} from './operation-dependencies';
import {operationKey} from './operation-links';
import {cultivationOperationKey,type Cultivation} from './cultivation';
import {validateRegionalProfile} from './regional-profile';
import {legacyCatalogProfile} from './crop-catalog';
import {resolveEnvironment,planningRegion,type EnvironmentBundle} from './environment-planning';
import {buildCatalogPlot} from './catalog-operating-plan';
import {isLegacyCrop} from './crop-registry';
export function buildAnnualPlan(fields:FieldEntry[],year:number,fieldVersion:number,context:GuidelineContext={},cultivation?:Cultivation,environment?:EnvironmentBundle,resources?:import('./types').State){
 if(!Number.isInteger(year)||year<2000||year>2200)throw Error('계획 연도를 확인하세요.');
 const names={rice:'쌀',potato:'감자',pepper:'고추'} as const;
 const excluded=fields.filter(f=>!f.crop||!f.area).map(f=>({pnu:f.pnu,reason:!f.crop?'CROP_REQUIRED':'AREA_REQUIRED'}));
 const plots=fields.filter(f=>f.crop&&f.area).map(f=>{
  if(context.catalog||!isLegacyCrop(f.crop)){if(environment)throw Error('추가 작물의 환경 기준 연결은 별도 검토가 필요합니다. 기존 환경 승인을 적용하지 않았습니다.');return buildCatalogPlot(f,context,cultivation,resources);}
  const catalog=legacyCatalogProfile(f.crop);
  if(!catalog)throw Error('해당 작물의 실행 가능한 작업 프로필이 아직 연결되지 않았습니다.');
  const ref=cropReferences.find(r=>r.crop===names[f.crop as keyof typeof names])!;
  if(cultivation&&(cultivation.pnu!==f.pnu||cultivation.crop!==f.crop))throw Error('재배 건과 농지·작물 불일치');
  const operations=guidelineTasks(f.crop as CropCode,year,context,cultivation);
  const environmental=environment?resolveEnvironment(environment,catalog.id,planningRegion(f)):null;
  if(environmental?.operations.some(o=>!operations.some(task=>task.code===o.code)))throw Error('환경 기준의 작업 코드와 작물 공통 단계가 다릅니다.');
  const environmentalTasks=operations.map(op=>{
   const manual=context.operations?.[f.crop as CropCode]?.[op.code];
   const resolved=environmental?.operations.find(o=>o.code===op.code);
   // Explicit dates/anchors and repeated occurrences remain human-owned.
   if(!resolved||manual?.from||manual?.occurrences?.length||op.window||op.kind==='REPEAT'||op.kind==='CONDITIONAL'||op.kind==='INSPECTION')return {...op,allowedWindows:null as {from:string;to:string}[]|null};
   const from=cultivation?.start??`${year}-01-01`,to=cultivation?.end??`${year}-12-31`;
   const windows=resolved.windows.map(w=>({from:w.from<from?from:w.from,to:w.to>to?to:w.to})).filter(w=>w.from<=w.to);
   return {...op,allowedWindows:windows,window:windows.length?{from:windows[0].from,to:windows.at(-1)!.to,basis:'ENVIRONMENT_NORMAL_CANDIDATE'}:null,timingStatus:resolved.status};
  });
  const regionalProfile=context.regionalProfile?validateRegionalProfile(context.regionalProfile,f.crop as CropCode,operations.flatMap(o=>o.window?[o.window.from,o.window.to]:[]),f.conditions):null;
  if(regionalProfile&&context.region&&regionalProfile.region!==context.region)throw Error('계획 지역과 기준 지역이 다릅니다.');
  const taskKey=(code:string)=>cultivation?cultivationOperationKey(cultivation.id,code):`${year}:${f.pnu}:${f.crop}:${code}`;
  return {cultivationId:cultivation?.id??null,pnu:f.pnu,address:f.address,area:f.area!,crop:f.crop,group:f.group,mode:f.mode,consultationId:f.consultationId??null,rights:f.rights,referenceId:ref.id,referenceVersion:ref.version,calendarStatus:ref.calendarStatus,calendarSourceUrl:ref.calendarSourceUrl,yieldRange:estimateProduction(f.area!,ref),yieldBasis:ref.yieldMethod,
   catalogProfileId:catalog.id,catalogVersion:catalog.version,serviceEligibility:'NOT_ASSESSED' as const,
   conditions:f.conditions??null,regionalProfile,environmental,guidelineVersion,region:regionalProfile?.region??context.region??f.conditions?.region??'미확인',climateStatus:regionalProfile?'OPERATOR_REVIEWED_REGIONAL_PROFILE':'REGIONAL_PROFILE_REQUIRED',guidelineSource:cropGuidelines[f.crop as CropCode].source,
   tasks:environmentalTasks.map(op=>({id:cultivation?taskKey(op.instanceCode):`${year}:${f.pnu}:${guidelineVersion}:${op.instanceCode}`,cultivationId:cultivation?.id??null,operationKey:taskKey(op.instanceCode),operationCode:op.code,occurrence:op.occurrence,part:1,workAreaM2:f.area!,predecessorKeys:prerequisiteInstances(f.crop as CropCode,op,operations).map(taskKey),requirements:operationRequirement(f.crop as CropCode,op.code,f.mode,context.operations?.[f.crop as CropCode]?.[op.code]),name:op.name+(op.kind==='REPEAT'?` (${op.occurrence}회차)`:''),date:op.date,window:op.window,allowedWindows:op.allowedWindows,timing:op.timing,kind:op.kind,predecessor:null,assignee:null,equipmentId:null,status:'WAITING_CONDITIONS' as const,blockers:['RIGHTS_PENDING',...(op.window?['REGIONAL_TIMING_REVIEW']:['WORK_WINDOW_UNVERIFIED']),'RESOURCE_UNASSIGNED','DURATION_UNVERIFIED','SAFETY_CONDITIONS_UNVERIFIED']}))};
 });
 if(!plots.length)throw Error('작물과 면적이 입력된 저장 농지가 필요합니다.');
 return {year,cultivation:cultivation??null,fieldVersion,context,environmentReview:null as import('./environment-execution-check').GrowthReview|null,environmentForecastHash:null as string|null,status:'DRAFT' as const,plots,excluded,taskCount:plots.reduce((n,p)=>n+p.tasks.length,0),dispatchStatus:'BLOCKED' as const};
}
export type AnnualPlan=ReturnType<typeof buildAnnualPlan>;
