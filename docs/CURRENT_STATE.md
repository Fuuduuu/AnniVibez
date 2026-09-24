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
- Backend Phases 1–9 are ACCEPTED. Phase 6 is `63981e14903cac077471b6e6911664d73cd94448` (`feat: add Majandus household creation foundation`): independent final audit PASS; BLOCKING `0`; MATERIAL `0`; Phase 1–6 regression `54 passed`, `0 failed`, `0 skipped`. Its non-blocking clock-test MINOR does not reopen the accepted implementation. Phase 7 is `85d8488ec3752037d702464c833c21038520fa02` (`feat: add Majandus household creation endpoint`): implementation/re-audit PASS; BLOCKING requiring action `0`; MATERIAL requiring action `0`; non-blocking MINOR notes `2`; Phase 1–7 regression `62 passed`, `0 failed`, `0 skipped`.
- The accepted Phase 5 contract is closed and protected: `functions/_lib/auth.js` exports exactly `authenticateDevice(request, db)` and `requireAuthenticated(request, db)`; credential failures collapse uniformly; infrastructure failures propagate and never become `null` or 401; the trusted context is repository-derived; plaintext credentials never cross the repository boundary. Phase 4 remains precomputed-hash repository work only.
- Accepted Phase 6 files are protected: `functions/_lib/households.js` and `scripts/backend/households.test.mjs`. Their self-validating, non-idempotent hash-only creation contract remains closed; invalid input returns `INVALID_REQUEST`, repository errors propagate unchanged, and no conflict/retry semantics exist.
- Phase 7's accepted files are `functions/api/auth/create-household.js` and `scripts/backend/create-household-api.test.mjs`; its direct-handler contract is accepted. Actual Pages dispatch for both auth routes is accepted under Phase 9 evidence.
- Phase 8 is ACCEPTED at `d65195356bd2430d7e634c3959b7a5dbe79a12bd` (`feat: add Majandus session endpoint`): independent final audit PASS; BLOCKING `0`; MATERIAL `0`; MINOR `0`; focused tests `12 passed`, combined Phase 1–8 regression `74 passed`, both with `0 failed` and `0 skipped`. Its accepted files are protected; its Phase 8 evidence covered direct exported-handler contracts only, with actual Pages dispatch subsequently verified under Phase 9.
- Phase 9 is ACCEPTED at `5eb18cb4a7a17d6b3f6ef7852cca8788430e5414` (`test: verify Majandus Pages foundation integration`); its protected test file is `scripts/backend/foundation-integration.test.mjs`. Final independent audit PASS; BLOCKING `0`; MATERIAL `0`; non-blocking MINOR `7`; focused regression `13 passed`, combined Phase 1–9 regression `87 passed`, build PASS. Actual local Pages routing is verified for both endpoints: routed POST creation reaches `onRequestPost`, session GET reaches `onRequestGet` and returns 401 without a token / the exact safe metadata with its returned token, unsupported methods reach generic 405 handlers with expected `Allow` headers, and session HEAD returns 405 with `Allow: GET`. Phase 7/8 routing debt is satisfied. The seven non-blocking follow-ups are recorded in `ACCEPTED_CHECKPOINTS.md` and are not open repair scope.
- Phase 10A-1/10A-2 read-only inventory is COMPLETE for Cloudflare account `1b233505a2b4e206ee28a99aae152564` (`Elarvaltri@gmail.com's Account`), Pages project `annivibe`, production environment, production branch `main`, and production Pages/D1 binding inspection. Production `d1_databases` is NONE; expected binding `DB` is NOT PRESENT. The confirmed account's D1 inventory contained exactly `tehnika-temp-inventory` (`c6ea725f-c533-441c-a287-af714af99f43`, created `2026-05-05T06:42:33.844Z`, jurisdiction none, version `production`), which is protected/out of scope. Candidate `majandus-backend-v1` is NOT FOUND. No schema was inspected and no SQL was executed. The authenticated Cloudflare API connector was used for read-only calls; credential values were not stored. The Task 10 candidate files remain unopened.
- Phase 10 remains BLOCKED for remote mutation, deployment, and implementation. Phase 10A-3 CREATE REMOTE D1 ONLY is BLOCKED pending explicit human mutation authorization for exactly one new database named `majandus-backend-v1` in account `1b233505a2b4e206ee28a99aae152564`; if later authorized and creation succeeds, STOP and report name, id, and non-secret metadata. Phase 10A-4 binding authorization and 10A-5 remote migration authorization remain separate gates. Binding, migration, schema inspection, preview/production deployment, remote Wrangler, client/runtime integration, and real-user readiness remain LOCKED. Phase 10B remains controlled technical deployment only with isolated synthetic/non-user data; Phase 10C remains closed. Phase 9 local synthetic authorization grants no Phase 10 permission.
- Real-user readiness is NOT established. Remaining prerequisite decisions include session lifetime/renewal, lost-device/session revocation and recovery, secure client token storage/integration, unknown-result create/retry handling, restore/rollback credential safety, abuse/publication controls, retention, production observability, credential-supply mechanism, and privacy/security readiness. Plan treats D1 restore/time-travel as a credential-security event; operational retention/backup/rollback procedures are not defined here.
- Next safe action: remain blocked until explicit human mutation authorization is provided for the exact 10A-3 create-only target. This checkpoint authorizes no creation, binding, migration, schema query, deployment, or implementation.
- Common Backend Architecture v1 is accepted; Cloudflare Pages Functions + D1 is selected for the v1 backend; the Phase A implementation plan is accepted.
- Task 1's native IndexedDB schema/primitives are accepted at `f2fe59c7b1704c5a1feb2266123606acaa4a1342` with real Chromium tests `5/5 PASS`, build PASS and no runtime cutover.
- Task 2's local-replica contracts and exported record validators are accepted at `5d7546fbf96fff77b738b48ca0b1e5f5936cfc48` with Chromium storage tests `6/6 PASS`, build PASS and no runtime cutover.
- Task 3's legacy validation, transformation and digest are accepted at `7ace02444fc3783898a14251c62ebe032113e0ea` with storage tests `45/45 PASS`, IndexedDB regressions `6/6 PASS`, build PASS and no runtime migration.
- Task 4's dormant migration state machine is accepted at `e651a6edb2f19bf850e5e67ceac462551f2fd37a` with storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, build PASS and final adversarial audit PASS; no runtime migration has occurred, legacy storage remains non-destructive and migration generates zero outbox mutations.
- Task 5's integration breadth is accepted at `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` with storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, build PASS, diff check PASS and no production file changes; migration remains dormant and no live runtime migration has occurred.
- Task 6's dormant guard and fail-fast regression is accepted at `abdd002240e78ed093facdb3ef463d4ba6ede418`: source guard PASS, bundle guard PASS, fail-fast sweep PASS and runtime diff NONE.
- Phase A implementation is complete and the Phase A final human review is ACCEPTED (range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`; review package at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`).
- The runtime cutover plan remains HUMAN ACCEPTED and C1-C8 are ACCEPTED / CHECKPOINTED. C8 is the accepted production runtime; the earlier accidental C6 deployment remains historical incident evidence and was not rolled back to pre-C6. Backend Phase 8 is accepted and protected; Phase 9 actual local routing is accepted. Phase 10 external execution remains blocked pending a specific governance/authorization decision; sync, outbox UI, legacy cleanup/deletion, and automatic-production-deployment policy remain separate locked scopes.
