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
- Backend Phases 1–6 are ACCEPTED. Phase 6 is `63981e14903cac077471b6e6911664d73cd94448` (`feat: add Majandus household creation foundation`): independent final audit PASS; BLOCKING `0`; MATERIAL `0`; Phase 1–6 regression `54 passed`, `0 failed`, `0 skipped`. Its non-blocking clock-test MINOR does not reopen the accepted implementation.
- The accepted Phase 5 contract is closed and protected: `functions/_lib/auth.js` exports exactly `authenticateDevice(request, db)` and `requireAuthenticated(request, db)`; credential failures collapse uniformly; infrastructure failures propagate and never become `null` or 401; the trusted context is repository-derived; plaintext credentials never cross the repository boundary. Phase 4 remains precomputed-hash repository work only.
- Accepted Phase 6 files are protected: `functions/_lib/households.js` and `scripts/backend/households.test.mjs`. Their self-validating, non-idempotent hash-only creation contract remains closed; invalid input returns `INVALID_REQUEST`, repository errors propagate unchanged, and no conflict/retry semantics exist.
- `MAJANDUS_BACKEND_AUTH_FOUNDATION_P7_CREATE_HOUSEHOLD_ENDPOINT` is OPEN FOR IMPLEMENTATION only for `functions/api/auth/create-household.js` and `scripts/backend/create-household-api.test.mjs`. It implements `/api/auth/create-household` POST through `onRequestPost({ request, env })`, generic 405/`Allow: POST` Pages routing for all other methods, capped JSON transport, `env.DB`/Phase 6 service orchestration, public 201 projection, and safe 400/500 mapping. It does not duplicate service/crypto/repository work, create conflict/409 or retry semantics, or open Phase 8+.
- Next safe action: `MAJANDUS_BACKEND_AUTH_P7_CREATE_HOUSEHOLD_ENDPOINT`. No remote D1, deployment, client/runtime coupling, or Phase 8+ work is authorized.
- Common Backend Architecture v1 is accepted; Cloudflare Pages Functions + D1 is selected for the v1 backend; the Phase A implementation plan is accepted.
- Task 1's native IndexedDB schema/primitives are accepted at `f2fe59c7b1704c5a1feb2266123606acaa4a1342` with real Chromium tests `5/5 PASS`, build PASS and no runtime cutover.
- Task 2's local-replica contracts and exported record validators are accepted at `5d7546fbf96fff77b738b48ca0b1e5f5936cfc48` with Chromium storage tests `6/6 PASS`, build PASS and no runtime cutover.
- Task 3's legacy validation, transformation and digest are accepted at `7ace02444fc3783898a14251c62ebe032113e0ea` with storage tests `45/45 PASS`, IndexedDB regressions `6/6 PASS`, build PASS and no runtime migration.
- Task 4's dormant migration state machine is accepted at `e651a6edb2f19bf850e5e67ceac462551f2fd37a` with storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, build PASS and final adversarial audit PASS; no runtime migration has occurred, legacy storage remains non-destructive and migration generates zero outbox mutations.
- Task 5's integration breadth is accepted at `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` with storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, build PASS, diff check PASS and no production file changes; migration remains dormant and no live runtime migration has occurred.
- Task 6's dormant guard and fail-fast regression is accepted at `abdd002240e78ed093facdb3ef463d4ba6ede418`: source guard PASS, bundle guard PASS, fail-fast sweep PASS and runtime diff NONE.
- Phase A implementation is complete and the Phase A final human review is ACCEPTED (range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`; review package at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`).
- The runtime cutover plan remains HUMAN ACCEPTED and C1-C8 are ACCEPTED / CHECKPOINTED. C8 is the accepted production runtime; the earlier accidental C6 deployment remains historical incident evidence and was not rolled back to pre-C6. Only Phase 7's exact two-file local create-household Pages-route scope is open; Phase 8+, sync, outbox UI, legacy cleanup/deletion, and automatic-production-deployment policy remain separate future scopes.
