import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {laborCapacityFixture} from './labor-capacity-fixture';
import {catalogField,catalogState} from './catalog-fixtures';
import {consultationSchema} from '../lib/consultation';
import type {FieldEntry} from '../lib/field-record';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
export async function fieldManagementFixture(){
 const base=await laborCapacityFixture();
 const kinds=['fields','consultation','cultivation','cultivationPlan','cultivationChange','cultivationChangeHistory','cultivationChangeApproval','annualDispatchApproval','annualReservation','cancelledReservation','fieldParticipation'];
 const old=await db.workRecord.findMany({where:{kind:{in:kinds}}});
 await db.workRecord.deleteMany({where:{kind:{in:kinds}}});
 const ownerId=randomUUID(),field:FieldEntry={...catalogField('soybean'),crop:'',consultationId:ownerId};
 field.conditions!.climate.sesame='suitable';field.address='계북면 격리 검증 농지';
 const consultation=consultationSchema.parse({application:{policy:'OWNER_SERVICE_V1',residence:'격리 검증용 주소',cultivationHistory:'',supportReason:'',exceptionReason:'',review:'pending'},farmer:{name:'홍가상',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},fields:[{id:randomUUID(),pnu:field.pnu,address:field.address,area:String(field.area),crop:'',mode:'delegated',tenure:'owned',ownerName:'홍가상',ownerPhone:'000-0000-0000',evidence:'ownership',end:'',callAt:'',operator:'',callResult:'pending',scope:'',verified:'pending',conditions:field.conditions}],consent:true,step:3});
 const state=catalogState();
 state.fields=[{id:field.pnu,farmerId:ownerId,name:consultation.farmer.name,address:field.address,area:field.area!,crop:null,mode:'완전 위탁형',access:true,water:true,confirmed:false,cluster:'',source:'REGISTERED'}];
 await db.center.update({where:{id:'demo'},data:{state:json(state)}});
 await db.workRecord.createMany({data:[{workspace:'sandbox',kind:'fields',id:'current',payload:json([field])},{workspace:'sandbox',kind:'consultation',id:ownerId,payload:json(consultation)}]});
 return {field,ownerId,consultation,state,async cleanup(){await db.workRecord.deleteMany({where:{kind:{in:kinds}}});if(old.length)await db.workRecord.createMany({data:old as any});await base.cleanup()}};
}
