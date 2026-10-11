import {it,expect} from 'vitest';
import {registeredDemo,seasonalOperations} from './registered-demo-fixture';
import {linkLegacyOperations,type LinkedMission} from '../lib/operation-links';
it('maps all 460 exact records and preserves their dates, IDs and statuses idempotently',()=>{
 const s=registeredDemo().state,linked=linkLegacyOperations(s,seasonalOperations);
 expect(linked).toEqual(s);expect(linked.missions).toHaveLength(460);
 expect(new Set((linked.missions as LinkedMission[]).map(m=>m.operationKey)).size).toBe(460);
 const f=s.fields.find(f=>f.crop==='고추')!;
 expect((linked.missions as LinkedMission[]).filter(m=>m.fieldId===f.id&&m.operationCode==='harvest').map(m=>m.occurrence)).toEqual([1,2,3,4,5]);
});
it('does not guess unknown or changed task labels',()=>{
 const s=registeredDemo().state;s.missions[0].label='다른 작업';expect(()=>linkLegacyOperations(s,seasonalOperations)).toThrow('매핑');
});
