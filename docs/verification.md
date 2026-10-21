# Verification scope and results

K-Farm has been evaluated in isolated local databases and a separate hosted judge environment. These results establish specific software behaviors, not field safety, national optimization, actual equipment agreements or agricultural income improvements. Model-free tests and paid model evaluations are reported separately. The sections below are dated historical results, not a claim that every newer version received every earlier check.

## Current submission evidence — October 21, 2026

- **Paired actual-model comparison:** with the same 1,000 m² synthetic reviewed field, available potato equipment led to potato (5 essential tasks, 10.75 person-hours); unavailable equipment led to pepper (7 tasks, 24.75 person-hours). Both were applied through the UI, saved to isolated databases and verified after a new login. Both matched the deterministic baseline. The [case record](ai-decision-evidence.md) reports the rejected attempt, unresolved labor and private NAS inference transport explicitly.
- **Current hosted interface:** the October 21 Korean/English check confirmed the national view's crop, area, expected-output and progress focus, after removing the delay/labor/equipment column. The selected 2027 season showed four participating centers, 301 cultivations and 53.3 hectares. The retained business snapshot contains 301 fields and 1,791 tasks; these are plans, not completed farming activity.
- **Reference coverage:** the hosted screens expose dated aT price observations, RDA crop-cost references and KMA live weather with selectable Jangsu 1991–2020 normals. Partial economics and unreviewed climate applicability are not treated as completed farm-profit or regional-suitability validation.
- **Scale, separately:** isolated database loading and aggregation passed with 3,000 cultivations / 4 centers / 18,000 tasks and 30,000 cultivations / 40 synthetic centers / 180,000 tasks. The retained query-plus-aggregation timings were approximately 267–282 ms and 2,878–2,920 ms respectively on that local environment. These are not public deployment volumes, full AI-approval journeys, concurrent-user benchmarks or national statistical coverage. Both tests made zero paid model calls and zero operating-data writes.
- **Source and deployment:** the current application source is public commit `5fa3e3415ba6e199bd5855744b8d0180b10ce34f`; the NAS web and operations image is `kfarm-judge-web:20261021-r1`. The source manifest has 917 files, with digest `67ff2a0c45007dc976315c39d321b72132e15f5b234324e64a512fcabc5155ba`. This documentation revision does not change the application image.
- **Preservation and recovery:** the October 20 release retained 20 protected business-record kinds and all four center states; calculated continuous-production fingerprints/timestamps refreshed separately. A business-backup restore was checked in a separate database. Both isolated A/B databases were also backed up and read back, and an isolated restore matched their raw rows. The canonical AI ledger was not reset or replaced. These are bounded recovery checks, not proof of offsite disaster recovery.

The current **Apply AI plans** button authorizes calculation, validation and application. Earlier descriptions of a separate preview/batch-approval screen below describe the interface at their stated date. See the current [judge guide](judge-guide.md) before trying a write action. The existing linked 174-second video is the October 18 recording until a revised recording is published; its counts must not be relabeled as the current dataset.

## Historical submission evidence summary — October 19, 2026

- **Actual AI:** [two traced decisions](ai-decision-evidence.md) connect crop/resource proposals and a compound incident to UI confirmation and stored effects. Both match the rule baseline; superiority is not established.
- **Hosted workflow:** a fresh NAS intake, automatic Nebius review, approval and a model-backed date change reached persistent records on October 19, after incomplete synthetic field conditions were corrected. Six tasks, three equipment reservations and six labor-demand records were stored. No actual SMS or machinery action occurred.
- **Scale:** the public 174-second English film uses 300 cadastral references with fictional people/resources: 299 cultivations (284 rice, 15 potato), one held orchard, 1,779 tasks and 897 equipment reservations. A seven-day repair resulted in 129 saved task changes. This is not 300 completed farming seasons or a national optimum.
- **Source/runtime:** the audited 856-file source snapshot was compared byte-for-byte with both NAS web and operations containers on October 19. The source-only Windows build and fresh empty-database account setup passed. The NAS overlay built on Linux; an independent clean Linux root-Dockerfile build remains unverified.
- **Operating boundary:** the [judge checklist](judge-operations.md) distinguishes current access, retained backups and a finite AI allowance from guaranteed access throughout judging. A same-volume backup listing is not an offsite restore test.

Later sections retain their original measured counts and notification behavior. In current operation owner SMS is disabled, and worker messages are recorded/queued rather than delivered by a carrier.

## Earlier submission checkpoint — October 19, 2026

- Regression suite: **198 test files / 855 tests passed; two files / five tests skipped**. Skips require private optional cadastral snapshots or retained model responses; they are not counted as passing.
- Python solver suite: **56 passed**. TypeScript checking and the production build passed.
- A newly created, isolated database completed the browser journey from two-field intake through crop/resource approval to a combined machine breakdown and worker absence, adjacent resource allocation, saved changes and attendance/center notice records. Existing operating records were preserved. This final rerun was **model-free**, made no inference charge and reported no page errors; it is separate from the retained actual-model evidence above.
- The hosted web and operations containers restarted successfully. Four center records, 6,330 non-session work records and 373 outbox records retained exactly the same fingerprints. The canonical ledger retained 717 call records and unchanged cumulative reservation totals. The saved 2027 schedule remained accessible after restart; no database was reseeded.
- At that checkpoint, the runtime was the reviewed `20261019-v6` application snapshot. The accompanying publication added documentation and source-export checks. The October 21 application version above supersedes that runtime; the earlier test counts remain dated evidence.

These are point-in-time checks. They do not establish continuous uptime, an offsite restore, a new paid-model comparison or completed farming activity.

## Production integrated into managed fields — 2026-10-16

The separate Production overview tab is now part of Managed fields. Each field's
Manage dialog has Owner, Field details, Crop / production and Work history tabs.
Crop editing, stored next-cultivation proposals, crop comparisons, participation
terms and accumulated cultivation records remain available. Cross-field planning
and batch confirmation open from **AI planning / batch approval** above the field
list. Former `tab=production` and `section=production` links open this review in
its new location instead of losing access.

This is a presentation consolidation, not a data migration. The existing
planning, approval, reservation and notification APIs are unchanged. The list
and per-field view read saved reviews; opening them does not run inference,
regenerate a plan or save an approval. Explicit review/approval retains the same
fingerprint and authorization checks.

Targeted unit checks passed (42 tests), along with eight browser checks and the
production build/type check. Browser checks cover scoped field data,
preserved history, individual and batch confirmation, participation changes,
stale approval rejection, old links and Korean/English narrow layouts. These
interaction tests use controlled endpoint responses. Separate opt-in checks
read retained records and a previously generated real-AI result from the isolated
database without reseeding or another model call. The retained business-record
fingerprint was unchanged by per-field browsing. This is not a new inference or
a new end-to-end approval against the operating database.

Sources: `e2e/continuous-production.spec.ts`, `e2e/integrated-planning.spec.ts`,
`e2e/field-production-saved-review.spec.ts`, `e2e/submission-saved-review.spec.ts`
and `tests/workspace-domain-layout.test.ts`. Existing operating records are not
reset or backfilled by this change.

## Integrated intake and incident journey — 2026-10-16

One browser journey now connects the new joint crop/resource planner to actual
Nebius inference and persistent business effects, rather than combining separate
mock-screen, model-only and database-only results.

- The browser entered one fictional applicant and two fields through the ordinary
  registration form. Four centers' resource records were read; this run does not
  claim four simultaneous new-center intakes or nationwide optimization.
- The real model evaluated crop compositions through the common scheduling tool
  and selected rice plus potato. It also evaluated rice plus pepper. Its checked
  comparison cited 11 versus 13 essential tasks. The selected plan had two ready
  fields, 11 essential tasks, zero unplaced essential tasks and 49.75 person-hours.
  The operational metrics **equaled the rule baseline**; there is no demonstrated
  model advantage in this case.
- Staff staged the review and confirmed both fields in the UI. The transaction
  saved two cultivations, 13 scheduled tasks/reservation records (including
  observation work beyond the 11 essential tasks), 13 labor-demand records,
  seven shared equipment reservations and a pending owner-notice record.
- The incident affected the rice harvest produced by that same application.
  A repair interval and an explicit worker absence made the local alternatives
  infeasible. With recorded adjacent-center equipment authorization and confirmed
  worker support, the actual model selected the adjacent-resource alternative.
  The date remained unchanged; the machine changed and the start moved by
  30 minutes for travel. Equipment and support labor each occupied 270 minutes.
  This selection also matched the rule baseline and was the only feasible
  alternative; it is not evidence of superior optimization.
- The ordinary schedule-change screen saved the replacement, shared reservation,
  repair interval and owner notice. The prior attendance job became stale;
  a replacement job and explicit reconfirmation were checked, along with notices
  to both centers. Other centers' plans, completed history and unaffected work
  were unchanged. Duplicate registration, model request, approval and automatic
  rescheduling commands did not duplicate effects or repeat inference.

The normal plan used three real completions (two evaluations and one selection);
incident reconsideration used one. The total application usage estimate was
**$0.001459**, with **$0.021048** conservatively reserved against the existing
budget. These are not provider invoice figures. No automatic paid retry ran.

The business database was disposable `kfarm_centers_e2e`; the AI ledger remained
the existing operating ledger. The operating business fingerprint was identical
before/after: 8,185 work records, four centers, 61 outbox entries, seven receipts
and 113 audit rows. No actual message, purchase, employment or device command was
issued. The journey stopped at persisted pending notifications, not carrier
delivery. The period, soil, ownership, resource and adjacency inputs were controlled
test assumptions; external parcel lookup alone was stubbed. Business endpoints,
the scheduler, model inference, approval and storage were not stubbed.

After this run, a presentation-only change added actual-call counts, honest
baseline equality text and the model's verified alternative-comparison values
to the existing comparison tab. A saved-real-result UI test and a synthetic UI
test passed in Korean and English without another paid call. That rendering
check is explicitly not a fresh inference. Owner screen acceptance remains open.

Reproduction sources: `e2e/submission-journey-live-db.spec.ts`, its input fixture
`tests/submission-journey-fixture.ts`, and `e2e/submission-saved-review.spec.ts`.
The ordinary test run is opt-in and model-free; paid mode additionally requires
a unique run ID and the existing shared ledger. Private reports and screenshots
under `.data/verification/submission-journey/` are excluded from public source.

## Bulk rescheduling search repair — 2026-10-12

The same five ordinary-screen-to-database cases were rerun after improving the constraint engine's starting search hints. The earlier failed run remains retained separately: its 120-task case placed 106 tasks two days away despite a one-day feasible arrangement, and its feasible 240-task congested case timed out and was incorrectly presented as a resource shortage.

The engine now reserves fixed commitments before building bounded placement hints, prioritizes selected work with tight windows, and ranks candidate dates by distance from the requested date. These hints are not executable results: CP-SAT must find a complete feasible solution, and the existing independent server verifier and approval transaction still enforce the constraints. No crop windows, protected records, staffing limits or loan permissions were relaxed. This warm-start change is limited to replanning; initial cultivation admission retains its existing calculation.

| Same production UI / isolated database case | Result |
|---|---|
| 30 tasks into local vacancies | All saved, including 23 equipment reservations, 15 farmer notice records and 7 labor reconfirmation jobs. |
| 240 tasks into local vacancies | All saved, including 180 equipment reservations, 120 farmer notice records and 60 labor reconfirmation jobs. |
| 120 tasks with the requested date occupied | All 120 saved exactly one day from the requested date; fixed bookings preserved. Passed three consecutive browser runs. |
| 240 tasks requiring related-booking movement | All 240 saved on the requested date after 12 related bookings moved within their allowed windows. Passed three consecutive browser runs. |
| 120 tasks affected by an equipment repair interval | Original dates retained using a preapproved adjacent-center machine; five loan days and ten both-center notice records saved. |

The first five-case run passed in 54.0 seconds. The two former failures passed two additional repetitions each in 52.9 seconds. Twelve existing browser checks also passed, covering desktop/mobile changes, repair requests, attendance reconfirmation and recovery after an interrupted response. The targeted TypeScript/API suite passed 93 tests in 16 files; all 56 Python solver tests, type checking and the production build passed. These are targeted current checks, not a claim that the complete TypeScript repository suite was rerun.

Search timeout, oversized connected scope and invalid-model results are now distinct from proven infeasibility. They do not create a misleading additional-resource request or partially apply a schedule. The ordinary automatic flow remains equipment-only for equipment tasks; manual-conversion behavior in older dated sections below is historical.

Browser checks verified exact stored plans and reservations, farmer notices, labor reconfirmation, unchanged completed/cancelled/locked/started tasks, unchanged lender records, reload persistence and duplicate-request safety. Operating database fingerprints for centers, 8,052 business records, outbox and AI call/budget ledgers were unchanged. Local web and calculation servers were restarted with the latest code. No paid inference, real SMS, device commands, deployment or repository publication occurred in this repair.

These cases use synthetic 15-minute work items and controlled capacities in `kfarm_test`, not observed agricultural productivity. They demonstrate one operator's bulk operation up to 240 selected tasks, not concurrent multi-user load or a universal globally optimal result (`optimal=false` is retained where optimality was not proved). Private evidence: `.data/validation/20261012-bulk-ui-fixed/`; the earlier failures remain in `.data/validation/20261012-bulk-ui/`.

## Manual substitution follows the ordinary screen — 2026-10-11

The previous manual-fallback screen test supplied its work-rate standard directly to the disposable database. The ordinary screen now supplies that standard through a center-scoped, authenticated API. Only the home-center administrator can save it; the server records the reviewer and source classification and rejects stale versions, protected work, specialist tasks and unsupported participation.

The working copy passed **697 tests in 168 files**, with no failures or skips, plus type checking and a production build. A new private source copy passed its production build and **nine model-free HTTPS browser checks**, including desktop and mobile manual-standard entry followed by rescheduling, interrupted-request recovery and staffing operations. The manual scenario uses a controlled 1,000 m² delegated harvest, a two-person crew and an entered work-rate assumption. That scenario validates software flow, not its agronomic accuracy or general manual feasibility.

Saving the standard leaves the scheduled date, equipment, actual staffing and reservations unchanged; a subsequent ordinary rescheduling command revalidates and commits the changes. Split-package area is used rather than recounting the whole parcel. Estimates exceeding one workday remain explicit and require daily work-package review instead of invented speedups.

The operating 30 fields / 460 tasks, account and AI-ledger fingerprints, and the previous recovery-check database remained unchanged. No paid inference, real SMS or hardware commands were issued. The operating local server was restarted with the new build, with its previous build retained for rollback. Owner screen acceptance and the later chronological demo refresh remain pending.

## Source-only reproduction

The 2026-10-11 source-only check used Windows, Node.js 24, pnpm 11.25.0, Next.js 16.3.8, Python 3.12 and local PostgreSQL. Actual environment files, operating records and the three private provider snapshots were absent from the exported source.

| Check | Result and scope |
|---|---|
| Frozen dependency installation and production build | Passed from the separate source copy. |
| Empty-database installation | Passed schema installation, four empty centers, one-time administrator setup, authenticated access, logout and login. No farmer data or paid calls were created. |
| Four-center browser workflow | Passed four sequential registrations producing 32 tasks, normal changes, equipment replacement, and a combined wind/failure/absence case. |
| Downstream effects | The browser workflow checked approval, reservation changes, attendance reconfirmation, notices to both centers and local notification receipts. |
| Failure boundaries | Infeasibility, offered-but-unconfirmed resources, stale approvals, duplicate requests and completed/other-center record preservation were checked. |
| Dependency advisory scan | No known advisories reported by the current JavaScript dependency audit. This is not a penetration test or a guarantee of no vulnerabilities. |
| Final source-only regression suite | 554 passed, 5 optional tests skipped, 0 failed across 148 files (146 passed and 2 skipped). Includes canonical-origin and secure-session tests. |
| Python solver tests | All 50 passed in the fresh constrained Python environment. |

Three optional tests inspect the excluded provider files, and two replay excluded historical model logs. They are skipped when those private inputs are absent; synthetic parser, capacity, decision-contract and business-path tests remain enabled. The four-center acceptance fixture supplies controlled geography, crop windows, equipment and people. It does not claim these are observed field conditions.

[Installation and repeatable commands](clean-installation.md) describe the checked paths. Linux containers, HTTPS hosting and sustained judge access still need deployment-specific verification.

## Real model decisions

The live evaluations used NVIDIA `nvidia/Nemotron-3_5-Lightning` through Nebius Token Factory. Tool choice was automatic, reasoning was low and temperature was 0.1. Crop review allowed up to 2,048 output tokens; schedule review allowed up to 4,096. Server-side selection, numerical-evidence and rejection-reason checks remained active.

Five controlled crop comparisons passed the current contract, including separate candidate-order changes and priority changes. A separate browser journey completed registration, a real crop review, operator approval, common reservations, labor demand and a pending farmer notice.

Six final schedule-comparison cases passed the current contract. They covered equipment use, external-resource priorities, labor shortages and combined incidents. A no-feasible-alternative case stopped before a paid model call.

A further four-center browser evaluation made three live schedule decisions and continued to stored operational effects:

| Case | Changed tasks | Equipment changes | Sum of date shifts | Borrowed equipment | Support labor |
|---|---:|---:|---:|---:|---:|
| Normal rescheduling | 1 | 0 | 1 day | 0 minutes | 0 person-minutes |
| Equipment replacement | 1 | 1 | 0 days | 0 minutes | 0 person-minutes |
| Wind, breakdown and absence | 2 | 1 | 1 day | 270 minutes | 270 person-minutes |

The compared target tasks had no unassigned items or work-window violations. In the compound case, one additional related task changed; the lender's existing commitments and completed work remained protected. Approval led to stored reservations, attendance reconfirmation, notices for both centers and local notification receipts.

**The model and rule baseline had the same measured scheduling outcomes in these three browser cases.** This demonstrates grounded model participation and a completed workflow, not an optimization advantage. The infeasibility result comes from the constraint engine rather than independent mathematical proof by the language model.

Earlier model failures were retained as failures. An output truncation and an unsupported evidence reference were rejected before the relevant output or evidence contract was corrected and retested. Small successful comparisons do not establish a population-wide model success rate.

## Automatic rescheduling screen recheck — 2026-10-11

The revised ordinary screen removes the model checkbox and alternative-selection steps. A reason and optional preferred date lead to one **Reschedule** command. Its internal decision, validation, approval transaction and saved receipt remain auditable.

The four-center browser journey was rerun against the production build with both model-free decisions and three live Nebius decisions. Four sequential registrations created 32 new tasks. Normal rescheduling, compatible self-owned replacement, and a combined wind/breakdown/absence case reached saved schedules, common reservations, labor reconfirmation, both-center notices and local delivery receipts. Replaying the same automatic request returned the saved result without another inference or duplicate commit.

The three cases retained the measured outcomes in the table above. They establish integration, **not an AI optimization improvement**: local-first search stops at its first feasible stage, so these are chiefly validation/selection cases rather than comparisons among multiple feasible strategies. Selection and rejection evidence passed the server contract, but no unsupported economic benefit is claimed.

This recheck found and fixed a crop-identity connection: the original three-crop plan path saves the selected crop name without the newer catalog marker. Compatible local substitutes now resolve that saved identity and still require the substitute's explicit crop compatibility; missing compatibility is not invented. Development event injection performs an unpaid preliminary calculation, and its reschedule button uses the same automatic path as normal work.

The new live run made exactly three calls, totaling 4,383 input and 3,025 output tokens. The recorded token-cost estimate was $0.000990 and the conservative reservation was $0.016490; neither is a provider invoice. The operating business/account fingerprints were unchanged. Existing demo history was not backfilled or re-seeded.

The local regression suite passed **601 tests across 154 files**, with no failures. The added crop-identity fallback was also checked separately (15 automatic-replanning tests passed). Type checking and the production build passed. The operating server was restored after disposable-DB browser testing; its login endpoint responded successfully. These are local working-copy results, not a new verification of the public source export or every historical browser suite.

Remaining boundaries: ordinary screen refinement and operator review are still in progress; this recheck is not hosted, physical equipment or carrier-SMS validation. Manual substitution requires its own reviewed workload/staffing criteria; generic equipment duration is not a manual-work standard.

## Interrupted rescheduling recovery — 2026-10-11

Each automatic request now has a server-owned, five-minute execution lease. **Check result** retrieves the exact saved request without repeating comparison or inference. A completed request returns its receipt. After an interrupted lease expires, a durable proposal may resume approval only after the ordinary version, weather, resource and expiry checks pass. An abandoned request with no saved proposal is marked failed without changing the schedule; starting again requires a separate operator action.

The recovery API tests cover saved, expired, unprepared, still-running and concurrent recovery. A late handler cannot overwrite a newer recovery, another center cannot claim the receipt, and an uncommitted automatic proposal cannot bypass its request fence through direct approval.

Six browser checks passed on the new production build, including response delivery interrupted **after an actual disposable-DB commit**, an expired durable checkpoint, an abandoned pre-proposal request, explicit reviewed manual substitution, date/repair-period changes and the simplified labor form. Recovery did not create a second decision, plan commit, reservation or notification. These checks used synthetic business records and no paid model calls. The revised four-center browser journey also passed again, through sequential intake, compound incidents, reconfirmation and local delivery records.

No existing demo history was completed or replaced to make these tests pass. A fresh chronological demo remains deferred until settings and screen behavior are settled. All operating business, account and AI-ledger fingerprints remained unchanged during this recovery verification.

The complete working-copy regression run passed **607 tests across 156 files**, with no failures; type checking and the production build also passed. A new private source-only review copy passed frozen dependency installation, production build, fresh empty-database account setup and the model-free four-center browser journey. Its 658 exported source files retained their audited hashes after verification. The full 607-test suite was run in the working copy, not rerun in that export. No publication, deployment or additional paid inference occurred in this recovery run.

### Shared origin guard and local HTTPS verification

The source review found legacy loopback-only checks in 19 business endpoints. These are now consolidated into the common authenticated origin guard. Internal incident requests retain their original validated Host, Origin and session rather than inventing localhost headers. Center permissions and business validation remain in place.

The latest working-copy build passed a local HTTPS reverse-proxy browser run: actual login, Secure/HttpOnly/SameSite session cookies, center scope, forged-origin rejection, direct-backend rejection and logout, followed by the full model-free four-center journey. Both browser tests passed. An initial login-test assertion expected the name alone while the interface displayed name plus role; the locator was corrected and both tests rerun. No application security condition was relaxed.

The complete regression suite passed **610 tests in 157 files** in 430.47 seconds. Type checking and production build passed, and the four-center journey also passed again on the ordinary local HTTP origin. The operating server was restored afterward. Business, account and AI-ledger fingerprints remained unchanged, with zero additional paid calls; the public Git checkout was not modified.

The reverse proxy and self-signed certificate were confined to loopback, using a disposable database and disabled provider calls. This does **not** establish external hosting, a trusted public certificate or sustained judge access. Operating demo records were not backfilled or replaced. The final deployment environment still requires its own approval and verification.

## Fresh-demo input boundary and latest screen checks — 2026-10-11

The fixed-date 30-field snapshot writer has been removed from the ordinary interface and database service. A cached insert request receives HTTP 410 (`LEGACY_DEMO_IMPORT_RETIRED`), including against an empty test center; the old installer exits without importing the database. Existing manifests remain readable for preservation and scoped retirement. This does not activate a new importer: the owner's screen/settings acceptance, selected cleanup scope and chronological ordinary-input replay still precede a fresh working demo.

Eight HTTPS browser checks passed on the latest working-copy build, including the retired-import boundary, automatic date/repair rescheduling, supported manual fallback, interrupted-result recovery, simple labor registration and D-7/D-2 attendance. The attendance case recorded a test phone reply, advanced only the scheduled worker's explicit test clock and verified replacement plus operator acknowledgement without treating silence as a penalty or confirmed attendance. The operating 30 fields, 460 tasks, accounts and API ledger remained unchanged; no paid model, actual message or device command was used. Type checking and production build passed.

The publication inventory now shares one root-file allowlist between audit and export, including the operation-screen, chronological replay and retirement test configurations. Previously those newer configurations could be omitted even when their test source was exported. This is a reproduction safeguard, not proof of a public deployment or owner acceptance.

## Closed optional work and continuous cultivation — 2026-10-11

A recorded omission of an optional inspection or conditional operation no longer blocks the next cultivation as if it were unfinished mandatory work. It retains its **cancelled** status and operator reason; it is not converted to a completed result. Mandatory cancellations, withdrawal/crop-change cancellations, missing evidence and unfinished work still block the expired cultivation. The common scheduler still rejects cancelled prerequisites.

Newly admitted missions retain their plan's operation kind. For older missions, the continuous planner reads the exact saved cultivation plan into its calculation view without migrating historical mission rows or inferring their kind from the current crop catalog. Source fingerprints include these stored classifications, so previously reviewed proposals must be revalidated.

The regression first reproduced the false block, then passed **109 tests across 27 files** after correction. A disposable-DB API test used ordinary registration, approval, cancellation and execution endpoints, explicitly recorded synthetic work results, confirmed that an unfinished final operation stayed blocked, and approved the next linked cultivation after completion. It also covered historical missions without stored kinds, preserved their old plans/results byte-for-byte at the JSON value level, retained synthetic provenance, created one pending notification and deduplicated approval. No paid inference, actual message or equipment command was used.

Type checking and the production build passed. The operating web server was restarted; its business/account/AI-ledger fingerprints were unchanged, with 30 existing fields and 460 tasks still intact. This API-focused check is not a new browser acceptance or public-export verification. Existing demo history was not backfilled and the fresh chronological input remains deferred until the owner finishes reviewing settings and screens.

## Retired prototype write paths — 2026-10-11

The remaining fixed-snapshot bypasses are closed. Cached `workspace/injectDemo` requests and prototype registration, crop-choice, fixed-plan, wind, approval and lock actions on the old endpoints return HTTP 410 after the existing authentication/origin checks. The old `seed` and `ground-demo` commands also exit before loading a database module. Historical reads remain available; empty-center initialization and the ordinary center-scoped local notification handler remain intact.

Isolated tests cover both populated and empty centers, unauthorized origins and other-center requests, historical reads, duplicate empty-center creation, and notification delivery without resending or touching another center's queue. These checks do not migrate records, generate completed work or create a replacement working demo. Internal historical fixtures remain for regression testing; they are not an onboarding route.

The complete working-copy regression suite passed **669 tests across 166 files** in 393.98 seconds. Type checking and the production build passed. All eight local HTTPS operation-screen checks passed again, including cached requests to each retired endpoint, interrupted-result recovery, date/repair rescheduling, reviewed manual fallback and D-7/D-2 attendance. The ordinary local server was restarted on the new build. Business, account and AI-ledger fingerprints were unchanged: 30 operating fields and 460 tasks were retained with no additional paid inference, actual messages or equipment commands. These results are not owner screen acceptance, a hosted service or a fresh chronological demo.

## Reproducible source and isolated four-center run — 2026-10-11

A new source-only copy, with no actual environment files or private provider snapshots, passed frozen JavaScript installation and a fresh constrained Python installation. All **50 Python solver tests** passed. The full TypeScript suite passed **677 tests in 165 files**, with five optional tests in two files skipped because their private provider inputs or historical model logs are not distributed. There were no failures. The production build passed.

The acceptance tooling now permits a strictly named, separately provisioned local four-center database for each run. It still rejects arbitrary hosts and operating database names, and `--fresh` refuses an existing database without changing its schema. Thirteen focused checks cover these boundaries. This prevents a new acceptance run from requiring an earlier replay/recovery dataset to be overwritten.

From that source copy and a newly created database, two HTTPS browser checks passed: real login/session/origin/logout handling and the complete four-center journey. Four sequential applications created 32 new tasks. Normal rescheduling, compatible equipment replacement and combined wind, breakdown and absence reached stored plans, shared reservations, attendance reconfirmation, both-center notices and local delivery records. The three model-free decisions had zero unassigned selected tasks and zero work-window violations. These are controlled-input results, not a measured model advantage or field-performance estimate.

The new run used zero paid inference. The working 30-field/460-task records, accounts, AI ledger and the separate prior recovery-check database retained their pre-run fingerprints. The ordinary local app stayed online. Only the temporary test web/proxy/solver processes were stopped afterward. Public source publication, owner screen acceptance, a fresh chronological working demo, video, judge access and submission remain separate pending steps.

## Protected boundaries

- No actual SMS, equipment command or physical inter-center loan was executed. Local notification receipts are not carrier receipts.
- Existing operating business records were preserved. Paid evaluation used the existing shared accounting ledger; synthetic business records were kept in a separate disposable database.
- Actual API keys, personal records, authentication/recovery material, raw provider files and raw model logs are not needed to reproduce the model-free checks.
- A public service still requires appropriate agreements, consent, field-validated agronomic criteria, hardware safety integration, privacy controls and deployment-specific security checks.

The full automated test source is supplied for reproduction. This summary deliberately excludes credentials, raw model responses and internal operational records.
