import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {centerId,recordSpace} from './workspace';
import type {State} from './types';

/** Input provenance only. It must never change planning or execution rules.
 * Batches are prepared out of band, not created by a public registration request.
 */
export const demoInputBatchSchema=z.object({
 version:z.literal('demo-registration-inputs-v1'),id:z.string().uuid(),centerId:z.string().min(1),
 status:z.enum(['READY','CLOSED']),
 registrations:z.array(z.object({requestId:z.string().uuid(),inputHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(1000),
}).strict().refine(b=>new Set(b.registrations.map(r=>r.requestId)).size===b.registrations.length,'Duplicate demo request');
const originSchema=z.object({
 version:z.literal('registration-origin-v1'),dataOrigin:z.literal('SYNTHETIC'),batchId:z.string().uuid(),
 consultationId:z.string().uuid(),requestId:z.string().uuid(),inputHash:z.string().regex(/^[a-f0-9]{64}$/),
 pnus:z.array(z.string().regex(/^\d{19}$/)).min(1),actorId:z.string().min(1),registeredAt:z.string(),
}).strict();

export async function authorizeDemoRegistration(tx:Prisma.TransactionClient,batchId:string,requestId:string,inputHash:string){
 await tx.$queryRaw`SELECT id FROM "WorkRecord" WHERE workspace=${recordSpace()} AND kind='demoInputBatch' AND id=${batchId} FOR UPDATE`;
 const row=await tx.workRecord.findUnique({where:{workspace_kind_id:{workspace:recordSpace(),kind:'demoInputBatch',id:batchId}}});
 const batch=demoInputBatchSchema.safeParse(row?.payload);
 if(!batch.success||batch.data.id!==batchId||batch.data.centerId!==centerId()||batch.data.status!=='READY'||!batch.data.registrations.some(r=>r.requestId===requestId&&r.inputHash===inputHash))throw Error('승인된 가상 입력 묶음과 신청 내용이 일치하지 않습니다.');
}

export async function saveRegistrationOrigin(tx:Prisma.TransactionClient,input:{batchId:string;consultationId:string;requestId:string;inputHash:string;pnus:string[];actorId:string}){
 const payload=originSchema.parse({...input,version:'registration-origin-v1',dataOrigin:'SYNTHETIC',registeredAt:new Date().toISOString()});
 await tx.workRecord.create({data:{workspace:recordSpace(),kind:'registrationOrigin',id:input.consultationId,payload}});
}

/** Project the sealed input origin when ordinary planning admits new fields.
 * A provisional crop calendar by itself does NOT make an actual farmer synthetic.
 */
export async function applyRegistrationOrigins(tx:Prisma.TransactionClient,state:State){
 const ids=[...new Set(state.fields.map(f=>f.farmerId).filter(Boolean))];
 if(!ids.length)return;
 const rows=await tx.workRecord.findMany({where:{workspace:recordSpace(),kind:'registrationOrigin',id:{in:ids}}});
 for(const row of rows){
  const origin=originSchema.parse(row.payload);
  if(origin.consultationId!==row.id)throw Error('등록 자료의 출처 연결을 확인하세요.');
  for(const field of state.fields.filter(f=>f.farmerId===row.id&&origin.pnus.includes(f.id))){
   if(field.demoBatchId&&field.demoBatchId!==origin.batchId)throw Error('서로 다른 가상 입력 묶음이 혼합되었습니다.');
   field.source='DEMO_ASSUMPTION';field.demoBatchId=origin.batchId;
  }
 }
}
