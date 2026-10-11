# Verification scope and results

K-Farm has been evaluated as local operational software with controlled inputs. These results establish specific software behaviors, not field safety, national optimization, actual equipment agreements or agricultural income improvements. Model-free tests and paid model evaluations are reported separately.

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

## Protected boundaries

- No actual SMS, equipment command or physical inter-center loan was executed. Local notification receipts are not carrier receipts.
- Existing operating business records were preserved. Paid evaluation used the existing shared accounting ledger; synthetic business records were kept in a separate disposable database.
- Actual API keys, personal records, authentication/recovery material, raw provider files and raw model logs are not needed to reproduce the model-free checks.
- A public service still requires appropriate agreements, consent, field-validated agronomic criteria, hardware safety integration, privacy controls and deployment-specific security checks.

The full automated test source is supplied for reproduction. This summary deliberately excludes credentials, raw model responses and internal operational records.
