# Judging allowance amendment — October 28, 2026

The owner approved roughly three times the previously proposed additional $6 judging allowance, with the existing Nebius account balance available for judging. This amendment changes only the server-side budget policy and its deployment configuration. The accepted UI, crop/scheduling logic, schema, business data, video and Devpost story are unchanged.

The existing ledger is retained. At the pre-deployment check it contained 908 calls, $9.618166 in primary reservations and $8.618166 in the decision slice. The approved judging ceilings are **$28 primary / $27 decision slice**, leaving **$18.381834** in either counter. These are cumulative conservative reservations, not a provider invoice, newly purchased credit or a reset allowance. The account UI showed $24.72 remaining; no top-up or billing setting is changed.

Activation requires `KFARM_AI_SPENDING_PHASE=judging` and `KFARM_AI_RESERVATION_CEILING_MICRO_USD=27000000` in both web and operations. The explicit configured slice can still lower the ceiling. Development retains its $10 cumulative stop; a request cannot select judging mode. The per-call $0.50 cap, atomic ledger updates, failed-request reservations, approved model, output limits and December 17 price-review expiry remain unchanged.

The October 28 final tag and judging branch remain fixed. Keep the prior `kfarm-judge-web:20261027-ai-r1` image for rollback. The budget amendment uses a separately named image, `kfarm-judge-web:20261028-budget-r1`, for web and operations; database, solver and tunnel must be retained. No database or ledger restore is part of this change.

The owner cancelled the desktop 09:00 check on October 28. No recurring monitor is active. The earlier freeze document's monitor description records the original arrangement, not current monitoring.

Verification before activation: 17 model-free unit checks, 6 isolated PostgreSQL budget/concurrency checks and TypeScript checking passed. Deployment and post-activation verification are recorded separately after completion. No real model call is required to verify this budget policy change.

Provider credit validity and payment availability remain separate from this application allowance. Increasing it does not extend promotional credit validity or verify future card payments.
