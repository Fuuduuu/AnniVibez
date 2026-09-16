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

Current pass: **TASK_5_INTEGRATION_BREADTH_ONLY**.

Task 4 (`TASK_4_MIGRATION_STATE_MACHINE`) is ACCEPTED / COMPLETE at `e651a6edb2f19bf850e5e67ceac462551f2fd37a` with storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, `npm run build` PASS and final adversarial audit PASS. The Task 4 migration contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` remain authoritative for migration behavior; Task 5 tests them and never changes them.

## Accepted Task 4 state carried forward

- migration remains dormant; no runtime migration has occurred and nothing invokes migration at runtime
- legacy storage remains non-destructive
- migration generates zero outbox mutations
- the Task 4 production source guard in `scripts/storage/storage.test.mjs` intentionally permits `transact` and `requestResult`; legacy mutation, global storage handles, store-wide clears, network and runtime coupling stay forbidden

## Allowed in this pass

- TEST-ONLY: modify only `scripts/storage/storage.test.mjs` and `scripts/storage/indexeddb-browser.test.mjs`
- use the existing Task 1 Chromium harness and Task 4 page helpers; no new harness, alternative API or duplicate Task 4 atomicity, concurrency or failure-injection test
- add a full-path migration integration scenario seeding a valid calendar, a valid household, 3 saved places, waste data where applicable and representative private/device-local sentinels
- capture the complete localStorage snapshot before migration, require `status === 'completed'`, close the database, reload/reopen the browser context and reopen the database
- after reopen prove: marker `status === 'complete'`; household, calendar events, 3 shared places and seeded waste persisted; shared-place order `[0,1,2]`; outbox count `0`; localStorage snapshot byte-for-byte unchanged
- prove private sentinel values occur in none of `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState`, the `legacyMigrationV1` marker, `calendarLegacyEnvelopeExtras`, `householdLegacyEnvelopeExtras` or the `sourceDigest` input
- private key names remain test-only
- prove behavior with a meaningful RED -> GREEN run by `node --test scripts/storage/storage.test.mjs` and `node --test scripts/storage/indexeddb-browser.test.mjs`; RED must never be manufactured by changing production code

## Forbidden in this pass

- modify any production file, including `src/storage/**` and all other `src/**`, or `docs/**`, `package.json` or `package-lock.json`
- fix a production defect exposed by Task 5; a proven Task 4 production bug means STOP and report
- add private key names to production migration code
- change migration statuses, marker fields, result fields or Task 3/Task 4 exports and contracts
- Task 6+: dormant import/bundle guards and fail-fast regression sweep
- import storage migration into App/React or any production component, run migration at startup, switch reads from localStorage to IndexedDB, dual-write, or create outbox mutations
- implement sync, authentication, D1, Cloudflare bindings, network/backend calls, dependencies or deployment
- modify accepted calendar, household, waste, saved-place, bus or reminder behavior or repositories; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Implementation boundary

Task 5 adds integration tests only. The running Majandus application continues using its existing accepted localStorage/runtime paths; nothing invokes migration at runtime and no user data is migrated.

## Decision gate

Task 5 implementation is authorized as test-only integration breadth, beginning with a meaningful RED test. Task 6+ is locked until Task 5 passes validation, fresh read-only audit, exact commit/push, and a separate explicit scope opening.
