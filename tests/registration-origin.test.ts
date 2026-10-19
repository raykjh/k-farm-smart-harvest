import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {applyRegistrationOrigins,authorizeDemoRegistration,demoInputBatchSchema} from '../lib/registration-origin';
import {inCenter} from '../lib/workspace';
import {registeredDemo} from './registered-demo-fixture';

it('requires a ready center-scoped input batch and exact request hash',async()=>{
 const id=randomUUID(),requestId=randomUUID(),inputHash='a'.repeat(64);
 const payload=demoInputBatchSchema.parse({version:'demo-registration-inputs-v1',id,centerId:'demo',status:'READY',registrations:[{requestId,inputHash}]});
 const tx={$queryRaw:vi.fn().mockResolvedValue([]),workRecord:{findUnique:vi.fn().mockResolvedValue({payload})}} as unknown as Prisma.TransactionClient;
 await inCenter('demo',()=>authorizeDemoRegistration(tx,id,requestId,inputHash));
 await expect(inCenter('demo',()=>authorizeDemoRegistration(tx,id,requestId,'b'.repeat(64)))).rejects.toThrow('일치');
 await expect(inCenter('gyenam',()=>authorizeDemoRegistration(tx,id,requestId,inputHash))).rejects.toThrow('일치');
 payload.status='CLOSED';await expect(inCenter('demo',()=>authorizeDemoRegistration(tx,id,requestId,inputHash))).rejects.toThrow('일치');
});

it('preserves real registration origin unless the matching farmer and parcel have sealed synthetic provenance',async()=>{
 const state=registeredDemo().state;
 state.fields.forEach(f=>{f.source='REGISTERED'});
 const first=state.fields[0],batchId=randomUUID();
 const row={id:first.farmerId,payload:{version:'registration-origin-v1',dataOrigin:'SYNTHETIC',batchId,consultationId:first.farmerId,requestId:randomUUID(),inputHash:'a'.repeat(64),pnus:[first.id],actorId:'test',registeredAt:new Date().toISOString()}};
 const tx={workRecord:{findMany:vi.fn().mockResolvedValue([row])}} as unknown as Prisma.TransactionClient;
 const missions=structuredClone(state.missions);await inCenter('demo',()=>applyRegistrationOrigins(tx,state));
 expect(first).toMatchObject({source:'DEMO_ASSUMPTION',demoBatchId:batchId});
 expect(state.fields.slice(1).every(f=>f.source==='REGISTERED'&&!f.demoBatchId)).toBe(true);
 expect(state.missions).toEqual(missions);
 first.demoBatchId=randomUUID();await expect(inCenter('demo',()=>applyRegistrationOrigins(tx,state))).rejects.toThrow('혼합');
});
