import {db} from '../lib/db';
import {recordSpace} from '../lib/workspace';
import {dateSlot} from '../lib/scheduling-engine';
import {syncChangedPlanReservations} from '../lib/plan-reservation-sync';
import type {State,Mission} from '../lib/types';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const day='2032-09-01';
export async function seedMission(centerId:string,support:string[]=[]){
 const before=(await db.center.findUniqueOrThrow({where:{id:centerId}})).state as unknown as State;
 const m={id:'recovery-harvest',fieldId:'recovery-p',label:'수확',crop:'고추',scheduledDate:day,month:9,owner:'센터 인력',status:'PLANNED',resourceId:null,start:dateSlot(day)+4-dateSlot('2026-09-09'),duration:4,deadline:999999,priority:1,batchKey:'recovery',staff:1,ordinaryWorkers:1,transport:0,laborSupportIds:support,operationCode:'harvest',predecessorMissionIds:[],planningWindow:{from:day,to:'2032-09-02',duration:4,rainSensitive:false,basis:'OPERATOR_PROVISIONAL_WINDOW'}} as Mission;
 const closed={...m,id:'completed',scheduledDate:'2032-08-01',status:'COMPLETED' as const,laborSupportIds:[]};
 const after={...before,fields:[{id:m.fieldId,farmerId:'recovery-f',name:'홍검증',address:'가상 검증지',area:1000,crop:'고추',mode:'완전 위탁형',access:true,water:true,confirmed:true,cluster:'test',source:'REGISTERED'}],missions:[closed,m]} as State;
 await db.$transaction(async tx=>{
  await syncChangedPlanReservations(tx,centerId,before,after,[m.id],'test');
  await tx.center.update({where:{id:centerId},data:{state:json(after)}});
  // The common plan path now creates demand for legacy manual tasks as well.
  await tx.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:recordSpace(centerId),kind:'laborDemand',id:m.id}}});
 });
 return {m,closed};
}
