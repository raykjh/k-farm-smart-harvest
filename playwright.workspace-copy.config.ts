import {defineConfig} from '@playwright/test';
import operations from './playwright.operations.config';
export default defineConfig({...operations,testMatch:['workspace-copy.spec.ts'],timeout:100000});
