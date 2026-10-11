import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'e2e',testMatch:'adjacent-replanning-live-db.spec.ts',workers:1,timeout:120000,expect:{timeout:15000},use:{baseURL:'http://127.0.0.1:3101',browserName:'chromium',screenshot:'only-on-failure',extraHTTPHeaders:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'}}});
