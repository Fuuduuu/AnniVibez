# CURRENT_STATE

Status: compact operational snapshot for future Majandus passes.

## Product and production

- visible product: `Majandus`
- historical product milestone: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
- canonical production: `https://annivibe.pages.dev`
- accepted canonical production: C8 controlled deployment `0c4e39e4-63b8-4e9a-8ac4-7a667bda6b80`, runtime provenance `9dac8c021be1b99bf7ec1227615cb6f3bd874674`, forward/default mode with `VITE_STORAGE_AUTHORITY_MODE` absent
- C8 production smoke: PASS — Majandus shell, Kodu, Kalender and Seaded rendered; unexpected visible storage/error state NONE

## Accepted product state

- Majandus application shell: Kodu, Kalender, Buss, Veel and Seaded.
- Household calendar, waste/household functionality and reminders are accepted.
- Existing Buss functionality is preserved, including concrete stop_id routing, nearby departures and map destination selection.
- Motion polish is accepted at `20ac51b481c1b2a7ea58ce2251f28ceb96f31046` (`style: add subtle native motion`): subtle page entrance, tactile navigation and press feedback, calendar state motion, event-dialog entrance and reduced-motion support.
- Calendar UX v2 is accepted at `062cdcbe6488282854cbb7d8fcf2309c50360dec`: visible `+ Lisa`, integrated `Täna`, month-aligned selected-day content, the legend after selected-day content, essential-first event creation and truthful advanced options.

## Protected boundaries

- Preserve current bus routing behavior and concrete stop_id identity; `depsWithMeta(...)` and `displayCodes` remain transitional where present.
- Preserve calendar recurrence and imported-event protections.
- Preserve local-only data until an accepted migration plan exists.
- Do not reopen Trends in v1 or combine unrelated feature work.

## Evidence

- Motion polish validation: `211 PASS`, `0 FAIL`; human phone review: PASS.
- Calendar UX v2 validation: `206 PASS`, `0 FAIL`; production smoke and human phone review: PASS.
- These are pass-specific validation results, not the repository-wide test total.

## Next action

- `RUNTIME_CUTOVER_C1` through `RUNTIME_CUTOVER_C8` are **ACCEPTED / CHECKPOINTED**; `MAJANDUS RUNTIME CUTOVER = COMPLETE`. C8 deliberately moved canonical production from accidental C6-containing deployment `0cca08f2-3a87-4176-99e2-7bc107bf8ce5` to `0c4e39e4-63b8-4e9a-8ac4-7a667bda6b80`, using exact C7-validated forward provenance `9dac8c021be1b99bf7ec1227615cb6f3bd874674`. C8 validation: storage `83/83`, IndexedDB `88/88`, saved places `6/6`, app shell LEGACY `32/32`, READY `48/48`, build and diff check PASS; stable PWA snapshot `3/3`, artifact count `11`, remote production byte/hash proof `11/11`, `/sw.js` JavaScript-compatible MIME and remote syntax PASS. Automatic production deploys remain disabled (`production_branch: main`, `production_deployments_enabled: false`). C7 waiver remains **WAIVED BY HUMAN FOR FINAL ACCEPTANCE GATE; NOT EXECUTED**.
- Backend foundation governance drift was discovered before Phase 4: accepted Phase 1-3/checkpoint history had advanced while the current authority documents retained a blanket backend/D1 lock. This reconciliation does not retroactively authorize those earlier commits.
- Backend Phases 1–5 are ACCEPTED: Phase 1 at `6d3496177a6c8ca1857c4081d900be69a0bbfeeb`; Phase 2 at `8a696c240bfbfb93395b85a98b55fbfeb487e328`; Phase 3 at `9a1bb5aea3a15a844a38d8651904740e953e20e7`; the Phase 4 repository-contract checkpoint at `915ed9a320e4b5395f6e007d6af2db92c5eeb95d`; Phase 4 implementation at `50faf24667e560295dab37a26a33272b1ffaee1a` (`feat: add Majandus D1 repository foundation`); and Phase 5 implementation at `4331e117fa2be759ab0661d3f85d76c8356b58cd` (`feat: add Majandus authentication foundation`). Phase 4 final audit: PASS; findings: none; Phase 1–4 regression: `37 passed`, `0 failed`, `0 skipped`. Phase 5 implementation audit: PASS; independent repair re-audit: PASS; BLOCKING `0`; MATERIAL `0`; MINOR requiring action `0`; Phase 1–5 regression: `47 passed`, `0 failed`, `0 skipped`.
- The accepted Phase 5 contract is closed and protected: `functions/_lib/auth.js` exports exactly `authenticateDevice(request, db)` and `requireAuthenticated(request, db)`; credential failures collapse uniformly; infrastructure failures propagate and never become `null` or 401; the trusted context is repository-derived; plaintext credentials never cross the repository boundary. Phase 4 remains precomputed-hash repository work only.
- `MAJANDUS_BACKEND_AUTH_FOUNDATION_P6_HOUSEHOLD_CREATION` is OPEN FOR IMPLEMENTATION only for `functions/_lib/households.js` and `scripts/backend/households.test.mjs`, exporting exactly `createHousehold({ db, input, clock })` and `publicHouseholdCreation(result)`. Its accepted boundary is ID, device-token and recovery-code generation, hashing, one timestamp, household revision `1`, persisted-record construction, one atomic repository creation operation, and the public creation result. The repository still receives only `tokenHash` and `recoveryHash`; `change_log` and `applied_mutations` are not written. Creation stays NON-IDEMPOTENT and an unknown-result create must not be auto-retried. Phase 6 must not parse `Authorization`, authenticate bearer tokens, change authentication failure semantics, or add session expiry, rotation or refresh tokens. Phase 7+ remains locked.
- Next safe action: `MAJANDUS_BACKEND_AUTH_P6_HOUSEHOLD_CREATION`. No live backend integration, remote D1, deployment, client/runtime coupling, or Phase 7+ work is authorized.
- Common Backend Architecture v1 is accepted; Cloudflare Pages Functions + D1 is selected for the v1 backend; the Phase A implementation plan is accepted.
- Task 1's native IndexedDB schema/primitives are accepted at `f2fe59c7b1704c5a1feb2266123606acaa4a1342` with real Chromium tests `5/5 PASS`, build PASS and no runtime cutover.
- Task 2's local-replica contracts and exported record validators are accepted at `5d7546fbf96fff77b738b48ca0b1e5f5936cfc48` with Chromium storage tests `6/6 PASS`, build PASS and no runtime cutover.
- Task 3's legacy validation, transformation and digest are accepted at `7ace02444fc3783898a14251c62ebe032113e0ea` with storage tests `45/45 PASS`, IndexedDB regressions `6/6 PASS`, build PASS and no runtime migration.
- Task 4's dormant migration state machine is accepted at `e651a6edb2f19bf850e5e67ceac462551f2fd37a` with storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, build PASS and final adversarial audit PASS; no runtime migration has occurred, legacy storage remains non-destructive and migration generates zero outbox mutations.
- Task 5's integration breadth is accepted at `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` with storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, build PASS, diff check PASS and no production file changes; migration remains dormant and no live runtime migration has occurred.
- Task 6's dormant guard and fail-fast regression is accepted at `abdd002240e78ed093facdb3ef463d4ba6ede418`: source guard PASS, bundle guard PASS, fail-fast sweep PASS and runtime diff NONE.
- Phase A implementation is complete and the Phase A final human review is ACCEPTED (range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`; review package at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`).
- The runtime cutover plan remains HUMAN ACCEPTED and C1-C8 are ACCEPTED / CHECKPOINTED. C8 is the accepted production runtime; the earlier accidental C6 deployment remains historical incident evidence and was not rolled back to pre-C6. Only Phase 6's exact local household-creation scope is open; Phase 7+, sync, outbox UI, legacy cleanup/deletion, and automatic-production-deployment policy remain separate future scopes.
