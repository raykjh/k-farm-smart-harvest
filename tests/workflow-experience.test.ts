import {it,expect} from 'vitest';
import {emptyExperience,transitionExperience as step} from '../lib/workflow-experience';
it('runs real common calculations across cancellation and reconfirmation',async ()=>{
 let s=(await step(emptyExperience(),{action:'register',name:'홍길동',address:'가상 주소',area:1000,crop:'rice'}));
 s=(await step(s,{action:'plan',start:'2027-03-01',machines:0,workers:2}));await expect(step(s,{action:'approve'})).rejects.toThrow('부족');
 s=(await step(s,{action:'plan',start:'2027-03-01',machines:2,workers:2}));s=(await step(s,{action:'approve'}));expect(s.reservations.length).toBeGreaterThan(0);
 let job=s.labor.jobs.find(j=>j.status==='OPEN')!;s=(await step(s,{action:'respond',jobId:job.id,workerId:job.invited[0],response:'PHONE'}));expect(s.labor.jobs.find(j=>j.id===job.id)!.assigned).toHaveLength(1);
 s=(await step(s,{action:'cancel',reason:'변경'}));expect(s.reservations).toHaveLength(0);expect(s.labor.jobs.every(j=>j.status==='STALE')).toBe(true);
 s=(await step(s,{action:'plan',start:'2027-03-05',machines:2,workers:2}));s=(await step(s,{action:'approve'}));job=s.labor.jobs.find(j=>j.status==='OPEN')!;expect(job.responses).toEqual({});expect(job.assigned).toEqual([]);expect(s.labor.notices.some(n=>n.type==='RECONFIRM')).toBe(true);
 s=(await step(s,{action:'respond',jobId:job.id,workerId:job.invited[0],response:'APP'}));expect(s.labor.jobs.find(j=>j.id===job.id)!.assigned).toHaveLength(1);
});
