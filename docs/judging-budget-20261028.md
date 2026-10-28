# Judging allowance amendment — October 28, 2026

The owner approved roughly three times the previously proposed additional $6 judging allowance, with the existing Nebius account balance available for judging. This amendment changes only the server-side budget policy and its deployment configuration. The accepted UI, crop/scheduling logic, schema, business data, video and Devpost story are unchanged.

The existing ledger is retained. At the pre-deployment check it contained 908 calls, $9.618166 in primary reservations and $8.618166 in the decision slice. The approved judging ceilings are **$28 primary / $27 decision slice**, leaving **$18.381834** in either counter. These are cumulative conservative reservations, not a provider invoice, newly purchased credit or a reset allowance. The account UI showed $24.72 remaining; no top-up or billing setting is changed.

Activation requires `KFARM_AI_SPENDING_PHASE=judging` and `KFARM_AI_RESERVATION_CEILING_MICRO_USD=27000000` in both web and operations. The explicit configured slice can still lower the ceiling. Development retains its $10 cumulative stop; a request cannot select judging mode. The per-call $0.50 cap, atomic ledger updates, failed-request reservations, approved model, output limits and December 17 price-review expiry remain unchanged.

The October 28 final tag and judging branch remain fixed. Keep the prior `kfarm-judge-web:20261027-ai-r1` image for rollback. The budget amendment uses a separately named image, `kfarm-judge-web:20261028-budget-r1`, for web and operations; database, solver and tunnel must be retained. No database or ledger restore is part of this change.

The owner cancelled the desktop 09:00 check on October 28. No recurring monitor is active. The earlier freeze document's monitor description records the original arrangement, not current monitoring.

Verification: 17 model-free unit checks, 3 judge-ledger guards, 6 isolated PostgreSQL budget/concurrency checks, TypeScript checking and the NAS Linux production build passed. No real model call was made for this change.

## Activation and preservation

Applied on October 28 at 11:49 KST. Both web and operations run `kfarm-judge-web:20261028-budget-r1`, image ID `sha256:031f03fb2a07d35210758e657446ba9b4fd4a648533271a1a5214d305bd8878c`, from application commit `019a3806d6990bb1687dca3d7b043a505768f673`. All 909 runtime-source files matched the expected Git content, accepting only the existing CRLF/LF packaging conversion where exact bytes differed. Aggregate: `77354ae0d33b752ee3de9ef0ece073c5837bb7ed3534fd9336f82602781ab800`.

Read-only checks inside both processes confirmed judging mode, $28/$27 cumulative ceilings, $18.381834 remaining, the $0.50 per-call cap, the original DB-hosted ledger and the existing worker settings. Web is healthy; operations is running. Both retain `unless-stopped`. Database, solver and tunnel containers were not replaced. The public HTTPS application reloaded successfully and retained the 494-task 2027 center schedule and national totals of 4 centers, 308 approved cultivations and 54.7 ha.

Before/after fingerprints matched for all four center aggregates, 377 outbox rows, one receipt, 575 audit rows and 6,522 non-authentication work records. The work-record comparison excludes routine continuous-production cache timestamps, versions and calculation fingerprints. Both ledger records and all 908 call records matched exactly. New private custom-format business and ledger backups were saved on the NAS persistent volume and their contents checked; no restore was performed.

The budget amendment is retained on `judge/budget-20261028` and the separate `judge-budget-20261028-r1` tag. The original submitted tag, judging branch, repository default branch, Devpost copy and video remain unchanged.

Provider credit validity and payment availability remain separate from this application allowance. Increasing it does not extend promotional credit validity or verify future card payments.
