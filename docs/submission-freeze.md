# Final submission freeze — October 28, 2026

The judging application is the October 27 crop-planning release. The final review corrected stale video descriptions and regression-test fixtures; it did not change application code, UI, schema, business data or the approved video. No runtime redeployment was needed.

## Fixed references

| Item | Final reference |
|---|---|
| Public application | [kfarm.1gaji.com](https://kfarm.1gaji.com) |
| Submission source and corrected tests/docs | [judge-submission-20261028-final](https://github.com/raykjh/k-farm-smart-harvest/tree/judge-submission-20261028-final) |
| Judging branch | `judge/final-20261028` |
| Future development branch | `development/post-submission` |
| Runtime application source | `1bc233baa9c6b28c2ac18a28fcc09bed72657e4f` |
| NAS web and operations image | `kfarm-judge-web:20261027-ai-r1` |
| Both application image IDs | `sha256:3193daa2865ee4ebd5d6abafa455a3a256f4766fe5bdb9e2ea17266100fca51d` |
| Current English video | [2:58 recording from October 28](https://youtu.be/owk6Hm48ITs) |
| Approved MP4 SHA-256 | `84396b9e9b35acccd038b5adaf371edbd5679d5b60ca6bf3132d0d84a17beb2a` |

The final source tag contains documentation and test corrections after the runtime source commit. Application paths, dependencies, solver and schema remain identical to that runtime source. The older `judge-submission-20261021-r1` tag is retained and must not be moved.

## Final review results

- **Devpost:** only the two-sentence recording-date explanation was replaced. Saved form comparison confirmed the rest of the story, video URL, title, tagline, tags and project links were retained. The entry remains **Submitted, 5/5 steps done**. The current video shows saved public-app records and separately dated October 27 validation evidence; filming did not perform a new model call or approval.
- **TypeScript:** `pnpm typecheck` passed after the test corrections.
- **Regression tests:** the initial full run was followed by targeted retries after starting the local solver and correcting stale tests. The latest result for each of 226 files is **1,009 passed, 5 skipped, 0 failed**. This is the combined result, not a claim that the first full run passed. The five optional tests require private provider snapshots or historical model-answer artifacts excluded from public source.
- **Solver:** `python -m pytest solver -q` passed **56 tests**.
- **Corrections:** old tests assumed separate manager/staff operational permissions or a removed reservations tab, referenced the former replanning implementation location, or omitted the current bounded-query interface. One divergence fixture shared the same national contribution object across centers; it now changes an independently cloned center so the conflict check is genuinely exercised. Existing center, national-reference, account, stale-input, atomic-write and duplicate-request guards remain tested. No application behavior was weakened to make a test pass.
- **Public browser checks:** a new login, saved spring-potato details, May/October 2027 schedules, the 2027 national overview, price/cost references and climate page were inspected. An isolated browser connection-close error on the climate page recovered on fresh navigation. No persistent page failure or browser console error was observed in the completed checks. This is a bounded check, not an uptime guarantee or a fresh model-to-approval test.
- **NAS source:** both running application processes matched the 909-file deployment manifest. The normalized Git-content aggregate remains `02c4f2df8e5c7651bc7b2cf271811906f18789cb5695e608b748297f236c6d5c`; raw packaged bytes remain `c5507577888620809f1fe19a244095bdd270e431ba9ca84f2aa91b238eb4f667`. Only the documented CRLF/LF differences were accepted.

## Separation and recovery

The NAS judge stack uses the fixed image above and its own persistent business and runtime volumes. It does not mount the development checkout. The web, operations, database, solver and tunnel all use `unless-stopped`. Web, database and solver reported healthy; operations and tunnel reported running. Operations retains the production and labor workers, while SMS is disabled. The login role is configured in the web process; the background worker intentionally has no public-login configuration.

Normal judge registrations, plans, sessions and accounting records remain writable. Freezing the application does not freeze or restore the database. Future work belongs on `development/post-submission` in its separate checkout. It must not be automatically deployed to the judge stack. The tag and judging branch are fixed release references, not a claim that repository permissions make them technically impossible for an owner to alter.

Fresh custom-format business and AI-ledger backups were written to private persistent NAS storage on October 28. Both archive contents were successfully inspected with `pg_restore --list`, and SHA-256 checksums were retained privately. This is a same-volume backup check, not a new restore or offsite disaster-recovery test. The October 27 isolated restore results remain separately documented in [judge operations](judge-operations.md).

For an incident, retain logs and identify the failing component before changing anything. A required application rollback changes only web/operations images to a previously verified reference. Preserve all database volumes, existing approvals, reservations, accounts, secrets and the canonical AI ledger. Do not reseed or restore a historical ledger to recover spending allowance.

## Availability and budget

A read-only daily check is scheduled for 09:00 Asia/Seoul through the stated judging end, December 16 at 05:00 KST. It checks public access and, when the existing authenticated NAS connection is available, image identity, process health and remaining AI allowance. It reports actionable changes and stays quiet when unchanged. It never makes a paid model call, approves a plan, redeploys, restarts services or increases a budget automatically.

The monitor runs from the owner's local desktop: the computer and app must be running. The NAS application itself runs independently of that computer. A missed monitor run is not evidence that the NAS stayed healthy.

The October 28 ledger check retained **908 calls**, a **$10 reservation ceiling**, **$9.618166 reserved** and **$0.381834 remaining**. No new allowance or paid call was created for this review. These are application reservations, not a provider invoice. Judge testing can use the remainder, but this review does not establish that it will cover the full judging period. An additional bounded allowance requires the owner's explicit approval. See [judge operations](judge-operations.md) for the price-review expiry and recovery boundary.
