import {createHash} from 'node:crypto';
import type {EquipmentSplit,EquipmentWork,Mission,State} from './types';
import type {ReplanInput} from './annual-replanning';
import {replacementFor} from './equipment-replacement';
import {equipmentWork,resourceCandidates,resourceDuration,resourceUsable,supportsMissionCrop,type ReplanResource} from './replan-resource-options';
import {immovable} from './replan-scope';
import {dateSlot,slotDate} from './scheduling-engine';
import {splitGroup} from './split-work-area';

export type WorkMission=Mission&{workAreaM2?:number;setupMinutes?:number;equipmentWork?:EquipmentWork;equipmentSplit?:EquipmentSplit;splitFromId?:string;splitChildIds?:string[];predecessorMissionIds?:string[];operationKey?:string;planningWindow?:{from:string;to:string;duration:number;[key:string]:unknown}};
export type WorkSplit={sourceId:string;partIds:string[];areaHa:number;basis:EquipmentWork['basis']};
export function missionCandidates(s:State,m:Mission,input:ReplanInput):ReplanResource[]{
 const explicit=replacementFor(s,m,input.replacement);
 const candidates=explicit?[{machine:explicit.machine,borrowed:!!s.centerSharing&&explicit.machine.ownerCenterId!==s.centerSharing.centerId}]:resourceCandidates(s,m,input.automaticReplacement!==false);
 return input.allowBorrowing===false?candidates.filter(r=>!r.borrowed||r.machine?.id===m.resourceId):candidates;
}
/** Second attempt only. Preserve the original ID as part 1; its pre-change
 * snapshot remains in taskPlanChange. Never split started/closed/locked work. */
export function splitReplanWork(raw:State,input:ReplanInput,asOf:string){
 const state=structuredClone(raw),splits:WorkSplit[]=[],selected=new Set(input.ids);
 for(const id of input.ids){
  const m=state.missions.find(t=>t.id===id) as WorkMission|undefined;
  if(!m||immovable(m)||!m.resourceId||!m.planningWindow)continue;
  const priorGroup=m.equipmentSplit?splitGroup(state,m.equipmentSplit.groupId):null;
  if(!priorGroup&&m.splitChildIds?.length)throw Error('기존 분할 식별정보를 먼저 연결하세요.');
  const work=equipmentWork(state,m);if(!work)continue;
  const from=Math.max(dateSlot(asOf),dateSlot(m.planningWindow.from)),to=dateSlot(m.planningWindow.to);
  if(to<from||to-from>731*32)continue;
  const viable=missionCandidates(state,m,input).filter(r=>supportsMissionCrop(r.machine,m)).flatMap(r=>{
   const usable=32-(r.offer?.outboundSlots??0)-(r.offer?.returnSlots??0);
   if(usable-Math.ceil(work.setupSlots??0)<1)return [];
   for(let at=from;at<=to;at+=32){const day=slotDate(at);
    if(input.replacement&&(day<input.replacement.availableFrom||input.replacement.availableUntil&&day>input.replacement.availableUntil))continue;
    if(resourceUsable(state,r,day,r.offer?.outboundSlots??0,1))return [{duration:resourceDuration(state,m,r),usable}];
   }return [];
  });
  const setup=Math.ceil(work.setupSlots??0);
  // An extremely slow alternative must not force every other candidate into
  // dozens of parts. Use the smallest multi-day partition among viable options;
  // the common engine rejects options that still cannot fit a part in a day.
  const counts=viable.map(r=>Math.max(1,Math.ceil((r.duration-setup)/(r.usable-setup))));
  const count=counts.length?Math.min(...counts):1;
  if(count===1)continue;
  const total=(priorGroup?.members.length??1)+count-1,ordinal=m.equipmentSplit?.part??1;
  if(total>32||state.missions.length+count-1>5000)throw Error('분할 작업 수가 검토 한도를 초과합니다. 일부 작업을 생략하지 않았습니다.');
  if(priorGroup?.members.some(t=>immovable(t)&&(t.status!=='COMPLETED'||t.equipmentSplit!.part>=ordinal)))throw Error('시작·잠금 회차 또는 뒤쪽 완료 회차는 재분할할 수 없습니다. 완료 구역과 순서를 보존합니다.');
  const dependents=(state.missions as WorkMission[]).filter(t=>t.predecessorMissionIds?.includes(id));
  if(dependents.some(immovable))throw Error('잠금·시작·완료된 후속 작업이 있어 자동 분할할 수 없습니다. 연결 작업을 먼저 검토하세요.');
  const revision=createHash('sha256').update(JSON.stringify([id,raw.planVersion,count,work])).digest('hex').slice(0,24);
  const groupId=priorGroup?.groupId??revision,sourceId=priorGroup?.sourceId??id;
  const partIds=Array.from({length:count},(_,i)=>i===0?id:`work-split:${revision}:${i+1}`);
  if(partIds.slice(1).some(id=>state.missions.some(t=>t.id===id)))throw Error('기존 분할 기록과 충돌합니다. 새로 불러오세요.');
  const source=structuredClone(m),upstream=source.predecessorMissionIds??[];
  const parts=partIds.map((partId,index):WorkMission=>({
   ...structuredClone(source),id:partId,label:source.label.replace(/ \(분할 \d+\/\d+\)$/,'')+` (분할 ${ordinal+index}/${total})`,
   duration:Math.max(1,Math.ceil(source.duration/count)),
   planningWindow:{...source.planningWindow!,duration:Math.max(1,Math.ceil(source.duration/count))},
   equipmentWork:{...work,areaHa:work.areaHa/count},equipmentSplit:{sourceId,part:ordinal+index,parts:total,groupId},
   ...(index?{splitFromId:id}:{}),
   ...(source.workAreaM2?{workAreaM2:source.workAreaM2/count}:{}),
   splitChildIds:undefined,
   operationKey:index===0?source.operationKey:`${source.operationKey??id}:split:${revision}:${index+1}`,
   predecessorMissionIds:index===0?upstream:[partIds[index-1]],
   operatorIds:[],laborSupportIds:[],
  }));
  Object.assign(m,parts[0]);state.missions.push(...parts.slice(1));
  for(const next of dependents)next.predecessorMissionIds=next.predecessorMissionIds!.map(p=>p===id?partIds.at(-1)!:p);
  for(const previous of priorGroup?.members??[]){
   if(previous.id===id||immovable(previous))continue;
   const sibling=state.missions.find(t=>t.id===previous.id) as WorkMission;
   const part=previous.equipmentSplit!.part+(previous.equipmentSplit!.part>ordinal?count-1:0);
   sibling.equipmentSplit={sourceId,groupId,part,parts:total};
   sibling.label=sibling.label.replace(/ \(분할 \d+\/\d+\)$/,'')+` (분할 ${part}/${total})`;
   selected.add(sibling.id);
  }
  const root=state.missions.find(t=>t.id===sourceId) as WorkMission;
  if(!immovable(root))root.splitChildIds=(state.missions as WorkMission[]).filter(t=>t.equipmentSplit?.groupId===groupId&&t.id!==sourceId).sort((a,b)=>a.equipmentSplit!.part-b.equipmentSplit!.part).map(t=>t.id);
  partIds.forEach(id=>selected.add(id));
  splits.push({sourceId:id,partIds,areaHa:work.areaHa,basis:work.basis});
 }
 const expanded:ReplanInput={...input,ids:[...selected]};
 return {state,input:expanded,splits};
}
export const splitKey=(splits:WorkSplit[])=>JSON.stringify(splits.map(s=>[s.sourceId,s.partIds,s.areaHa,s.basis]));
