import {isClosedTask} from './task-lifecycle';
import {z} from 'zod';
import type {Machine,State} from './types';
import {cropCodeSchema} from './crop-registry';
export const equipmentTypes=[['DR','방제 드론','Spraying drone'],['TR','트랙터','Tractor'],['RP','이앙기','Rice transplanter'],['PS','감자 파종기','Potato planter'],['CB','콤바인','Combine'],['PD','감자 굴취기','Potato digger'],['SP','지상 방제기','Ground sprayer'],['TV','장비 운송차량','Transport vehicle'],['SE','밭작물 파종기','Field crop seeder'],['GC','곡물 콤바인','Grain combine'],['RD','뿌리작물 굴취기','Root crop digger']] as const;
export const equipmentInput=z.object({id:z.string().regex(/^[A-Z0-9-]{2,32}$/),name:z.string().trim().min(1).max(100),defaultOperatorId:z.string().uuid().optional(),kind:z.enum(['DR','TR','RP','PS','CB','PD','SP','TV','SE','GC','RD']),compatibleCrops:z.array(cropCodeSchema).max(30).refine(c=>new Set(c).size===c.length,'호환 작물 중복').optional(),capacityHaHour:z.number().nonnegative().max(100),status:z.enum(['AVAILABLE','MAINTENANCE','UNKNOWN']),manufacturer:z.string().trim().max(100),model:z.string().trim().max(100),product:z.string().trim().max(100),purchasedOn:z.string().refine(v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v).toISOString().slice(0,10)===v),servicePhone:z.string().max(40),notes:z.string().max(1000)}).strict();
export type EquipmentInput=z.infer<typeof equipmentInput>;
export type LedgerMachine=Machine&{ledger?:Omit<EquipmentInput,'id'|'name'|'capacityHaHour'|'status'>};
export function applyEquipmentEdit(state:State,input:EquipmentInput,existingId?:string,owner='demo'){
 if(input.kind!=='TV'&&input.capacityHaHour<=0)throw Error('시간당 작업면적은 0보다 커야 합니다.');
 const s=structuredClone(state),old=s.machines.find(m=>m.id===existingId) as LedgerMachine|undefined;
 if(existingId&&!old)throw Error('장비를 찾을 수 없습니다.');
 if(old&&old.id!==input.id)throw Error('장비코드는 변경할 수 없습니다.');
 if(old?.ownerCenterId&&old.ownerCenterId!==owner)throw Error('다른 센터 소유 장비는 수정할 수 없습니다.');
 if(!old&&s.machines.some(m=>m.id===input.id))throw Error('이미 등록된 장비코드입니다.');
 if(!old&&!input.id.includes(input.kind))throw Error('장비코드에 선택한 종류 코드가 필요합니다. 예: JB23TR03');
 const oldKind=old?.ledger?.kind??equipmentTypes.find(t=>old?.id.includes(t[0]))?.[0];
 const type=old&&oldKind===input.kind?old.type:equipmentTypes.find(t=>t[0]===input.kind)![1];
 const busy=old&&s.missions.some(m=>m.resourceId===old.id&&!isClosedTask(m.status));
 const compatibleCrops=input.compatibleCrops??old?.compatibleCrops;
 if(busy&&JSON.stringify([...(compatibleCrops??[])].sort())!==JSON.stringify([...(old?.compatibleCrops??[])].sort()))throw Error('미완료 배정 작업이 있습니다. 호환 작물 변경 전 예약·재계획을 확인하세요.');
 if(old&&busy&&(old.type!==type||old.capacityHaHour!==input.capacityHaHour||old.status!==input.status))throw Error('미완료 배정 작업이 있습니다. 예약·재계획에서 조정한 뒤 운용 조건을 변경하세요.');
 const defaultOperatorId=input.defaultOperatorId;
 if(defaultOperatorId&&!state.operatorRoster?.some(p=>p.id===defaultOperatorId&&p.active&&p.kinds.includes(input.kind)))throw Error('선택한 장비 종류를 운용할 수 있는 등록 담당자를 선택하세요.');
 const {id,name,capacityHaHour,status,...ledger}=input;
 const value:LedgerMachine={...old,id,name,capacityHaHour,status,type,defaultOperatorId,ownerCenterId:old?.ownerCenterId??owner,safetyLock:old?.safetyLock??false,ledger,...(compatibleCrops?{compatibleCrops}:{})};
 if(old)s.machines=s.machines.map(m=>m.id===id?value:m);else s.machines.push(value);
 s.planVersion++;return s;
}
