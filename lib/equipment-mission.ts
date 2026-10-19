import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {State,Mission} from './types';
import {equipmentDownOn} from './equipment-downtime';
import {workGeometrySchema,validateWorkGeometry} from './work-area-geometry';
import {resolveSplitArea,type SplitWorkArea} from './split-work-area';
import type {WorkMission} from './replan-work-split';
import {immovable} from './replan-scope';
import {cropCodes,cropNames} from './crop-registry';
import {missionReservation} from './plan-reservation-sync';
import type {SharedReservation} from './shared-reservations';
export const workAreaInput=z.object({pnu:z.string().regex(/^\d{19}$/),geometry:workGeometrySchema,source:z.enum(['FIELD_SURVEY','OPERATOR_DRAWN']),reviewedOn:z.string().date(),accessAndExclusionsReviewed:z.literal(true),machineAccessConfirmed:z.boolean().default(false),note:z.string().trim().min(3).max(1000)}).strict();
export type WorkArea=z.infer<typeof workAreaInput>&{version:number;reviewedBy:string};
export function missionPacket(state:State,centerId:string,missionId:string,parentArea:WorkArea|null,reservations:SharedReservation[],today:string,splitAreas:SplitWorkArea[]=[]){
 const mission=state.missions.find(m=>m.id===missionId),field=state.fields.find(f=>f.id===mission?.fieldId),machine=state.machines.find(m=>m.id===mission?.resourceId);
 const blockers:string[]=[];
 const split=(mission as WorkMission)?.equipmentSplit,saved=splitAreas.find(a=>a.groupId===split?.groupId)??null;
 const review=split?resolveSplitArea(state,split.groupId,parentArea,saved,today):null;
 const part=saved?.parts.find(p=>p.missionId===missionId);
 const work=mission as WorkMission|undefined,operationKey=work?.operationKey;
 // Replacement suffixes can follow a legacy part marker; do not mistake those
 // records (or their first piece) for a full-field operation.
 const partMarker=/:part\d+(?=:|$)/;
 const unlinkedPartial=!split&&(!!operationKey&&(partMarker.test(operationKey)||state.missions.some(t=>{const key=(t as WorkMission).operationKey;return t.fieldId===mission?.fieldId&&key&&partMarker.test(key)&&key.replace(partMarker,'')===operationKey;}))||!!work?.workAreaM2&&!!field?.area&&work.workAreaM2<field.area*0.95);
 const area:WorkArea|null=unlinkedPartial?null:split?(review?.ready&&part&&parentArea&&saved?{...parentArea,geometry:part.geometry,source:saved.source,reviewedOn:saved.reviewedOn,note:saved.note,version:saved.version,reviewedBy:saved.reviewedBy}:null):parentArea;
 if(unlinkedPartial)blockers.push('UNLINKED_WORK_PARTS');
 if(split&&!review?.ready)blockers.push('SPLIT_WORK_AREA_REVIEW_REQUIRED');
 if(area){try{validateWorkGeometry(area.geometry)}catch{blockers.push('INVALID_WORK_AREA_GEOMETRY');}}
 if(!mission||mission.resourceOccupancyOnly||mission.owner!=='장비')blockers.push('EQUIPMENT_TASK_REQUIRED');
 if(mission?.status!=='PLANNED'||!mission?.scheduledDate||mission.scheduledDate<today||immovable(mission))blockers.push('FUTURE_APPROVED_TASK_REQUIRED');
 if(mission?.laborRecoveryRequired)blockers.push('LABOR_RECOVERY_REQUIRED');
 // Canonical registrations deliberately retain pending legal/ownership status.
 // Operational access is a separate, explicit field review, not an enrollment flag.
 // Older areas without this review remain blocked until the operator reviews them.
 if(!field||(field.machineAccess!==undefined?field.machineAccess!=='yes':!area?.machineAccessConfirmed))blockers.push('FIELD_ACCESS_REVIEW_REQUIRED');
 if(!area||area.pnu!==field?.id||area.reviewedOn>today)blockers.push('OPERATOR_REVIEWED_WORK_AREA_REQUIRED');
 if(!machine||machine.status!=='AVAILABLE'||machine.safetyLock)blockers.push('EQUIPMENT_UNAVAILABLE');
 if(machine&&mission?.scheduledDate&&equipmentDownOn(machine,mission.scheduledDate))blockers.push('EQUIPMENT_REPAIR_PERIOD');
 const crop=cropCodes.find(c=>cropNames[c]===mission?.crop);
 if(!crop||!machine?.compatibleCrops?.includes(crop))blockers.push('EQUIPMENT_CROP_COMPATIBILITY_REQUIRED');
 const ids=mission?.operatorIds?.length?mission.operatorIds:machine?.defaultOperatorId?[machine.defaultOperatorId]:[],operatorCount=mission?.machineOperators??(machine?1:0);
 const minute=mission?480+((mission.start%32+32)%32)*15:0;
 const operators=state.operatorRoster?.filter(p=>ids.includes(p.id))??[];
 if(!operatorCount||new Set(ids).size!==operatorCount||operators.length!==operatorCount||operators.some(p=>!p.active||!p.kinds.some(k=>machine?.id.includes(k))||p.from>mission!.scheduledDate!||p.until<mission!.scheduledDate!||p.excludedDates.includes(mission!.scheduledDate!)||!p.weekdays.includes(new Date(mission!.scheduledDate!+'T00:00:00Z').getUTCDay())||p.startMinute>minute||p.endMinute<minute+mission!.duration*15))blockers.push('NAMED_QUALIFIED_OPERATOR_REQUIRED');
 if(mission&&ids.length&&state.missions.some(other=>other.id!==mission.id&&!other.resourceOccupancyOnly&&!['CANCELLED','COMPLETED'].includes(other.status)&&other.scheduledDate===mission.scheduledDate&&((other.start%32+32)%32)<((mission.start%32+32)%32)+mission.duration&&((mission.start%32+32)%32)<((other.start%32+32)%32)+other.duration&&(other.operatorIds?.length?other.operatorIds:[state.machines.find(m=>m.id===other.resourceId)?.defaultOperatorId]).some(id=>id&&ids.includes(id))))blockers.push('OPERATOR_BOOKING_CONFLICT');
 const expected=mission?missionReservation(centerId,mission):null;
 const reservation=expected?reservations.find(r=>r.centerId===centerId&&r.taskId===missionId&&r.resourceId===expected.resourceId&&Date.parse(r.from)===Date.parse(expected.from)&&Date.parse(r.to)===Date.parse(expected.to)):null;
 if(!reservation)blockers.push('MATCHING_RESERVATION_REQUIRED');
 const details=mission as Mission&{operationCode?:string;predecessorMissionIds?:string[];planningWindow?:{from:string;to:string};executionReviewRequired?:boolean};
 if(details?.planningWindow&&mission?.scheduledDate&&(mission.scheduledDate<details.planningWindow.from||mission.scheduledDate>details.planningWindow.to))blockers.push('OUTSIDE_OPERATION_WINDOW');
 const splitArea=split?{...split,reviewVersion:saved?.version??null,parentVersion:parentArea?.version??null,reviewFingerprint:review?.reviewFingerprint??null,reviewRequired:!review?.ready}:null;
 const data={schemaVersion:split?'equipment-mission-v2':'equipment-mission-v1',centerId,missionId,planVersion:state.planVersion,fieldId:field?.id??null,crop:crop??null,operationCode:details?.operationCode??null,equipmentId:machine?.id??null,operatorIds:ids,scheduledDate:mission?.scheduledDate??null,startMinute:minute,durationMinutes:mission?mission.duration*15:null,workArea:area??null,splitArea,reservation:reservation??null,predecessors:details?.predecessorMissionIds??[],executionAuthorized:false as const,transport:'LOCAL_ADAPTER_ONLY' as const,executionChecks:['ON_SITE_WEATHER','PREDECESSOR_COMPLETION','PEOPLE_AND_OBSTACLE_CLEARANCE','EMERGENCY_STOP_AND_GEOFENCE','EQUIPMENT_ADAPTER_CERTIFICATION',...(details?.executionReviewRequired?['TREATMENT_OR_GROWTH_REVIEW']:[])]};
 // Relevant inputs only. Unrelated work can change without invalidating this packet.
 const fingerprint=createHash('sha256').update(JSON.stringify({mission,area,machine,operators,reservation,field,...(split?{parentArea,splitArea}: {})})).digest('hex');
 return {fingerprint,blockers:[...new Set(blockers)],ready:blockers.length===0,data};
}
