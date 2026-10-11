import {it,expect,vi,afterEach} from 'vitest';
import {initialState,annualMissions} from '../lib/seed';
import {impactFacts,verifiedSummary} from '../lib/ai-facts';
import {jobs} from '../lib/scheduler';
import {translate} from '../lib/i18n';
const fake=vi.hoisted(()=>({completion:vi.fn(),solve:vi.fn()}));
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'test',budgetedCompletion:fake.completion}));
vi.mock('../lib/scheduler',async original=>({...await original<typeof import('../lib/scheduler')>(),solve:fake.solve}));
import {propose} from '../lib/ai';
function fixture(){
 const s=initialState();s.fields.forEach(f=>f.crop='쌀');s.missions=annualMissions(s);
 const drones=jobs(s).filter(m=>m.resourceId?.startsWith('D'));
 drones.forEach((m,i)=>{m.start=i<14?i*2:64+i*2});
 s.events=[{id:'wind',start:0,end:32,windMs:9,source:'DEMO_ASSUMPTION'}];
 return s;
}
afterEach(()=>{vi.unstubAllEnvs();fake.completion.mockReset();fake.solve.mockReset();});
it('uses mission counts and formatted times, never invented hours or approval',()=>{
 const s=fixture();const facts=impactFacts(s);
 expect(facts.weatherBlockedMissionCount).toBe(14);
 expect(facts.sharedResourceScopeMissionCount).toBe(27);
 expect(facts).not.toHaveProperty('resourceClosure');
 const summary=verifiedSummary(s,{feasible:true,diff:[{missionId:'A-5',before:0,after:34,reason:'test'}],groups:27});
 expect(summary).toContain('14건');expect(summary).toContain('27건');
 expect(summary).toContain('9월 10일 08:30');expect(summary).not.toContain('27시간');
 expect(summary).toContain('일괄 승인 전');expect(summary).toContain('발송은 하지 않았습니다');
 expect(translate(summary)).toContain('14 tasks');expect(translate(summary)).toContain('Sep 10, 08:30');
 expect(translate(summary)).not.toMatch(/[가-힣]/);
});
it('renders infeasible result without suggesting execution',()=>{
 const summary=verifiedSummary(fixture(),{feasible:false,diff:[],groups:0});
 expect(summary).toContain('찾지 못했습니다');expect(summary).not.toContain('검증된 변경안');
});
it('ignores hallucinated model prose and stops after the validated tool result',async()=>{
 vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','fake');
 fake.completion.mockResolvedValueOnce({choices:[{message:{role:'assistant',content:'12개, 27시간 폐쇄, 즉시 재투입',tool_calls:[{id:'a',function:{name:'inspect_impact',arguments:'{}'}}]}}]});
 fake.completion.mockResolvedValueOnce({choices:[{message:{role:'assistant',content:'승인 완료',tool_calls:[{id:'b',function:{name:'solve_schedule',arguments:'{"preferBatch":true}'}}]}}]});
 fake.solve.mockResolvedValue({feasible:true,diff:[],groups:27});
 const result=await propose(fixture());
 expect(result.summary).not.toContain('27시간');expect(result.summary).not.toContain('승인 완료');
 expect(result.summary).toContain('14건');expect(fake.completion).toHaveBeenCalledTimes(2);
});
it('rejects text-only responses and solve-before-inspection',async()=>{
 vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','fake');
 fake.completion.mockResolvedValueOnce({choices:[{message:{content:'완료'}}]});
 await expect(propose(fixture())).rejects.toThrow('도구');
 fake.completion.mockResolvedValueOnce({choices:[{message:{tool_calls:[{id:'b',function:{name:'solve_schedule',arguments:'{"preferBatch":true}'}}]}}]});
 await expect(propose(fixture())).rejects.toThrow('영향 검토 전');expect(fake.solve).not.toHaveBeenCalled();
});
