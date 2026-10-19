// Publication documentation allowlist. Runtime code, schemas and synthetic tests
// are not reduced; private historical handoffs remain in the working checkout.
// Audit and export must use the same root inventory. Otherwise a new verification
// command can be documented but silently absent from the source-only package.
export const PUBLIC_SOURCE_ROOT_FILES=new Set([
 'LICENSE','README.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml',
 '.env.example','.gitignore','.dockerignore','Dockerfile','compose.yaml','instrumentation.ts','proxy.ts',
 'next-env.d.ts','postcss.config.mjs','tsconfig.json',
 'playwright.config.ts','playwright.adjacent.config.ts','playwright.isolated.config.ts','playwright.operations.config.ts','playwright.bulk-operations.config.ts',
 'playwright.field-management.config.ts','playwright.work-order.config.ts','playwright.sms.config.ts','playwright.task-results.config.ts','playwright.workspace-copy.config.ts',
 'playwright.labor-management.config.ts','playwright.screen-review.config.ts','playwright.settings.config.ts',
 'vitest.config.ts','vitest.adjacent.config.ts','vitest.centers.config.ts','vitest.replay.config.ts','vitest.retirement.config.ts',
 'AI-BUDGET-V2.md',
]);
export const PUBLIC_DOCUMENTS=new Set([
 'docs/ai-cost-controls.md',
 'docs/clean-installation.md',
 'docs/farmland-policy-rationale-2026-10-08.md',
 'docs/public-source-and-data.md',
 'docs/verification.md',
 'docs/judge-guide.md',
 'docs/ai-decision-evidence.md',
 'docs/judge-operations.md',
]);
export function internalPublicationDocument(path:string){
 return path==='AI-BUDGET-V2.md'||(path.startsWith('docs/')&&!PUBLIC_DOCUMENTS.has(path));
}
