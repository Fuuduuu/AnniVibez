# SESSION_BOOT.md

Status: operational session entrypoint for Majandus.

## Product

Majandus is a live Android-first PWA.

Canonical production:
https://annivibe.pages.dev

## Accepted baseline

- historical product milestone: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
- accepted C8 production runtime: `9dac8c021be1b99bf7ec1227615cb6f3bd874674`, deliberately deployed as `0c4e39e4-63b8-4e9a-8ac4-7a667bda6b80` at `https://annivibe.pages.dev`
- human production/phone validation: PASS
- motion polish: accepted at `20ac51b481c1b2a7ea58ce2251f28ceb96f31046` with `211 PASS`, `0 FAIL` and human phone acceptance
- Calendar UX v2: accepted at `062cdcbe6488282854cbb7d8fcf2309c50360dec` with `206 PASS`, `0 FAIL`, production smoke PASS and human phone acceptance

## Current product state

- accepted surfaces: Kodu, Kalender, Buss, Veel and Seaded
- household calendar, waste/household functionality and reminders are accepted
- Buss behavior is accepted and preserved, including reachability-based routing, nearby departures and map destination selection
- calendar UX v2 keeps recurrence semantics and imported-event protections

## Current active phase

**PHASE_A_INDEXEDDB_FOUNDATION**.

- `COMMON_BACKEND_ARCHITECTURE_V1 = ACCEPTED`.
- `Phase A IndexedDB Foundation Plan = ACCEPTED` at `4e9a65af179c45ce95395aae21d577fe90ed13b2`.
- `PHASE_A_TASK_1_INDEXEDDB_SCHEMA_PRIMITIVES = ACCEPTED / COMPLETE` at `f2fe59c7b1704c5a1feb2266123606acaa4a1342` with real Chromium IndexedDB tests `5/5 PASS`, `npm run build` PASS, `git diff --check` PASS and no runtime cutover.
- `PHASE_A_TASK_2_LOCAL_REPLICA_CONTRACTS = ACCEPTED / COMPLETE` at `5d7546fbf96fff77b738b48ca0b1e5f5936cfc48` with Chromium storage tests `6/6 PASS`, `npm run build` PASS, `git diff --check` PASS and no runtime cutover.
- `PHASE_A_TASK_3_LEGACY_VALIDATION_TRANSFORM_DIGEST = ACCEPTED / COMPLETE` at `7ace02444fc3783898a14251c62ebe032113e0ea` with storage tests `45/45 PASS`, IndexedDB regressions `6/6 PASS`, `npm run build` PASS, `git diff --check` PASS and no runtime migration.
- `PHASE_A_TASK_4_MIGRATION_STATE_MACHINE = ACCEPTED / COMPLETE` at `e651a6edb2f19bf850e5e67ceac462551f2fd37a` with storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, `npm run build` PASS and final adversarial audit PASS. Migration remains dormant: no runtime migration has occurred, legacy storage remains non-destructive and migration generates zero outbox mutations.
- `PHASE_A_TASK_5_INTEGRATION_BREADTH_ONLY = ACCEPTED / COMPLETE` at `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` with storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, `npm run build` PASS, `git diff --check` PASS and no production file changes. Migration remains dormant; no live runtime migration has occurred.
- `PHASE_A_TASK_6_DORMANT_GUARD_AND_FAIL_FAST = ACCEPTED / COMPLETE` at `abdd002240e78ed093facdb3ef463d4ba6ede418`: source guard PASS, bundle guard PASS, fail-fast sweep PASS (storage `53/53`, IndexedDB `16/16`, build and diff check PASS; full list in `docs/ACCEPTED_CHECKPOINTS.md`) and runtime diff NONE.
- `PHASE_A_INDEXEDDB_FOUNDATION = IMPLEMENTATION COMPLETE` (Phase A range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`).
- `PHASE_A_FINAL_HUMAN_REVIEW = ACCEPTED`: the Phase A foundation is ACCEPTED by the human, based on the Phase A review package recorded at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`.
- `RUNTIME_CUTOVER_PLAN = ACCEPTED` (human) in `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` at plan checkpoint `8077c0e2626f1be1ef149a5690f43aa1e46cb248`; `RUNTIME_CUTOVER_PLAN_FRESH_REVIEW = PASS`. Four earlier independent fresh reviews returned AMEND.
  - Amendment 1 applied: saved-place module prerequisite, unknown authority never `LEGACY`, hint write as `READY` gate, exact `versionchange` propagation.
  - Amendment 2 applied: exact authority and hint record contracts, authoritative empty-state revert export, write-once backups with byte-for-byte compensation.
  - Amendment 3 applied: no automatic re-adopt after the switch (divergence keeps IndexedDB authoritative, `LEGACY_DIVERGED` plus STOP), durable IndexedDB revert-attempt record for export gating and resume, corrected calendar order note.
  - Amendment 4 applied: confirm-only `REVERT_STORAGE_LOST` for the revert build with authority absent and a non-null hint; collision-safe revert `attemptId` that never overwrites an existing backup key.
  - Post-amendment falsification review PASS; final fresh independent review PASS.
  - Implementation phases: C1-C8 ACCEPTED / CHECKPOINTED; `MAJANDUS RUNTIME CUTOVER = COMPLETE`.
- `VISUAL_POLISH_V1 = ACCEPTED / CHECKPOINTED` at implementation `f367f2c06f3a4d5e96abb8ca7f4f8d96028491ee` (review PASS; behavior and storage/runtime changes NONE).
- `VISUAL_POLISH_V2 = ACCEPTED / CHECKPOINTED` at implementation `67f8ad55345e3a9c41b23e233167a394123e88a5` (independent review PASS; behavior drift NONE FOUND; storage/runtime changes NONE). Visual-polish interlude CLOSED.
- `RUNTIME_CUTOVER_C1 = ACCEPTED / CHECKPOINTED` at final implementation `704cc7a815d1df1efdbfba979814aceb94886c09` (review: initial AMEND, final PASS / ACCEPT; runtime behavior change NONE; storage foundation DORMANT). C1 source scope: CLOSED.
- `RUNTIME_CUTOVER_C2 = ACCEPTED / CHECKPOINTED` at implementation `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e` (independent source review PASS / ACCEPT; runtime behavior change NONE; runtime/storage activation NONE). C2 source scope: CLOSED.
- `RUNTIME_CUTOVER_C3 = ACCEPTED / CHECKPOINTED` at final implementation `5612953e7c9e07eef411cecc3c6bb5dd5685930d` (review: initial AMEND, final PASS / ACCEPT; runtime behavior change NONE; storage foundation DORMANT). C3 source scope: CLOSED.
- `RUNTIME_CUTOVER_C4 = ACCEPTED / CHECKPOINTED` at final implementation `d2d1dad0e688706609b80172e8b10a50c54d138d` (implementation history `bf4c598f5b494bb289d748d48632c77d4be96be9` → `fa4b81055a4d4449bac89ac40fb9dc44f851abef` → `858d777e0b15ef8a61197d9c49262f1818030a20` → final `d2d1dad0e688706609b80172e8b10a50c54d138d`; final independent source review PASS / ACCEPT). Authority controller and the complete dormant cutover state machine (authority record, hint, revert-attempt record, startup state machine including `REVERTING`, switch ordering, no-re-adopt divergence, connection lifecycle, revert export/backups/compensation, and the mounted-`READY`/mounted-`LEGACY` runtime-signal amendment via `handleRuntimeSignal`). Runtime behavior change: NONE; storage foundation stays DORMANT. C4 source scope: CLOSED. Full accepted contract in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C4`) and `docs/ACTIVE_SCOPE_LOCK.md`.
- `RUNTIME_CUTOVER_C5 = ACCEPTED / CHECKPOINTED` at final implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b` (implementation history: scope open `590a2a7c56f63a5895a4fd56da7668ad879b95c6` → calendar-read scope amendment `02b5ff1824258bf28d16121517c072d90d0b892a` → initial implementation `5c3f6fee68a5af98390f28706dc759d4737f5a56` → review-amend governance `fbbff8b9dc4fa237ab144a1ac066d70244ef7a4f` → final corrective implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b`).
  - Production files: `src/storage/replicaRepositories.js`; `src/storage/localReplica.js` restricted to one additive read-only `listCalendarEvents()` accessor.
  - Purpose: dormant IndexedDB domain repositories for household, places, and calendar + waste (`createReplicaRepositories({ replica, authority, newId, clock })`), mutating only through the accepted C3 `runReplicaMutation(...)` and reusing (never reimplementing) the accepted household/places/calendar domain logic. Runtime behavior change: NONE.
  - `RUNTIME_CUTOVER_C5_CALENDAR_READ_SCOPE_AMEND` at baseline `02b5ff1824258bf28d16121517c072d90d0b892a`: the accepted `localReplica.js` read surface had no collection-read accessor for `calendarEvents`; resolved with one additive `listCalendarEvents()` accessor mirroring the accepted `listSharedPlaces()` pattern, without weakening the C3 mutation/transaction boundary.
  - `RUNTIME_CUTOVER_C5_REVIEW_AMEND` at baseline `5c3f6fee68a5af98390f28706dc759d4737f5a56`: the independent review of the initial implementation returned AMEND on five findings — (A) an invalid existing places collection could be silently auto-repaired instead of rejected; (B) the parity tests needed a true legacy-vs-IndexedDB oracle comparison instead of hand-computed expected values; (C) a generic/other write-error case was missing alongside `QuotaExceededError`; (D) `requestResult` needed explicit dependency-allowlist governance; (E) the calendar canonical-order comparator needed to match C4's locale-independent `<`/`>` comparator instead of `localeCompare()`.
  - Final corrective implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b` resolved all five findings; the further independent source review returned **PASS / ACCEPT**, remaining C5 source blocker: NONE FOUND. C5 source scope: CLOSED. Full accepted contract in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C5`) and `docs/ACTIVE_SCOPE_LOCK.md`.
- `RUNTIME_CUTOVER_C6 = ACCEPTED / CHECKPOINTED` at final implementation `7146d0ac85c28da0cb8846b944099bf1307b9ece` (`fix: harden runtime cutover coordination`), following scope open `07a74aafc174aea3aab43aa99d60e8721f396553`, reminder test-scope amendment `8e15c47e3d29b3cbcde88c7d42e55ceba720715c`, authority-identity amendment `6123c12567efea7040d5a5995dd8ba5f738c73a1`, and initial implementation `6a5739fb4c7809d9e50ce4d6e6bdf6d866474360`. Initial review AMENDed four findings; final independent source review PASS / ACCEPT, remaining blocker NONE FOUND. Automated final evidence and human-smoke record are in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C6`). C6 source scope: CLOSED; runtime behavior change: YES.
- Desktop Chrome human smoke: PASS on `http://127.0.0.1:4176/` from legacy `6123c12567efea7040d5a5995dd8ba5f738c73a1` to C6 `7146d0ac85c28da0cb8846b944099bf1307b9ece`; human-confirmed data continuity, shared-domain CRUD, reload persistence, two-tab domain refresh, reload-banner disabled writes and visual parity. Waste CRUD PASS; waste import action not separately confirmed. No unexpected storage state or `TransactionInactiveError` observed.
- `RUNTIME_CUTOVER_C7 = ACCEPTED / CHECKPOINTED`: C7 accepted the fixed-preview and Android installed-PWA gate at `82f17c50-78de-4ef6-ba3a-185c9475f5ad`, provenance `9dac8c021be1b99bf7ec1227615cb6f3bd874674`. Its complete accepted C6 automation, focused source review, PWA proof and final Android smoke passed. Preserved Step 1 evidence remains `PLACE_ORDER_BEFORE`: Kodu — Õie 58, Vanaema — Kaevu 10, Trenn — Pikk 23; `WASTE_IMPORT: NOT AVAILABLE`; manual waste schedule PASS; saved-place add/remove `NOT USER-EXPOSED`. **MANUAL C7 FORENSIC/DESTRUCTIVE DRILLS: WAIVED BY HUMAN FOR FINAL ACCEPTANCE GATE; NOT EXECUTED.**
- `RUNTIME_CUTOVER_C8 = ACCEPTED / CHECKPOINTED`: the first intentional/governed production boundary deployed exact forward/default provenance `9dac8c021be1b99bf7ec1227615cb6f3bd874674` with `VITE_STORAGE_AUTHORITY_MODE` absent. Deployment `0c4e39e4-63b8-4e9a-8ac4-7a667bda6b80` is canonical production at `https://annivibe.pages.dev`; C8 production-critical validation, stable PWA proof, remote 11/11 byte/hash proof and short production smoke all PASS.

The earlier C6-containing Git auto-deploy history, including frozen accidental deployment `0cca08f2-3a87-4176-99e2-7bc107bf8ce5` from `549203d3a0eced020fc954cab62721ee85a06936`, remains incident evidence. Current accepted canonical production is C8 deployment `0c4e39e4-63b8-4e9a-8ac4-7a667bda6b80` with runtime provenance `9dac8c021be1b99bf7ec1227615cb6f3bd874674`. Automatic production deployments remain disabled (`production_branch: main`, `production_deployments_enabled: false`); future releases remain deliberate/manual unless a separate deployment-policy scope changes that rule. Backend/D1, authentication, sync, outbox UI and legacy cleanup/deletion remain locked.

## Required reads by task

- all work: `AGENTS.md`, `docs/SESSION_BOOT.md`, `docs/CURRENT_STATE.md`, `docs/ACTIVE_SCOPE_LOCK.md`
- backend architecture planning: current frontend/local persistence surfaces and the active lock
- bus work: `docs/BUS_LOGIC_LOCK.md`
- deploy/API-key work: `docs/DEPLOYMENT.md`, `docs/POST_DEPLOY_FOLLOWUPS.md`

## Session-end checklist

1. Update this file when current state or the next phase changes.
2. Update `docs/ACCEPTED_CHECKPOINTS.md` when a pass is accepted.
3. Update `docs/ACTIVE_SCOPE_LOCK.md` only when active authority changes.
4. Report final Git status.
