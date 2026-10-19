# What the AI actually decided

These are retained **actual NVIDIA Nemotron / Nebius Token Factory calls**, not scripted model responses. They use fictional applicants, resources and reviewed-condition assumptions. Both cases below belong to one isolated, persisted browser journey on October 18, 2026. They do not establish field productivity or national price forecasts.

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
