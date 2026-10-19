import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {db} from '../lib/db';
import {authKey,digest} from '../lib/auth';
import {centerRegistry,emptyCenter} from '../lib/center-registry';
import {recordSpace} from '../lib/workspace';
import {registrationCommand} from '../lib/registration-service';
import {demoInputBatchSchema} from '../lib/registration-origin';
import {catalogField} from './catalog-fixtures';
import {WORKLOAD_CATALOG_VERSION,workloadEquipment} from '../lib/crop-workload-catalog';
import {fourCenterTestUrl} from './four-center-fixture';
import {syntheticCadastre} from './synthetic-cadastre';
import type {SupportedCropCode} from '../lib/crop-registry';

export async function prepareChronologicalFixture(){
 if(process.env.DATABASE_URL!==fourCenterTestUrl||process.env.AI_MODE!=='demo'||process.env.NEBIUS_API_KEY)throw Error('Disposable, model-free four-center DB required');
 const tokens:Record<string,string>={},batches=Object.fromEntries(centerRegistry.map(c=>[c.id,randomUUID()]));
 await db.$transaction(async tx=>{
  await tx.outbox.deleteMany();await tx.receipt.deleteMany();await tx.audit.deleteMany();await tx.workRecord.deleteMany();await tx.center.deleteMany();
  for(const c of centerRegistry){
   const state=emptyCenter(c.id);state.demoResourceBatchId=batches[c.id];state.staffCount=6;state.crewCapacity={operators:2,workers:4};state.transportCount=2;
   state.machines=workloadEquipment.flatMap(e=>[1,2].map(n=>({id:c.prefix+(e.id==='GS'?'SP':e.id)+'0'+n,name:e.name,type:e.name,status:'AVAILABLE' as const,safetyLock:false,ownerCenterId:c.id,capacityHaHour:0.4,compatibleCrops:['rice','potato','pepper','barley'] as SupportedCropCode[]})));
   state.operatorRoster=[1,2].map(n=>({id:randomUUID(),name:'홍운'+n,active:true,kinds:['TR','RP','PS','CB','PD','SE','GC','RD','DR','SP'],weekdays:[0,1,2,3,4,5,6],from:'2026-01-01',until:'2027-12-31',excludedDates:[],startMinute:480,endMinute:960,evidence:'격리 검증용 가상 운용자'}));
   await tx.center.create({data:{id:c.id,state:JSON.parse(JSON.stringify(state))}});
   const id=randomUUID(),token=randomBytes(32).toString('hex');tokens[c.id]=token;
   await tx.workRecord.create({data:{...authKey('user',id),payload:{id,username:'chronology-'+c.id,name:c.township+' 검증 담당자',role:'CENTER_ADMIN',centerId:c.id,enabled:true,passwordHash:'NO_PASSWORD_LOGIN'}}});
   await tx.workRecord.create({data:{...authKey('session',digest(token)),payload:{userId:id,expiresAt:Date.parse('2099-01-01')}}});
  }
 },{timeout:30000});
 const entries=Array.from({length:30},(_,i)=>{
  const center=centerRegistry[i%4],crop=(['rice','potato','pepper'] as const)[Math.floor(i/4)%3],index=Math.floor(i/4);
  return input(center.id,index,crop,`2026-01-${String(i+2).padStart(2,'0')}`,batches[center.id],i);
 });
 // A later autumn application proves that the same intake is not a once-a-year batch.
 entries.push(input('gyenam',10,'barley','2026-10-01',batches.gyenam,30));
 // Versions depend on approved prior intake. Seal each payload just before entry,
 // after reading the ordinary current inventory version; no schedule is seeded.
 return {tokens,batches,entries};
}

function input(centerId:string,index:number,crop:SupportedCropCode,on:string,batchId:string,nameIndex:number){
 const center=centerRegistry.find(c=>c.id===centerId)!,parcel=syntheticCadastre.parcels.filter(p=>p.centerId===centerId)[index],field=catalogField(crop,1000);
 field.conditions!.region=center.township;field.conditions!.checkedOn=on;
 const farmerName='홍'+'가나다라마바사아자차'[Math.floor(nameIndex/10)]+'가나다라마바사아자차'[nameIndex%10];
 const command=registrationCommand.parse({requestId:randomUUID(),consultationId:randomUUID(),consultationVersion:0,fieldVersion:0,testDataOnly:true,demoInputBatchId:batchId,cultivations:[],continuousService:{from:on,until:null,continuousConsent:true},consultation:{farmer:{name:farmerName,birth:'1960-01-01',phone:'000-0000-'+String(nameIndex+1).padStart(4,'0'),contact:'sms'},application:{policy:'OWNER_SERVICE_V1',residence:'합성 신청인 주소',cultivationHistory:'합성 경작 이력',supportReason:'검증용 가상 신청',exceptionReason:'',review:'pending'},fields:[{id:randomUUID(),pnu:parcel.pnu,address:parcel.address,area:'1000',crop:'',conditions:field.conditions,mode:'delegated',tenure:'owned',ownerName:farmerName,ownerPhone:'',evidence:'none',end:'',callAt:'',operator:'',callResult:'pending',scope:'가상 소유·참여 설정. 실제 소유권·동의 증거 아님.',verified:'pending'}],consent:true,step:3}});
 return {centerId,crop,on,command};
}

export function chronologyCriteria(centerId:string,batchId:string){
 return {profiles:[{id:'crop30-2026',name:'현재 공통 작업표의 2026년 가상 수치',dataOrigin:'DEMO',sourceBatchId:batchId,context:{region:centerRegistry.find(c=>c.id===centerId)!.township,catalog:{version:WORKLOAD_CATALOG_VERSION,year:2026,dataOrigin:'DEMO',sourceBatchId:batchId}}}]};
}

export async function sealChronologicalInput(entry:ReturnType<typeof input>){
 const workspace=recordSpace(entry.centerId),key={workspace,kind:'demoInputBatch',id:entry.command.demoInputBatchId!};
 const inventory=await db.workRecord.findUnique({where:{workspace_kind_id:{workspace,kind:'fields',id:'current'}}});
 entry.command.fieldVersion=inventory?.version??0;
 const previous=await db.workRecord.findUnique({where:{workspace_kind_id:key}});
 const payload=demoInputBatchSchema.parse({version:'demo-registration-inputs-v1',id:key.id,centerId:entry.centerId,status:'READY',registrations:[...(previous?.payload as any)?.registrations??[],{requestId:entry.command.requestId,inputHash:createHash('sha256').update(JSON.stringify(registrationCommand.parse(entry.command))).digest('hex')}]});
 await db.workRecord.upsert({where:{workspace_kind_id:key},create:{...key,payload},update:{payload,version:{increment:1}}});
}
