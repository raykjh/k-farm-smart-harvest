# AI cost controls

Live inference is disabled by default. `AI_MODE=demo` uses model-free paths, and provider credentials are server-only. Enabling `AI_MODE=nebius` is an explicit spending decision for the installer; the source does not supply credits or a paid account.

## Request boundaries

The enabled decision path uses NVIDIA `nvidia/Nemotron-3_5-Lightning` through Nebius Token Factory. The model reviews computed crop or scheduling alternatives, not raw authority to change business records. An operator must approve a validated decision.

- `AI_CALL_SCOPE=decisions` restricts calls to explicitly requested decisions and enabled diagnostics. Ordinary page loads, calculation previews and approvals do not require a fresh inference.
- Requests accept only the reviewed model and parameter set, one non-streaming completion, a bounded JSON input and an output limit.
- Crop review permits 2,048 output tokens and schedule review 4,096. Other explanation requests permit 1,200.
- There is no automatic retry. Transport failure, truncation and invalid evidence remain visible failures.

The reviewed rates and expiry are in `lib/ai-budget.ts`. The shipped rate review expires on **2026-10-18 UTC**; live calls stop afterward until the maintainer verifies the provider price and updates that review. Do not remove the expiry merely to make a demonstration run.

## Persistent accounting

Before contacting the provider, the application atomically reserves a conservative amount in PostgreSQL. Both account-wide and decision-validation ceilings must allow the request. The source currently retains a $20 account ceiling, a $15.20 decision ceiling and a $0.01 per-request ceiling, with no daily stop. These are deployment-specific safeguards, not recommended budgets or guarantees of provider billing.

Existing totals survive restarts and key changes. An isolated acceptance database must use the same accounting ledger through `AI_BUDGET_DATABASE_URL`; resetting business fixtures must not reset spending authorization. Do not reset or subtract historical usage to obtain more calls.

Failed and uncertain calls retain reservations. Successful responses may also record provider-reported token counts and an estimated token cost. A reservation is not the amount invoiced, and an estimate is not the provider account balance. Review the console invoice separately. This application cannot limit requests made by other software using the same provider account.

## Hosting

Before enabling inference on a public evaluation server, review all limits for the approved account, configure authentication and request limits, protect the accounting database and check the provider's current availability and prices. Never distribute the API key, account recovery material or raw request/response logs. Keep real SMS and equipment execution disabled unless separately authorized and implemented.
