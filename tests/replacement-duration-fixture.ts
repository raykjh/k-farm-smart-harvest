import {randomUUID} from 'node:crypto';
import {emptyCenter} from '../lib/center-registry';
import {dateSlot} from '../lib/scheduling-engine';
import type {WorkMission} from '../lib/replan-work-split';
export const replacementDay='2032-09-01';
export function replacementDurationFixture(){
 const s=emptyCenter('demo'),day=replacementDay,operator=randomUUID();s.staffCount=2;s.transportCount=1;s.crewCapacity={operators:1,workers:1};
 s.fields=[{id:'field',farmerId:'farmer',name:'홍가상',address:'격리 검증 농지',area:10000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'REGISTERED'}];
 s.machines=[{id:'JB23TR01',name:'기존 트랙터',type:'트랙터',capacityHaHour:0.2,status:'MAINTENANCE',safetyLock:false,ownerCenterId:'demo',compatibleCrops:['rice']},{id:'JSJGTR01',name:'대체 트랙터',type:'트랙터',capacityHaHour:0.1,status:'AVAILABLE',safetyLock:false,ownerCenterId:'janggye',compatibleCrops:['rice']}];
 s.operatorRoster=[{id:operator,name:'홍운영',active:true,kinds:['TR'],weekdays:[0,1,2,3,4,5,6],from:day,until:'2032-09-07',excludedDates:[],startMinute:480,endMinute:960,evidence:'격리 검증 근무'}];
 s.centerSharing={centerId:'demo',neighborCenterIds:['janggye'],loans:[],offers:[{id:randomUUID(),version:1,machineId:'JSJGTR01',ownerCenterId:'janggye',borrowerCenterId:'demo',from:day,to:'2032-09-03',compatibleMachineIds:['JB23TR01'],outboundSlots:2,returnSlots:2,agreementRef:'격리 검증 합의',conditions:'호환·운송 확인',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true}],blocks:[],lendingDays:[1,2,3].map(n=>({ownerCenterId:'janggye',date:`2032-09-0${n}`,capacity:1}))};
 const m:WorkMission={id:'work',fieldId:'field',label:'경운 및 정리',crop:'쌀',scheduledDate:day,month:9,owner:'장비',status:'HELD',resourceId:'JB23TR01',start:dateSlot(day)-dateSlot('2026-09-09'),duration:24,deadline:32,priority:1,batchKey:'fixture',staff:2,machineOperators:1,ordinaryWorkers:1,operatorIds:[operator],transport:1,compatibilityCrop:'rice',workAreaM2:10000,setupMinutes:60,predecessorMissionIds:[],operationKey:'test:soil',planningWindow:{from:day,to:'2032-09-03',duration:24,rainSensitive:false,windLimitMs:12,basis:'OPERATOR_PROVISIONAL_WINDOW'}};
 const prior:WorkMission={...m,id:'completed',label:'지난 작업',scheduledDate:'2032-08-01',status:'COMPLETED',operationKey:'test:before'};
 s.missions=[prior,m];return {s,m,operator};
}
