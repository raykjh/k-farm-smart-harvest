import {it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(function(){return {marker:'shared-ledger'}}),db:{marker:'business-db'}}));
vi.mock('@prisma/client',()=>({PrismaClient:mocks.create}));
vi.mock('../lib/db',()=>({db:mocks.db}));
import {aiBudgetDb} from '../lib/ai-budget-ledger';
afterEach(()=>{vi.unstubAllEnvs();delete (globalThis as any).aiLedger;mocks.create.mockClear()});
it('normal operation uses its existing DB and never opens another allowance',()=>{
 vi.stubEnv('AI_BUDGET_DATABASE_URL','');expect(aiBudgetDb()).toBe(mocks.db);expect(mocks.create).not.toHaveBeenCalled();
});
it('isolated business DB reuses a single shared ledger and rejects switching it mid-process',()=>{
 vi.stubEnv('DATABASE_URL','test-business');vi.stubEnv('AI_BUDGET_DATABASE_URL','existing-ledger');
 expect(aiBudgetDb()).toBe(aiBudgetDb());expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.create).toHaveBeenCalledWith({datasourceUrl:'existing-ledger'});
 vi.stubEnv('AI_BUDGET_DATABASE_URL','new-ledger');expect(()=>aiBudgetDb()).toThrow('cannot change');
});
