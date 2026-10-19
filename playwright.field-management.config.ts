import {defineConfig} from '@playwright/test';
import operations from './playwright.operations.config';
export default defineConfig({...operations,testMatch:['field-management.spec.ts','task-results-lifecycle.spec.ts'],timeout:120000,use:{...operations.use,actionTimeout:15000,navigationTimeout:20000}});
