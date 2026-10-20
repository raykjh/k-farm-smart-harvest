import {randomUUID} from 'node:crypto';
import {emptyCenter} from '../lib/center-registry';
import type {RetirementSnapshot} from '../lib/demo-retirement';
export function preparedFixture(){
 const batchId=randomUUID(),farmer=randomUUID(),request=randomUUID(),cycle=randomUUID(),pnu='5274036023100000099',other='5274036023100000098',mission='cultivation:'+cycle+':plant',job='job:'+mission;
 const state=emptyCenter('demo');state.planVersion=4;state.registered=true;state.planned=true;
 state.fields=[{id:pnu,farmerId:farmer,name:'가공 신청',address:'가공 주소',area:1000,crop:'감자',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'',source:'DEMO_ASSUMPTION',demoBatchId:batchId},{id:other,farmerId:'ordinary-owner',name:'기존 신청',address:'기존 주소',area:123.5,crop:'감자',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'',source:'REGISTERED'}];
 state.missions=[{id:mission,fieldId:pnu,label:'파종',crop:'감자',owner:'장비',status:'PLANNED',resourceId:'retained-machine',start:0,duration:2,deadline:32,month:3,priority:1,batchKey:cycle,staff:1,transport:1}];
 state.machines=[{id:'retained-machine',name:'공유 트랙터',type:'TR',status:'AVAILABLE',safetyLock:false,capacityHaHour:0.4}];
 state.productionLedger={version:1,entries:{[pnu]:{id:pnu,referenceId:'x',referenceVersion:'1',commodity:'POTATO',period:{year:2027},areaM2:1000,kg:{low:2000,high:3000},source:'DEMO_ASSUMPTION'},[other]:{id:other,referenceId:'x',referenceVersion:'1',commodity:'POTATO',period:{year:2027},areaM2:123.5,kg:{low:200,high:300},source:'REGISTERED'}},totals:{'DEMO_ASSUMPTION:POTATO:2027':{low:2000,high:3000},'REGISTERED:POTATO:2027':{low:200,high:300}}};
 const records:{workspace:string;kind:string;id:string;version:number;payload:unknown}[]=[];
 const add=(kind:string,id:string,payload:unknown,workspace='sandbox')=>records.push({workspace,kind,id,version:1,payload});
 add('demoInputBatch',batchId,{version:'demo-registration-inputs-v1',id:batchId,centerId:'demo',status:'READY',registrations:[{requestId:request,inputHash:'a'.repeat(64)}]});
 add('registrationOrigin',farmer,{version:'registration-origin-v1',dataOrigin:'SYNTHETIC',batchId,consultationId:farmer,requestId:request,inputHash:'a'.repeat(64),pnus:[pnu],actorId:'test',registeredAt:'2026-10-20T00:00:00Z'});
 add('consultation',farmer,{farmer:{name:'가공 신청'},fields:[{pnu}]});
 add('registrationReceipt',request,{result:{consultationId:farmer}});
 add('fields','current',[{pnu,consultationId:farmer,area:1000},{pnu:other,consultationId:'ordinary-owner',area:123.5}]);
 add('cultivation',cycle,{id:cycle,pnu,crop:'potato',start:'2027-03-01',end:'2027-06-30'});
 add('cultivationPlan',cycle,{plots:[{pnu,tasks:[{id:mission,fieldId:pnu}]}]});
 add('fieldParticipation',pnu,{pnu,consultationId:farmer,status:'ACTIVE'});
 add('continuousProduction','current',{fingerprint:'before',sourceFingerprint:'before',items:[{pnu,status:'ACTIVE'},{pnu:other,status:'REVIEW'}]});
 add('laborOperations','current',{people:[{id:'worker',name:'기존 인력'}],jobs:[{id:job,missionId:mission,fieldId:pnu,status:'OPEN',worked:[],assigned:['worker']}],notices:[{id:'notice',jobId:job,workerId:'worker'}],penalties:[]});
 add('resourceReservation','booking',{id:'booking',centerId:'demo',taskId:mission,resourceId:'retained-machine'},'shared');
 add('centerSettings','current',{location:{longitude:127.6,latitude:35.7}});
 const snapshot:RetirementSnapshot={centers:[JSON.stringify({id:'demo',version:4,state})],records:records.map(r=>JSON.stringify(r)),outbox:[],receipts:[]};
 return {snapshot,state,records,batchId,pnu,other,farmer,cycle,mission,job};
}
