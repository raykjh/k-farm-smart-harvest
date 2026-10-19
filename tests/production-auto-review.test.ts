import {it,expect,vi,afterEach} from 'vitest';
import {needsAutomaticReview,reviewProductionAutomatically} from '../lib/production-auto-review';
import {db} from '../lib/db';
import {createJointDraft,stageJointDraft} from '../lib/integrated-plan-service';
const mocks=vi.hoisted(()=>({rows:new Map<string,any>(),source:{scopeId:'demo'},view:{sourceFingerprint:'source',items:[{pnu:'p',status:'REVIEW'}]},calls:0}));
vi.mock('../lib/db',()=>({db:{$transaction:vi.fn(async(fn:any)=>fn({$executeRaw:async()=>0,workRecord:{
 findUnique:async({where}:any)=>{const k=where.workspace_kind_id;return k.kind==='continuousProduction'?{payload:mocks.view}:mocks.rows.get(k.id)},
 findMany:async({where}:any)=>where.kind==='productionApproval'?[]:[...mocks.rows.values()],create:async({data}:any)=>{mocks.rows.set(data.id,data);return data},
 update:async({where,data}:any)=>{const k=where.workspace_kind_id;if(k.kind==='continuousProduction')mocks.view=data.payload;else mocks.rows.set(k.id,data);return data}
}}))}}));
vi.mock('../lib/production-service',()=>({productionKey:(kind:string)=>({where:{workspace_kind_id:{workspace:'sandbox',kind,id:'current'}}}),productionSourceHash:()=> 'source',readProductionSource:async()=>mocks.source}));
vi.mock('../lib/integrated-plan',()=>({integratedHash:()=> 'job',jointSourceHash:()=> 'joint'}));
vi.mock('../lib/integrated-plan-service',()=>({readJointSources:async()=>[mocks.source],createJointDraft:vi.fn(async()=>({source:'NEBIUS',fingerprint:'joint'})),stageJointDraft:vi.fn(async()=>({}))}));
afterEach(()=>{mocks.rows.clear();mocks.view={sourceFingerprint:'source',items:[{pnu:'p',status:'REVIEW'}]};vi.clearAllMocks();vi.unstubAllEnvs()});
it('paid automatic review requires explicit enablement and never approves',async()=>{
 vi.stubEnv('KFARM_PRODUCTION_AI','0');expect(await reviewProductionAutomatically()).toBe('DISABLED');expect(db.$transaction).not.toHaveBeenCalled();
 expect(needsAutomaticReview({items:[]})).toBe(false);
 expect(needsAutomaticReview({items:[{status:'SCHEDULED'}]})).toBe(false);
 expect(needsAutomaticReview({...mocks.view,integratedPlan:{}})).toBe(false);
});
it('unchanged ticks or a new process reuse the persistent claim without paid retries',async()=>{
 vi.stubEnv('KFARM_PRODUCTION_AI','1');vi.stubEnv('AI_MODE','nebius');
 expect(await reviewProductionAutomatically()).toBe('AWAITING_CONFIRMATION');
 expect(await reviewProductionAutomatically()).toBe('UNCHANGED');
 expect(createJointDraft).toHaveBeenCalledTimes(1);expect(stageJointDraft).toHaveBeenCalledTimes(1);
 expect(mocks.rows.get('job').payload.status).toBe('AWAITING_CONFIRMATION');
});
it('failure is visible and is not retried or disguised as a rule approval',async()=>{
 vi.stubEnv('KFARM_PRODUCTION_AI','1');vi.stubEnv('AI_MODE','nebius');
 vi.mocked(createJointDraft).mockRejectedValueOnce(Error('AI 검토 실패'));
 expect(await reviewProductionAutomatically()).toBe('NEEDS_REVIEW');expect(await reviewProductionAutomatically()).toBe('UNCHANGED');
 expect(mocks.view).toHaveProperty('aiReviewError.message','AI 검토 실패');expect(stageJointDraft).not.toHaveBeenCalled();
});
it('an interrupted persisted claim reports review needed without repeating inference',async()=>{
 vi.stubEnv('KFARM_PRODUCTION_AI','1');vi.stubEnv('AI_MODE','nebius');
 mocks.rows.set('job',{payload:{status:'RUNNING',startedAt:new Date(Date.now()-11*60000).toISOString()}});
 expect(await reviewProductionAutomatically()).toBe('UNCHANGED');
 expect(mocks.rows.get('job').payload.status).toBe('NEEDS_REVIEW');
 expect(mocks.view).toHaveProperty('aiReviewError');expect(createJointDraft).not.toHaveBeenCalled();
});
