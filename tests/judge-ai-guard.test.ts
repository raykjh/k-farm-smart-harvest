import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({find:vi.fn(),transaction:vi.fn()}));
vi.mock('../lib/ai-budget-ledger',()=>({aiBudgetDb:()=>({aiBudget:{findMany:mock.find},$transaction:mock.transaction})}));
import {assertJudgeAiLedgerReady,reserveBudget,VALIDATION_BUDGET_ID} from '../lib/ai-budget';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DATABASE_URL','postgresql://fixture@localhost/kfarm_judge');vi.stubEnv('KFARM_JUDGE_AI_APPROVED','');vi.stubEnv('AI_BUDGET_DATABASE_URL','');vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','');});
afterEach(()=>vi.unstubAllEnvs());
it('blocks judge spending before any write when deployment approval or the shared ledger is missing',async()=>{
 await expect(reserveBudget(5000)).rejects.toThrow('approved spending');expect(mock.transaction).not.toHaveBeenCalled();expect(mock.find).not.toHaveBeenCalled();
});
it('refuses a fresh or incomplete judge ledger without resetting it',async()=>{
 vi.stubEnv('KFARM_JUDGE_AI_APPROVED','1');vi.stubEnv('AI_BUDGET_DATABASE_URL','postgresql://fixture@ledger/authoritative');vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','500000');
 for(const rows of [[],[{id:'nebius-primary',total:10}]]){mock.find.mockResolvedValue(rows);await expect(reserveBudget(5000)).rejects.toThrow('no fresh allowance');}
 expect(mock.transaction).not.toHaveBeenCalled();
});
it('requires remaining approved budget on the existing shared ledger',async()=>{
 vi.stubEnv('KFARM_JUDGE_AI_APPROVED','1');vi.stubEnv('AI_BUDGET_DATABASE_URL','postgresql://fixture@ledger/authoritative');vi.stubEnv('KFARM_AI_RESERVATION_CEILING_MICRO_USD','500000');
 mock.find.mockResolvedValue([{id:'nebius-primary',total:200000},{id:VALIDATION_BUDGET_ID,total:200000}]);await expect(assertJudgeAiLedgerReady()).resolves.toBeUndefined();
 mock.find.mockResolvedValue([{id:'nebius-primary',total:500000},{id:VALIDATION_BUDGET_ID,total:500000}]);await expect(assertJudgeAiLedgerReady()).rejects.toThrow('exhausted');expect(mock.transaction).not.toHaveBeenCalled();
});
