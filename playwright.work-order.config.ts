import {defineConfig} from '@playwright/test';
import operations from './playwright.operations.config';
export default defineConfig({...operations,testMatch:['work-order-live.spec.ts','split-work-area.spec.ts'],timeout:100000});
