import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({execute:vi.fn(),transaction:vi.fn()}));
vi.mock('../lib/db',()=>({db:{$transaction:mock.transaction,aiCall:{create:vi.fn().mockResolvedValue({}),update:vi.fn().mockResolvedValue({})}}}));
import {validateRequest,reserveBudget,budgetedCompletion,APPROVED_MODEL,reservationMicroUsd,usageEstimate,PRICE_REVIEW_EXPIRES_AT,VALIDATION_MICRO_USD,effectiveValidationCeiling,effectivePrimaryCeiling,MAX_PLANNING_OUTPUT_TOKENS,JOINT_PLAN_OUTPUT_TOKENS,MAX_REQUEST_RESERVATION_MICRO_USD} from '../lib/ai-budget';
import {db} from '../lib/db';
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-11T00:00:00Z'))});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();mock.execute.mockReset();mock.transaction.mockReset();});
describe('AI budget fail closed',()=>{
 it('defaults to the cumulative development stop and requires an explicit judging phase',async()=>{
  vi.stubEnv('KFARM_AI_SPENDING_PHASE','');expect(effectivePrimaryCeiling()).toBe(10_000_000);
  mock.execute.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  mock.transaction.mockImplementation(fn=>fn({$executeRaw:mock.execute}));
  await reserveBudget(5000);expect(mock.execute.mock.calls[1]).toContain(10_000_000);
  vi.stubEnv('KFARM_AI_SPENDING_PHASE','judging');expect(effectivePrimaryCeiling()).toBe(28_000_000);
  vi.stubEnv('KFARM_AI_SPENDING_PHASE','typo');expect(()=>effectivePrimaryCeiling()).toThrow('Invalid');
 });
 it('allows the approved judging expansion only in judging phase and retains lower configured stops',()=>{
  vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','27000000');
  vi.stubEnv('KFARM_AI_SPENDING_PHASE','development');
  expect(effectivePrimaryCeiling()).toBe(10_000_000);expect(effectiveValidationCeiling()).toBe(15_200_000);
  vi.stubEnv('KFARM_AI_SPENDING_PHASE','judging');
  expect(effectivePrimaryCeiling()).toBe(28_000_000);expect(effectiveValidationCeiling()).toBe(27_000_000);
  vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','999999999');expect(effectiveValidationCeiling()).toBe(27_000_000);
  vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','10000000');expect(effectiveValidationCeiling()).toBe(10_000_000);
 });
 it('permits enough planning output while retaining the per-call money cap and smaller diagnostic profile',async()=>{
  expect(JOINT_PLAN_OUTPUT_TOKENS).toBe(32768);
  expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:JOINT_PLAN_OUTPUT_TOKENS},'planning')).not.toThrow();
  expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:4097},'diagnostic')).toThrow();
  const largest={model:APPROVED_MODEL,max_tokens:MAX_PLANNING_OUTPUT_TOKENS,messages:'a'.repeat(15000)};
  expect(reservationMicroUsd(largest,'planning')).toBeLessThanOrEqual(500_000);
  expect(MAX_REQUEST_RESERVATION_MICRO_USD).toBe(500_000);
  await expect(reserveBudget(500_001)).rejects.toThrow('Invalid');expect(mock.transaction).not.toHaveBeenCalled();
 });
 it('keeps the reviewed window open through judging without removing the expiry or expanding the slice',async()=>{
  expect(Date.parse(PRICE_REVIEW_EXPIRES_AT)).toBeGreaterThan(Date.parse('2026-12-15T20:00:00Z'));
  expect(Date.parse(PRICE_REVIEW_EXPIRES_AT)).toBeLessThanOrEqual(Date.parse('2026-12-17T00:00:00Z'));
  vi.setSystemTime(new Date('2026-12-15T20:00:00Z'));
  vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','4171458');
  mock.transaction.mockRejectedValue(new Error('approved slice exhausted'));
  const network=vi.fn();vi.stubGlobal('fetch',network);
  await expect(budgetedCompletion({model:APPROVED_MODEL,max_tokens:32})).rejects.toThrow('approved slice exhausted');
  expect(mock.transaction).toHaveBeenCalledOnce();expect(network).not.toHaveBeenCalled();
  expect(effectiveValidationCeiling()).toBe(4171458);
 });
 it('permits only a lower verification ceiling and uses it in the atomic shared-ledger update',async()=>{
  vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','4171458');expect(effectiveValidationCeiling()).toBe(4171458);
  mock.execute.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  mock.transaction.mockImplementation(fn=>fn({$executeRaw:mock.execute}));
  await reserveBudget(5000);expect(mock.execute.mock.calls[3]).toContain(4171458);
  vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','999999999');expect(effectiveValidationCeiling()).toBe(VALIDATION_MICRO_USD);
  for(const value of ['-1','abc','0','1.5']){vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD',value);expect(()=>effectiveValidationCeiling()).toThrow('Invalid');}
 });
 it('blocks expired pricing before reserving or calling the network',async()=>{
  vi.setSystemTime(new Date(Date.parse(PRICE_REVIEW_EXPIRES_AT)+1));vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  const network=vi.fn();vi.stubGlobal('fetch',network);
  await expect(budgetedCompletion({model:APPROVED_MODEL,max_tokens:32})).rejects.toThrow('review expired');expect(network).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
 });
 it('records token-derived estimate separately from reservation without real calls',async()=>{
  vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  mock.transaction.mockResolvedValue(undefined);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({usage:{prompt_tokens:21,completion_tokens:32},choices:[]})}));
  await budgetedCompletion({model:APPROVED_MODEL,max_tokens:32});
  expect(db.aiCall.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({reservedMicroUsd:5000})}));
  expect(db.aiCall.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({estimatedMicroUsd:9,promptTokens:21,completionTokens:32})}));
 });
 it('distinguishes reservation from token-cost estimate',()=>{
  expect(reservationMicroUsd({model:APPROVED_MODEL,max_tokens:32})).toBe(5000);
  expect(usageEstimate({prompt_tokens:21,completion_tokens:32})?.estimatedMicroUsd).toBe(9);
  expect(usageEstimate({prompt_tokens:-1,completion_tokens:32})).toBeNull();
  expect(usageEstimate(undefined)).toBeNull();
 });
 it('rejects unknown models, oversized requests and output',()=>{
  expect(()=>validateRequest({model:'unknown',max_tokens:1})).toThrow();
  expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:1201})).toThrow();
  expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:1,messages:'가'.repeat(6000)})).toThrow();
  expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:32})).not.toThrow();
  for(const patch of [{n:2},{stream:true},{best_of:3},{max_completion_tokens:10000},{reasoning_effort:'high'}])expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:32,...patch})).toThrow();
  expect(()=>validateRequest({model:APPROVED_MODEL,max_tokens:32,reasoning_effort:'none'})).not.toThrow();
 });
 it('bounds the shared schedule/crop thinking profile without widening general calls',async()=>{
  const body={model:APPROVED_MODEL,max_tokens:MAX_PLANNING_OUTPUT_TOKENS,reasoning_effort:'low'};
  expect(()=>validateRequest(body,'planning')).not.toThrow();
  expect(reservationMicroUsd(body,'planning')).toBeGreaterThanOrEqual(5000);
  expect(()=>validateRequest(body)).toThrow();
  for(const patch of [{max_tokens:MAX_PLANNING_OUTPUT_TOKENS+1},{reasoning_effort:'medium'},{stream:true},{n:2},{chat_template_kwargs:{enable_thinking:true}}]){
   expect(()=>validateRequest({...body,...patch},'planning')).toThrow();
  }
  vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  const network=vi.fn().mockResolvedValue({ok:true,json:async()=>({usage:{prompt_tokens:10,completion_tokens:20},choices:[]})});vi.stubGlobal('fetch',network);mock.transaction.mockResolvedValue(undefined);
  await expect(budgetedCompletion(body,'crop-decision')).resolves.toBeDefined();expect(network).toHaveBeenCalledOnce();
  await expect(budgetedCompletion(body)).rejects.toThrow();expect(network).toHaveBeenCalledOnce();
 });
 it('rejects exhausted persistent ledger',async()=>{
  mock.execute.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  mock.transaction.mockImplementation(fn=>fn({$executeRaw:mock.execute}));
  await expect(reserveBudget(5000)).rejects.toThrow('exhausted');
 });
 it('does not send when database fails',async()=>{
  vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  mock.transaction.mockRejectedValue(new Error('database offline'));
  const network=vi.fn();vi.stubGlobal('fetch',network);
  await expect(budgetedCompletion({model:APPROVED_MODEL,max_tokens:32})).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
 });
 it('blocks unrelated calls in decision-only mode before budget or network',async()=>{
  vi.stubEnv('AI_MODE','nebius');vi.stubEnv('AI_CALL_SCOPE','decisions');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  const network=vi.fn();vi.stubGlobal('fetch',network);
  await expect(budgetedCompletion({model:APPROVED_MODEL,max_tokens:32})).rejects.toThrow('explicit');
  expect(network).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
 });
 it('keeps the additional validation ceiling in the same ledger transaction',async()=>{
  mock.execute.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  mock.transaction.mockImplementation(fn=>fn({$executeRaw:mock.execute}));
  await expect(reserveBudget(5000)).rejects.toThrow(`$${(VALIDATION_MICRO_USD/1e6).toFixed(2)}`);expect(mock.execute).toHaveBeenCalledTimes(4);
 });
 it('retains reservation on network failure without retry',async()=>{
  vi.stubEnv('AI_MODE','nebius');vi.stubEnv('NEBIUS_API_KEY','test-not-real');
  mock.transaction.mockResolvedValue(undefined);
  const network=vi.fn().mockRejectedValue(new Error('timeout'));vi.stubGlobal('fetch',network);
  await expect(budgetedCompletion({model:APPROVED_MODEL,max_tokens:32})).rejects.toThrow();
  expect(mock.transaction).toHaveBeenCalledTimes(1);expect(network).toHaveBeenCalledTimes(1);
 });
});
