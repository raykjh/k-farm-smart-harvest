# Judge environment operating checklist

The public judge environment is [kfarm.1gaji.com](https://kfarm.1gaji.com). It has a separate synthetic database and a restricted, prefilled account; no provider login is required. See the [judge guide](judge-guide.md) for the short walkthrough.

## Availability commitment and budget boundary

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), checked October 19, place judging from December 1 through December 15, 2026 (ending December 16 at 05:00 KST). Keep free access available for that period. A working link today, a longer price-review expiry or a saved video does **not** prove uninterrupted future AI access.

The reviewed inference-price window currently expires **December 17, 2026 at 00:00 UTC**, after the stated judging window. The price window and spending allowance are independent. Public use can exhaust the remaining shared allowance sooner; provider outages, NAS power and network outages can also interrupt service. Approval to extend a date is not approval to add funds. No budget is replenished automatically, and no new allowance is created on redeploy.

Before judging, the owner must confirm an adequate remaining inference allowance and NAS availability. On October 19 the owner authorized an additional bounded $2 of judge inference headroom, without resetting past usage or enabling automatic funding. This is a spending limit, not a provider charge or a guarantee of uninterrupted access. If further allowance is needed, request another bounded extension; do not reset the ledger, hide the failure or advertise fallback records as new live inference.

## Preflight and recovery

1. Check public HTTPS, English-prefilled sign-in, Managed fields and **Schedule → 2027 → May/October**. Opening saved plans must not make paid calls. Inspect only whether credentials are prefilled; never copy them into logs.
2. Check web, operations, database and solver health. Web and operations must run the same reviewed image. Check that the intended production and labor loops are enabled in the operations process and inspect retained job history and canonical ledger connectivity without making a paid completion. Process health alone does not prove that a new AI job completed. SMS and physical device adapters remain disabled.
3. Before a release, take business and ledger backups and verify their archive contents. Keep private backups outside public source and web assets. A same-volume dump is not an offsite restore test.
4. Record image/source digests, schema version, non-session business-record fingerprints, outbox counts and ledger totals. On restart, verify these again. Session timestamps may legitimately change; distinguish them from farming records and inference charges.
5. Reopen the public site after restart. Old drafts must be marked stale when inputs change. An interrupted request must be recovered by its existing request ID, not blindly resubmitted. Duplicate processing must not add another charge or change.
6. On failure, retain the prior known-good image and roll back application containers only. Preserve database volumes, secrets, ledger and ordinary accounts. Never reseed the filmed or judge database to make a failing demonstration appear successful.

## Final scope

Freeze crop expansion, new national datasets, autonomous hardware, actual SMS/payroll and settlement integration for this submission. Fix only reproducible blocking bugs. The existing English film can stay unless a visible workflow or claimed result materially changes. Any pre-deadline text update must distinguish current implementation, retained historical evidence and future policy ambitions.
