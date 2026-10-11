import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {State} from './types';
import type {WorkMission} from './replan-work-split';
import type {WorkArea} from './equipment-mission';
import {immovable} from './replan-scope';
import {workGeometrySchema,validateWorkPartition,draftRemainingWorkPartition} from './work-area-geometry';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const splitAreaInput=z.object({
 groupId:z.string().min(1).max(100),source:z.enum(['FIELD_SURVEY','OPERATOR_DRAWN']),
 reviewedOn:z.string().date(),note:z.string().trim().min(3).max(1000),
 accessAndExclusionsReviewed:z.literal(true),
 parts:z.array(z.object({missionId:z.string().min(1).max(200),geometry:workGeometrySchema}).strict()).min(2).max(32),
}).strict();
export type SplitWorkArea=z.infer<typeof splitAreaInput>&{
 version:number;parentVersion:number;reviewFingerprint:string;reviewedBy:string;savedAt:string;
};
export function splitGroup(state:State,groupId:string){
 const stored=(state.missions as WorkMission[]).filter(m=>m.equipmentSplit?.groupId===groupId).sort((a,b)=>a.equipmentSplit!.part-b.equipmentSplit!.part);
 const total=stored.length;
 // Completed rows retain the partition count from their original approval.
 // Only the current review projection gets an updated total; no history rewrite.
 const members=stored.map(m=>m.status==='COMPLETED'&&Number.isInteger(m.equipmentSplit!.parts)&&m.equipmentSplit!.parts>=m.equipmentSplit!.part&&m.equipmentSplit!.parts<=total?{...m,equipmentSplit:{...m.equipmentSplit!,parts:total}}:m);
 const first=members[0],split=first?.equipmentSplit;
 if(members.length>32)throw Error('현장 구역 검토는 한 그룹 32회차 이내로 나누어 진행하세요.');
 if(!first||!split||members.length<2||members.length!==split.parts||split.sourceId!==first.id||new Set(members.map(m=>m.id)).size!==members.length||members.some((m,i)=>m.equipmentSplit!.part!==i+1||m.equipmentSplit!.parts!==members.length||m.equipmentSplit!.sourceId!==first.id||m.fieldId!==first.fieldId||m.crop!==first.crop||m.owner!=='장비'||!m.equipmentWork?.areaHa||!Number.isFinite(m.equipmentWork.areaHa)))throw Error('분할 작업 구성이 변경되었거나 불완전합니다.');
 return {groupId,sourceId:first.id,fieldId:first.fieldId,members,editable:members.some(m=>!immovable(m))&&members.every(m=>m.status==='COMPLETED'||!immovable(m))};
}
export function splitReviewFingerprint(state:State,groupId:string,parent:WorkArea|null){
 const group=splitGroup(state,groupId);
 // Date/equipment changes invalidate packets, not an unchanged reviewed partition.
 // Area, crop, predecessor and group membership changes require a new area review.
 return hash({parent,members:group.members.map(m=>({id:m.id,fieldId:m.fieldId,crop:m.crop,equipmentSplit:m.equipmentSplit,equipmentWork:m.equipmentWork,workAreaM2:m.workAreaM2,predecessors:m.predecessorMissionIds}))});
}
export function fixedSplitAreas(state:State,groupId:string,parent:WorkArea|null,prior:SplitWorkArea|null){
 const group=splitGroup(state,groupId),fixed=new Map<number,import('./work-area-geometry').WorkGeometry>();
 for(const [i,m] of group.members.entries())if(immovable(m)){
  const area=prior?.parts.find(p=>p.missionId===m.id)?.geometry;
  if(m.status!=='COMPLETED'||!area||prior?.parentVersion!==parent?.version)throw Error('완료된 회차의 기존 확인 구역이 필요합니다. 완료 기록이나 구역을 추정하지 않습니다.');
  fixed.set(i,area);
 }
 return fixed;
}
export function draftSplitReview(state:State,groupId:string,parent:WorkArea,prior:SplitWorkArea|null,axis:'EW'|'NS'){
 const group=splitGroup(state,groupId);
 return draftRemainingWorkPartition(parent.geometry,group.members.map(m=>m.equipmentWork!.areaHa),fixedSplitAreas(state,groupId,parent,prior),axis);
}
export function validateSplitReview(state:State,groupId:string,parent:WorkArea|null,input:z.infer<typeof splitAreaInput>,today:string,prior:SplitWorkArea|null=null){
 const group=splitGroup(state,groupId);
 if(!parent||parent.pnu!==group.fieldId||parent.reviewedOn>today||!parent.machineAccessConfirmed||!parent.accessAndExclusionsReviewed)throw Error('먼저 전체 작업구역과 장비 진입을 현장 확인하세요.');
 if(input.groupId!==groupId||input.reviewedOn>today||input.reviewedOn<parent.reviewedOn)throw Error('분할 구역 확인일은 전체 구역 확인일 이후, 오늘 이내여야 합니다.');
 if(group.members.some(m=>m.status==='CANCELLED')||input.parts.length!==group.members.length||new Set(input.parts.map(p=>p.missionId)).size!==input.parts.length||group.members.some(m=>!input.parts.some(p=>p.missionId===m.id)))throw Error('현재의 모든 분할 작업에 구역을 하나씩 연결해야 합니다.');
 for(const [i,geometry] of fixedSplitAreas(state,groupId,parent,prior))if(hash(input.parts.find(p=>p.missionId===group.members[i].id)!.geometry)!==hash(geometry))throw Error('완료된 회차의 확인 구역은 변경할 수 없습니다.');
 const metrics=validateWorkPartition(parent.geometry,group.members.map(m=>input.parts.find(p=>p.missionId===m.id)!.geometry),group.members.map(m=>m.equipmentWork!.areaHa));
 const plannedAreaM2=group.members.reduce((n,m)=>n+m.equipmentWork!.areaHa*10000,0);
 // Provisional data-consistency guard. This is not a surveying accuracy claim.
 if(Math.abs(metrics.totalAreaM2-plannedAreaM2)>plannedAreaM2*0.05)throw Error('현장 경계 면적과 계획 작업면적이 5% 이상 다릅니다. 작업량·배차 검토 후 연결하세요.');
 return {...metrics,plannedAreaM2,areaTolerance:0.05};
}
export function resolveSplitArea(state:State,groupId:string,parent:WorkArea|null,saved:SplitWorkArea|null,today:string){
 let reviewFingerprint:string|null=null;
 try{
  reviewFingerprint=splitReviewFingerprint(state,groupId,parent);
  if(!saved)return {ready:false,reason:'분할별 현장 작업구역 연결 필요',reviewFingerprint};
  if(saved.reviewFingerprint!==reviewFingerprint||saved.parentVersion!==parent?.version)return {ready:false,reason:'작업량·전체 구역이 변경되어 분할 구역을 다시 확인해야 합니다.',reviewFingerprint};
  const input=splitAreaInput.parse({groupId:saved.groupId,source:saved.source,reviewedOn:saved.reviewedOn,note:saved.note,accessAndExclusionsReviewed:saved.accessAndExclusionsReviewed,parts:saved.parts});
  const metrics=validateSplitReview(state,groupId,parent,input,today,saved);
  return {ready:true,reason:'',reviewFingerprint,metrics};
 }catch(e){return {ready:false,reason:e instanceof Error?e.message:'분할 구역 검토 필요',reviewFingerprint};}
}
