import {it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({solve:vi.fn(),complete:vi.fn()}));
vi.mock('../lib/annual-replanning',()=>({calculateAnnualReplan:mocks.solve}));
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'test',budgetedCompletion:mocks.complete}));
import {proposeAnnualReplan} from '../lib/annual-planning-agent';
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks()});
it('does not spend tokens for calculation in decision-only mode',async()=>{
 vi.stubEnv('AI_MODE','nebius');vi.stubEnv('AI_CALL_SCOPE','decisions');mocks.solve.mockResolvedValue({status:'FEASIBLE',diff:[]});
 await proposeAnnualReplan({machines:[],staffCount:2,transportCount:2} as any,{ids:['task']},{status:'READY'} as any,'2027-04-30');
 expect(mocks.solve).toHaveBeenCalledOnce();expect(mocks.complete).not.toHaveBeenCalled();
});
it('routes AI tool calls to the same engine without granting approval',async()=>{
 vi.stubEnv('AI_MODE','nebius');mocks.solve.mockResolvedValue({status:'FEASIBLE',diff:[]});
 mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:['inspect_request','calculate_annual_schedule'].map((name,i)=>({id:String(i),function:{name,arguments:'{}'}}))}}]});
 const state={machines:[],staffCount:2,transportCount:2} as any,input={ids:['task'],preferred:'2027-05-01'},weather={status:'READY'} as any;
 const result=await proposeAnnualReplan(state,input,weather,'2027-04-30');
 expect(mocks.solve).toHaveBeenCalledWith(state,input,weather,'2027-04-30');expect(result.source).toBe('NEBIUS');expect(result).not.toHaveProperty('approved');
});
it('rejects an AI attempt to change constraints',async()=>{
 vi.stubEnv('AI_MODE','nebius');mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:[{function:{name:'calculate_annual_schedule',arguments:'{"staff":999}'}}]}}]});
 await expect(proposeAnnualReplan({} as any,{ids:['a']},{status:'READY'} as any,'2027-05-01')).rejects.toThrow('제약');expect(mocks.solve).not.toHaveBeenCalled();
});
