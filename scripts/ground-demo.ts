// Fail closed for the historical scenario upgrader; preserve all prior records.
console.error('LEGACY_DEMO_WORKFLOW_RETIRED: Replacing stored missions with a fixed ground/wind scenario is retired. Use ordinary incident and replanning actions. No records were changed.');
process.exitCode=1;
