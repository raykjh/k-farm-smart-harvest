import {expect,it} from 'vitest';
import {calendarStatus,inDailySchedule} from '../lib/calendar-status';
import type {State,Mission} from '../lib/types';
const state={fields:[{id:'field',source:'REGISTERED'}]} as State;
const task={id:'task',fieldId:'field',scheduledDate:'2026-09-22',status:'PLANNED'} as Mission;
it('keeps today and future planned, and rolls past plans into result entry without writes',()=>{
 expect(calendarStatus(state,task,[],'2026-09-22')).toBe('PLANNED');
 expect(calendarStatus(state,task,[],'2026-09-23')).toBe('RESULT_MISSING');
 expect(task.status).toBe('PLANNED');
 expect(calendarStatus(state,{...task,scheduledDate:'2026-09-24'},[],'2026-09-23')).toBe('PLANNED');
});
it('preserves confirmed completions, held tasks and unstaffed tasks',()=>{
 const history=[{missionId:'task',source:'ACTUAL',plannedDate:'2026-09-22',assessment:'COMPLETED'}];
 expect(calendarStatus(state,task,history,'2026-09-23')).toBe('COMPLETED');
 for(const [status,expected] of [['HELD','REPLAN_PENDING'],['UNSTAFFED','STAFFING_PENDING'],['COMPLETED','COMPLETED'],['CANCELLED','CANCELLED']] as const)expect(calendarStatus(state,{...task,status},[],'2026-09-23')).toBe(expected);
});
it('uses the same result rules for demo and registered data; does not mistake absent date for overdue',()=>{
 expect(calendarStatus({...state,fields:[{...state.fields[0],source:'DEMO_ASSUMPTION'}]},task,[],'2026-09-23')).toBe('RESULT_MISSING');
 expect(calendarStatus(state,{...task,scheduledDate:undefined},[],'2026-09-23')).toBe('REPLAN_PENDING');
});
it('daily results exclude unresolved past work, retain cancellations and follow the confirmed new date',()=>{
 const pending={...task},completed={...task,id:'done',status:'COMPLETED' as const},cancelled={...task,id:'cancel',status:'CANCELLED' as const},moved={...task,id:'moved',scheduledDate:'2026-09-24',originalScheduledDate:task.scheduledDate};
 const all=[pending,completed,cancelled,moved],before=JSON.stringify(all);
 const visible=all.filter(m=>inDailySchedule(state,m,[],'2026-09-23'));
 expect(visible.filter(m=>m.scheduledDate==='2026-09-22').map(m=>m.id)).toEqual(['done','cancel']);
 expect(visible.filter(m=>m.scheduledDate==='2026-09-24').map(m=>m.id)).toEqual(['moved']);
 expect(JSON.stringify(all)).toBe(before);
});
