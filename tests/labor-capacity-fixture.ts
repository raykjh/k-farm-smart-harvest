import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {emptyCenter,centerRegistry} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {emptyLaborOps,type Worker} from '../lib/labor-operations';
import type {LaborCapacityWindow} from '../lib/labor-capacity';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const kinds=['laborRecovery','laborCapacityWindow','laborCapacityNotice','laborCapacityReceipt','laborOperations','laborOperationReceipt','laborShare','laborShareReceipt','laborShareNotice','centerGeography','centerSettings','equipmentLoan','equipmentSharingOffer','resourceReservation','laborDemand','replanning','taskPlanChange'];
export async function laborCapacityFixture(){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated test DB required');
 const centers=await db.center.findMany(),records=await db.workRecord.findMany({where:{kind:{in:kinds}}}),audit=await db.audit.findMany({select:{id:true}}),outbox=await db.outbox.findMany({select:{id:true}});
 const worker:Worker={id:randomUUID(),name:'홍가상',birth:'1960-01-01',phone:'000-0000-0000',address:'격리 검증용 주소',registeredFarmer:false,usesApp:false,active:true,weekdays:[0,1,2,3,4,5,6],preferredDates:[],excludedDates:[],startMinute:480,endMinute:960,workCodes:['harvest']};
 await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{kind:{in:kinds}}});
  for(const c of centerRegistry){
   const s=emptyCenter(c.id);s.staffCount=c.id==='demo'?1:0;s.crewCapacity={operators:0,workers:s.staffCount};
   await tx.center.upsert({where:{id:c.id},create:{id:c.id,state:json(s)},update:{state:json(s),version:1}});
   await tx.workRecord.create({data:{workspace:recordSpace(c.id),kind:'centerSettings',id:'current',payload:{location:null}}});
  }
  for(const [id,x] of [['demo',0],['janggye',1]] as const){
   await tx.workRecord.create({data:{workspace:recordSpace(id),kind:'centerGeography',id:'current',payload:{geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}}}});
   await tx.workRecord.create({data:{workspace:recordSpace(id),kind:'laborOperations',id:'current',payload:json({...emptyLaborOps(),people:id==='demo'?[worker]:[]})}});
  }
 });
 const window:Omit<LaborCapacityWindow,'id'|'status'|'actor'|'createdAt'|'ownerCenterId'|'workerName'>={borrowerCenterId:'janggye',workerId:worker.id,date:'2032-09-01',startMinute:480,endMinute:960,travelMinutes:30,workCodes:['harvest'],response:'PHONE',consent:true,reason:'격리 API 검증'};
 return {worker,window,async cleanup(){await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{kind:{in:kinds}}});if(records.length)await tx.workRecord.createMany({data:records as any});
  for(const c of centers)await tx.center.update({where:{id:c.id},data:{state:c.state as any,version:c.version}});
  for(const c of centerRegistry.filter(c=>!centers.some(old=>old.id===c.id)))await tx.center.delete({where:{id:c.id}});
  await tx.audit.deleteMany({where:{id:{notIn:audit.map(a=>a.id)}}});
  await tx.outbox.deleteMany({where:{id:{notIn:outbox.map(a=>a.id)}}});
 },{timeout:30000})}};
}
