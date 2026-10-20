import {createHash,randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {emptyCenter} from '../lib/center-registry';
import {emptyLaborOps,ordinaryLaborAvailability,newAttendance,advanceAttendance,type LaborJob} from '../lib/labor-operations';
import type {Mission} from '../lib/types';
export const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
export const offset=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function smsInput(date='2032-09-01'){
 const s=emptyCenter('demo'),owner=randomUUID();
 s.ruleVersion='ISOLATED_SMS_'+randomUUID();s.staffCount=4;
 s.fields=[1,2].map(n=>({id:'sms-field-'+n,farmerId:owner,name:'홍소유',address:'계북면 문자 검증 필지 '+n,area:1000,crop:'고추' as const,mode:'완전 위탁형' as const,access:true,water:true,confirmed:true,cluster:'sms',source:'DEMO_ASSUMPTION' as const}));
 s.missions=s.fields.map((f,i)=>({id:'sms-work-'+i,fieldId:f.id,crop:'고추',label:'고추 수확',owner:'센터 인력',resourceId:null,status:'PLANNED',scheduledDate:date,month:Number(date.slice(5,7)),start:0,duration:4,deadline:32,priority:1,batchKey:'sms',staff:1,ordinaryWorkers:1,transport:0} as Mission));
 const labor=emptyLaborOps();labor.people=['홍문자','홍전화'].map((name,i)=>({id:randomUUID(),name,birth:'1960-01-01',phone:'000-0000-000'+i,address:'격리 인력 주소',registeredFarmer:false,usesApp:i===0,active:true,...ordinaryLaborAvailability()}));
 const m=s.missions[0],value={id:m.id,missionId:m.id,task:m.label,address:s.fields[0].address,date,startMinute:480,durationMinutes:60,count:1,workCode:'general',held:false};
 const j:LaborJob={...value,id:randomUUID(),sourceHash:createHash('sha256').update(JSON.stringify(value)).digest('hex'),pay:'격리 검증 조건',status:'OPEN',invited:[],responses:{},distances:Object.fromEntries(labor.people.map((p,i)=>[p.id,i+1])),assigned:[],manual:null,worked:[],attendance:newAttendance()};
 labor.jobs=[j];advanceAttendance(labor,j,offset(date,-7)+'T09:00:00+09:00');
 const contacts=new Map([[owner,{name:'홍소유',phone:'000-0000-0000'}]]);
 return {s,owner,labor,contacts,date};
}
/** Preserve the disposable database too; never operate on a production DB. */
export async function smsFixture(date?:string){
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('isolated test DB required');
 const kinds=['smsManagementReceipt','smsResendRequest','laborRecovery','smsMessage','smsAttempt','consultation','laborOperations','laborDemand'],spaces=['sandbox','center:janggye'];
 const centers=await db.center.findMany({where:{id:{in:['demo','janggye']}}}),records=await db.workRecord.findMany({where:{workspace:{in:spaces},kind:{in:kinds}}}),audits=await db.audit.findMany({select:{id:true}});
 const input=smsInput(date);
 await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:spaces},kind:{in:kinds}}});
  for(const id of ['demo','janggye'])await tx.center.upsert({where:{id},create:{id,state:json(id==='demo'?input.s:emptyCenter(id))},update:{state:json(id==='demo'?input.s:emptyCenter(id)),version:1}});
  await tx.workRecord.create({data:{workspace:'sandbox',kind:'consultation',id:input.owner,payload:{farmer:input.contacts.get(input.owner)!}}});
  await tx.workRecord.create({data:{workspace:'sandbox',kind:'laborOperations',id:'current',payload:json(input.labor)}});
  for(const m of input.s.missions)await tx.workRecord.create({data:{workspace:'sandbox',kind:'laborDemand',id:m.id,payload:{missionId:m.id}}});
 });
 return {...input,async save(){await db.center.update({where:{id:'demo'},data:{state:json(input.s)}})},async cleanup(){await db.$transaction(async tx=>{
  await tx.workRecord.deleteMany({where:{workspace:{in:spaces},kind:{in:kinds}}});if(records.length)await tx.workRecord.createMany({data:records as any});
  for(const c of centers)await tx.center.update({where:{id:c.id},data:{state:c.state as any,version:c.version}});
  for(const id of ['demo','janggye'].filter(id=>!centers.some(c=>c.id===id)))await tx.center.delete({where:{id}});
  await tx.audit.deleteMany({where:{id:{notIn:audits.map(r=>r.id)}}});
 },{timeout:30000})}};
}
