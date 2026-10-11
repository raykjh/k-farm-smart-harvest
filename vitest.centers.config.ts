import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
// Disposable DB shared with the separately run browser fixture; never run both concurrently.
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{env:{DATABASE_URL:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e',AI_MODE:'demo',KFARM_PRODUCTION_WORKER:'0',SOLVER_URL:'http://127.0.0.1:8100',KMA_SERVICE_KEY:'',NEBIUS_API_KEY:''},include:['tests/four-centers.integration.ts','tests/model-free-operations.integration.ts'],testTimeout:240000,hookTimeout:30000,fileParallelism:false}});
