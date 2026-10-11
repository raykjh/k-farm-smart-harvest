import {execFileSync} from 'node:child_process';
import {testPython} from './python-runtime';
import {verifySchedule,type SchedulingContract,type ScheduleResult} from '../lib/scheduling-engine';

// Exercise current solver code without starting a service or relying on an old
// HTTP process. This is a real isolated CP-SAT invocation, not a canned result.
export async function calculateCurrentSchedule(c:SchedulingContract):Promise<ScheduleResult>{
 const r=JSON.parse(execFileSync(testPython,['scripts/capacity-solver-bridge.py'],{input:JSON.stringify(c),encoding:'utf8',timeout:c.tasks.length>600?45000:30000,maxBuffer:20*1024*1024,windowsHide:true}));
 if(r.capacityPoolsVersion!=='qualified-pools-v1')throw Error('Current qualified-pool solver required');
 if(c.tasks.some(t=>t.resourceDayCenter)&&r.resourceDayVersion!=='exclusive-center-days-v1')throw Error('Current exclusive equipment-day solver required');
 if(r.status==='FEASIBLE')verifySchedule(c,r.assignments,r.phase);return r;
}
