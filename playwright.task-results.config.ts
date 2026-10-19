import {defineConfig} from '@playwright/test';
import operations from './playwright.operations.config';
export default defineConfig({...operations,testMatch:['task-results-lifecycle.spec.ts','work-order-live.spec.ts','automatic-replanning.spec.ts'],timeout:120000});
