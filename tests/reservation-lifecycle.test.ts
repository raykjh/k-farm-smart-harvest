import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {mutateReservation} from '../lib/reservation-lifecycle';
import type {Principal} from '../lib/auth';
it('approves, rejects stale/unauthorized changes, changes, cancels and releases a slot',async()=>{
 const id='loan-test-'+crypto.randomUUID(),owner=id+'owner',borrower=id+'borrower';
 const actor={id:'tester',enabled:true,role:'CENTER_ADMIN',centerId:owner} as Principal;
 const base={fields:[],missions:[],machines:[]};
 try{
 await db.center.create({data:{id:owner,state:{...base,machines:[{id,ownerCenterId:owner,status:'AVAILABLE',safetyLock:false}]}}});
 await db.center.create({data:{id:borrower,state:base}});
 const reservation={id,resourceId:id,centerId:borrower,taskId:id+'task',from:'2027-05-01T08:00:00+09:00',to:'2027-05-01T10:00:00+09:00'};
 const run=(body:unknown,p=actor)=>db.$transaction(tx=>mutateReservation(tx,body,p),{isolationLevel:'Serializable'});
 expect((await run({action:'approve',reservation})).version).toBe(1);
 await expect(run({action:'change',id,version:2,from:reservation.from,to:reservation.to})).rejects.toThrow('변경');
 await expect(run({action:'cancel',id,version:1,reason:'test'},{...actor,centerId:borrower})).rejects.toThrow('관리자');
 expect((await run({action:'change',id,version:1,from:'2027-05-02T08:00:00+09:00',to:'2027-05-02T10:00:00+09:00'})).version).toBe(2);
 expect((await run({action:'cancel',id,version:2,reason:'취소 검증'})).status).toBe('CANCELLED');
 expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation',id}})).toBe(0);
 await expect(run({action:'approve',reservation})).rejects.toThrow('재사용');
 expect(await db.audit.count({where:{centerId:owner}})).toBe(3);
 }finally{
 await db.workRecord.deleteMany({where:{workspace:'shared',id}});await db.audit.deleteMany({where:{centerId:owner}});await db.center.deleteMany({where:{id:{in:[owner,borrower]}}});
 }
});
