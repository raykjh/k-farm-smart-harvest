import type {Prisma} from '@prisma/client';
import {centerDefinition} from './center-registry';
import {equipmentTypes,applyEquipmentEdit} from './equipment-register';
import {productionCriteria,type ProductionCriteria} from './continuous-production';
import {recordSpace} from './workspace';
import {saveCenterSetting} from './center-settings-store';
import {lockCenterPool} from './center-resources';
import type {State} from './types';
import {demoEquipmentCrops} from './demo-equipment-crops';
export const centerDemoBatch='new-centers-resources-2026-10-02';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
// Input data only. The production planner and reservation engine are unchanged.
// These windows/productivities are illustrative, not validated local crop advice.
export function centerDemoCriteria(center:string):ProductionCriteria{
 const region=centerDefinition(center).township;
 const windows={rice:{seed:['04-10','04-20'],nursery:['04-21','05-15'],soil:['05-16','05-24'],plant:['05-25','06-05'],harvest:['10-01','10-15'],finish:['10-02','10-20']},potato:{seed:['03-01','03-14'],soil:['03-15','03-24'],plant:['03-25','04-10'],harvest:['06-15','06-30'],finish:['06-16','07-05']},pepper:{seed:['03-20','04-20'],soil:['04-21','05-04'],plant:['05-05','05-20'],stake:['05-21','06-05'],harvest:['08-01','09-20'],finish:['08-02','09-25'],cleanup:['10-01','10-20']}};
 return productionCriteria.parse({profiles:[2026,2027].map(year=>({id:`${centerDemoBatch}-${year}`,name:`${year}년 작기`,dataOrigin:'DEMO',sourceBatchId:centerDemoBatch,context:{region,operations:Object.fromEntries(Object.entries(windows).map(([crop,steps])=>[crop,Object.fromEntries(Object.entries(steps).map(([code,[from,to]])=>[code,{from:`${year}-${from}`,to:`${year}-${to}`,laborMinutesPer1000m2:crop==='pepper'&&code==='harvest'?240:60,rainSensitive:true,...(crop==='pepper'&&['harvest','finish'].includes(code)?{occurrences:(code==='harvest'?[['08-01','08-10'],['08-20','08-30'],['09-10','09-20']]:[['08-02','08-15'],['08-21','09-05'],['09-11','09-25']]).map(([a,b],i)=>({occurrence:i+1,from:`${year}-${a}`,to:`${year}-${b}`}))}:{})}]))]))}}))});
}
export type CenterGeography={code:string;name:string;longitude:number;latitude:number;geometry:unknown;sourceUrl:string;fetchedAt:string};
export async function fetchCenterGeography(id:string):Promise<CenterGeography>{
 const c=centerDefinition(id),key=process.env.VWORLD_API_KEY?.trim(),domain=process.env.VWORLD_DOMAIN?.trim();if(!key||!domain)throw Error('VWorld 설정 필요');
 const url=new URL('https://api.vworld.kr/req/data');url.search=new URLSearchParams({service:'data',request:'GetFeature',version:'2.0',data:'LT_C_ADEMD_INFO',format:'json',crs:'EPSG:4326',size:'100',page:'1',geometry:'true',attribute:'true',attrFilter:'emd_cd:like:52740',key,domain}).toString();
 let data:any;try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();data=await r.json()}catch{throw Error('VWorld 지역 수신 실패')}
 if(data.response?.status!=='OK')throw Error('VWorld 지역 조회 실패');
 const f=data.response.result.featureCollection.features.find((f:any)=>f.properties.emd_kor_nm===c.township&&f.properties.full_nm===`전북특별자치도 장수군 ${c.township}`);
 if(!f||!/^52740\d{3}$/.test(f.properties.emd_cd)||!['Polygon','MultiPolygon'].includes(f.geometry?.type))throw Error('지역 경계 확인 실패');
 const coords=f.geometry.coordinates.flat(f.geometry.type==='Polygon'?1:2) as number[][];
 if(!coords.length||coords.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])||p[0]<124||p[0]>132||p[1]<32||p[1]>39))throw Error('지역 좌표 확인 실패');
 return {code:f.properties.emd_cd,name:c.township,longitude:(Math.min(...coords.map(p=>p[0]))+Math.max(...coords.map(p=>p[0])))/2,latitude:(Math.min(...coords.map(p=>p[1]))+Math.max(...coords.map(p=>p[1])))/2,geometry:f.geometry,sourceUrl:'https://www.vworld.kr',fetchedAt:new Date().toISOString()};
}
export async function installCenterDemo(tx:Prisma.TransactionClient,id:string,geography:CenterGeography){
 if(!['janggye','cheoncheon','gyenam'].includes(id))throw Error('새 센터에만 적용 가능');
 const space=recordSpace(id),batchKey={workspace:space,kind:'demoResourceBatch',id:centerDemoBatch};
 await lockCenterPool(tx);
 if(await tx.workRecord.findUnique({where:{workspace_kind_id:batchKey}}))return {id,unchanged:true};
 const row=await tx.center.findUniqueOrThrow({where:{id}}),before=json(row.state) as State;
 if(before.machines.length||before.fields.length||before.missions.length||before.staffCount||before.transportCount)throw Error(id+': 기존 운영 자료가 있어 덮어쓰지 않았습니다.');
 if(await tx.workRecord.count({where:{workspace:space,kind:{in:['centerSettings','productionCriteria','centerGeography']}}}))throw Error(id+': 기존 기준 자료가 있어 덮어쓰지 않았습니다.');
 if(geography.name!==centerDefinition(id).township)throw Error('지역 불일치');
 let state=structuredClone(before);
 const capacities={DR:1,TR:0.4,RP:0.3,PS:0.2,CB:0.3,PD:0.2,SP:0.5,TV:0};
 for(const [kind,type] of equipmentTypes.filter(([kind])=>Object.hasOwn(capacities,kind)))for(const n of [1,2])state=applyEquipmentEdit(state,{id:`${centerDefinition(id).prefix}${kind}0${n}`,name:type,kind,compatibleCrops:[...demoEquipmentCrops[kind]],capacityHaHour:capacities[kind as keyof typeof capacities],status:'AVAILABLE',manufacturer:'',model:'',product:'',purchasedOn:'',servicePhone:'',notes:`DEMO · ${centerDemoBatch}`},undefined,id);
 state.demoResourceBatchId=centerDemoBatch;
 await tx.center.update({where:{id},data:{state:json(state),version:{increment:1}}});
 const evidence={basis:`DEMO · ${centerDemoBatch} · 실제 확보 자원 아님`,checkedOn:'2026-10-02'};
 const a=await saveCenterSetting(tx,id,'development-demo-input',{action:'capacity',version:row.version+1,settingsVersion:0,staffCount:6,transportCount:2,evidence});
 await saveCenterSetting(tx,id,'VWorld-import',{action:'location',version:a.version,settingsVersion:a.settingsVersion,location:{longitude:geography.longitude,latitude:geography.latitude,sourceUrl:geography.sourceUrl,evidence:{basis:'VWorld 면 경계의 경계상자 중심 · 센터 건물 위치나 전체 농지의 기상 대표점이 아님',checkedOn:'2026-10-02'}}});
 const criteria=centerDemoCriteria(id);
 await tx.workRecord.create({data:{workspace:space,kind:'productionCriteria',id:'current',version:1,payload:json(criteria)}});
 await tx.workRecord.create({data:{workspace:space,kind:'centerGeography',id:'current',version:1,payload:json(geography)}});
 // Retain exact before state and created keys for selective cleanup / recovery.
 await tx.workRecord.create({data:{...batchKey,payload:{source:'DEMO',beforeCenter:json(row),createdMachineIds:state.machines.map(m=>m.id),createdRecordKinds:['centerSettings','productionCriteria','centerGeography'],createdAt:new Date().toISOString(),cropYears:[2026,2027],actualGeography:true}}});
 await tx.audit.create({data:{centerId:id,action:'center.demoResources.install',detail:{batchId:centerDemoBatch,equipment:16,crew:6,transport:2}}});
 return {id,unchanged:false,equipment:16,crew:6,transport:2,cropProfiles:2,regionCode:geography.code};
}
