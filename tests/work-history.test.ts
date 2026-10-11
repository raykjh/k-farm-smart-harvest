import {expect,it} from 'vitest';
import {assessHistoricalTask,simulateHourlyTask} from '../lib/work-history';
import type {Mission} from '../lib/types';
const m={scheduledDate:'2026-06-15',windLimitMs:5} as Mission;
it('never generates execution for a cancelled task',()=>{
 const cancelled={...m,status:'CANCELLED' as const};
 expect(assessHistoricalTask(cancelled,{date:'2026-06-15',precipitationMm:0,maxWindMs:1},'2026-09-22').status).toBe('NOT_DUE');
 expect(simulateHourlyTask(cancelled,[],'2026-09-22').status).toBe('NOT_DUE');
});
it('never turns missing weather or future plans into completion',()=>{
 expect(assessHistoricalTask(m,undefined,'2026-09-10').status).toBe('NEEDS_OBSERVATION');
 expect(assessHistoricalTask(m,undefined,'2026-06-15').status).toBe('NOT_DUE');
});
it('keeps null rain distinct from dry weather',()=>expect(assessHistoricalTask(m,{date:'2026-06-15',precipitationMm:null,maxWindMs:1},'2026-09-10').status).toBe('NEEDS_OBSERVATION'));
it('daily adverse weather is not a fabricated exact execution time',()=>{
 expect(assessHistoricalTask(m,{date:'2026-06-15',precipitationMm:0,maxWindMs:7},'2026-09-10').status).toBe('SIMULATED_HELD');
 expect(assessHistoricalTask(m,{date:'2026-06-15',precipitationMm:2,maxWindMs:1},'2026-09-10').status).toBe('NEEDS_HOURLY_REVIEW');
});
