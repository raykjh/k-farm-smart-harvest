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

Initialization adds empty centers; it does not add applicants, equipment, labor or completed missions. Do not use `seed` as ordinary onboarding or point initialization at an existing operating database.

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

## Empty-installation check

From a built source-only export with no actual `.env` files or private provider snapshots, run `node --import tsx scripts/verify-clean-installation.ts --run=your_unique_id`. Stop the web server first; the check needs local port 3100. PostgreSQL must remain available on port 55432.

The verifier creates a new database whose name starts with `kfarm_install_e2e_`. It refuses an existing database and never resets or drops one. It installs the schema, creates empty centers and exercises one-time administrator setup, authenticated access, logout and login through the actual HTTP routes. Generated credentials are neither printed nor saved in a report. The result contains only assertions and counts in `.data/validation/`; the disposable database is retained for inspection. No paid inference or farmer data is created.

## Public judge access

A local successful installation is not a published judge environment. Before hosting, provision a separate synthetic database, strong credentials, private recovery material, HTTPS, role-scoped judge access, request limits and the authorized shared AI budget. Do not expose this development PC or its database. Keep model results and local notification receipts distinguishable from real equipment or carrier execution.

Set the server-only `KFARM_APP_ORIGIN` to the approved canonical HTTPS origin. With this value set, mutation requests must carry that exact Origin and matching Host; localhost and other hosts are not additional trusted origins. Login cookies remain `Secure` when TLS terminates at a reverse proxy, and authentication redirects use the configured public origin. The proxy must preserve Host, enforce HTTPS, limit request sizes/rates and prevent direct public access to the backend, PostgreSQL and solver. Forwarded headers do not grant trust. A missing setting retains local-only behavior; invalid settings deny mutation requests rather than falling back to localhost.

This configuration support is not a verified public deployment. The final host, certificate, reverse-proxy behavior, access accounts and availability through judging must be checked after the owner approves the deployment destination.
