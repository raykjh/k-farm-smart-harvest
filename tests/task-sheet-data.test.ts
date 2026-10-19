import {it,expect} from 'vitest';
import {historyActor,historyDate} from '../lib/history-display';
import {withRegisteredInventory} from '../lib/inventory-view';
import {emptyConditions} from '../lib/field-conditions';
import {emptyCenter} from '../lib/center-registry';
import {applyEquipmentEdit,equipmentInput} from '../lib/equipment-register';
import {withNamedOperators} from '../lib/named-operators';
import {dateSlot,type SchedulingJob} from '../lib/scheduling-engine';
import {splitWorkAreaFixture} from './split-work-area-fixture';
it('formats history in KST and hides only UUID suffixes without changing audit values',()=>{
 const raw='계북면 테스트 담당자 [ae0326b0-83cb-4b5e-9a85-488eed222d56]';expect(historyActor(raw)).toBe('계북면 테스트 담당자');expect(raw).toContain('[ae0326');expect(historyDate('2026-10-11T14:52:43.894Z')).toBe('2026-10-11 23:52');expect(historyActor('담당자 [임시]')).toBe('담당자 [임시]');
});
it('projects access without changing crop, ownership or old state',()=>{
 const {state}=splitWorkAreaFixture(),before=structuredClone(state),f=state.fields[0];
 const next=withRegisteredInventory(state,[{pnu:f.id,address:f.address,area:f.area,crop:'',group:'',mode:'full',rights:'pending',conditions:{...emptyConditions(),machineAccess:'no'}}]);
 expect(next.fields[0].machineAccess).toBe('no');expect(next.fields[0].crop).toBe(f.crop);expect(state).toEqual(before);
});
it('validates equipment operator and carries the default into scheduling candidates',()=>{
 const {state}=splitWorkAreaFixture(),machine=state.machines[0],person=state.operatorRoster![0];
 const input=equipmentInput.parse({id:machine.id,name:machine.name,kind:'TR',capacityHaHour:machine.capacityHaHour,status:'AVAILABLE',manufacturer:'',model:'',product:'',purchasedOn:'',servicePhone:'',notes:'',defaultOperatorId:person.id});
 const next=applyEquipmentEdit(state,input,machine.id);expect(next.machines[0].defaultOperatorId).toBe(person.id);expect(next.missions).toEqual(state.missions);
 expect(()=>applyEquipmentEdit(state,{...input,defaultOperatorId:'10000000-0000-4000-8000-000000000099'},machine.id)).toThrow('등록 담당자');
 const d=dateSlot('2032-09-01'),job:SchedulingJob={id:'new',resource:machine.id,field:state.fields[0].id,person:null,staff:1,transport:1,original:d,duration:4,allowed:[d],selected:true,preferred:null,predecessor:null};
 const clone={...person,id:'10000000-0000-4000-8000-000000000099'};next.operatorRoster!.push(clone);
 const candidates=withNamedOperators(next,job,{resourceId:machine.id,machineOperators:1,staff:1}).options![0].operatorCandidates;expect(candidates?.map(p=>p.id)).toEqual([person.id]);
});
