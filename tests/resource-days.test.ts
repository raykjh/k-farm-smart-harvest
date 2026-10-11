import {it,expect,vi} from 'vitest';
import {verifySchedule,solveSchedule,type SchedulingContract} from '../lib/scheduling-engine';
const contract=():SchedulingContract=>({purpose:'INITIAL',daily:false,freezeBefore:0,staffCapacity:0,transportCapacity:0,tasks:['A','B'].map((center,i)=>({id:center,resource:'machine',resourceDayCenter:center,field:center,person:null,original:i*4,allowed:[i*4],duration:4,staff:0,transport:0,selected:true,preferred:null,predecessor:null}))});
it('independently rejects a shared machine at different centers on the same day, including unnamed existing work',()=>{
 const c=contract(),a=c.tasks.map(t=>({id:t.id,start:t.original,resource:t.resource}));
 expect(()=>verifySchedule(c,a,'INITIAL_DISPATCH')).toThrow('다중 센터');
 c.tasks[0].resourceDayCenter=undefined;expect(()=>verifySchedule(c,a,'INITIAL_DISPATCH')).toThrow('다중 센터');
 c.tasks[0].resourceDayCenter='B';expect(()=>verifySchedule(c,a,'INITIAL_DISPATCH')).not.toThrow();
});
it('requires explicit solver support rather than trusting a legacy response for exclusive loan days',async()=>{
 const mock=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({status:'NO_FEASIBLE_PLAN',contractVersion:'shared-schedule-v1',reason:'old'}));
 try{await expect(solveSchedule(contract())).rejects.toThrow('일일 단독 사용')}finally{mock.mockRestore()}
});
