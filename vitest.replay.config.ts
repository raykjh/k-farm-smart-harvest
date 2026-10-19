import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
// Shares the disposable four-center DB. Never run alongside other acceptance suites.
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{env:{
 DATABASE_URL:'postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e',AI_MODE:'demo',KFARM_APP_ORIGIN:'',
 NEBIUS_API_KEY:'',KMA_SERVICE_KEY:'',VWORLD_API_KEY:'',TAVILY_API_KEY:'',KFARM_PRODUCTION_WORKER:'0',KFARM_LABOR_WORKER:'0',
},include:['tests/chronological-demo.integration.ts'],testTimeout:600000,hookTimeout:30000,fileParallelism:false}});
