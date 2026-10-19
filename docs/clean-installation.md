# Clean installation and verification

This procedure runs K-Farm from source without operating records, private API keys or cached provider datasets. The application uses the ordinary registration, planning, approval and notification paths. Synthetic inputs are limited to isolated acceptance tests.

## Runtime and dependencies

The local verification uses Windows, Node.js 24, pnpm 11.25.0, Python 3.12 and PostgreSQL. `pnpm-lock.yaml` locks JavaScript dependencies; `solver/requirements.txt` and `solver/constraints.txt` pin the tested Python environment. Linux containers and a hosted judge environment require separate runtime checks.

1. Install JavaScript dependencies with `pnpm install --frozen-lockfile`. Do not disable package integrity or supply-chain checks.
2. Create `.env` from `.env.example`. Leave all provider keys blank and retain `AI_MODE=demo`.
3. Start PostgreSQL and the HTTP solver with `docker compose up -d --build`, or use the local services below. Do not run two PostgreSQL instances against the same data directory.
4. Run `pnpm exec prisma generate` and `pnpm db:push` against a **new** local database.
5. Run `node --env-file=.env --import tsx scripts/initialize-centers.ts --apply` to create four empty centers.
6. Run `node --env-file=.env --import tsx scripts/auth-bootstrap.ts` once. Use its private, expiring setup link to create the first administrator. Do not include that link in screenshots, recordings or shared logs.
7. Run `pnpm dev` and open `http://127.0.0.1:3100`.

Initialization adds empty centers; it does not add applicants, equipment, labor or completed missions. The old `seed`, `ground-demo` and snapshot installer commands now stop without loading the database. Cached prototype mutation requests are also rejected; historical reads and ordinary local notification processing remain available. Enter fictional inputs through the same registration, planning and explicit work-result paths as other applications. Do not point initialization at an existing operating database.

## Local services without Docker

For a new local installation, `pnpm db:start` runs embedded PostgreSQL on loopback port 55432 and stores its persistent files in `.data/postgres`. Keep this process running separately. Never delete that directory to fix an installation problem.

Create the solver environment on Windows:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r solver/requirements.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m uvicorn solver.main:app --host 127.0.0.1 --port 8100
```

On macOS/Linux, create the environment with `python3.12 -m venv .venv` and use `.venv/bin/python` in the remaining commands. Keep the solver process separate from the web process. Check `http://127.0.0.1:8100/health` for the expected scheduling contract versions before testing.

### Updating dependencies on Windows

Stop the web server, workers and tests before updating dependencies or regenerating Prisma. If using embedded PostgreSQL, stop it normally as well: its executable lives inside `node_modules`, and an installation that replaces that directory can lock files or prevent new database connections. Wait for a clean database shutdown. Do not remove its lock files or force-delete the data directory.

After installation and Prisma generation, restart the database and solver, verify their health, then run tests and builds **sequentially**. An open TCP port alone does not prove a usable database connection. Compare protected business-record fingerprints before and after maintenance when using an existing development installation.

## Optional provider data

The root `Dockerfile` builds the web/worker image from the public source with pinned JavaScript dependencies (`docker build -t kfarm-web .`). Its explicit source-copy list and `.dockerignore` exclude private data and credentials. It does not initialize a DB, start a solver, enable paid inference or bundle the hosted judge dataset. Provide PostgreSQL/solver addresses and approved runtime configuration separately; never bake provider keys into an image. The NAS maintenance overlay preserves the existing runtime data while deploying these same reviewed source files. Windows build tests and Linux container build tests are separate evidence.

Weather and parcel lookup use server-side KMA and VWorld credentials supplied by the installer. Each dataset keeps its own terms; the source license does not relicense provider data.

Three cached inputs are intentionally outside the source package:

| Optional input | Separately obtained filename in `KFARM_PROVIDER_DATA_DIR` |
|---|---|
| Registered parcel sample | `registered-demo-parcels.json` |
| Four-center cadastral sample | `four-center-cadastre.json` |
| Capacity study input | `four-center-study.json` |

The default directory is `.data/provider-samples`. Existing private legacy paths remain compatible. Missing inputs produce an explicit unavailable response for the corresponding sample operation; corrupt inputs fail validation. Neither case creates a guessed parcel or changes existing operating records.

Synthetic parser, capacity and planning fixtures are included in `tests/`. They are not asserted to be observed boundaries, actual owners, official crop calendars or current equipment inventories. Three optional tests that inspect the private provider files and two replay tests that inspect private historical model logs are skipped when those inputs are absent. Synthetic parser, decision-contract and business-path tests still run.

## Test order

Create `.venv` and install the Python requirements even if the HTTP solver runs in Docker. TypeScript tests invoke the local checked-out solver directly in addition to testing the service contract.

With PostgreSQL and the HTTP solver available:

```text
pnpm exec tsx scripts/setup-tests.ts
pnpm exec next typegen
pnpm typecheck
pnpm test
pnpm build
```

The suite uses `kfarm_test`. Run only one suite against that disposable database at a time. Python unit tests run with `.venv\Scripts\python.exe -m pytest solver -q` on Windows or `.venv/bin/python -m pytest solver -q` on macOS/Linux. Do not replace failed or skipped tests with a broader success claim.

## Four-center acceptance

Follow the model-free browser commands in the root README. They prepare only guarded `kfarm_centers_e2e` and use a separately started acceptance web server. Applicants, resources and constraints are synthetic; registration, plan calculation, approval and storage responses are real application responses.

The journey covers four sequential intakes, normal schedule changes, an equipment replacement and a combined wind/failure/labor-absence case. It checks reservations, attendance reconfirmation, both-center notices, local notification receipts, completed-record preservation, stale approval and infeasibility. It does not send a real SMS, operate machinery or prove actual borrowing agreements.

Paid acceptance is a separate explicit opt-in. It must reuse the existing shared spending ledger, never a fresh allowance created by resetting a test database. A model-free acceptance result is not evidence of a live model decision.

### Current integrated intake and incident acceptance

`e2e/submission-journey-live-db.spec.ts` exercises the current joint crop/resource
panel and ordinary schedule-change dialog. It enters two fields through the UI,
stages and confirms the plan, then applies equipment repair plus worker absence
to that same registered cultivation. It checks stored reservations, reconfirmed
adjacent labor and pending notices. Only external parcel lookup is controlled;
business responses and the scheduling service are not replaced.

Use a dedicated disposable four-center database. This fixture **resets its test
database**; do not select one holding a recovery copy or evidence you need to keep.
The operating database is read only for its preservation fingerprint, while the
original AI ledger is reused for paid calls. Stop the ordinary web server first
because this browser test uses loopback port 3100, then start the latest build
against the disposable DB. Set the following in both the web and test processes:

```powershell
$env:DATABASE_URL='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm_centers_e2e'
$env:AI_BUDGET_DATABASE_URL='postgresql://kfarm:kfarm_local_demo@127.0.0.1:55432/kfarm'
$env:AI_MODE='demo'
$env:KFARM_SMS_WORKER='0'
$env:KFARM_PRODUCTION_WORKER='0'
$env:KFARM_LABOR_WORKER='0'
```

In the test process, set `KFARM_SUBMISSION_E2E=1`, `KFARM_LIVE_AI_E2E=0`, then run
`pnpm exec playwright test e2e/submission-journey-live-db.spec.ts --retries=0`.
Keep the checked-out solver running. Do not run other mutating tests against the
same database concurrently. Test sessions are created only in the disposable DB.

Only after approving paid verification, switch the test web server to
`AI_MODE=nebius` and `AI_CALL_SCOPE=decisions` with its server-side API credential.
The test process additionally needs `KFARM_LIVE_AI_E2E=1` and a fresh
`KFARM_LIVE_RUN_ID` containing lowercase letters, digits and hyphens. Never delete
the run marker to repeat a paid test, reset the original budget, or enable test
runner retries. The journey permits at most four joint-plan completions and one
incident-decision completion. Real SMS and equipment commands remain off.

After a successful live run, `KFARM_SUBMISSION_SAVED_REVIEW=1` enables
`e2e/submission-saved-review.spec.ts`. It renders the retained actual result in
Korean and English without a new inference or resetting data. It is a presentation
test, not another real-model decision. Restore the ordinary web server to its
original database after testing. Local evidence is under `.data/verification/`
and must not be included in public source.

The current field workflow is **Fields → Managed fields → Manage →
Crop / production**. Multi-field review and confirmation use **AI planning /
batch approval** in the managed-field list. Old production URLs remain aliases.
`KFARM_FIELD_PRODUCTION_SAVED_REVIEW=1` enables
`e2e/field-production-saved-review.spec.ts` against the retained isolated database.
It verifies owner, production and work-history reads with no business writes,
reseed or inference; the same original AI ledger may be provided for call-count
comparison. Do not point authentication fixtures at the operating database.

## Empty-installation check

### Keep separate four-center verification runs isolated

The default four-center name is retained for compatibility. If it contains a prior replay or recovery check, do not reset it. Choose a new run-specific name instead:

```powershell
$env:KFARM_FOUR_CENTER_DATABASE='kfarm_centers_e2e_review01'
pnpm exec tsx scripts/setup-centers-e2e.ts --fresh
```

The suffix may contain 1–30 lowercase letters, digits or underscores. Only the fixed local PostgreSQL host/port and `kfarm_centers_e2e` name family are accepted; a whole connection URL or an operating database name is rejected. `--fresh` refuses an existing database before changing its schema. It does not rename, drop or reset a previous run. Keep this environment variable and the test process's `DATABASE_URL` pointed at the same chosen database.

For HTTPS testing while leaving the ordinary app online, start the checked-out solver on port 8101 and run the TLS helper with `--backend-port=3101 --db=kfarm_centers_e2e_review01 --run=review01`. Supply OpenSSL as described below. In the test terminal set `KFARM_E2E_BACKEND_PORT=3101`, `KFARM_E2E_ORIGIN=https://127.0.0.1:3443`, `KFARM_CENTERS_E2E=1`, `KFARM_COMPARISON_E2E=1`, `AI_MODE=demo`, `KFARM_LIVE_AI_E2E=0`, `SOLVER_URL=http://127.0.0.1:8101` and the matching `DATABASE_URL`. Then run the local HTTPS auth and model-free operations browser files. The auth test probes the chosen test backend, not a different working app on port 3100. A run-specific database does not enable paid inference or bypass the existing shared cost-ledger requirement.

### Fresh account setup

From a built source-only export with no actual `.env` files or private provider snapshots, run `node --import tsx scripts/verify-clean-installation.ts --run=your_unique_id`. Stop the web server first; the check needs local port 3100. PostgreSQL must remain available on port 55432.

The verifier creates a new database whose name starts with `kfarm_install_e2e_`. It refuses an existing database and never resets or drops one. It installs the schema, creates empty centers and exercises one-time administrator setup, authenticated access, logout and login through the actual HTTP routes. Generated credentials are neither printed nor saved in a report. The result contains only assertions and counts in `.data/validation/`; the disposable database is retained for inspection. No paid inference or farmer data is created.

## Public judge access

A local successful installation is not a published judge environment. Before hosting, provision a separate synthetic database, strong credentials, private recovery material, HTTPS, role-scoped judge access, request limits and the authorized shared AI budget. Do not expose this development PC or its database. Keep model results and local notification receipts distinguishable from real equipment or carrier execution.

Set the server-only `KFARM_APP_ORIGIN` to the approved canonical HTTPS origin. With this value set, mutation requests must carry that exact Origin and matching Host; localhost and other hosts are not additional trusted origins. Reads and page navigation may omit Origin but must still use the matching Host, and a supplied Origin must match. Login cookies remain `Secure` when TLS terminates at a reverse proxy, and authentication redirects use the configured public origin. The proxy must preserve Host, enforce HTTPS, limit request sizes/rates and prevent direct public access to the backend, PostgreSQL and solver. Forwarded headers do not grant trust. A missing setting retains local-only behavior; invalid settings deny requests rather than falling back to localhost.

The 2026-10-11 working-copy update consolidated legacy per-endpoint loopback checks into the shared authenticated origin guard. A local TLS reverse-proxy check passed actual browser login, Secure/HttpOnly session cookies, forged-origin rejection, logout and the model-free four-center business journey. This is not a verified public deployment: the final host, trusted certificate, reverse-proxy configuration, access accounts and availability through judging must still be checked after the owner approves the deployment destination.

### Repeat the local HTTPS check

First prepare the guarded `kfarm_centers_e2e` database and build the application. Stop other web servers on port 3100. Run `node --import tsx scripts/acceptance-https.ts --run=your-unique-run` in a separate terminal; supply `--openssl=<absolute executable path>` if OpenSSL is not on PATH. The runner binds only loopback ports 3100 and 3443, disables provider calls and workers, and writes a one-day test certificate under the excluded `.data/https-acceptance/` directory. It does not edit `.env`, reset a database, install a trusted certificate or publish the app.

Use the four-center acceptance environment above, also setting `KFARM_LIVE_AI_E2E=0` and `KFARM_E2E_ORIGIN=https://127.0.0.1:3443`. Then run:

```text
pnpm exec playwright test e2e/local-https-auth.spec.ts e2e/model-free-operations.spec.ts --retries=0
```

The browser's self-signed-certificate exception is limited to this local test context. Never reuse the test certificate for deployment. Stop the acceptance proxy and its child web process before restarting the ordinary local server.

### Check the scheduling and attendance screens without stopping the working app

With the guarded `kfarm_test` schema ready, start the current solver on loopback port 8101. The TLS runner points only to this test solver. Run `node --import tsx scripts/acceptance-https.ts --run=your-unique-run --backend-port=3101 --db=kfarm_test`; the ordinary server on port 3100 can stay online. Only `kfarm_test` and the restricted `kfarm_centers_e2e` name family are accepted by the runner; it does not reset any database. Supply the OpenSSL path as above if needed.

Set `DATABASE_URL` to the disposable `kfarm_test` connection, `AI_MODE=demo`, an empty `NEBIUS_API_KEY`, and `SOLVER_URL=http://127.0.0.1:8101` in the test process, then run `pnpm exec playwright test --config playwright.operations.config.ts --retries=0`. Do not run other database-mutating suites concurrently. The fixtures preserve their starting test records and authenticate only against the test database.

This suite covers date and repair-period changes, supported manual fallback, lost-response recovery, the simplified labor form, and D-7/D-2 attendance. The attendance test advances only the scheduled worker's explicit test clock, not the browser/server clock or work-completion state. Test results and screenshots are local evidence, not the owner's screen acceptance or a live model evaluation. Stop only the identified test proxy/backend/solver processes afterward; leave the operating server and database intact.
