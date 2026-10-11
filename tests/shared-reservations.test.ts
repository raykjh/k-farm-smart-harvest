import {it,expect} from 'vitest';
import {validateReservations,type SharedReservation} from '../lib/shared-reservations';
const a:SharedReservation={id:'a',centerId:'A',resourceId:'DR01',taskId:'one',from:'2026-09-21T08:00:00+09:00',to:'2026-09-21T10:00:00+09:00'};
it('rejects two centers reserving the same resource',()=>expect(()=>validateReservations([{...a,id:'b',centerId:'B'}],[a])).toThrow('충돌'));
it('allows adjacent reservations and other machines',()=>{expect(validateReservations([{...a,id:'b',from:a.to,to:'2026-09-21T12:00:00+09:00'}],[a])).toHaveLength(1);expect(validateReservations([{...a,id:'b',resourceId:'DR02'}],[a])).toHaveLength(1)});
it('compares instants rather than timezone strings',()=>expect(()=>validateReservations([{...a,id:'b',from:'2026-09-20T23:00:00Z',to:'2026-09-21T01:00:00Z'}],[a])).toThrow());
it('rejects malformed intervals and duplicates within batch',()=>{expect(()=>validateReservations([{...a,to:a.from}],[])).toThrow();expect(()=>validateReservations([a,a],[])).toThrow()});
