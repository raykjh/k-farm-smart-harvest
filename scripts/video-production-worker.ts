import {fourCenterDatabaseUrl} from './disposable-test-db';
// A dedicated process makes automatic work independent of browser requests.
process.env.DATABASE_URL=fourCenterDatabaseUrl('kfarm_centers_e2e_video_20261018');
process.env.AI_BUDGET_DATABASE_URL='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm';
process.env.AI_MODE='nebius';process.env.AI_CALL_SCOPE='decisions';
process.env.KFARM_PRODUCTION_AI='1';process.env.KFARM_SMS_WORKER='0';
await import('./production-worker');
