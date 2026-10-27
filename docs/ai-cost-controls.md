# AI cost controls

Live inference is disabled by default. `AI_MODE=demo` uses model-free paths, and provider credentials are server-only. Enabling `AI_MODE=nebius` is an explicit spending decision for the installer; the source does not supply credits or a paid account.

## Request boundaries

The enabled decision path uses NVIDIA `nvidia/Nemotron-3_5-Lightning` through Nebius Token Factory. The model reviews computed crop or scheduling alternatives, not raw authority to change business records. Crop decisions need operator confirmation. For automatic rescheduling, the operator's command authorizes the bounded change; the server validates the model response and revalidates the plan before an atomic commit.

- `AI_CALL_SCOPE=decisions` restricts calls to operator-requested decisions, explicitly enabled automatic production review, and enabled diagnostics. Ordinary page loads, calculation previews and approvals do not require a fresh inference.
- `KFARM_PRODUCTION_AI=1` with `AI_MODE=nebius` enables automatic crop/resource drafts for new eligible registrations. The running Node server checks each center every minute. A persistent, center-scoped input claim prevents repeated calls for unchanged inputs, including after a restart. A joint review has at most four model calls, including at most one semantic correction within that same limit. A failed or interrupted claim is not automatically retried; the error remains for review. The job does not approve a plan or fabricate worker attendance.
- Requests accept only the reviewed model and parameter set, one non-streaming completion, a bounded JSON input and an output limit.
- The planning request profile has a 131,072-token output ceiling; joint crop review requests 32,768. Diagnostic and ordinary explanation profiles have smaller caps. A 16,000-byte input check and the $0.50 per-call conservative reservation cap still apply. A large token ceiling is not an instruction to spend the whole allowance.
- There is no automatic transport retry. Joint selection permits one bounded semantic correction when validation rejects a response; the rejected selection remains recorded. Exhausted correction, transport failure and truncation remain failures.
- One automatic rescheduling request makes at most one decision call. Event injection only calculates preliminary impact; the rescheduling command performs the decision. Stored receipts allow completed requests to be replayed without a second call or duplicate application.
- **Check result** never repeats inference. While the server-owned five-minute execution lease is active, it reports processing. After expiry, it either resumes approval of the existing, revalidated proposal or releases the abandoned request without changing the schedule. Starting a new calculation requires a separate operator action; stale proposals are not silently recomputed.

The reviewed rates and expiry are in `lib/ai-budget.ts`. Rates were rechecked on the [official model page](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference) on **2026-10-19**: **$0.06 per million input tokens / $0.24 per million output tokens** for Nemotron 3.5 Lightning. This bounded review expires on **2026-12-17 00:00 UTC**, after the published judging window. Live calls stop afterward until a new price review. This is not a provider price or uptime guarantee; do not remove the expiry or bypass reservations to keep a demonstration running.

The public judge deployment also enforces its smaller, explicitly approved cumulative ceiling using `KFARM_AI_RESERVATION_CEILING_MICRO_USD`. Extending the price-review window does **not** replenish that allowance. Exhaustion blocks inference before the network call; saved decisions and records remain readable. Provider balance and the $15 historical approval are not a new allowance.

## October 27 ledger snapshot

The authorized NAS deployment ceiling is $10. The read-only release preflight observed primary reservations of **$9.618166**, leaving **$0.381834** under the development stop. The decision-slice total was $8.618166; its larger apparent headroom does not override the primary limit. Release checks do not reset either ledger or authorize more spending. These values are a dated snapshot, not live provider billing.

## Persistent accounting

Before contacting the provider, the application atomically reserves a conservative amount in PostgreSQL. Both account-wide and decision-validation ceilings must allow the request. The source retains the historical $20 lifetime ceiling and $15.20 decision slice, but defaults to a stricter **$10 cumulative development stop**, with a **$0.50 per-request reservation cap** and no daily stop. A deployment ceiling can only further restrict the decision slice. Selecting a judging phase is an explicit operator configuration decision, not an automatic budget extension. These are deployment-specific safeguards, not recommended budgets or guarantees of provider billing.

Existing totals survive restarts and key changes. An isolated acceptance database must use the same accounting ledger through `AI_BUDGET_DATABASE_URL`; resetting business fixtures must not reset spending authorization. Do not reset or subtract historical usage to obtain more calls.

Failed and uncertain calls retain reservations. Successful responses may also record provider-reported token counts and an estimated token cost. A reservation is not the amount invoiced, and an estimate is not the provider account balance. Review the console invoice separately. This application cannot limit requests made by other software using the same provider account.

## Hosting

Before enabling inference on a public evaluation server, review all limits for the approved account, configure authentication and request limits, protect the accounting database and check the provider's current availability and prices. Never distribute the API key, account recovery material or raw request/response logs. Keep real SMS and equipment execution disabled unless separately authorized and implemented.
