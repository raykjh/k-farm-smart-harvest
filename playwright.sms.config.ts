import {defineConfig} from '@playwright/test';
import operations from './playwright.operations.config';
export default defineConfig({...operations,testMatch:['sms-management.spec.ts','labor-attendance-live.spec.ts'],timeout:120000});
