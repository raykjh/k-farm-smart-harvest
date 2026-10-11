import {expect,it} from 'vitest';
import {executionStatus} from '../lib/execution-view';
import type {State,Mission} from '../lib/types';
const m={id:'m',fieldId:'f',scheduledDate:'2026-06-01',status:'COMPLETED'} as Mission;
const s={fields:[{id:'f',source:'DEMO_ASSUMPTION'}]} as State;
const r={missionId:'m',source:'DEMO_SIMULATION',plannedDate:'2026-06-01',assessment:'SIMULATED_HELD'};
it('projects demo history without changing stored status',()=>{expect(executionStatus(s,m,[r])).toBe('HELD');expect(m.status).toBe('COMPLETED')});
it('ignores history for other dates or real fields',()=>{expect(executionStatus(s,m,[{...r,plannedDate:'2026-06-02'}])).toBe('COMPLETED');expect(executionStatus({fields:[]} as unknown as State,m,[r])).toBe('COMPLETED')});
it('keeps review separate from held',()=>expect(executionStatus(s,m,[{...r,assessment:'NEEDS_OBSERVATION'}])).toBe('UNKNOWN'));
