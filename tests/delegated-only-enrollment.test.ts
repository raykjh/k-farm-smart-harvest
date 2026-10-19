import {it,expect} from 'vitest';
import {assertNoNewJointEnrollment} from '../lib/field-enrollment-policy';
import {intakeField} from '../lib/registration-intake';
import {operationRequirement} from '../lib/operation-requirements';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db} from '../lib/db';
import {testSession} from './auth-fixture';
import {POST as saveFields} from '../app/api/fields/route';
import {POST as saveConsultation} from '../app/api/consultations/route';

it('registers land as delegated with crop choice left for the center',()=>{
 const f=intakeField('5274036023106160004','가상 신청 농지');
 expect(f).toMatchObject({mode:'delegated',crop:'',selected:true});
 expect(()=>assertNoNewJointEnrollment([f])).not.toThrow();
 expect(()=>assertNoNewJointEnrollment([{pnu:f.pnu,mode:'full'}])).not.toThrow();
});
it('rejects a new joint field or downgrade while preserving legacy metadata',()=>{
 const legacy={pnu:'5274036023106160004',mode:'joint'},snapshot=JSON.stringify(legacy);
 expect(()=>assertNoNewJointEnrollment([legacy])).toThrow('위탁으로만');
 expect(()=>assertNoNewJointEnrollment([legacy],[{...legacy,mode:'full'}])).toThrow();
 expect(()=>assertNoNewJointEnrollment([legacy],[legacy])).not.toThrow();
 expect(()=>assertNoNewJointEnrollment([legacy,{pnu:'5274036023106160005',mode:'joint'}],[legacy])).toThrow();
 expect(JSON.stringify(legacy)).toBe(snapshot);
});
it('always includes ordinary labor in new work instead of assuming the owner will work',()=>{
 for(const mode of ['full','joint','delegated']){
  expect(operationRequirement('pepper','harvest',mode)).toMatchObject({owner:'센터 인력',staff:1,machineCode:null});
  expect(operationRequirement('rice','harvest',mode)).toMatchObject({owner:'장비',staff:1,requiresOperator:true});
 }
});
it('rejects stale joint enrollment through both direct write routes without changing records',async()=>{
 if(!process.env.DATABASE_URL?.endsWith('/kfarm_test'))throw Error('Isolated DB only');
 const session=await testSession(),id=randomUUID(),pnu='5274036023199990099';
 const key={workspace:'sandbox',kind:'fields',id:'current'};
 const before=await db.workRecord.findUnique({where:{workspace_kind_id:key}});
 const req=(path:string,body:unknown)=>new NextRequest('http://127.0.0.1:3100/api/'+path,{method:'POST',headers:session.headers,body:JSON.stringify(body)});
 try{
  const {geometry,selected,...field}=intakeField(pnu,'가상 신청 농지');
  const consultation={farmer:{name:'홍분리',birth:'1960-01-01',phone:'000-0000-0000',contact:'sms'},fields:[{...field,area:'1000',mode:'joint'}],consent:true,step:3};
  expect((await saveConsultation(req('consultations',{workspace:'sandbox',id,version:0,testDataOnly:true,payload:consultation}))).status).toBe(400);
  expect((await saveFields(req('fields',{workspace:'sandbox',version:before?.version??0,mode:'append',payload:[{pnu,address:'가상 신청 농지',area:1000,crop:'',mode:'joint',group:'',rights:'pending'}]}))).status).toBe(400);
  expect(await db.workRecord.count({where:{kind:'consultation',id}})).toBe(0);
  expect(await db.workRecord.findUnique({where:{workspace_kind_id:key}})).toEqual(before);
 }finally{await session.cleanup()}
});
