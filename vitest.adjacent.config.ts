import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{env:{DATABASE_URL:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_replan_e2e',AI_MODE:'demo'},include:['tests/adjacent-replanning.integration.ts'],testTimeout:90000,fileParallelism:false}});
