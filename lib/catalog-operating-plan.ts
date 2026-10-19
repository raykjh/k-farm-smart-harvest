import type {FieldEntry} from './field-record';
import type {Cultivation} from './cultivation';
import type {GuidelineContext} from './crop-guidelines';
import {compileCapacityWorkload} from './capacity-workload';
import {WORKLOAD_CATALOG_VERSION,workloadCrop,workloadSources} from './crop-workload-catalog';
import {operationRequirement} from './operation-requirements';
import {cultivationOperationKey} from './cultivation';
import {recommendConditions} from './field-conditions';
import type {SupportedCropCode} from './crop-registry';
import type {State} from './types';

export function catalogOperationTasks(crop:SupportedCropCode,pnu:string,area:number,context:GuidelineContext,resources?:State){
 if(!context.catalog||context.catalog.version!==WORKLOAD_CATALOG_VERSION||context.catalog.dataOrigin!=='DEMO')throw Error('추가 작물의 작업 기준 버전·입력 출처를 선택하세요.');
 const profile=workloadCrop(crop),year=context.catalog.year;
 const methodRates:Record<string,number>={};
 // Divide the area conservatively for the slowest compatible registered machine.
 // The solver still checks the chosen machine's own rate, dates and loan authority.
 if(resources)for(const op of profile.operations){
  const method=op.methods.find(m=>m.availability==='CURRENT');if(!method?.capability)continue;
  const code=method.capability==='GS'?'SP':method.capability,center=resources.centerSharing?.centerId??'demo';
  const machines=resources.machines.filter(m=>m.id.includes(code)&&m.status==='AVAILABLE'&&!m.safetyLock&&m.capacityHaHour>0&&m.compatibleCrops?.includes(crop)&&(!m.ownerCenterId||m.ownerCenterId===center||resources.centerSharing?.loans.some(l=>l.machineId===m.id&&l.borrowerCenterId===center&&l.status==='CONFIRMED')));
  if(machines.length)methodRates[`${crop}:${op.code}`]=Math.max(method.minutesPer1000m2,...machines.map(m=>6/m.capacityHaHour));
 }
 const override=context.operations?.[crop]??{};
 if(Object.keys(override).some(code=>!profile.operations.some(o=>o.code===code)))throw Error('알 수 없는 작업 단계');
 const overrides=Object.entries(override).flatMap(([operationCode,rule])=>{
  if(rule.occurrences?.some((r,i)=>r.occurrence!==i+1))throw Error('작업 회차는 1회부터 순서대로 입력하세요.');
  const method=profile.operations.find(o=>o.code===operationCode)!.methods.find(m=>m.availability==='CURRENT')!;
  // Changing these parameters requires recompiling split work and staffing.
  // Do not accept a change and silently plan with the old profile values.
  if(rule.laborMinutesPer1000m2!==undefined&&rule.laborMinutesPer1000m2!==method.minutesPer1000m2||rule.setupMinutes!==undefined&&rule.setupMinutes!==method.setupMinutes||rule.staff!==undefined&&rule.staff!==method.operators+method.workers||rule.transport!==undefined&&rule.transport!==method.transport)throw Error('작업표의 처리시간·인원 변경은 별도 기준 검토가 필요합니다. 날짜만 변경하거나 해당 입력을 제거하세요.');
  if(!rule.from&&!rule.occurrences?.length)return [];
  const windows=rule.occurrences?.map(r=>({from:r.from,to:r.to}))??[{from:rule.from!,to:rule.to!}];
  return [{cropId:crop,operationCode,windows,basis:'DEMO_INPUT',source:context.catalog!.sourceBatchId}];
 });
 // Reuse the exact work-period, dependency and multi-day compiler used for the
 // capacity study. This temporary adapter writes no owner / study / parcel rows.
 const compiled=compileCapacityWorkload({title:'운영 작업 생성',population:{basis:'SYNTHETIC_OWNER_POPULATION',description:'저장 농지의 공통 작업 컴파일 입력. 소유권 추정 또는 새 소유자 생성 아님.',owners:[{id:'compiler'}],parcels:[{pnu,centerId:'demo',areaM2:area,ownerId:'compiler',applied:true,cropId:crop,year,geographicBasis:'SYNTHETIC_TEST_ONLY',geographicSource:'COMPILER_INPUT_ONLY_NOT_GEOGRAPHIC_EVIDENCE',suitability:'SUITABLE',cropLocked:true,existingBearingOrchard:true}],seed:'compiler',participationRate:1},includeConditionalReserve:true,overrides},methodRates);
 if(compiled.blockers.length)throw Error(compiled.blockers.map(b=>b.message).join(' / '));
 return compiled.tasks;
}

export function buildCatalogPlot(f:FieldEntry,context:GuidelineContext,cultivation?:Cultivation,resources?:State){
 const crop=f.crop as SupportedCropCode,profile=workloadCrop(crop);
 if(!context.catalog)throw Error('작물 작업 프로필의 버전·입력 출처를 선택하세요.');
 if(cultivation&&(cultivation.pnu!==f.pnu||cultivation.crop!==crop))throw Error('재배 건과 농지·작물 불일치');
 if(!context.region||context.region!==f.conditions?.region)throw Error('농지와 작업 기준 지역 확인 필요');
 const assessment=recommendConditions(f.conditions).find(c=>c.crop===crop);
 if(!assessment||assessment.missing.length||assessment.blocked.length)throw Error('추가 작물의 농지·지역 적합성 확인이 필요합니다.');
 if(profile.lifecycle==='EXISTING_BEARING_ORCHARD'&&!f.conditions?.existingBearingOrchard)throw Error('기존 성목 과원 확인이 필요합니다.');
 const compiled=catalogOperationTasks(crop,f.pnu,f.area!,context,resources);
 const operationCode=(t:typeof compiled[number])=>`${t.operationCode}${t.occurrence>1?':'+t.occurrence:''}${t.part>1?':part'+t.part:''}`;
 const key=(t:typeof compiled[number])=>cultivation?cultivationOperationKey(cultivation.id,operationCode(t)):`${context.catalog!.year}:${f.pnu}:${crop}:${operationCode(t)}`;
 const tasks=compiled.map(t=>{
  if(cultivation&&(t.from<cultivation.start||t.to>cultivation.end))throw Error('작업기간이 재배 기간을 벗어납니다.');
  const op=profile.operations.find(o=>o.code===t.operationCode)!,m=t.method;
  const machineCode=m.capability==='GS'?'SP':m.capability??undefined;
  const custom=context.operations?.[crop]?.[t.operationCode]??{};
  if(custom.machineCode&&custom.machineCode!==machineCode)throw Error('이 작업의 장비 수행 방식은 호환 검토 후 변경하세요.');
  const elapsed=m.minutesPer1000m2;
  const crew={machineOperators:m.operators,ordinaryWorkers:m.workers,farmerWorkers:0};
  const req=operationRequirement(crop,t.operationCode,f.mode,{...custom,machineCode,laborMinutesPer1000m2:elapsed,setupMinutes:m.setupMinutes,staff:crew.machineOperators+crew.ordinaryWorkers,transport:m.transport});
  // The generic legacy defaults (e.g. rice planter) must not override this profile.
  req.machineCode=machineCode??null;req.executionMethod=machineCode?'MANNED_MACHINE':'MANUAL';req.requiresOperator=!!machineCode;req.owner=machineCode?'장비':'센터 인력';
  return {id:key(t),cultivationId:cultivation?.id??null,operationKey:key(t),operationCode:t.operationCode,occurrence:t.occurrence,part:t.part,
   predecessorKeys:t.predecessors.map(id=>key(compiled.find(p=>p.id===id)!)),requirements:req,crew,
   workAreaM2:t.workAreaM2,compatibilityCrop:machineCode?crop:null,executionBlocked:op.kind==='CONDITIONAL'?'예찰·처방 확인 후 작업계획 등록 필요':null,
   condition:op.condition,executionReviewRequired:op.kind==='CONDITIONAL',
   name:t.label+(op.windows.length>1?` (${t.occurrence}회차)`:'')+(t.part>1?` (${t.part}일차)`:''),date:null,
   window:{from:t.from,to:t.to,basis:'CATALOG_DEMO_INPUT'},allowedWindows:null as {from:string;to:string}[]|null,
   timing:`${t.from} ~ ${t.to}`,kind:(op.kind==='REQUIRED'?'PROCESS':op.kind) as 'PROCESS'|'INSPECTION'|'CONDITIONAL'|'REPEAT',
   predecessor:null,assignee:null,equipmentId:null,status:'WAITING_CONDITIONS' as const,
   blockers:['RIGHTS_PENDING','REGIONAL_TIMING_REVIEW','RESOURCE_UNASSIGNED','SAFETY_CONDITIONS_UNVERIFIED'],
  };
 });
 return {cultivationId:cultivation?.id??null,pnu:f.pnu,address:f.address,area:f.area!,crop,group:f.group,mode:f.mode,consultationId:f.consultationId??null,rights:f.rights,
  referenceId:`workload:${crop}`,referenceVersion:WORKLOAD_CATALOG_VERSION,calendarStatus:'SOURCE_REVIEW_REQUIRED' as const,calendarSourceUrl:workloadSources.find(s=>s.id==='calendar')!.url,
  yieldRange:null,yieldBasis:'NOT_AVAILABLE',catalogProfileId:crop,catalogVersion:WORKLOAD_CATALOG_VERSION,serviceEligibility:'NOT_ASSESSED' as const,
  conditions:f.conditions??null,regionalProfile:null,environmental:null,guidelineVersion:WORKLOAD_CATALOG_VERSION,region:context.region,climateStatus:'DEMO_INPUT_NOT_REGIONAL_AGRONOMIC_APPROVAL',guidelineSource:workloadSources.find(s=>s.id==='calendar')!.url,
  dataOrigin:'DEMO' as const,sourceBatchId:context.catalog!.sourceBatchId,tasks};
}
