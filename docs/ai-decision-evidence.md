# What the AI actually decided

These are retained **actual NVIDIA Nemotron / Nebius Token Factory calls**, not scripted model responses. They use fictional applicants, resources and reviewed-condition assumptions. Each case names its date and execution environment. They establish bounded software behavior, not field productivity, a national production target or farm profitability.

## Latest paired crop decision — October 20, 2026

The same 1,000 m² test field and reviewed-condition assumptions were evaluated in two isolated databases. Equipment availability was the intended changed input. The model called the calculation tool to assess alternatives before selecting a plan.

| Input condition | Actual model selection | Calculated comparison | Saved result |
|---|---|---|---|
| A: potato equipment available | Potato | Potato: 5 essential tasks, 10.75 person-hours. Pepper alternative: 7 tasks, 24.75 person-hours. | 1 cultivation, 5 tasks, 3 equipment reservations |
| B: potato equipment unavailable | Pepper | Pepper: 7 essential tasks, 24.75 person-hours. Potato alternative: all 5 essential tasks unplaced. | 1 cultivation, 7 tasks, 1 equipment reservation |

Both selected plans **matched the deterministic baseline**. The useful result is that changed operational feasibility changed the crop selection through actual tool-assisted inference and persisted business effects. It is not evidence that AI beat the baseline. The zero person-hours attached to the infeasible potato alternative is not a cheap feasible plan: its essential work could not be placed.

The operator used **Apply AI plans**; the application calculated, validated and committed the result. Database inspection and a new browser login verified the saved crops and tasks. Replaying the same request added neither records nor inference. Each case preserved 66 pre-existing protected records and the other three centers; the expected field and continuous-production projections changed. Four unassigned labor entries in A and three in B remained unresolved demand, not confirmed staffing.

**Execution boundary:** the application, solver, UI and business databases ran locally in isolation. A private test transport sent the inference requests through the existing NAS connection and canonical cost ledger to the actual model. This was not a fresh end-to-end test of the current public NAS application. The public source excludes that private transport, raw prompts, credentials, contacts and database dumps.

An initial B attempt made three completions but returned unsupported extra selection keys and was rejected before application. After clarifying allowed response keys and the validation error, a new three-completion attempt passed without relaxing the contract. A used three completions: **nine in total including the failed attempt**, with a token-derived estimate of $0.003045 and conservative reservations of $0.309669. Neither amount is a provider invoice.

**Economic boundary:** the potato case had a partial dated wholesale-price / RDA cost reference; pepper's matching economics were unknown. Farm-gate receipts, distribution deductions, actual labor/equipment rates and other cost components were incomplete. No profit ranking or economic superiority is claimed. Supply coverage was unassessed, so zero flagged supply-risk fields does not mean verified national balance.

## Earlier connected journey — October 18, 2026

The following two decisions belong to one isolated, persisted browser journey and remain separate historical evidence.

## 1. New application: choose crops and resource demand together

Staff registered two fields through the ordinary UI. The model proposed crop/resource compositions, used `evaluate_plan` to obtain scheduling results, and returned `select_plan` with references to server-calculated metrics. The application, not free-form model prose, supplied the numerical values.

| Checked output | Selected rice + potato | Evaluated rice + pepper |
|---|---:|---:|
| Essential tasks | 11 | 13 |
| Person-hours | 49.75 | 63.75 |

The selected plan covered both fields with **zero unplaced essential tasks**. The alternative comparison explains why this is more than a crop-name text response, but **the rule baseline selected the same plan with the same measured results**. No incremental optimization benefit was demonstrated. Market conditions were unassessed for both fields; a zero flagged supply-risk count must not be interpreted as verified national supply balance.

The operator staged and approved the actual-model draft in the UI. The database retained two cultivations, **13 scheduled tasks** (including observation work beyond the 11 essential tasks), seven shared equipment reservations and 13 labor-demand records. Planned demand is not confirmed attendance or paid employment.

## 2. Incident on that application: equipment failure plus worker absence

A repair interval and worker absence affected the registered rice harvest. The common scheduling engine compared local vacancies, local rearrangement and authorized adjacent-center resources. Local alternatives were infeasible under this scenario; the adjacent alternative had a recorded compatible machine and confirmed worker support.

The model selected that alternative and correctly rejected both local alternatives as infeasible. The harvest stayed on **October 1, 2027**; its machine changed from the Gyebuk resource to the Janggye resource, and its start moved from **08:00 to 08:30** for travel. Equipment and support labor each occupied **270 minutes**. One task changed; unrelated tasks and other-center plans were preserved.

The ordinary rescheduling command saved the change, reservation and repair records. Attendance was reconfirmed and notices for both centers were stored. No SMS carrier, machine, purchase or payroll was invoked. This was the **only feasible alternative and also the rule baseline's selection**: it demonstrates grounded incident handling, not that a language model outperformed the solver.

## Audit, usage and limits

- Four actual completions: three for the crop/resource review and one for the incident. Token-derived estimate **$0.001409**; conservative reservation **$0.022103**. Neither is a provider invoice.
- Approval was bound to the saved model draft and server metric references. Duplicate approval/replay did not duplicate effects. Existing operating records had identical before/after fingerprints; the isolated test database retained the new records.
- A preceding invalid-model attempt was rejected before approval. The successful case is not evidence of error-free model output, and the rejected attempt is not silently counted as success.
- External parcel lookup and agronomic/resource/border inputs were controlled. Business APIs, solver, model calls, UI approval and database storage were real.
- Reproduction entry points: `e2e/submission-journey-live-db.spec.ts`, `tests/submission-journey-fixture.ts`, and `e2e/submission-saved-review.spec.ts`. Paid runs require explicit opt-in and the existing shared ledger. Private raw prompts, contacts, screenshots and database dumps are intentionally not published.

## Separate hosted check — October 19

The [NAS demonstration](https://kfarm.1gaji.com) also completed a new one-field intake after incomplete synthetic review inputs were corrected through the UI. The automatic worker made a real-model crop/resource draft; screen approval stored six tasks, three equipment reservations and six labor-demand records. A subsequent real-model reschedule moved one task from May 20 to May 21, 2027 and survived refresh. Existing missions and other-center records were preserved.

That hosted run used three completions, **5,166 input / 1,683 output tokens**, an estimated **$0.000716** and **$0.015722** of conservative reservation. It again matched the baseline. Labor was appropriately unconfirmed outside the D-7 recruitment window; notice entries were recorded-only. This hosted check is separate from the isolated two-field compound-incident case and from the [300-parcel film](https://youtu.be/2abo7PjQH_I).
