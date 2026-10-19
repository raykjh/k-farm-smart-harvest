import {it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {PUBLIC_SOURCE_ROOT_FILES,internalPublicationDocument} from '../scripts/public-source-policy';

it('includes every current root verification configuration in the shared export inventory',()=>{
 const configs=readdirSync(process.cwd()).filter(p=>/^(?:vitest|playwright)(?:\.[a-z-]+)*\.config\.ts$/.test(p));
 expect(configs).toContain('playwright.operations.config.ts');
 expect(configs).toContain('vitest.replay.config.ts');
 expect(configs).toContain('vitest.retirement.config.ts');
 for(const file of configs)expect(PUBLIC_SOURCE_ROOT_FILES.has(file),file).toBe(true);
 for(const file of ['scripts/audit-public-source.ts','scripts/export-public-source.ts'])expect(readFileSync(file,'utf8')).toContain('PUBLIC_SOURCE_ROOT_FILES');
});

it('does not include credentials, recovery data or private handoffs in the public source profile',()=>{
 for(const file of ['.env','.env.local','.data/validation/result.json','.data/provider-samples/registered-demo-parcels.json','tsconfig.tsbuildinfo','AGENTS.md'])expect(PUBLIC_SOURCE_ROOT_FILES.has(file),file).toBe(false);
 expect(internalPublicationDocument('docs/submission-draft-en.md')).toBe(true);
 expect(internalPublicationDocument('AI-BUDGET-V2.md')).toBe(true);
 expect(internalPublicationDocument('docs/clean-installation.md')).toBe(false);
});
