import base from './playwright.labor-management.config';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:['labor-simple-management.spec.ts','sms-management.spec.ts','settings-navigation.spec.ts','map-failure.spec.ts','reschedule-results-layout.spec.ts','continuous-production.spec.ts','submission-simplification.spec.ts']});
