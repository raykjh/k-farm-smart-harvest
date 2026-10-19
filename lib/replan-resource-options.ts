import type {Machine,Mission,State} from './types';
import type {SharingOffer} from './equipment-sharing-offers';
import {machineAvailableToCenter} from './center-sharing';
import {equipmentDownOn} from './equipment-downtime';
import {sameEquipmentKind} from './equipment-code';
import {cropCodes,cropNames} from './crop-registry';
export type ReplanResource={machine:Machine|null;offer?:SharingOffer;borrowed:boolean};
export function equipmentWork(s:State,m:Mission):import('./types').EquipmentWork|null{
 const existing=(m as Mission&{equipmentWork?:import('./types').EquipmentWork}).equipmentWork;
 if(existing){if(!Number.isFinite(existing.areaHa)||existing.areaHa<=0||!Number.isFinite(existing.setupSlots??0)||(existing.setupSlots??0)<0)throw Error('작업량 기준 확인 필요');return existing;}
 const old=s.machines.find(x=>x.id===m.resourceId);
 if(!old||!Number.isFinite(old.capacityHaHour)||old.capacityHaHour<=0)return null;
 const known=m as Mission&{workAreaM2?:number;setupMinutes?:number};
 if(Number.isFinite(known.workAreaM2)&&known.workAreaM2!>0&&Number.isFinite(known.setupMinutes)&&known.setupMinutes!>=0)return {areaHa:known.workAreaM2!/10000,setupSlots:known.setupMinutes!/15,basis:'PLAN_AREA_AND_SETUP',referenceMachineId:old.id,referenceCapacityHaHour:old.capacityHaHour,referenceDuration:m.duration};
 return {areaHa:m.duration/4*old.capacityHaHour,basis:'APPROVED_DURATION_X_CAPACITY',referenceMachineId:old.id,referenceCapacityHaHour:old.capacityHaHour,referenceDuration:m.duration};
}
export function resourceDuration(s:State,m:Mission,r:ReplanResource){
 if(!r.machine||r.machine.id===m.resourceId&&!(m as Mission&{equipmentWork?:unknown}).equipmentWork)return m.duration;
 const work=equipmentWork(s,m);
 if(!work||!Number.isFinite(r.machine.capacityHaHour)||r.machine.capacityHaHour<=0)throw Error('장비 처리능력·작업량 확인 필요');
 const time=work.areaHa/r.machine.capacityHaHour*4+(work.setupSlots??0);
 // With no separate setup record, do not promise a faster-than-approved run.
 const conservative=work.basis==='APPROVED_DURATION_X_CAPACITY'?Math.max(time,work.areaHa/work.referenceCapacityHaHour*4):time;
 return Math.max(1,Math.ceil(conservative-1e-9));
}
export function supportsMissionCrop(machine:Machine|undefined|null,mission:Mission){return !mission.resourceId||!mission.compatibilityCrop||!!machine?.compatibleCrops?.includes(mission.compatibilityCrop);}
export function requiredLoanPool(s:State,r:ReplanResource,date:string){
 if(!r.borrowed||!r.offer||!r.machine)return;
 if(s.centerSharing?.loans.some(l=>l.machineId===r.machine!.id&&l.borrowerCenterId===s.centerSharing!.centerId&&l.status==='CONFIRMED'&&l.usableFrom<=date&&date<=l.usableUntil))return;
 const capacity=s.centerSharing?.lendingDays?.find(d=>d.ownerCenterId===r.offer!.ownerCenterId&&d.date===date)?.capacity??0;
 return {id:r.offer.ownerCenterId+':'+date,capacity};
}
export function resourceCandidates(s:State,m:Mission,automatic=true):ReplanResource[]{
 const original=s.machines.find(x=>x.id===m.resourceId),sharing=s.centerSharing;
 const result:ReplanResource[]=[{machine:original??null,borrowed:!!original?.ownerCenterId&&!!sharing&&original.ownerCenterId!==sharing.centerId}];
 if(!automatic||!m.resourceId||!original||original.safetyLock)return result;
 // Same-center equipment needs no inter-center loan, but must explicitly
 // support the crop; a label alone is not evidence of implement compatibility.
 const localCenter=sharing?.centerId??original.ownerCenterId??'demo';
 // The original three-crop intake path stores the selected crop name without
 // the newer catalog marker. Resolve that stable identity, never equipment
 // compatibility: the substitute must still explicitly list this crop.
 const crop=m.compatibilityCrop??cropCodes.find(code=>cropNames[code]===m.crop);
 for(const candidate of s.machines){
  if(candidate.id===original.id||(candidate.ownerCenterId??localCenter)!==localCenter||!sameEquipmentKind(original,candidate)||!(candidate.capacityHaHour>0)||!(original.capacityHaHour>0))continue;
  if(!crop||!candidate.compatibleCrops?.includes(crop))continue;
  result.push({machine:candidate,borrowed:false});
 }
 // A separately approved repair loan must work without a standing offer too.
 for(const loan of sharing?.loans??[]){
  if(loan.status!=='CONFIRMED'||loan.borrowerCenterId!==localCenter||!loan.operatorConfirmed||!loan.transportConfirmed||!sharing!.neighborCenterIds.includes(loan.ownerCenterId))continue;
  const candidate=s.machines.find(x=>x.id===loan.machineId&&x.ownerCenterId===loan.ownerCenterId);
  if(!candidate||!sameEquipmentKind(original,candidate)||!(candidate.capacityHaHour>0)||!(original.capacityHaHour>0)||!crop||!candidate.compatibleCrops?.includes(crop)||result.some(r=>r.machine?.id===candidate.id))continue;
  result.push({machine:candidate,borrowed:true});
 }
 for(const offer of sharing?.offers??[]){
  if(!offer.enabled||!offer.noExtraApprovalRequired||!offer.operatorConfirmed||!offer.transportConfirmed||offer.borrowerCenterId!==sharing!.centerId||!offer.compatibleMachineIds.includes(m.resourceId))continue;
  const candidate=s.machines.find(x=>x.id===offer.machineId);
  if(!candidate||candidate.ownerCenterId!==offer.ownerCenterId||candidate.id===original.id||!sameEquipmentKind(candidate,original)||!(original.capacityHaHour>0)||!Number.isFinite(candidate.capacityHaHour)||candidate.capacityHaHour<=0)continue;
  const borrowed=offer.ownerCenterId!==sharing!.centerId;
  if(borrowed&&!sharing!.neighborCenterIds.includes(offer.ownerCenterId))continue;
  if(result.some(r=>r.machine?.id===candidate.id))continue;
  result.push({machine:candidate,offer,borrowed});
 }return result.sort((a,b)=>Number(a.borrowed)-Number(b.borrowed));
}
export function resourceUsable(s:State,r:ReplanResource,date:string,start:number,duration:number){
 const m=r.machine;if(!m)return true;if(equipmentDownOn(m,date))return false;
 if(m.status!=='AVAILABLE'||m.safetyLock||m.availableFrom&&date<m.availableFrom||m.availableUntil&&date>m.availableUntil)return false;
 if(s.centerSharing?.blocks?.some(b=>b.machineId===m.id&&b.date===date))return false;
 if(r.offer){const o=r.offer;
  if(date<o.from||date>o.to||start<o.outboundSlots||start+duration>32-o.returnSlots)return false;
  // An owner's pre-authorization cannot override another approved borrower.
  if(s.centerSharing?.loans.some(l=>l.machineId===m.id&&l.status==='CONFIRMED'&&l.usableFrom<=date&&date<=l.usableUntil&&l.borrowerCenterId!==s.centerSharing!.centerId))return false;
  if((requiredLoanPool(s,r,date)?.capacity??1)<=0)return false;
  return true;
 }return machineAvailableToCenter(m,date,s.centerSharing);
}
