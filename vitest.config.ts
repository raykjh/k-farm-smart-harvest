import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const testDatabase=process.env.KFARM_TEST_DATABASE_URL??'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_test';
const target=new URL(testDatabase);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/kfarm_test'||!['55432','55433','55434'].includes(target.port))throw Error('Tests require an isolated local kfarm_test database.');
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{env:{DATABASE_URL:testDatabase,AI_MODE:'demo'},include:['tests/**/*.test.ts'],testTimeout:30000,fileParallelism:false}});
