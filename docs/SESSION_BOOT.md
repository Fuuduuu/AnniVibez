# SESSION_BOOT.md

Status: operational session entrypoint for Majandus.

## Product

Majandus is a live Android-first PWA.

Canonical production:
https://annivibe.pages.dev

## Accepted baseline

- accepted production/runtime baseline: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
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
  - Implementation phases C1-C8: LOCKED.
- `VISUAL_POLISH_V1 = ACCEPTED / CHECKPOINTED` at implementation `f367f2c06f3a4d5e96abb8ca7f4f8d96028491ee` (review PASS; behavior and storage/runtime changes NONE).
- Current gate: `VISUAL_POLISH_V2` (final visual-only interlude before C1). V2 source scope: OPEN at `142e7fb105d09c46ad810b00c9475b32a7088436`.
  - Production files: `src/design/shell.css`, `src/design/calendar.css`, `src/design/waste.css`, `src/components/SeadedTab.jsx`, `src/components/EventDialog.jsx`.
  - Test files (only for legitimate visual/class expectations): `scripts/shell/app-shell.test.mjs`, `scripts/shell/visual-cases.mjs`, `scripts/shell/visual-polish.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/calendar/calendar-ui.test.mjs`, `scripts/waste/browser-cases.mjs`, `scripts/waste/waste-ui.test.mjs`.
  - Authorized behavior changes: NONE; storage/runtime changes: NONE. Full scope in `docs/ACTIVE_SCOPE_LOCK.md`.
  - Direction: B-lite; modern native Android; calm warm utility; Material-3 influenced; no dark mode; no storage/runtime changes.
  - Expected focus: EventDialog mobile bottom-sheet presentation; forms/fields consistency; Kalender, Prügivedu and Seaded visual consistency; final spacing, typography and microinteraction polish.
  - Still excluded: dark mode, skeleton loaders, bus countdown, dynamic theme-color, new behavior, new data logic.

The only open implementation scope is the visual-only Visual Polish V2 scope; implementation happens in a separate pass. Runtime/storage implementation stays closed until Visual Polish V2 is checkpointed and a separate C1 scope-open pass is approved. Runtime implementation, startup migration, D1/backend, authentication, sync and outbox UI remain locked. The running Majandus application continues using its existing accepted localStorage/runtime paths.

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
