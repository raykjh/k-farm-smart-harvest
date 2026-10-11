import {emptyCenter} from '../../lib/center-registry';
import type {State,Mission,Machine} from '../../lib/types';
import type {ForecastResult} from '../../lib/kma-forecast';
import type {ReplanInput} from '../../lib/annual-replanning';
import type {ReplanAlternative} from '../../lib/planning-decision';
import type {LaborCapacityWindow} from '../../lib/labor-capacity';

// Fixed synthetic inputs, not real hiring, neighbor agreements or crop advice.
export const tradeoffDay='2032-09-01',tradeoffAsOf='2032-08-31';
export const tradeoffWeather={status:'NOT_CONFIGURED',kind:'short',points:[],sourceUrl:'fixture://unavailable',fetchedAt:tradeoffAsOf} as ForecastResult;
const op1='11111111-1111-4111-8111-111111111111',op2='22222222-2222-4222-8222-222222222222';
type Task=Mission&{operationCode:string;predecessorMissionIds:string[];planningWindow:{from:string;to:string;duration:number;windLimitMs:number;rainSensitive:boolean;basis:string}};
const machine=(id:string,ownerCenterId:string):Machine=>({id,ownerCenterId,name:'격리 비교 드론',type:'DR',status:'AVAILABLE',safetyLock:false,capacityHaHour:1});
function task(id:string,patch:Partial<Task>={}):Task{
 return {id,fieldId:id,crop:'쌀',label:'격리 작업',owner:'장비',status:'PLANNED',scheduledDate:tradeoffDay,month:9,resourceId:'JB23DR01',start:0,duration:16,deadline:32,priority:5,batchKey:id,staff:1,transport:1,machineOperators:1,ordinaryWorkers:0,operatorIds:[op2],operationCode:'spray',predecessorMissionIds:[],planningWindow:{from:tradeoffDay,to:'2032-09-03',duration:16,windLimitMs:5,rainSensitive:true,basis:'OPERATOR_PROVISIONAL_WINDOW'},...patch};
}
export function resourceTradeoffCase(kind:'equipment'|'labor'|'compound'){
 const centers=Object.fromEntries(['demo','janggye','cheoncheon','gyenam'].map(id=>[id,emptyCenter(id)])) as Record<string,State>;
 const state=centers.demo;
 state.staffCount=3;state.transportCount=2;state.crewCapacity={operators:2,workers:1};
 state.operatorRoster=[op1,op2].map(id=>({id,name:'격리 운영자',active:true,kinds:['DR'],weekdays:[0,1,2,3,4,5,6],from:'2032-01-01',until:'2032-12-31',excludedDates:[],startMinute:480,endMinute:960,evidence:'SYNTHETIC_QUALIFIED_OPERATOR'}));
 centers.cheoncheon.machines=[machine('JSCCDR01','cheoncheon')];
 centers.gyenam.machines=[machine('JSGNDR01','gyenam')];
 centers.janggye.staffCount=1;centers.janggye.crewCapacity={operators:0,workers:1};
 state.machines=[machine('JB23DR01','demo'),structuredClone(centers.cheoncheon.machines[0])];
 state.centerSharing={centerId:'demo',neighborCenterIds:['cheoncheon','janggye'],loans:[],
  offers:[{id:'33333333-3333-4333-8333-333333333333',version:1,machineId:'JSCCDR01',ownerCenterId:'cheoncheon',borrowerCenterId:'demo',from:tradeoffDay,to:tradeoffDay,compatibleMachineIds:['JB23DR01'],outboundSlots:2,returnSlots:2,agreementRef:'SYNTHETIC_ONLY',conditions:'격리된 검증용 허용',operatorConfirmed:true,transportConfirmed:true,noExtraApprovalRequired:true,enabled:true}],
  lendingDays:[{ownerCenterId:'cheoncheon',date:tradeoffDay,capacity:1}]};
 const support:LaborCapacityWindow={id:'44444444-4444-4444-8444-444444444444',ownerCenterId:'janggye',borrowerCenterId:'demo',workerId:'55555555-5555-4555-8555-555555555555',workerName:'가상지원자',date:tradeoffDay,startMinute:480,endMinute:960,travelMinutes:30,workCodes:['*'],response:'PHONE',consent:true,reason:'SYNTHETIC_ONLY',status:'CONFIRMED',actor:'fixture',createdAt:'2032-08-31T00:00:00Z'};
 state.laborCapacity={incoming:[support],outgoing:[]};
 const manual={owner:'센터 인력' as const,resourceId:null,machineOperators:0,ordinaryWorkers:1,operatorIds:[],transport:0};
 const selected=task('selected',kind==='labor'?manual:kind==='compound'?{staff:2,ordinaryWorkers:1}:{});
 const fixed=task('fixed-equipment',{operatorIds:[op1],duration:32,planningWindow:{...selected.planningWindow,duration:32}});
 const fixedLabor=task('fixed-labor',{...manual,duration:32,planningWindow:{...selected.planningWindow,duration:32}});
 state.missions=[selected,...(kind!=='labor'?[fixed]:[]),...(kind!=='equipment'?[fixedLabor]:[]),task('completed',{scheduledDate:'2032-08-20',status:'COMPLETED'})];
 state.fields=state.missions.map(m=>({id:m.fieldId,farmerId:'fixture-'+m.id,name:'가상참여자',address:'격리 비교 필지',area:1000,crop:'쌀',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'fixture',source:'DEMO_ASSUMPTION'}));
 const request:ReplanInput={ids:['selected'],preferred:tradeoffDay,reason:'동일 작업기간 내 희망일 유지와 외부 자원 부담 비교'};
 const alternatives:ReplanAlternative[]=[{id:'local',label:'현재 자원 유지',scope:'PRESERVE',replacement:'NONE',newLaborSupport:false}];
 if(kind!=='labor')alternatives.push({id:'equipment',label:'확인된 장비 차용',scope:'PRESERVE',newLaborSupport:false});
 if(kind!=='equipment')alternatives.push({id:'labor',label:'확정 인력 지원',scope:'PRESERVE',replacement:'NONE'});
 if(kind==='compound')alternatives.push({id:'combined',label:'장비와 인력 함께 지원',scope:'PRESERVE'});
 return {id:kind,centers,state,request,alternatives,asOf:tradeoffAsOf,weather:tradeoffWeather};
}
