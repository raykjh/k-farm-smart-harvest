import {it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({complete:vi.fn(),compare:vi.fn(()=>[{candidateId:'rice',status:'INCOMPLETE'}])}));
vi.mock('../lib/ai-budget',()=>({APPROVED_MODEL:'test',budgetedCompletion:mocks.complete}));
vi.mock('../lib/crop-feasibility',()=>({compareCropFeasibility:mocks.compare}));
import {assessCropCandidates} from '../lib/crop-planning-agent';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
it('does not spend tokens for crop feasibility in decision-only mode',async()=>{vi.stubEnv('AI_MODE','nebius');vi.stubEnv('AI_CALL_SCOPE','decisions');await assessCropCandidates([],{} as any,'2026-09-20');expect(mocks.compare).toHaveBeenCalledOnce();expect(mocks.complete).not.toHaveBeenCalled()});
it('uses the same engine and never grants reservation authority',async()=>{vi.stubEnv('AI_MODE','nebius');mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:[{function:{name:'compare_crop_feasibility',arguments:'{}'}}]}}]});const state={} as any;const r=await assessCropCandidates([],state,'2026-09-20');expect(mocks.compare).toHaveBeenCalledWith([],state,'2026-09-20');expect(r.reserved).toBe(false);expect(r.results[0].status).toBe('INCOMPLETE')});
it('rejects model-authored resource capacity',async()=>{vi.stubEnv('AI_MODE','nebius');mocks.complete.mockResolvedValue({choices:[{message:{tool_calls:[{function:{name:'compare_crop_feasibility',arguments:'{"staff":999}'}}]}}]});await expect(assessCropCandidates([],{} as any,'2026-09-20')).rejects.toThrow('제약');expect(mocks.compare).not.toHaveBeenCalled()});
