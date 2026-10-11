import {z} from 'zod';
import type {State,Mission} from './types';
import {supportsMissionCrop} from './replan-resource-options';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const replacementSchema=z.object({
 failedId:z.string().min(1),replacementId:z.string().min(1),
 availableFrom:day,availableUntil:day.optional(),arrivalConfirmed:z.boolean(),
 compatibilityConfirmed:z.boolean(),note:z.string().trim().min(1).max(500),
}).strict().refine(v=>!v.availableUntil||v.availableUntil>=v.availableFrom,'대여 종료일 확인 필요');
export type EquipmentReplacement=z.infer<typeof replacementSchema>;
// Dates are conservative full work days (08:00–16:00), after transport/setup.
// No purchase, loan, machine-status mutation or automatic safety unlock.
export function replacementFor(s:State,m:Mission,input?:EquipmentReplacement){
 if(!input||m.resourceId!==input.failedId)return null;
 const r=replacementSchema.parse(input),old=s.machines.find(x=>x.id===r.failedId),next=s.machines.find(x=>x.id===r.replacementId);
 if(!old||!next||old.id===next.id||old.status!=='MAINTENANCE')throw Error('고장 장비와 등록된 대체 장비를 확인하세요.');
 if(old.safetyLock)throw Error('안전잠금 사고는 대체 장비로 우회할 수 없습니다.');
 if(!r.arrivalConfirmed||!r.compatibilityConfirmed)throw Error('도착·현장 호환성 확인 전에는 대체 배차를 확정할 수 없습니다.');
 if(next.status!=='AVAILABLE'||next.safetyLock||next.type!==old.type)throw Error('사용 가능하고 같은 작업 유형인 대체 장비가 필요합니다.');
 if(!supportsMissionCrop(next,m))throw Error('대체 장비의 해당 작물 호환성을 장비대장에서 확인하세요.');
 if(!Number.isFinite(old.capacityHaHour)||!Number.isFinite(next.capacityHaHour)||old.capacityHaHour<=0||next.capacityHaHour<=0)throw Error('기존·대체 장비의 유효한 처리능률이 필요합니다.');
 return {machine:next,from:r.availableFrom,until:r.availableUntil};
}
