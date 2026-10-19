import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'e2e',
 testMatch:['schedule-attendance-live.spec.ts','automatic-replanning.spec.ts','automatic-replan-recovery.spec.ts','labor-attendance-live.spec.ts','demo-input-policy.spec.ts'],
 workers:1,timeout:120000,expect:{timeout:20000},
 use:{baseURL:'https://127.0.0.1:3443',browserName:'chromium',ignoreHTTPSErrors:true,screenshot:'only-on-failure',serviceWorkers:'block'},
});
