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
- Current implementation task: `TASK_1_INDEXEDDB_SCHEMA_PRIMITIVES`.

Task 1 is authorized to create only `src/storage/schema.js`, `src/storage/indexedDb.js`, and `scripts/storage/indexeddb-browser.test.mjs` for native IndexedDB schema, transaction/request primitives, and real Chromium validation. Phase A remains dormant relative to production UI; current production behavior continues using the accepted localStorage runtime.

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
