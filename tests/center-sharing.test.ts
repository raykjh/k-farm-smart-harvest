import {describe,it,expect} from 'vitest';
import {machineAvailableToCenter,validateLoan,type EquipmentLoan} from '../lib/center-sharing';
import type {Machine} from '../lib/types';
const machine:Machine={id:'DR01',ownerCenterId:'gyenam',name:'드론',type:'DR',status:'AVAILABLE',safetyLock:false,capacityHaHour:1};
const loan:EquipmentLoan={id:'loan1',machineId:'DR01',ownerCenterId:'gyenam',borrowerCenterId:'gyebuk',usableFrom:'2026-09-21',usableUntil:'2026-09-23',status:'CONFIRMED',transportConfirmed:true,operatorConfirmed:true};
const sharing={centerId:'gyebuk',neighborCenterIds:['gyenam'],loans:[loan]};
describe('center sharing',()=>{
 it('permits confirmed nearby equipment only during the loan',()=>{expect(machineAvailableToCenter(machine,'2026-09-22',sharing)).toBe(true);expect(machineAvailableToCenter(machine,'2026-09-24',sharing)).toBe(false)});
 it('does not duplicate owner availability',()=>expect(machineAvailableToCenter(machine,'2026-09-22',{...sharing,centerId:'gyenam'})).toBe(false));
 it('rejects unconfirmed, unknown owner and missing personnel',()=>{expect(machineAvailableToCenter(machine,'2026-09-22',{...sharing,loans:[{...loan,status:'REQUESTED'}]})).toBe(false);expect(machineAvailableToCenter({...machine,ownerCenterId:undefined},'2026-09-22',sharing)).toBe(false);expect(()=>validateLoan({...loan,operatorConfirmed:false},[])).toThrow()});
 it('blocks overlapping reservations and invalid dates',()=>{expect(()=>validateLoan({...loan,id:'other'},[loan])).toThrow();expect(()=>validateLoan({...loan,usableFrom:'2026-02-30'},[])).toThrow()});
 it('preserves legacy inventory but does not import external equipment implicitly',()=>{expect(machineAvailableToCenter({...machine,ownerCenterId:undefined},'2026-09-22')).toBe(true);expect(machineAvailableToCenter(machine,'2026-09-22')).toBe(false)});
});
