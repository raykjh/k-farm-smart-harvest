# K-Farm judge guide

Updated October 21, 2026 for the current hosted interface. Open [the hosted demonstration](https://kfarm.1gaji.com). English and a restricted judge account are prefilled; click **Sign in**. No personal account, provider login or API key is needed. The language selector switches Korean/English, including equipment labels and displayed addresses.

The [176-second English video](https://youtu.be/gq45y38CqxM) records this same public application and release. Its October 20 A/B comparison is a dated evidence summary, not footage from an older local application or a new public-server execution. The submitted source is retained at `judge-submission-20261021-r1`; ordinary operational DB records may continue to change.

## Inspect the saved results

1. **Field management → Manage** opens a parcel's details, crop / production and work history. These views read saved records. Opening a field or reloading a page does not request new inference.
2. **Schedule → 2027 → May or October** contains the saved next-season work. The 2026 dashboard can legitimately show no tasks today. Dates are not moved to today for the demonstration. Open task details to inspect equipment, labor demand and retained changes.
3. **Equipment** keeps each machine's reservations and borrowing information inside its details. **Labor** distinguishes demand, pending replies and confirmed attendance. A next-year labor requirement is not a confirmed worker.
4. **National overview → 2027** shows the participating centers' crop composition, area, expected output and recorded progress. The October 21 check showed four centers, 301 cultivation records and 53.3 hectares. These are participating-network totals, not a complete national census or proof of oversupply. The map and region/season filters work on that coverage.
5. **Prices**, **Costs and economics** and **Climate information** expose the evidence used for review: dated aT price observations, RDA cost references, KMA weather and a selectable Jangsu 1991–2020 normals dataset. Coverage differs by crop. Wholesale prices are not farm receipts, and a selectable climate series has not automatically been approved for a center.

The [actual-model evidence](ai-decision-evidence.md) includes a paired October 20 case: potato with suitable equipment available; pepper when the potato equipment is unavailable. Both completed application, database storage and a new login in isolated test databases. The model selections matched the deterministic baseline. These records are documented evidence, not two additional fields claimed to exist in the public judge database.

## Try a new decision

**Apply AI plans** (Korean: **AI 계획·일괄 확정**) is an action, not a preview. Pressing it requests actual AI crop/resource planning for eligible uncommitted fields, validates the result and applies the resulting plans in the same operator-authorized workflow. It can consume inference allowance and save cultivations, tasks and reservations. Use the saved-record views above for inspection only.

For a new case, register fictional applicant and parcel inputs with complete reviewed field conditions. Missing conditions hold the intake instead of being invented. Eligible intake can also enter the background draft workflow; that path keeps its own staff confirmation. Changed inputs invalidate an old draft. The current one-command **Apply AI plans** path should not be confused with the earlier two-step filming interface.

To test an exception, open a task's **Manage → Reschedule**, enter a reason and optionally a preferred date. For an equipment issue, choose the machine and repair period. This command validates and saves the selected change; reload afterward to inspect persistence. Existing completed work and unrelated center commitments are protected. Resource shortages remain requests when equipment or confirmed labor cannot be secured.

The server uses NVIDIA Nemotron through Nebius Token Factory, under a small shared spending cap. Live inference can be unavailable if the approved budget is exhausted or the provider is unavailable. This must be shown as an error, not a fabricated AI success; the saved evidence and [public video](https://youtu.be/gq45y38CqxM) remain available. A selected plan equal to the deterministic baseline is not an improvement claim.

Use fictional applicant details only. People, ownership assumptions and resources are synthetic; real cadastral references do not prove ownership. No real SMS, payroll, equipment command, purchase or hiring is executed. This is a policy proposal and supervised operational MVP, not field certification or a national production/price forecast.

The evidence distinguishes the October 21 public-app recording, the October 18 workflow film, the October 19 hosted check and the October 20 isolated comparison. Rejected model answers remain failures; they are not counted as successful applications.

Maintainer: follow the [judge operations checklist](judge-operations.md). Preserve the business DB and canonical AI ledger across updates, use the same reviewed source image for web and background workers, and retain the previous image for rollback. Do not reset a database, rotate secrets or replenish a budget as part of a routine source update.
