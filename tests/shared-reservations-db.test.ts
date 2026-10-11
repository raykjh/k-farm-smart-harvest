import {it,expect} from 'vitest';
import {db} from '../lib/db';
import {reserveSharedResources} from '../lib/shared-reservations';
it('serializes simultaneous centers on the same machine in PostgreSQL',async()=>{
 const prefix='test-reservation:'+crypto.randomUUID();
 const base={resourceId:prefix,taskId:prefix,from:'2026-10-01T08:00:00+09:00',to:'2026-10-01T09:00:00+09:00'};
 try{
  const results=await Promise.allSettled(['A','B'].map(centerId=>db.$transaction(tx=>reserveSharedResources(tx,[{...base,id:prefix+centerId,centerId}]))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(await db.workRecord.count({where:{workspace:'shared',kind:'resourceReservation',id:{startsWith:prefix}}})).toBe(1);
 }finally{await db.workRecord.deleteMany({where:{workspace:'shared',kind:'resourceReservation',id:{startsWith:prefix}}})}
});
