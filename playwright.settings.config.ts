import base from './playwright.operations.config';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:['settings-navigation.spec.ts','sms-management.spec.ts','demo-input-policy.spec.ts']});
