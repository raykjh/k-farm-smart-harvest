import {defineConfig} from '@playwright/test';
import operations from './playwright.operations.config';

export default defineConfig({...operations,testMatch:['bulk-schedule-live.spec.ts'],timeout:180000,expect:{timeout:90000}});
