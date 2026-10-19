// Fail closed for old onboarding instructions; do not load any database module.
console.error('LEGACY_DEMO_WORKFLOW_RETIRED: Fixed-snapshot seeding is retired. Use scripts/initialize-centers.ts for empty centers, then ordinary registration and planning. No records were changed.');
process.exitCode=1;
