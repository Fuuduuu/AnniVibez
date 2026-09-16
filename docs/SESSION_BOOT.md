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
- Current implementation task: `TASK_5_INTEGRATION_BREADTH_ONLY`.

Task 5 is test-only and may modify only `scripts/storage/storage.test.mjs` and `scripts/storage/indexeddb-browser.test.mjs` to add full-path migration integration breadth (reload/reopen persistence, unchanged legacy snapshot, zero outbox, shared-place order and private-sentinel exclusion). No production file may change; a Task 4 production defect found under Task 5 means STOP and report. Task 6+ remains locked. The running Majandus application continues using its existing accepted localStorage/runtime paths.

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
