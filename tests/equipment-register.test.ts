import {it,expect} from 'vitest';
import {applyEquipmentEdit,equipmentInput} from '../lib/equipment-register';
import {registeredDemo} from './registered-demo-fixture';
const input=()=>equipmentInput.parse({id:'JB23DR03',name:'드론 3호',kind:'DR',capacityHaHour:2,status:'AVAILABLE',manufacturer:'',model:'',product:'',purchasedOn:'',servicePhone:'',notes:''});
it('adds owned equipment without touching work or historical records',()=>{const s=registeredDemo().state,n=applyEquipmentEdit(s,input());expect(n.machines.at(-1)?.ownerCenterId).toBe('demo');expect(n.missions).toEqual(s.missions);expect(s.machines).toHaveLength(16);expect(n.planVersion).toBe(s.planVersion+1)});
it('rejects duplicate and changed identity',()=>{const s=applyEquipmentEdit(registeredDemo().state,input());expect(()=>applyEquipmentEdit(s,input())).toThrow('이미');expect(()=>applyEquipmentEdit(s,{...input(),id:'JB23DR04'},'JB23DR03')).toThrow('변경할 수')});
it('retains safety lock and legacy type on metadata editing',()=>{const s=registeredDemo().state,m=s.machines.find(m=>m.id==='JB23TR01')!;m.safetyLock=true;const n=applyEquipmentEdit(s,{...input(),id:m.id,name:m.name,kind:'TR',capacityHaHour:m.capacityHaHour,model:'Verified model'},m.id);expect(n.machines.find(x=>x.id===m.id)?.type).toBe(m.type);expect(n.machines.find(x=>x.id===m.id)?.safetyLock).toBe(true)});
it('rejects changed capacity while unfinished work is booked',()=>{const s=registeredDemo().state,m=s.machines.find(x=>x.id==='JB23CB01')!;expect(()=>applyEquipmentEdit(s,{...input(),id:m.id,name:m.name,kind:'CB',capacityHaHour:9},m.id)).toThrow('미완료')});
