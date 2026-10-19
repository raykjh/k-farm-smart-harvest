import {z} from 'zod';
import type {Machine,State} from './types';
import {immovable} from './replan-scope';
export const equipmentDowntimeSchema=z.object({machineId:z.string().min(1).max(100),from:z.string().date(),returnOn:z.string().date()}).strict().refine(v=>v.from<v.returnOn&&Date.parse(v.returnOn)-Date.parse(v.from)<=366*86400000,'입고일 이후의 복귀 예정일을 입력하세요 (최대 1년).');
export type EquipmentDowntime=z.infer<typeof equipmentDowntimeSchema>;
export const equipmentDownOn=(machine:Machine,date:string)=>machine.downtimes?.some(p=>p.from<=date&&date<p.returnOn)??false;
export function applyDowntimeForPlanning(state:State,raw:EquipmentDowntime,ids:string[],expanded=false){
 const outage=equipmentDowntimeSchema.parse(raw),machine=state.machines.find(m=>m.id===outage.machineId);
 if(!machine||machine.ownerCenterId&&machine.ownerCenterId!==(state.centerSharing?.centerId??'demo'))throw Error('소유 센터의 장비만 입고·복귀 기간을 등록할 수 있습니다.');
 if(state.centerSharing?.loans.some(l=>l.machineId===machine.id&&l.status==='CONFIRMED'&&l.usableFrom<outage.returnOn&&l.usableUntil>=outage.from&&l.borrowerCenterId!==state.centerSharing!.centerId))throw Error('수리 기간에 다른 센터의 확정 차용이 있습니다. 차용 변경·취소부터 확인하세요.');
 const affected=state.missions.filter(m=>m.resourceId===machine.id&&m.scheduledDate&&outage.from<=m.scheduledDate&&m.scheduledDate<outage.returnOn&&!['COMPLETED','CANCELLED'].includes(m.status));
 if(affected.some(immovable))throw Error('입고 기간의 시작·잠금 작업은 자동 조정할 수 없습니다. 먼저 현장 상태를 확인하세요.');
 if(!expanded&&affected.some(m=>!ids.includes(m.id)))throw Error('입고부터 복귀 전까지 해당 장비의 모든 미시작 작업을 선택하세요.');
 if(!ids.some(id=>affected.some(m=>m.id===id)))throw Error('해당 장비의 수리 기간에 변경할 작업이 없습니다.');
 return {...state,machines:state.machines.map(m=>m.id===machine.id?{...m,downtimes:[...m.downtimes??[],outage]}:m)};
}
