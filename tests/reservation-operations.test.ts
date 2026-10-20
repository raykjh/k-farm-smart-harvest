import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {migrateReservations,cancelLinkedReservation} from '../lib/reservation-operations';
import type {Principal} from '../lib/auth';
it('previews then migrates idempotently and cancels future work without deleting history',async()=>{
 const id='operations-test-'+crypto.randomUUID(),booking='plan:'+id+':task';
 const actor={id:'tester',enabled:true,role:'CENTER_ADMIN',centerId:id} as Principal;
 const state={planVersion:1,revisions:[],fields:[{id:'field',farmerId:'farmer'}],machines:[],missions:[{id:'task',fieldId:'field',label:'방제',resourceId:id,scheduledDate:'2099-05-01',start:0,duration:4,status:'PLANNED'},{id:'past',fieldId:'field',label:'완료',resourceId:id,scheduledDate:'2026-01-01',start:0,duration:4,status:'COMPLETED'}]};
 try{
 await db.center.create({data:{id,state}});
 expect((await db.$transaction(tx=>migrateReservations(tx,id,actor,false))).pending).toBe(1);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation',id:booking}})).toBe(0);
 expect((await db.$transaction(tx=>migrateReservations(tx,id,actor,true))).added).toBe(1);
 expect((await db.$transaction(tx=>migrateReservations(tx,id,actor,true))).added).toBe(0);
 await expect(db.$transaction(tx=>cancelLinkedReservation(tx,booking,2,'test',actor))).rejects.toThrow('버전');
 await db.$transaction(tx=>cancelLinkedReservation(tx,booking,1,'기상 재검토',actor));
 const after=(await db.center.findUniqueOrThrow({where:{id}})).state as any;
 expect(after.missions[0].status).toBe('HELD');expect(after.missions[0].scheduledDate).toBeUndefined();expect(after.missions[1]).toEqual(state.missions[1]);
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation',id:booking}})).toBe(0);
 expect(await db.outbox.count({where:{centerId:id}})).toBe(1);
 }finally{await db.workRecord.deleteMany({where:{workspace:'shared',id:booking}});await db.outbox.deleteMany({where:{centerId:id}});await db.audit.deleteMany({where:{centerId:id}});await db.center.deleteMany({where:{id}})}
});
