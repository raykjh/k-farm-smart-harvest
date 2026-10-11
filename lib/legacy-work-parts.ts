import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {State} from './types';
import type {WorkMission} from './replan-work-split';
import {immovable} from './replan-scope';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const marker=/:part(\d+)(?=:|$)/;
export const legacyPartsInput=z.object({key:z.string().length(64),fingerprint:z.string().length(64),note:z.string().trim().min(3).max(1000),confirmed:z.literal(true),parts:z.array(z.object({missionId:z.string().min(1).max(200),workAreaM2:z.number().positive().max(10000000),setupMinutes:z.number().min(0).max(480)}).strict()).min(2).max(32)}).strict();
/** Suggest only explicit legacy operation/part identities, never proximity,
 * dates or matching labels. Incomplete or completed histories are not rewritten. */
export function legacyWorkGroups(state:State){
 const groups=new Map<string,WorkMission[]>();
 for(const m of state.missions as WorkMission[]){
  if(m.equipmentSplit||m.owner!=='장비'||!m.operationKey)continue;
  const key=hash([m.fieldId,m.crop,m.operationKey.replace(marker,'')]);
  groups.set(key,[...(groups.get(key)??[]),m]);
 }
 return [...groups].filter(([,members])=>members.some(m=>marker.test(m.operationKey!))).map(([key,rows])=>{
  const part=(m:WorkMission)=>Number(m.operationKey!.match(marker)?.[1]??1),members=[...rows].sort((a,b)=>part(a)-part(b));
  const valid=members.length>=2&&members.length<=32&&members.every((m,i)=>part(m)===i+1&&!immovable(m)&&!!m.scheduledDate);
  return {key,fingerprint:hash({members,machines:members.map(m=>state.machines.find(r=>r.id===m.resourceId))}),editable:valid,
   reason:valid?'':'회차 누락·중복 또는 시작·완료·잠금 기록은 자동 이관하지 않습니다.',members};
 });
}
export function linkLegacyWorkParts(state:State,raw:z.infer<typeof legacyPartsInput>){
 const input=legacyPartsInput.parse(raw),g=legacyWorkGroups(state).find(g=>g.key===input.key);
 if(!g||!g.editable||g.fingerprint!==input.fingerprint)throw Error('기존 부분 작업이 변경되었거나 명시적 이관이 불가능합니다. 새로 확인하세요.');
 if(input.parts.length!==g.members.length||new Set(input.parts.map(p=>p.missionId)).size!==g.members.length||g.members.some(m=>!input.parts.some(p=>p.missionId===m.id)))throw Error('모든 기존 회차의 작업량을 하나씩 확인하세요.');
 const next=structuredClone(state),groupId=hash(['legacy-parts-v1',g.key,input.parts]).slice(0,24),sourceId=g.members[0].id;
 for(const [i,old] of g.members.entries()){
  const p=input.parts.find(p=>p.missionId===old.id)!,machine=state.machines.find(m=>m.id===old.resourceId);
  if(!machine||!Number.isFinite(machine.capacityHaHour)||machine.capacityHaHour<=0)throw Error('기존 장비의 처리능력을 확인하세요.');
  if(Math.ceil(p.workAreaM2/10000/machine.capacityHaHour*4+p.setupMinutes/15-1e-9)>old.duration)throw Error('확인 작업량이 승인된 작업시간을 초과합니다. 일정·작업량을 먼저 검토하세요.');
  const m=next.missions.find(m=>m.id===old.id) as WorkMission;
  m.workAreaM2=p.workAreaM2;m.setupMinutes=p.setupMinutes;
  m.equipmentWork={areaHa:p.workAreaM2/10000,setupSlots:p.setupMinutes/15,basis:'PLAN_AREA_AND_SETUP',referenceMachineId:machine.id,referenceCapacityHaHour:machine.capacityHaHour,referenceDuration:old.duration};
  m.equipmentSplit={groupId,sourceId,part:i+1,parts:g.members.length};
  if(i===0)m.splitChildIds=g.members.slice(1).map(m=>m.id);
 }
 // Only identity/workload metadata changes. No dates, reservations, labor,
 // completion status, geometry, or equipment commands are fabricated here.
 next.planVersion++;
 return {state:next,groupId,missionIds:g.members.map(m=>m.id)};
}
