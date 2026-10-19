# K-Farm judge guide

Open [the hosted demonstration](https://kfarm.1gaji.com). English and a restricted judge account are prefilled; click **Sign in**. No personal account, provider login or API key is needed. Korean place names are retained.

1. **Managed fields → AI planning / batch approval** shows current plans and their cultivation records. Historical AI drafts are not valid for changed inputs. New eligible intake triggers the background worker, normally within one to two minutes; refresh to read its saved result. Refreshing does not itself make a paid model call.
2. **Schedule → 2027 → May or October** contains the saved next-season rice work. The 2026 dashboard can legitimately show no tasks today. Dates are not moved to today for the demonstration.
3. Open a task's **Manage → Reschedule**, enter a reason and optionally a preferred date. For an equipment issue, choose the affected machine and repair period. Inspect the changed date/equipment, then reload to verify persistence. Changes preserve completed work and other-center commitments.
4. **Labor** distinguishes required staff, pending replies and confirmed attendance. Next-year demand is not yet confirmed attendance. **Task history** and the field's cultivation history retain saved changes.

The server uses NVIDIA Nemotron through Nebius Token Factory, under a small shared spending cap. Live inference can be unavailable if the approved budget is exhausted or the provider is unavailable. This must be shown as an error, not a fabricated AI success; the saved evidence and [public video](https://youtu.be/2abo7PjQH_I) remain available. A selected plan equal to the deterministic baseline is not an improvement claim.

Use fictional applicant details only. People, ownership assumptions and resources are synthetic; real cadastral references do not prove ownership. No real SMS, payroll, equipment command, purchase or hiring is executed. This is a policy proposal and supervised operational MVP, not field certification or a national production/price forecast.

Maintainer: preserve the business DB and canonical AI ledger across updates, use the same reviewed source image for web and background workers, and retain the previous image for rollback. Do not reset a database, rotate secrets or replenish a budget as part of a routine source update.
