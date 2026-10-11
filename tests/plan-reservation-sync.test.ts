import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {missionReservation,syncChangedPlanReservations} from '../lib/plan-reservation-sync';
import type {State} from '../lib/types';
it('updates linked booking with plan and rolls everything back on failure',async()=>{
 const id='sync-test-'+crypto.randomUUID();
 const before={fields:[],machines:[{id,ownerCenterId:id,status:'AVAILABLE',safetyLock:false}],missions:[{id,resourceId:id,scheduledDate:'2027-05-01',start:0,duration:4,status:'PLANNED'}]} as unknown as State;
 const after=structuredClone(before);after.missions[0].scheduledDate='2027-05-02';
 const booking=missionReservation(id,before.missions[0])!;
 try{
 await db.center.create({data:{id,state:JSON.parse(JSON.stringify(before))}});
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:booking.id,payload:booking}});
 await expect(db.$transaction(async tx=>{await syncChangedPlanReservations(tx,id,before,after,[id],'test');await tx.center.update({where:{id},data:{version:{increment:1}}});throw Error('rollback');})).rejects.toThrow('rollback');
 expect((await db.center.findUniqueOrThrow({where:{id}})).version).toBe(0);
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:booking.id}}})).payload).toEqual(booking);
 await db.$transaction(tx=>syncChangedPlanReservations(tx,id,before,after,[id],'test'));
 const saved=await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:booking.id}}});expect(saved.version).toBe(2);expect(saved.payload).toEqual(missionReservation(id,after.missions[0]));
 const collision={...booking,id:id+'collision',centerId:'other',taskId:'other'};
 await db.workRecord.create({data:{workspace:'shared',kind:'resourceReservation',id:collision.id,payload:collision}});
 await expect(db.$transaction(tx=>syncChangedPlanReservations(tx,id,after,before,[id],'test'))).rejects.toThrow('충돌');
 expect((await db.workRecord.findUniqueOrThrow({where:{workspace_kind_id:{workspace:'shared',kind:'resourceReservation',id:booking.id}}})).version).toBe(2);
 }finally{await db.workRecord.deleteMany({where:{workspace:'shared',id:{in:[booking.id,id+'collision']}}});await db.audit.deleteMany({where:{centerId:id}});await db.center.deleteMany({where:{id}})}
});
