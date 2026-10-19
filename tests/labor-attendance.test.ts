import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {emptyLaborOps,ordinaryLaborAvailability,workerSchema,newAttendance,advanceAttendance,attendanceDates,respond,reviewAttendance,type LaborJob,type Worker} from '../lib/labor-operations';
const person=(id:string):Worker=>({id,name:id,birth:'1960-01-01',phone:'000',address:'가상',registeredFarmer:false,usesApp:false,active:true,...ordinaryLaborAvailability()});
const job=():LaborJob=>({id:'job',missionId:'task',task:'일반 수확',address:'가상',date:'2032-09-01',startMinute:540,durationMinutes:60,count:1,workCode:'harvest',sourceHash:'h',pay:'확인된 조건',status:'OPEN',invited:[],responses:{},distances:{a:1,b:2,c:3},assigned:[],manual:null,worked:[],attendance:newAttendance()});
const setup=()=>({...emptyLaborOps(),people:['a','b','c'].map(person),jobs:[job()]});
const day7='2032-08-25T00:00:00+09:00',day2='2032-08-30T00:00:00+09:00';
it('accepts a minimal signup and neutralizes obsolete personal timetable fields',()=>{
 const {weekdays,preferredDates,excludedDates,startMinute,endMinute,workCodes,...p}=person(randomUUID());
 expect(workerSchema.parse(p)).toMatchObject(ordinaryLaborAvailability());
 expect(workerSchema.parse({...p,weekdays:[],excludedDates:['2032-09-01'],workCodes:['weed']})).toMatchObject(ordinaryLaborAvailability());
});
it('starts exactly 7 KST calendar days ahead, proposes by priority and never counts silence as attendance',()=>{
 const s=setup(),j=s.jobs[0];advanceAttendance(s,j,'2032-08-24T23:59:59+09:00');expect(j.invited).toEqual([]);
 advanceAttendance(s,j,day7);expect(j.attendance?.proposed).toEqual(['a']);expect(j.assigned).toEqual([]);expect(j.invited).toEqual(['a','b','c']);
 const snapshot=JSON.stringify(s);advanceAttendance(s,j,day7);expect(JSON.stringify(s)).toBe(snapshot);
 respond(s,j.id,'a','PHONE',day7);expect(j.assigned).toEqual(['a']);
});
it('replaces unanswered nominees at T-2 with confirmed waitlists, without penalties or fabricated replies',()=>{
 const s=setup(),j=s.jobs[0];advanceAttendance(s,j,day7);respond(s,j.id,'b','APP',day7);expect(j.assigned).toEqual([]);
 advanceAttendance(s,j,day2);expect(j.attendance?.expired).toEqual(['a']);expect(j.assigned).toEqual(['b']);expect(j.responses.a).toBeUndefined();expect(s.penalties).toEqual([]);
 reviewAttendance(j,'담당자',day2);const snapshot=JSON.stringify(s);advanceAttendance(s,j,day2);expect(JSON.stringify(s)).toBe(snapshot);
 expect(()=>respond(s,j.id,'a','PHONE',day2)).toThrow('교체');expect(j.assigned).toEqual(['b']);
});
it('shows a shortage when no confirmed replacement exists and accepts a replacement only after their reply',()=>{
 const s=setup(),j=s.jobs[0];advanceAttendance(s,j,day7);advanceAttendance(s,j,day2);
 expect(j.attendance?.proposed).toEqual(['b']);expect(j.assigned).toEqual([]);reviewAttendance(j,'담당자',day2);
 respond(s,j.id,'b','PHONE',day2);expect(j.assigned).toEqual(['b']);expect(j.attendance?.reviewedAt).toBeUndefined();
});
it('preserves confirmed/manual assignments, completed history and penalties',()=>{
 const s=setup(),j=s.jobs[0];advanceAttendance(s,j,day7);respond(s,j.id,'a','PHONE',day7);j.manual=['a'];
 advanceAttendance(s,j,day2);expect(j.assigned).toEqual(['a']);j.status='COMPLETED';const old=JSON.stringify(j);advanceAttendance(s,j,day2);expect(JSON.stringify(j)).toBe(old);
});
it('protects external reservations and avoids duplicate provisional offers on overlapping jobs',()=>{
 const s=setup(),j=s.jobs[0];s.externalBusy=[{workerId:'a',date:j.date,startMinute:540,durationMinutes:60}];
 advanceAttendance(s,j,day7);expect(j.attendance?.proposed).toEqual(['b']);const next={...job(),id:'second',attendance:newAttendance()};s.jobs.push(next);
 advanceAttendance(s,next,day7);expect(next.attendance?.proposed).toEqual(['c']);
});
it('keeps new inactive workers and reserve employees out of ordinary invitations',()=>{
 const s=setup(),j=s.jobs[0];s.people[0].active=false;s.people[1].employment='CENTER_RESERVE';s.people[1].standbyDates=[j.date];
 advanceAttendance(s,j,day7);expect(j.invited).toEqual(['c']);expect(j.attendance?.proposed).toEqual(['c']);
});
it('recovers a workday no-show with confirmed reserve duty but never creates a new late attendance',()=>{
 const s=setup(),j=s.jobs[0];s.people[2].employment='CENTER_RESERVE';s.people[2].standbyDates=[j.date];
 advanceAttendance(s,j,day7);respond(s,j.id,'a','PHONE',day7);advanceAttendance(s,j,day2);
 respond(s,j.id,'a','DECLINED','2032-09-01T09:05:00+09:00');expect(j.assigned).toEqual(['c']);expect(j.responses.c).toBe('STANDBY');
 expect(()=>respond(s,j.id,'b','PHONE','2032-09-01T09:05:00+09:00')).toThrow('시작 후');
});
it('calculates deadlines across year boundaries and rejects premature review',()=>{
 const j={...job(),date:'2033-01-03'};expect(attendanceDates(j)).toEqual({allocateOn:'2032-12-27',confirmBy:'2033-01-01'});
 expect(()=>reviewAttendance(j,'담당자',day7)).toThrow('2일 전');
});
