# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Read and follow in this order:
1. `AGENTS.md`
2. `docs/SESSION_BOOT.md`
3. `docs/CURRENT_STATE.md`
4. `docs/ACTIVE_SCOPE_LOCK.md`

## Accepted baseline

- product: `Majandus`
- accepted runtime: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
- canonical production: `https://annivibe.pages.dev`
- human production/phone validation: PASS

## Current phase

**PHASE_A_INDEXEDDB_FOUNDATION**.

Current pass: **TASK_6_DORMANT_GUARD_AND_FAIL_FAST** (final Phase A dormant-foundation pass).

Task 4 (`TASK_4_MIGRATION_STATE_MACHINE`) is ACCEPTED / COMPLETE at `e651a6edb2f19bf850e5e67ceac462551f2fd37a`. Task 5 (`TASK_5_INTEGRATION_BREADTH_ONLY`) is ACCEPTED / COMPLETE at `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` with storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, `npm run build` PASS, `git diff --check` PASS and no production file changes. The Task 4 migration contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` remain authoritative for migration behavior; Task 6 guards them and never changes them.

## Accepted state carried forward

- migration remains DORMANT; no live runtime migration has occurred and nothing invokes migration at runtime
- legacy storage remains non-destructive; migration generates zero outbox mutations
- the Task 4 production source guard in `scripts/storage/storage.test.mjs` intentionally permits `transact` and `requestResult`

## Allowed in this pass

- TEST/GUARD-ONLY: initially modify only `scripts/storage/storage.test.mjs` and `scripts/storage/indexeddb-browser.test.mjs`
- use existing test infrastructure; no new harness
- source import guard: deterministically enumerate every relevant production source file under `src/` outside `src/storage/` and fail on any static default/named import, re-export, side-effect import, `require` or dynamic `import(...)` of the storage foundation
- bundle guard: use the same entry/build shape as `scripts/shell/app-shell.test.mjs`, generate an esbuild metafile for the application bundle and fail if any `src/storage/` module is included directly or transitively; the production build configuration is not changed to satisfy the test
- establish a meaningful RED before completing guard coverage; RED must never come from adding a fake storage import or breaking production code
- run the plan's fail-fast regression sweep (calendar, calendar UI, app shell, reminders, reminder UI, native notification, waste, waste UI, storage, IndexedDB, `npm run build`, `git diff --check`), stopping at the first failure
- confirm no diff in `src/App.jsx`, `src/main.jsx`, `src/calendar/eventRepository.js`, `src/calendar/useHouseholdEvents.js`, `src/waste/householdRepository.js`, `src/waste/useHousehold.js` and `src/hooks/useSavedPlaces.js`, and that Task 6 changed no production runtime file
- commit per the plan: `feat: add IndexedDB migration foundation`

## Forbidden in this pass

- modify any production file, including `src/storage/**` and all other `src/**`, or `docs/**`, `package.json`, `package-lock.json` or build configuration
- fix a proven contract failure under Task 6; a required `src/storage/**` change means STOP and report the exact failing contract, the exact file and why tests alone cannot fix it, for a separately approved amendment
- dependency updates, including remediation of the pre-existing `npm audit` report (separate scope)
- runtime cutover: import storage into App/React or any production component, run migration at startup, switch reads from localStorage to IndexedDB, dual-write, or create outbox mutations or outbox UI
- implement sync, authentication, D1, Cloudflare bindings, network/backend calls or deployment
- modify accepted calendar, household, waste, saved-place, bus or reminder behavior or repositories; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Implementation boundary

Task 6 adds dormant guards and runs regressions only. The running Majandus application continues using its existing accepted localStorage/runtime paths; nothing invokes migration at runtime and no user data is migrated.

## Decision gate

Task 6 implementation is authorized as test/guard-only, beginning with a meaningful RED. After Task 6 passes validation, fresh read-only audit and exact commit/push, Phase A requires a separate final checkpoint and human review of the Phase A diff and Chromium evidence. Runtime cutover, backend and sync work remain locked until then and a separate explicit scope opening.
