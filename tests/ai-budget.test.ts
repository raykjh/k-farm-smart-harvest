import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({execute:vi.fn(),transaction:vi.fn()}));
vi.mock('../lib/db',()=>({db:{$transaction:mock.transaction,aiCall:{create:vi.fn().mockResolvedValue({}),update:vi.fn().mockResolvedValue({})}}}));
import {validateRequest,reserveBudget,budgetedCompletion,APPROVED_MODEL,reservationMicroUsd,usageEstimate,PRICE_REVIEW_EXPIRES_AT,VALIDATION_MICRO_USD} from '../lib/ai-budget';
import {db} from '../lib/db';
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-11T00:00:00Z'))});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();mock.execute.mockReset();mock.transaction.mockReset();});
describe('AI budget fail closed',()=>{
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
  const body={model:APPROVED_MODEL,max_tokens:4096,reasoning_effort:'low'};
  expect(()=>validateRequest(body,'planning')).not.toThrow();
  expect(reservationMicroUsd(body,'planning')).toBeGreaterThanOrEqual(5000);
  expect(()=>validateRequest(body)).toThrow();
  for(const patch of [{max_tokens:4097},{reasoning_effort:'medium'},{stream:true},{n:2},{chat_template_kwargs:{enable_thinking:true}}]){
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
