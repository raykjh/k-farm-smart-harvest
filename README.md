# K-Farm : Smart Harvest

K-Farm is an AI-assisted shared farming system for township support centers. It proposes a way for aging rural communities to coordinate crop choices, equipment, operators, transport and farm labor.

This is an **operational MVP and a policy proposal**, not an adopted government program or a field-certified autonomous farming service. The same business paths process ordinary inputs and synthetic evaluation inputs; demonstrations do not substitute fixed outcomes for registration, scheduling or approval.

## Capabilities

- Continuous farmer and parcel registration, linked cultivation records, and preservation of completed work as applications accumulate.
- Crop alternatives based on configured suitability, regional preferences, production references and work/resource requirements. Missing or unreviewed agronomic data remains a review condition.
- Scheduling within work periods, predecessor rules, equipment compatibility, operator/labor capacity, transport, weather constraints and shared reservations.
- Confirmed equipment/labor sharing between directly adjoining centers without overwriting another center's commitments.
- Replanning after wind, breakdowns, delays or absence, followed by operator comparison and batch approval.
- Persistent reservations, attendance reconfirmations, both-center notices, farmer notifications and actual-work/correction records.

The current scenario covers Gyebuk, Janggye, Cheoncheon and Gyenam in Jangsu, Korea. The catalog contains 30 crop types, but source coverage and field readiness differ. It is not a claim that every crop or region has certified operating parameters.

## AI responsibilities

NVIDIA `nvidia/Nemotron-3_5-Lightning`, served through **Nebius Token Factory**, reviews feasible crop and schedule alternatives against the operator's priorities.

| Responsibility | Implementation |
|---|---|
| Calculate feasible alternatives and resource use | Common TypeScript scheduling contract and Python OR-Tools CP-SAT service |
| Choose and explain trade-offs | Real model call with structured selection, numerical evidence and rejection reasons |
| Reject unsupported decisions | Server-side contract and priority validation; explicit `OPERATOR_REVIEW` on failure |
| Authorize changes | Human operator, with version and availability checks repeated before commit |
| Record effects | PostgreSQL transaction, reservations, audit trail and notification outbox |

The model cannot invent equipment, change work windows, authorize borrowing or execute a machine. No feasible candidate means no model call. Approval and refresh reuse and revalidate a saved decision instead of paying for another inference. These checks demonstrate grounded decisions, not superiority over deterministic ranking or a national optimum.

## Current verification

Verified on 2026-10-11:

- TypeScript and the Next.js production build passed.
- The source-only copy passed **554 tests in 146 files** against a disposable PostgreSQL database. Five optional tests in two files were skipped because the private provider snapshots and historical model logs are not distributed; no tests failed.
- A fresh constrained Python environment passed all **50 solver tests**. Frozen dependency installation, empty-database administrator setup and a model-free four-center browser journey also passed from the source-only copy.
- Five controlled live crop comparisons passed selection/rejection validation, including independent candidate-order changes. A separate new-crop browser journey reached approval and stored reservations, labor demand and notifications.
- Six final live schedule-comparison cases passed the current decision contract.
- A four-center browser journey passed with **three real schedule decisions**: normal rescheduling, equipment replacement, and a combined wind/breakdown/labor disruption. It reached approval, reservation changes, attendance reconfirmation, both-center notices and local delivery receipts.
- The browser journey also checked infeasibility without a model call, stale/duplicate approvals, unconfirmed resources and preservation of completed/other-center work.

Earlier failures remain failures. A truncated response was rejected before the schedule output limit was raised; an invalid evidence reference stopped an earlier browser run before the numeric-evidence boundary was made explicit and retested. These are bounded synthetic evaluations, not field reliability measurements.

Real SMS and hardware commands were **not** sent. External parcel/weather inputs were controlled in browser tests. Existing operating business records were preserved; only the authorized shared AI cost ledger received live-call records. [Verification scope and results](docs/verification.md) separates clean installation, model-free checks and paid-model evidence.

## Data and execution boundaries

Public geography is separate from fictional people, ownership assumptions and resource inputs. A displayed parcel does not establish ownership, consent or eligibility. KMA weather and VWorld parcel integrations use server-side credentials; missing, stale and simulated inputs must remain distinguishable.

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

This initializes empty centers, not fictional applicants or completed work. The legacy `seed` command is not part of current onboarding. A fresh empty-database installation and a model-free four-center browser journey were verified on the dependency-patched source copy without the three private provider snapshots.

Provider snapshots are optional server-side inputs, not source dependencies. Missing snapshots disable the associated sample import or capacity-study source with an explicit response; they do not create fictional cadastral evidence. Live parcel and weather lookup require your own authorized provider keys. See [clean installation and verification](docs/clean-installation.md).

For paid decisions, set `AI_MODE=nebius`, `AI_CALL_SCOPE=decisions` and your own server-only `NEBIUS_API_KEY` in `.env.local`, then restart. Review provider prices and persistent ledger limits before enabling calls; expired price review blocks inference. [AI cost controls](docs/ai-cost-controls.md) distinguishes reservations, estimates and invoices. App limits cannot stop charges from other uses of the provider account.

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

## Judge walkthrough

1. Register an applicant and parcel; select a reviewed crop candidate or request AI crop review.
2. Confirm the cultivation and inspect work periods, resources and reservations.
3. Open a scheduled task and compare alternatives under an operator priority.
4. Apply a controlled breakdown or compound incident. Observe date preservation using a substitute, or bounded replanning when needed.
5. Inspect selected and rejected alternatives, then approve once.
6. Verify changed reservations, labor reconfirmation, both-center notices and the local farmer notification record. Retry approval to check duplicate prevention.
7. Inspect an infeasible case: the system must report missing resources or constraints rather than fabricate success.

Use a dedicated evaluation dataset. This is not a public demo URL, and an empty installation does not preload every record needed for this walkthrough.

## Release status

This source release contains the application, calculation engine, database schema, synthetic tests and installation instructions under Apache-2.0. It excludes actual API keys, operating databases, personal records, cached provider datasets, raw model logs and internal development handoffs. [Publication and data scope](docs/public-source-and-data.md) explains the boundary.

The source-only Windows checks have passed. Hosted judge access, the final public video and hackathon submission are still pending. A source repository is not a deployed service. Next steps are a separate secure evaluation environment, an English video under three minutes and final submission review. No deployment of the development PC or operating database is implied.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) govern submission. The deadline checked on 2026-10-11 is October 30 at 10:00 AM PDT, or **October 31 at 02:00 KST**; recheck before submitting.

## License

Original source is licensed under [Apache License 2.0](LICENSE), selected on 2026-10-11. Dependencies, datasets, maps and provider assets retain their own terms. This does not grant rights to personal data, credentials, trademarks or third-party material. See [publication and data scope](docs/public-source-and-data.md).

## 한국어 안내

K-Farm은 고령·소규모 농가를 지역 농업 지원센터가 함께 지원하면 어떨지 제안하는 운영 소프트웨어입니다. 실제 업무 구조를 구현하고 데모에서는 입력 자료만 가상으로 사용합니다. AI는 계산된 작물·일정 대안을 비교하며 담당자가 승인합니다.

현재 로컬 검증과 실제 모델 연결은 확인했지만 현장 운영 승인·실제 문자·장비 제어·정책 채택을 뜻하지 않습니다. [개발 배경](docs/farmland-policy-rationale-2026-10-08.md), [검증 범위](docs/verification.md), [공개 자료 범위](docs/public-source-and-data.md)를 참고하세요.
