// Publication documentation allowlist. Runtime code, schemas and synthetic tests
// are not reduced; private historical handoffs remain in the working checkout.
export const PUBLIC_DOCUMENTS=new Set([
 'docs/ai-cost-controls.md',
 'docs/clean-installation.md',
 'docs/farmland-policy-rationale-2026-10-08.md',
 'docs/public-source-and-data.md',
 'docs/verification.md',
]);
export function internalPublicationDocument(path:string){
 return path==='AI-BUDGET-V2.md'||(path.startsWith('docs/')&&!PUBLIC_DOCUMENTS.has(path));
}
