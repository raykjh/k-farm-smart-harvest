import {cropCatalog} from './crop-catalog';
import {cropReferences} from './crop-reference';
import {publicYieldCriteria} from './public-crop-criteria';
import {cropGuidelines} from './crop-guidelines';
import {cropStageEvidence} from './crop-stage-evidence';
import {cropCodes, isLegacyCrop, type SupportedCropCode} from './crop-registry';
import {workloadCrop, workloadCrops, type WorkloadCapability, type WorkloadOperation, type MonthWindow} from './crop-workload-catalog';
import {equipmentTypes, type EquipmentInput, type LedgerMachine} from './equipment-register';
import type {SavedRegionalStandard} from './regional-crop-standard';

// Presentation adapters only. The planning data remains the single source of truth.
export type EquipmentKind = EquipmentInput['kind'];
export type Bilingual = readonly [ko: string, en: string];
export const textIn = (value:Bilingual, ko:boolean) => value[ko ? 0 : 1];
export const equipmentKindFor = (capability:WorkloadCapability):EquipmentKind => capability === 'GS' ? 'SP' : capability;
export const capabilityFor = (kind:EquipmentKind):WorkloadCapability|null => kind === 'TV' ? null : kind === 'SP' ? 'GS' : kind;
export const equipmentName = (kind:EquipmentKind, ko:boolean) => equipmentTypes.find(t=>t[0]===kind)![ko?1:2];
export function machineKind(machine:LedgerMachine):EquipmentKind|null {
 if(machine.ledger?.kind)return machine.ledger.kind;
 // Older records have no ledger. Do not match an arbitrary substring of a center prefix.
 return equipmentTypes.find(([code,ko])=>machine.type===ko || new RegExp(`${code}\\d+$`).test(machine.id))?.[0] ?? null;
}
export function informationCrop(id:string) {
 if(!(cropCodes as readonly string[]).includes(id))return null;
 const crop=workloadCrop(id);
 return {crop, yieldReference:cropReferences.find(r=>r.crop===crop.name)??null,
  publicYieldReference:publicYieldCriteria.find(r=>r.crop===id)??null,
  guideline:isLegacyCrop(id)?cropGuidelines[id]:null,
  stageEvidence:cropStageEvidence.find(r=>r.crop===id)??null,
  equipment:[...new Set(crop.operations.flatMap(o=>o.methods.flatMap(m=>m.capability?[equipmentKindFor(m.capability)]:[])))],
 };
}
export function equipmentOperations(kind:EquipmentKind) {
 const capability=capabilityFor(kind);
 return workloadCrops.flatMap(crop=>crop.operations.flatMap(operation=>operation.methods
  .filter(method=>kind==='TV'?method.transport>0:method.capability===capability)
  .map(method=>({crop,operation,method}))));
}
// Exact source-directory identities; never conflate e.g. leaf perilla with seed perilla.
const catalogNames:Record<SupportedCropCode,string>={rice:'벼 기계이앙재배',potato:'감자',pepper:'고추(보통재배)',soybean:'콩',barley:'일반보리',wheat:'밀',maize:'옥수수',sweetpotato:'고구마',redbean:'팥',sesame:'참깨',perilla:'들깨(종실)',peanut:'땅콩',garlic:'마늘',onion:'양파',cabbage:'배추',radish:'무',green_onion:'파',head_cabbage:'양배추',carrot:'당근',lettuce:'상추',spinach:'시금치',broccoli:'브로콜리(평야지재배)',ginger:'생강',pumpkin:'호박(단호박)',watermelon:'수박',apple:'사과',pear:'배',peach:'복숭아',grape:'포도(무가온)',plum:'자두'};
export function catalogForCrop(id:SupportedCropCode){
 const category=workloadCrop(id).category;
 return cropCatalog.find(c=>c.name===catalogNames[id]&&c.category===category)??null;
}
export function standardsForCrop(id:SupportedCropCode, standards:SavedRegionalStandard[]) {
 const catalog=catalogForCrop(id);
 return standards.filter(s=>s.profile.catalogProfileId===catalog?.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function windowLabel(w:MonthWindow,ko:boolean) {
 const year=w.yearOffset?ko?`다음 해${w.yearOffset>1?` +${w.yearOffset}`:''} `:`Year +${w.yearOffset} `:'';
 return `${year}${w.from} ~ ${w.to}`;
}
const operationEnglish:Record<string,string>={soil:'Soil preparation / tillage',plant:'Sowing / transplanting',care:'Growth / weed management',scout:'Pest scouting',nutrition:'Nutrient assessment',fertilize:'Prescribed fertilization',treat:'Treatment after inspection',harvest:'Harvest',finish:'Sorting / crop handling',prune:'Winter pruning',bloom:'Flowering / fruit set',thin:'Thinning / growth management',cleanup:'Post-harvest cleanup'};
export const operationName=(o:Pick<WorkloadOperation,'code'|'name'>,ko:boolean)=>ko?o.name:operationEnglish[o.code]??o.name;
export function practiceName(id:SupportedCropCode,ko:boolean){
 const crop=workloadCrop(id);if(ko)return crop.practice;
 if(crop.lifecycle==='EXISTING_BEARING_ORCHARD')return 'Existing bearing orchard / open field';
 if(['barley','wheat','garlic','onion'].includes(id))return 'Autumn planting / next-year harvest';
 return id==='potato'?'Spring cultivation':id==='perilla'?'Seed production':'Open-field cultivation';
}
export const methodName=(mode:string,ko:boolean)=>mode==='MANUAL'?(ko?'인력 작업':'Manual work'):mode==='AUTOMATED_WITH_OPERATOR'?(ko?'자동화 장비 + 운영자':'Automated equipment + operator'):(ko?'장비 + 운영자':'Equipment + operator');
export function conditionName(o:WorkloadOperation,ko:boolean){
 if(ko)return o.condition;
 if(!o.condition)return null;
 return o.code==='fertilize'?'Soil / growth diagnosis and prescription required':'Verify crop, product, timing, pre-harvest interval and application method';
}
export const equipmentDescriptions:Record<EquipmentKind,{purpose:Bilingual;attachment:Bilingual;checks:Bilingual}>={
 DR:{purpose:['상공에서 정해진 구역에 살포하는 농업용 장비','Agricultural aerial application equipment'],attachment:['살포장치·노즐·배터리·충전장치','Spraying system, nozzles, batteries and charging equipment'],checks:['약제·작물 적용, 비산 위험, 현장 풍속, 장애물, 조종자 및 비행 조건 확인','Check product/crop compatibility, drift, local wind, obstacles, pilot and flight conditions']},
 TR:{purpose:['작업기를 연결해 경운·토양 준비를 수행','Carries implements for tillage and soil preparation'],attachment:['작업별 로터리·쟁기 등 장착 규격 확인','Verify implement fit, such as rotary tiller or plough'],checks:['진입 폭·지반·경사·회차 공간·작업기 호환 확인','Check access width, ground, slope, turning room and implement compatibility']},
 RP:{purpose:['준비된 모를 논에 심는 이앙 장비','Transplants prepared rice seedlings into paddy fields'],attachment:['육묘상자·식부부·모 공급 계획','Seedling trays, planting unit and seedling supply'],checks:['논 상태·진입로·모 규격·보급 인력 확인','Check paddy conditions, access, seedling specification and replenishment crew']},
 PS:{purpose:['씨감자를 정해진 간격에 심는 장비','Plants seed potatoes at configured spacing'],attachment:['씨감자 규격·식부장치·트랙터 연결','Seed-potato specification, planting mechanism and tractor connection'],checks:['두둑 규격·토양 상태·씨감자 보급·장착 모델 확인','Check ridge dimensions, soil, seed supply and fitted model']},
 CB:{purpose:['벼의 예취·탈곡·수집을 함께 수행','Cuts, threshes and collects rice'],attachment:['벼용 예취부·곡물 배출 및 운반 연계','Rice harvesting unit plus unloading and haulage'],checks:['성숙·논 지반·진입 폭·배출 지점·곡물 운송 확인','Check maturity, ground, access width, unloading point and grain transport']},
 PD:{purpose:['감자를 굴취하고 수거 작업과 연결','Lifts potatoes for collection'],attachment:['굴취 작업기·트랙터·수거 인력','Digging implement, tractor and collection crew'],checks:['두둑·깊이·토양 수분·굴취 후 수거 인원 확인','Check ridges, depth, soil moisture and collection crew']},
 SP:{purpose:['지상에서 작물에 방제 작업을 수행','Applies crop treatments from the ground'],attachment:['펌프·노즐·호스 또는 붐·탱크','Pump, nozzles, hose or boom, and tank'],checks:['약제·작물·비산·풍속·살포 방식 확인. 지상 장비도 무조건 기상 영향이 없는 것은 아님','Check product, crop, drift, wind and application method; ground equipment is not weather-independent']},
 TV:{purpose:['작업 장비의 이동·상하차를 지원','Transports equipment and supports loading / unloading'],attachment:['적재함·경사판·고정장치·허용 중량','Bed, loading ramps, restraints and permitted load'],checks:['장비 중량·치수·운송경로·운전 인력 확인. 등록 대수와 배차 가능 운송 용량은 별도','Check load, dimensions, route and driver. Fleet count is not dispatch transport capacity']},
 SE:{purpose:['작물에 맞는 장치를 사용해 종자를 파종','Sows seeds using a crop-specific mechanism'],attachment:['종자 규격별 파종판·조간·파종 깊이','Seed-specific metering, row spacing and sowing depth'],checks:['종자·작업기 호환 확인. 동일 파종기가 모든 작물을 지원하지는 않음','Verify seed and implement compatibility; one seeder does not support every crop']},
 GC:{purpose:['호환 곡물을 예취·탈곡·수집','Cuts, threshes and collects compatible grain crops'],attachment:['작물 전용 헤더·탈곡 설정·반출','Crop-specific header, threshing settings and haulage'],checks:['작물별 헤더·탈곡 호환과 운용 조건 확인','Verify crop-specific header, threshing compatibility and operating conditions']},
 RD:{purpose:['호환 작업기로 뿌리·구근 작물을 굴취','Lifts root / bulb crops using a compatible implement'],attachment:['작물 전용 굴취부·트랙터·수거 인력','Crop-specific lifting implement, tractor and collection crew'],checks:['작물·두둑·깊이·손상 가능성·수거 인원 확인','Check crop, ridges, depth, damage risk and collection crew']},
};
