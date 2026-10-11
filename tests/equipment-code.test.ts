import {it,expect} from 'vitest';
import {equipmentCode,nextEquipmentCode} from '../lib/equipment-code';
import {registeredDemo} from './registered-demo-fixture';

it('uses the next serial by center and kind, not the count or first gap',()=>{
 const s=registeredDemo().state;
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR03');
 s.machines.push({...s.machines[0],id:'JB23DR09'});
 s.machines.push({...s.machines[0],id:'JB24DR99',ownerCenterId:'neighbor'});
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR10');
 expect(nextEquipmentCode(s,'TV')).toBe('JB23TV03');
});
it('starts at 01, retains legacy aliases, and supports serials above 99',()=>{
 const s=registeredDemo().state;s.machines=[];s.missions=[];
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR01');
 s.machines.push({...registeredDemo().state.machines[0],id:'D2'});
 expect(equipmentCode('D2')).toBe('JB23DR02');
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR03');
 s.machines.push({...s.machines[0],id:'JB23DR99'});
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR100');
});
it('does not reuse identifiers referenced by prior work or loans',()=>{
 const s=registeredDemo().state;s.machines=[];
 s.missions[0].resourceId='JB23DR05';
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR06');
 s.centerSharing={centerId:'demo',neighborCenterIds:[],loans:[{id:'loan',machineId:'JB23DR08',ownerCenterId:'demo',borrowerCenterId:'other',usableFrom:'2026-01-01',usableUntil:'2026-01-02',status:'CANCELLED',transportConfirmed:false,operatorConfirmed:false}]};
 expect(nextEquipmentCode(s,'DR')).toBe('JB23DR09');
});
it('does not silently assign the Gyebuk prefix to an unconfigured center',()=>{
 expect(()=>nextEquipmentCode(registeredDemo().state,'DR','other')).toThrow('센터 장비코드');
});
