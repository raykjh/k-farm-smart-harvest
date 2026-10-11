import {registeredDemo as build,type DemoParcel} from '../lib/registered-demo';
export {DEMO_BATCH,demoEquipment,demoMachineIds,seasonalOperations} from '../lib/registered-demo';
// Invented test inputs, never supplied by an operating registration endpoint.
// No assertion of public cadastral identity, area or actual ownership.
export const syntheticDemoParcels:DemoParcel[]=Array.from({length:30},(_,i)=>({
 pnu:'5274036023'+String(900000000+i).padStart(9,'0'),
 address:`전북특별자치도 장수군 계북면 합성검증리 ${9000+i}`,area:1000+i*20,land:i<10?'답':'전',source:'SYNTHETIC_TEST_INPUT',
}));
export const registeredDemo=()=>build(syntheticDemoParcels);
