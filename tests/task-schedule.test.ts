import {it,expect} from 'vitest';
import {registeredDemo} from './registered-demo-fixture';
import {taskScheduleOptions} from '../lib/task-schedule';
it('offers unheld manual tasks without requiring a weather incident',()=>{
 const s=registeredDemo().state,m=s.missions.find(x=>x.crop==='고추'&&x.owner==='농부'&&x.scheduledDate==='2026-09-09')!;
 expect(taskScheduleOptions(s,m.id,'2026-09-10').options.length).toBeGreaterThan(0);
 expect(m.scheduledDate).toBe('2026-09-09');
 expect(taskScheduleOptions(s,m.id,'2026-12-20').options).toHaveLength(0);
});
it('refuses completed history and locked machines',()=>{
 const s=registeredDemo().state;
 expect(()=>taskScheduleOptions(s,s.missions[0].id,'2026-09-10')).toThrow('완료');
 const m=s.missions.find(x=>x.resourceId&&x.status==='PLANNED')!;s.machines.find(x=>x.id===m.resourceId)!.safetyLock=true;
 expect(taskScheduleOptions(s,m.id,m.scheduledDate!).options).toHaveLength(0);
});
