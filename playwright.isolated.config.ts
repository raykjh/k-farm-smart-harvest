import {defineConfig} from '@playwright/test';
// Keep the existing strict localhost:3100 origin guard. Isolation is via kfarm_test.
export default defineConfig({testDir:'e2e',workers:1,expect:{timeout:20000},use:{baseURL:'http://127.0.0.1:3100',browserName:'chromium',screenshot:'only-on-failure'},timeout:60000});
