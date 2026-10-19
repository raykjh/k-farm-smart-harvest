# K-Farm : Smart Harvest

K-Farm is an AI-assisted shared farming system for township support centers. It proposes a way for aging rural communities to coordinate crop choices, equipment, operators, transport and farm labor.

This is an **operational MVP and a policy proposal**, not an adopted government program or a field-certified autonomous farming service. The same business paths process ordinary inputs and synthetic evaluation inputs; demonstrations do not substitute fixed outcomes for registration, scheduling or approval.

## Capabilities

For the hosted evaluation, see the [judge guide](docs/judge-guide.md). English and a restricted judge account are prefilled. Next-season tasks are under **Schedule → 2027**, not today's dashboard.

- Continuous farmer and parcel registration, linked cultivation records, and preservation of completed work as applications accumulate.
- New land enrollment is delegation-only: center staff manage crop selection, equipment and labor planning. Worker enrollment is separate and does not require owning or registering a field; registering land never enrolls its owner as a worker. Legacy participation metadata remains readable without rewriting past agreements or completed work.
- Crop alternatives based on configured suitability, regional preferences, production references and work/resource requirements. Missing or unreviewed agronomic data remains a review condition.
- Scheduling within work periods, predecessor rules, equipment compatibility, operator/labor capacity, transport, weather constraints and shared reservations.
- Confirmed equipment/labor sharing between directly adjoining centers without overwriting another center's commitments.
- Operator-initiated automatic replanning after wind, breakdowns, delays or absence, saving validated changes and their downstream records together.
- Persistent reservations, attendance reconfirmations, worker message queues, both-center records and actual-work/correction records. Historical owner-notification records are retained, but new owner SMS is disabled.

The current scenario covers Gyebuk, Janggye, Cheoncheon and Gyenam in Jangsu, Korea. The catalog contains 30 crop types, but source coverage and field readiness differ. It is not a claim that every crop or region has certified operating parameters.

## AI responsibilities

NVIDIA `nvidia/Nemotron-3_5-Lightning`, served through **Nebius Token Factory**, reviews feasible crop and schedule alternatives against the operator's priorities.

| Responsibility | Implementation |
|---|---|
| Calculate feasible alternatives and resource use | Common TypeScript scheduling contract and Python OR-Tools CP-SAT service |
| Choose and explain trade-offs | Real model call with structured selection, numerical evidence and rejection reasons |
| Reject unsupported decisions | Server-side contract and priority validation; explicit `OPERATOR_REVIEW` on failure |
| Authorize changes | The operator's bounded rescheduling command, with version and availability checks repeated before commit |
| Record effects | PostgreSQL transaction, reservations, audit trail and notification outbox |

The model cannot invent equipment, change work windows, authorize borrowing or execute a machine. No feasible candidate means no model call. Approval and refresh reuse and revalidate a saved decision instead of paying for another inference. These checks demonstrate grounded decisions, not superiority over deterministic ranking or a national optimum.

The ordinary rescheduling screen needs a reason and an optional preferred date, not an AI checkbox or an alternative-selection workflow. It tries local vacancies, related local rearrangement and preauthorized adjacent equipment. A repair request first preserves each original workday with a compatible replacement. Model rationale stays in the audit record. If the available resources cannot satisfy the work window, a resource/condition request is saved; the system does not pretend that a purchase, worker attendance or farm work has occurred.

Equipment-to-manual conversion is disabled in ordinary rescheduling, including requests from older clients. The dialog does not ask for a manual replacement standard. Originally manual tasks still use their existing labor requirements and attendance workflow. Historical manual standards and completed records are retained without being reused as automatic substitutes.

After a connection interruption, **Check result** retrieves the saved request without another model call. A still-valid saved proposal can finish its approval after the old execution lease expires; otherwise the existing schedule is preserved and a separate new request is required. A failed delivery is not treated as a failed database commit.

## Current verification

### Deployed workflow check — 2026-10-19

The NAS-hosted application completed one fictional intake against a real cadastral reference: automatic **actual Nebius** crop/resource review → screen approval → saved cultivation, six tasks, equipment reservations and labor demand. A subsequent actual-model reschedule was applied and remained after refresh. Existing records and other-center state were preserved. Three calls reported 5,166 input and 1,683 output tokens; the token-derived estimate was $0.000716, distinct from $0.015722 of conservative reservation and from provider billing. Compared metrics equalled the rule baseline; this does not prove optimization superiority. Labor outside the D-7 window remained unconfirmed, and outgoing notices were recorded only.

Source-maintenance changes dated 2026-10-19 add read-only draft freshness checks, refresh the bounded price-review window and clarify next-season navigation. The public repository is a source-only release: operating DBs, synthetic judge DB dumps, provider samples, credentials and raw AI logs are excluded. Historical verification below remains dated evidence, not a claim that every newer line received that earlier check.

Earlier source-only verification on 2026-10-11:

- A fresh source-only copy passed **677 tests in 165 files**; five optional tests in two files were skipped because private provider snapshots and historical model logs are deliberately excluded. No tests failed.
- A new constrained Python environment passed **50 solver tests**. Frozen dependency installation, dependency consistency and the production build passed.
- Actual HTTPS browser login and the four-center business journey passed from that same source copy in a newly provisioned run-specific database. Four sequential applications created 32 new tasks; ordinary rescheduling, replacement equipment and compound wind/failure/absence handling reached saved reservations, attendance reconfirmation and local delivery records.
- The run made **zero paid model calls**, preserved the operating records and previous recovery-check database, and did not publish or deploy the application. These checks are separate from owner screen acceptance and the later chronological working demo.

Earlier bounded checks and paid-model evidence:

- After connecting manual-standard entry, the working copy passed **697 tests in 168 files**, type checking and the production build. A separate source copy passed nine model-free HTTPS screen checks, including desktop/mobile standard entry through the ordinary API and subsequent saved rescheduling. Existing operating and recovery-copy fingerprints stayed unchanged; no paid calls were made. This does not replace field validation of the entered work rate.

- TypeScript and the Next.js production build passed.
- The source-only copy passed **554 tests in 146 files** against a disposable PostgreSQL database. Five optional tests in two files were skipped because the private provider snapshots and historical model logs are not distributed; no tests failed.
- A fresh constrained Python environment passed all **50 solver tests**. Frozen dependency installation, empty-database administrator setup and a model-free four-center browser journey also passed from the source-only copy.
- Five controlled live crop comparisons passed selection/rejection validation, including independent candidate-order changes. A separate new-crop browser journey reached approval and stored reservations, labor demand and notifications.
- Six final live schedule-comparison cases passed the current decision contract.
- A four-center browser journey passed with **three real schedule decisions**: normal rescheduling, equipment replacement, and a combined wind/breakdown/labor disruption. It reached approval, reservation changes, attendance reconfirmation, both-center notices and local delivery receipts.
- The browser journey also checked infeasibility without a model call, stale/duplicate approvals, unconfirmed resources and preservation of completed/other-center work.
- After the automatic rescheduling screen update, the working copy passed **601 tests in 154 files**, type checking and a production build. The revised four-center browser journey passed both model-free and three-call live-model runs, including saved receipts and duplicate-request protection. This newer local verification is separate from the earlier source-export checks above.
- The subsequent interrupted-request recovery update passed **607 tests in 156 files** and six targeted browser checks without paid inference. A new private source-only copy also passed installation, build, empty-database setup and the model-free four-center browser journey. The new review copy has not been published.
- The shared-origin update then passed **610 tests in 157 files**, type checking, production build, local HTTPS browser login and the model-free four-center journey on both HTTPS and the original local HTTP origin. That result is from the working copy, not an external deployment or a newly published source export.

Earlier failures remain failures. A truncated response was rejected before the schedule output limit was raised; an invalid evidence reference stopped an earlier browser run before the numeric-evidence boundary was made explicit and retested. These are bounded synthetic evaluations, not field reliability measurements.

Real SMS and hardware commands were **not** sent. External parcel/weather inputs were controlled in browser tests. Existing operating business records were preserved; only the authorized shared AI cost ledger received live-call records. [Verification scope and results](docs/verification.md) separates clean installation, model-free checks and paid-model evidence.

## Data and execution boundaries

Public geography is separate from fictional people, ownership assumptions and resource inputs. A displayed parcel does not establish ownership, consent or eligibility. KMA weather and VWorld parcel integrations use server-side credentials; missing, stale and simulated inputs must remain distinguishable.

Labor → Text messages manages workforce allocation/reconfirmation notices, superseded reminders, and a three-attempt mock failure/retry history. Owner SMS is disabled; historical records remain. Workforce confirmations are recorded as SMS replies or phone responses. There is no farmer app view. With `KFARM_SMS_WORKER=1`, the running server reconciles the queue every minute without sending anything; otherwise use **Refresh scheduled messages**. Only current, due messages can be simulated, and simulation never confirms attendance. Provider credentials, a registered sender, real delivery receipts and inbound replies are not connected.

Notification delivery currently ends in a local provider record, not a carrier delivery receipt. Equipment task/zone payloads prepare an integration; they do not control a machine. Real deployment requires field safety procedures, agronomic validation, legal agreements, privacy review and production adapters.

The proposal does not automatically invalidate leases, convert tenants into employees or guarantee income. [Policy rationale](docs/farmland-policy-rationale-2026-10-08.md) separates implemented software, proposed institutional links and future field improvements.

## Local setup

Prerequisites: Node.js 24, pnpm 11.25.0, and Docker Compose. Alternatively, run PostgreSQL and the Python 3.12 solver locally using `solver/requirements.txt`. Python dependency constraints record the versions used by the local validation; other platforms still need their own verification.

**Use a fresh local database. Never initialize or seed an existing operating database.** The development credentials and loopback bindings in `compose.yaml` are not suitable for a public server.

1. Run `pnpm install --frozen-lockfile`.
2. Create `.env` from `.env.example`. Keep `AI_MODE=demo` and provider keys blank for model-free execution.
3. Run `docker compose up -d --build` to start the local database and solver.
4. Run `pnpm exec prisma generate`, then `pnpm db:push`.
5. Add empty centers with `node --env-file=.env --import tsx scripts/initialize-centers.ts --apply`.
6. On a new database only, run `node --env-file=.env --import tsx scripts/auth-bootstrap.ts`. Keep its one-time setup link private and use it to create the initial administrator.
7. Run `pnpm dev` and open `http://127.0.0.1:3100`.

This initializes empty centers, not fictional applicants or completed work. Legacy fixed-snapshot commands and prototype write endpoints are retired; fictional inputs use ordinary registration, planning and explicit work-result entry. A fresh empty-database installation and a model-free four-center browser journey were verified on the dependency-patched source copy without the three private provider snapshots.

Provider snapshots are optional server-side inputs, not source dependencies. Missing snapshots disable the associated sample import or capacity-study source with an explicit response; they do not create fictional cadastral evidence. Live parcel and weather lookup require your own authorized provider keys. See [clean installation and verification](docs/clean-installation.md).

For paid decisions, set `AI_MODE=nebius`, `AI_CALL_SCOPE=decisions` and your own server-only `NEBIUS_API_KEY` in `.env.local`, then restart. Review provider prices and persistent ledger limits before enabling calls; expired price review blocks inference. [AI cost controls](docs/ai-cost-controls.md) distinguishes reservations, estimates and invoices. App limits cannot stop charges from other uses of the provider account.

For continuous intake on a long-lived Node server, set `KFARM_PRODUCTION_WORKER=1`, `KFARM_PRODUCTION_AI=1`, `KFARM_LABOR_WORKER=1` and `KFARM_SMS_WORKER=1`. Every minute, new eligible delegated registrations produce a real AI crop/resource draft; an operator still confirms it before schedules, reservations and notices are committed. Labor recruitment opens seven days before work, with unconfirmed assignments reconsidered two days before work. SMS is a queue only, not a connected delivery service. These loops require the server process to remain running; they are not a Windows startup service. Unchanged input claims survive restart without repeat inference. Accounts, reference data and the AI ledger are outside business-data reset scope.

Center staff may confirm their own center's saved, validated AI draft. Editing shared criteria, consent terms, or manually requesting another model review still requires the existing administrator permission. Confirmation rechecks the source fingerprint and dispatch constraints in the same transaction as reservations and records; it does not trust a client-supplied AI label.

## Automated checks

The database and solver must be running. The default suite uses disposable `kfarm_test`, not operating `kfarm`. Create a **local** Python environment even when the HTTP solver runs in Docker: solver contract tests execute the checked-out Python source directly.

On Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r solver/requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

On macOS/Linux, use `python3.12 -m venv .venv`, then `.venv/bin/python -m pip install -r solver/requirements.txt` and `.venv/bin/python -m pip check`.

```text
pnpm exec tsx scripts/setup-tests.ts
pnpm exec next typegen
pnpm typecheck
pnpm test
pnpm build
```

For Python unit tests, run `.venv\Scripts\python.exe -m pytest solver -q` on Windows or `.venv/bin/python -m pytest solver -q` on macOS/Linux. All 50 passed in a fresh constrained environment on 2026-10-11. Run dependency installation, Prisma generation and builds separately from running tests/servers on Windows; loaded native binaries can be locked.

For a model-free four-center browser run, prepare `kfarm_centers_e2e` with `pnpm exec tsx scripts/setup-centers-e2e.ts`. Stop any other server on port 3100, then start `pnpm exec tsx scripts/acceptance-web.ts --database=kfarm_centers_e2e` separately. In PowerShell:

```powershell
$env:DATABASE_URL='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e'
$env:AI_MODE='demo'
$env:KFARM_CENTERS_E2E='1'
$env:KFARM_COMPARISON_E2E='1'
pnpm exec playwright install chromium
pnpm exec playwright test e2e/model-free-operations.spec.ts --retries=0
```

The fixture resets only its guarded disposable database and uses real business APIs and solver responses without paid inference. Live comparison additionally requires explicit opt-in, a unique run ID and the existing shared accounting database. A fresh test database must not create a fresh spending allowance.

To preserve previous four-center verification data, use a new `KFARM_FOUR_CENTER_DATABASE` in the restricted `kfarm_centers_e2e_<run>` family and provision it with `scripts/setup-centers-e2e.ts --fresh`. The test `DATABASE_URL` and acceptance runner must select that same name. A separate HTTPS backend on port 3101 lets the ordinary app remain online; see the [isolated run instructions](docs/clean-installation.md#keep-separate-four-center-verification-runs-isolated).

## Judge walkthrough

1. Register an applicant and parcel; select a reviewed crop candidate or request AI crop review.
2. Confirm the cultivation and inspect work periods, resources and reservations.
3. Open a scheduled task, enter a reason and optional preferred date, then press **Reschedule**.
4. Apply a controlled breakdown or compound incident. Observe date preservation using a substitute, or bounded replanning when needed.
5. Check the saved result; candidate evaluation and validated model selection take place behind the same command, without separate comparison/approval screens.
6. Verify changed reservations, labor reconfirmation, both-center notices and the local farmer notification record. Replaying the same request must not apply it or charge inference again.
7. Inspect a resource-shortage case: the system retains a request to secure equipment, staffing or reviewed work conditions rather than fabricate success.

Use a dedicated evaluation dataset. This is not a public demo URL, and an empty installation does not preload every record needed for this walkthrough.

During screen refinement, existing demo history is preserved, not retrospectively marked complete. After the settings and workflows are settled, demo-only records can be replaced and fed through ordinary registration and chronological work-result paths. Passing a date alone never marks work completed; completion, rescheduling or cancellation needs a recorded outcome.

## Release status

This source release contains the application, calculation engine, database schema, synthetic tests and installation instructions under Apache-2.0. It excludes actual API keys, operating databases, personal records, cached provider datasets, raw model logs and internal development handoffs. [Publication and data scope](docs/public-source-and-data.md) explains the boundary.

The source-only Windows checks have passed. Hosted judge access, the final public video and hackathon submission are still pending. A source repository is not a deployed service. Next steps are a separate secure evaluation environment, an English video under three minutes and final submission review. No deployment of the development PC or operating database is implied.

Screen review and the fresh chronological demonstration come first. The legacy per-endpoint loopback checks have been consolidated into the shared origin guard; local HTTPS login and the model-free four-center workflow passed behind a loopback reverse proxy. This is not an external deployment. The approved host, trusted certificate, reverse proxy and sustained judge access still require environment-specific verification.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) govern submission. The deadline checked on 2026-10-11 is October 30 at 10:00 AM PDT, or **October 31 at 02:00 KST**; recheck before submitting.

## License

Original source is licensed under [Apache License 2.0](LICENSE), selected on 2026-10-11. Dependencies, datasets, maps and provider assets retain their own terms. This does not grant rights to personal data, credentials, trademarks or third-party material. See [publication and data scope](docs/public-source-and-data.md).

## 한국어 안내

K-Farm은 고령·소규모 농가를 지역 농업 지원센터가 함께 지원하면 어떨지 제안하는 운영 소프트웨어입니다. 실제 업무 구조를 구현하고 데모에서는 입력 자료만 가상으로 사용합니다. 작물계획은 담당자가 확정하며, 일정변경은 담당자가 재배치를 요청하면 내부 계산·AI 검증을 거쳐 예약과 안내 기록까지 함께 저장합니다. 장비 구매·외부 파견을 임의 실행하지는 않습니다.

현재 로컬 검증과 실제 모델 연결은 확인했지만 현장 운영 승인·실제 문자·장비 제어·정책 채택을 뜻하지 않습니다. [개발 배경](docs/farmland-policy-rationale-2026-10-08.md), [검증 범위](docs/verification.md), [공개 자료 범위](docs/public-source-and-data.md)를 참고하세요.
