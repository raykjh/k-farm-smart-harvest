import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{env:{DATABASE_URL:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_test',AI_MODE:'demo'},include:['tests/**/*.test.ts'],testTimeout:30000,fileParallelism:false}});
