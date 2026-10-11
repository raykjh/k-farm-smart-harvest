import type {Prisma} from '@prisma/client';
import {db} from './db';
import {centerId,recordSpace} from './workspace';
import {centerWeatherConfig} from './center-weather';
import {centerSettingCommand,type CenterSettings} from './center-settings';
import {lockCenterPool} from './center-resources';
import {isClosedTask} from './task-lifecycle';
import type {State} from './types';
import {assertCrewCapacityFits} from './operating-capacity';
import {fixedOperatorJobs} from './named-operators';
import {solveSchedule} from './scheduling-engine';
import {assertLaborCapacitySchedule,readLaborCapacity} from './labor-capacity-store';
export const centerSettingsKey=(id=centerId())=>({workspace:recordSpace(id),kind:'centerSettings',id:'current'});
export async function readCenterSettings(id=centerId(),client:Pick<Prisma.TransactionClient,'workRecord'>=db){return client.workRecord.findUnique({where:{workspace_kind_id:centerSettingsKey(id)}})}
export async function readCenterWeatherConfig(id=centerId()){
 const row=await readCenterSettings(id),p=row?.payload as CenterSettings|undefined;
 if(p&&Object.hasOwn(p,'location'))return {key:process.env.KMA_SERVICE_KEY,nx:p.location?.nx!==undefined?String(p.location.nx):undefined,ny:p.location?.ny!==undefined?String(p.location.ny):undefined};
 return centerWeatherConfig(id);
}
export async function saveCenterSetting(tx:Prisma.TransactionClient,id:string,actor:string,raw:unknown){
 const b=centerSettingCommand.parse(raw);await lockCenterPool(tx);
 const center=await tx.center.findUniqueOrThrow({where:{id}}),row=await readCenterSettings(id,tx);
 if(center.version!==b.version||(row?.version??0)!==b.settingsVersion)throw Error('센터 설정이 변경되었습니다. 새로고침한 뒤 다시 확인하세요.');
 const state=structuredClone(center.state) as unknown as State,p=structuredClone(row?.payload??{}) as CenterSettings;
 const proof=(e:zEvidence)=>({...e,reviewer:actor,reviewedAt:new Date().toISOString()});
 if(b.action==='capacity'){
  if(state.missions.some(m=>!isClosedTask(m.status))&&(b.staffCount<state.staffCount||b.transportCount<state.transportCount))throw Error('미완료 작업이 있어 자원 감소의 일정 영향 검토가 필요합니다. 먼저 예약·재계획에서 조정하세요.');
  state.staffCount=b.staffCount;state.transportCount=b.transportCount;
  if(b.crewCapacity)state.crewCapacity=b.crewCapacity;
  p.capacity={staffCount:b.staffCount,transportCount:b.transportCount,...(state.crewCapacity?{crewCapacity:state.crewCapacity}:{}),evidence:proof(b.evidence)};
 }else if(b.action==='operators'){
  state.operatorRoster=b.operators;
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),tasks=fixedOperatorJobs(state,today);
  if(tasks.length){
   const result=await solveSchedule({tasks,purpose:'INITIAL',daily:false,freezeBefore:0,staffCapacity:0,transportCapacity:0});
   if(result.status!=='FEASIBLE')throw Error('기존 확정 작업의 운영자·근무시간과 충돌합니다. 담당 배정을 먼저 검토하세요. '+result.reason);
   for(const a of result.assignments)if(a.operatorIds)state.missions.find(m=>m.id===a.id)!.operatorIds=a.operatorIds;
  }
 }else if(b.action==='location')p.location=b.location?{...b.location,evidence:proof(b.location.evidence)}:null;
 else {
  if(b.climate){const data=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:'shared',kind:'climateNormals',id:b.climate.datasetId}}});
   if(!data||data.version!==b.climate.datasetVersion||!Array.isArray((data.payload as any).values)||!(data.payload as any).values.length)throw Error('평년자료가 없거나 변경되었습니다. 자료를 다시 선택하세요.');}
  p.climate=b.climate?{...b.climate,evidence:proof(b.climate.evidence)}:null;
 }
 // Configuration changes invalidate unsaved proposals, not approved work or history.
 await assertLaborCapacitySchedule(tx,id,state);
 if(b.action==='capacity')assertCrewCapacityFits(state,new Set((await readLaborCapacity(tx,id)).incoming.map(w=>w.id)));
 state.planVersion++;for(const r of state.revisions)if(r.status==='REVIEW_REQUIRED')r.status='SUPERSEDED';
 await tx.center.update({where:{id},data:{state:JSON.parse(JSON.stringify(state)),version:{increment:1}}});
 await tx.workRecord.upsert({where:{workspace_kind_id:centerSettingsKey(id)},create:{...centerSettingsKey(id),version:1,payload:JSON.parse(JSON.stringify(p))},update:{payload:JSON.parse(JSON.stringify(p)),version:{increment:1},updatedAt:new Date()}});
 await tx.audit.create({data:{centerId:id,action:'center.settings.'+b.action,detail:{actor,before:row?.payload??null,after:JSON.parse(JSON.stringify(p)),...(b.action==='operators'?{beforeRoster:(center.state as unknown as State).operatorRoster??null,operatorRoster:b.operators,assignments:state.missions.filter(m=>m.operatorIds?.length).map(m=>({id:m.id,operatorIds:m.operatorIds}))}: {})}}});
 return {ok:true,version:center.version+1,settingsVersion:(row?.version??0)+1};
}
type zEvidence={basis:string;checkedOn:string};
