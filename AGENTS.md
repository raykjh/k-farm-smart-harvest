# K-Farm submitted release

- Read `docs/submission-freeze.md` before changing this repository or its deployment.
- `judge-submission-20261028-final` and `judge/final-20261028` identify the submitted release. Do not move or overwrite these references. Retain the older October 21 tag.
- Put future development on `development/post-submission` in a separate checkout. Do not deploy development changes to the NAS judge stack unless the owner explicitly requests a new judging release.
- Preserve existing database records, reservations, approvals, accounts and the canonical AI cost ledger. A code freeze does not prevent normal judge data entry. Never reset a ledger or create a new allowance to bypass a budget limit.
- Do not change the accepted UI, video or submission wording as incidental cleanup. Follow the user's exact requested scope.
- For Next.js changes, first read the relevant documentation in `node_modules/next/dist/docs`; the installed version may differ from remembered APIs.
- Tests use only the isolated local `kfarm_test` database. Start the local solver before tests requiring it; keep model mode `demo` and provider keys unset for model-free regression checks. Optional private-fixture skips must be reported.
