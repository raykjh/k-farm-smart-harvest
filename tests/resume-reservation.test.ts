import {it,expect,vi} from 'vitest';
import {resumeReservationState} from '../lib/resume-reservation';
it('restores cancelled resource only in a calculation copy',async()=>{
 const state={missions:[{id:'a',status:'HELD',resourceId:null,planningWindow:{from:'2027-05-01'}}]} as any;
 const tx={workRecord:{findMany:vi.fn().mockResolvedValue([{payload:{reservation:{centerId:'demo',taskId:'a'},before:{scheduledDate:'2027-05-01',resourceId:'DR01',start:0}}}])}} as any;
 const next=await resumeReservationState(tx,state,['a']);
 expect(next.missions[0].resourceId).toBe('DR01');expect(next.missions[0].scheduledDate).toBe('2027-05-01');expect((next.missions[0] as any).planningWindow).toEqual(state.missions[0].planningWindow);expect(state.missions[0].resourceId).toBeNull();expect(state.missions[0].scheduledDate).toBeUndefined();
});
it('rejects missing cancellation evidence instead of treating machinery as manual work',async()=>{
 const tx={workRecord:{findMany:vi.fn().mockResolvedValue([])}} as any;
 await expect(resumeReservationState(tx,{missions:[{id:'a',status:'HELD'}]} as any,['a'])).rejects.toThrow('확인');
});
