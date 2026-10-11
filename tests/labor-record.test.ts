import {it,expect} from 'vitest';
import {emptyLabor,laborRecord} from '../lib/labor-record';
const person={id:'11111111-1111-4111-8111-111111111111',name:'Test',score:100 as const,distanceKm:2,recentAssignments:0 as const,eligible:true,response:'PHONE' as const};
it('accepts blank drafts and rejects invented penalties',()=>{expect(laborRecord.safeParse(emptyLabor()).success).toBe(true);expect(laborRecord.safeParse({...emptyLabor(),people:[{...person,score:90}]}).success).toBe(false)});
it('requires invitation before responses and valid date',()=>{expect(laborRecord.safeParse({...emptyLabor(),people:[person]}).success).toBe(false);expect(laborRecord.safeParse({...emptyLabor(),opened:true,date:'2027-02-30',task:'Task',hours:'3h',pay:'TBD'}).success).toBe(false)});
it('validates confirmation and unique participants',()=>{const d={...emptyLabor(),opened:true,confirmed:true,date:'2027-06-16',task:'Task',hours:'3h',pay:'Agreed',people:[person]};expect(laborRecord.safeParse(d).success).toBe(true);expect(laborRecord.safeParse({...d,people:[person,person]}).success).toBe(false);expect(laborRecord.safeParse({...d,people:[]}).success).toBe(false)});
