# Judge environment operating checklist

The public judge environment is [kfarm.1gaji.com](https://kfarm.1gaji.com). It has a separate synthetic database and a restricted, prefilled account; no provider login is required. See the [judge guide](judge-guide.md) for the short walkthrough.

## Availability commitment and budget boundary

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), rechecked October 28, place judging from December 1 through December 15, 2026 (ending December 16 at 05:00 KST). Keep free access available for that period. A working link today, a longer price-review expiry or a saved video does **not** prove uninterrupted future AI access.

The reviewed inference-price window currently expires **December 17, 2026 at 00:00 UTC**, after the stated judging window. The price window and spending allowance are independent. Public use can exhaust the remaining shared allowance sooner; provider outages, NAS power and network outages can also interrupt service. Approval to extend a date is not approval to add funds. No budget is replenished automatically, and no new allowance is created on redeploy.

Before judging, the owner must confirm an adequate remaining inference allowance and NAS availability. The current authorized shared reservation ceiling is $10, with $9.618166 reserved and $0.381834 remaining at the October 28 read-only check. This is a conservative application reservation, not a provider invoice or a guarantee of uninterrupted access. Earlier approvals are historical and do not add to the latest ceiling. If further allowance is needed, request another bounded extension; do not reset the ledger, hide the failure or advertise fallback records as new live inference.

## Preflight and recovery

1. Check public HTTPS, English-prefilled sign-in, saved field details, **Schedule → 2027 → May/October** and **National overview → 2027**. Opening saved records must not make paid calls. **Apply AI plans** is a separate write action that calculates and commits; do not press it for a read-only health check. Inspect only whether credentials are prefilled; never copy them into logs.
2. Check web, operations, database and solver health. Web and operations must run the same reviewed image. Check that the intended production and labor loops are enabled in the operations process and inspect retained job history and canonical ledger connectivity without making a paid completion. Process health alone does not prove that a new AI job completed. SMS and physical device adapters remain disabled.
3. Before a release, take business and ledger backups and verify their archive contents. Keep private backups outside public source and web assets. A same-volume dump is not an offsite restore test.
4. Record image/source digests, schema version, non-session business-record fingerprints, outbox counts and ledger totals. On restart, verify these again. Session timestamps may legitimately change; distinguish them from farming records and inference charges.
5. Reopen the public site after restart. Old drafts must be marked stale when inputs change. An interrupted request must be recovered by its existing request ID, not blindly resubmitted. Duplicate processing must not add another charge or change.
6. On failure, retain the prior known-good image and roll back application containers only. Preserve database volumes, secrets, ledger and ordinary accounts. Never reseed the filmed or judge database to make a failing demonstration appear successful.

## October 27 application release

- Application source: 1bc233baa9c6b28c2ac18a28fcc09bed72657e4f.
- New web/operations image: kfarm-judge-web:20261027-ai-r1.
- Activation status: **DEPLOYED AND CHECKED on October 27, 2026**. Only the two web/operations image references changed in the existing stack; re-pull and prune were disabled. Both processes run image ID `sha256:3193daa2865ee4ebd5d6abafa455a3a256f4766fe5bdb9e2ea17266100fca51d`. Database and solver containers were retained.
- Existing PostgreSQL schema, business volumes, accounts and canonical ledger are retained. No 50,000-record dataset is imported into the public app. Preserve the previous image and the October 21 release tag for rollback.
- Before activation, custom-format business and ledger dumps were written to private persistent NAS storage, hashed and inspected with `pg_restore --list`. Both dumps were subsequently restored to separate inspection databases for comparisons. These are same-volume restore checks, not offsite disaster recovery.
- Both running processes matched all **909 tracked runtime-source files** in the release manifest, accepting only CRLF/LF packaging differences. The Git-content aggregate is `02c4f2df8e5c7651bc7b2cf271811906f18789cb5695e608b748297f236c6d5c`; the deployed raw-byte aggregate is `c5507577888620809f1fe19a244095bdd270e431ba9ca84f2aa91b238eb4f667`. Windows archive conversion changed only line endings in 908 files. For each file the check first compared the exact hash, then the CRLF-to-LF hash against the Git manifest. The archive was built from source/document commit `e8d4e7a579e5601009ae214a09cae73c16bb5ff3`; later release-record edits do not change runtime source.
- Preservation comparison: four center states, 377 outbox records, one receipt and 575 audit records matched. Among 6,522 non-auth work records, four `continuousProduction/current` cache records refreshed their version/time and payload `fingerprint`, `calculatedAt` and `sourceFingerprint`; their other content matched. No work records were added or removed, and no other non-auth work record changed. Both budget records and all 908 canonical ledger call records matched the restored backup exactly. No paid call was made for this deployment check.
- Public HTTPS sign-in, saved spring-potato details and May/October 2027 schedules passed read-only browser checks. National overview showed four participating centers, 308 approved cycles and 54.7 ha for 2027. These are existing shared-data totals, not the separate 50,000-record load test or new approvals from deployment. Web and operations retained their intended AI/worker settings; SMS remained disabled. This check does not claim a new hosted model-to-approval journey.
- At activation, the October 21 video and Devpost story were retained pending owner review. The replacement October 28 video and reviewed wording have since been published; see the [final freeze record](submission-freeze.md). Historical videos remain dated evidence, not the current submission.
- Remaining cumulative development headroom at preflight: $0.381834. No allowance is created by this release. Keep saved-record checks separate from paid planning; adequate judge-period headroom still needs an explicit owner decision.

## Historical October 21 release and submission freeze

The retained October 21 application baseline is public commit `5fa3e3415ba6e199bd5855744b8d0180b10ce34f` and image `kfarm-judge-web:20261021-r1` for both web and operations. Later documentation commits do not imply a different runtime. Retain the preceding image and private restore evidence.

The revised video and story were saved to Devpost on October 21; the entry remained **SUBMITTED, 5/5 steps done**, and the public page embedded the new video. Development and public source matched before filming; runtime code matched the deployment manifest. All new application footage was captured at `https://kfarm.1gaji.com`. The older isolated review apps were excluded and stopped after their protected records were verified unchanged.

The final submission source is retained at [judge-submission-20261021-r1](https://github.com/raykjh/k-farm-smart-harvest/tree/judge-submission-20261021-r1). The tag remains an immutable historical baseline. The owner explicitly authorized the October 27 application release above; the old tag must not be moved. Published media and Devpost wording remain subject to their separate review boundary. Normal operational database records, sessions and the canonical cost ledger remain live; the freeze is not a database rollback or a new inference allowance.

| Release evidence | Fixed value |
|---|---|
| Runtime application commit | `5fa3e3415ba6e199bd5855744b8d0180b10ce34f` |
| Web and operations image | `kfarm-judge-web:20261021-r1` |
| Local Docker image ID | `sha256:d31090cd0a21afe3cfa7f68385af42bd7a5c6ffaa5e5900bf07193511a66d118` |
| Deployed 917-file source manifest | `67ff2a0c45007dc976315c39d321b72132e15f5b234324e64a512fcabc5155ba` |
| Earlier October 21 video | [176-second public recording](https://youtu.be/gq45y38CqxM) |
| MP4 SHA-256 | `b619f4b456a30e57b05b94343378cb5ced434e962f0e30d4d823bb9e93b515ed` |
| Filmed data snapshot | 2027: 4 centers, 301 cultivations, 53.3 ha; retained release snapshot: 301 fields / 1,791 planned tasks |

Reference data and test scopes retain their dates in [verification](verification.md). The original October 18 film and October 20 raw verification records remain historical evidence. Price/cost/climate references and the participating-center national view are implemented; nationwide optimization, autonomous hardware, actual SMS/payroll and settlement remain future work. No application redeployment or operating-data restore was required for this media/document revision.
