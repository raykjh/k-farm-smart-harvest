import {it,expect,vi,afterEach} from 'vitest';
import {execFileSync} from 'node:child_process';
import {testPython} from './python-runtime';
import {scheduleCases,cropCase} from '../scripts/fixtures/ai-decision-cases';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('calculates all comparison cases with the real solver and no inference or business writes',async()=>{
 vi.stubEnv('SOLVER_URL','http://127.0.0.1:18100');
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  expect(String(url)).toBe('http://127.0.0.1:18100/schedule');
  const result=execFileSync(testPython,['-c','import sys,json; from solver.replanning import Request,replan; print(json.dumps(replan(Request(**json.load(sys.stdin)))))'],{cwd:new URL('..',import.meta.url),input:init.body,encoding:'utf8',timeout:20000,windowsHide:true});
  return Response.json(JSON.parse(result));
 }));
 const schedules=await scheduleCases(),crop=await cropCase();
 expect(schedules).toHaveLength(5);expect(schedules.every(c=>c.checks.inputUnchanged&&c.checks.completedPreserved)).toBe(true);
 expect(crop.facts).toHaveLength(3);expect(crop.checks.allCandidatesCapacityFeasible).toBe(true);
 expect(crop.facts.find(c=>c.id==='rice')!.supplyPenalty).toBeGreaterThan(0);
});
