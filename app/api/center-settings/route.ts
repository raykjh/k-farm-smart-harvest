import {isCenterOperator} from '@/lib/auth-policy';
import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/auth-route';
import {currentPrincipal,actorLabel} from '@/lib/auth';
import {db} from '@/lib/db';
import {centerId,recordSpace} from '@/lib/workspace';
import {centerDefinition} from '@/lib/center-registry';
import {readCenterSettings,saveCenterSetting} from '@/lib/center-settings-store';
import {readCenterWeatherConfig} from '@/lib/center-settings-store';
import {monthlyNormals} from '@/lib/climate-display';
import type {State} from '@/lib/types';
export const GET=withAuth('center-settings',async()=>{
 const id=centerId(),weather=await readCenterWeatherConfig(id);const result=await db.$transaction(async tx=>{
  const center=await tx.center.findUniqueOrThrow({where:{id}}),settings=await readCenterSettings(id,tx),s=center.state as unknown as State;
  const climate=await tx.workRecord.findMany({where:{workspace:'shared',kind:'climateNormals'},orderBy:{id:'asc'}});
  const criteria=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'productionCriteria',id:'current'}}});
  const geography=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'centerGeography',id:'current'}}});
  const users=await tx.workRecord.findMany({where:{workspace:'auth',kind:'user',payload:{path:['centerId'],equals:id}}});
  return {center:centerDefinition(id),geography:geography?.payload??null,version:center.version,settingsVersion:settings?.version??0,settings:settings?.payload??{},canManage:isCenterOperator(currentPrincipal()),canManageAccounts:currentPrincipal()?.role==='CENTER_ADMIN',staffCount:s.staffCount,transportCount:s.transportCount,crewCapacity:s.crewCapacity??null,
   operatorRoster:s.operatorRoster??null,operatorBookings:s.missions.filter(m=>m.operatorIds?.length&&m.status!=='CANCELLED'&&m.status!=='COMPLETED').map(m=>({id:m.id,date:m.scheduledDate,startMinute:480+(m.start%32+32)%32*15,durationMinutes:m.duration*15,task:m.label,machineId:m.resourceId,operatorIds:m.operatorIds})),
   accounts:{admins:users.filter(r=>(r.payload as any).enabled&&(r.payload as any).role==='CENTER_ADMIN').length,staff:users.filter(r=>(r.payload as any).enabled&&(r.payload as any).role==='CENTER_STAFF').length},
   resources:s.machines.filter(m=>!m.ownerCenterId||m.ownerCenterId===id).map(m=>({id:m.id,name:m.name,type:m.type,status:m.status,safetyLock:m.safetyLock,capacityHaHour:m.capacityHaHour})),criteriaCount:(criteria?.payload as any)?.profiles?.length??0,
   weather:{connected:!!(weather.key&&weather.nx&&weather.ny),nx:weather.nx??null,ny:weather.ny??null,source:'KMA'},
   datasets:climate.map(r=>{const v=r.payload as any;return {id:r.id,version:r.version,station:v.stationName,period:v.period,coverage:v.coverage??null,days:v.values?.length??0,sourceUrl:v.sourceUrl,months:monthlyNormals(v.values??[])}})};
 });return NextResponse.json(result);
});
export const POST=withAuth('center-settings',async req=>{
 try{const body=await req.json();return NextResponse.json(await db.$transaction(tx=>saveCenterSetting(tx,centerId(),actorLabel(),body),{timeout:body?.action==='operators'?60000:30000}));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'설정 저장 실패'},{status:409})}
});
