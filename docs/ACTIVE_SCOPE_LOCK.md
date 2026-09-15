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

Current pass: **TASK_2_LOCAL_REPLICA_CONTRACTS**.

## Allowed in this phase

- create only `src/storage/localReplica.js` and modify only `scripts/storage/indexeddb-browser.test.mjs`
- use the accepted Task 1 schema and native transaction primitives without modifying `src/storage/schema.js` or `src/storage/indexedDb.js`
- implement validated replica `open`, `close`, `transact`, singleton, calendar, shared-place, meta and ordered-outbox access APIs
- enforce shared-record rules: `local` has revision `0`; `synced` has integer revision `>= 1`; `pending` / `conflict` have integer revision `>= 0`; `updatedAt` is ISO; `deletedAt` is `null` or ISO
- enforce singleton keys `householdProfile.key === 'household'` and `wasteState.key === 'waste'`; shared places require `id`, integer `order`, `payload`, `revision`, `updatedAt`, `deletedAt` and `syncStatus`, sorted by `order`, then `id`
- validate outbox `mutationId`, `entityType`, `entityId`, `operation`, `baseRevision`, `patch`, `createdAt`, `attemptCount`, `lastAttemptAt` and `sequence`; only `CREATE` / `UPDATE` / `DELETE` are valid, with `CREATE.baseRevision === 0` and positive integer base revisions for `UPDATE` / `DELETE`
- allocate monotonic outbox `sequence` from `{ key: 'outboxSequence', value: integer }` in the same `meta` + `outbox` transaction as the item, never from mutation IDs, timestamps or array order
- add real Chromium/CDP tests for validator rejection, ordered outbox, and shared-place ordering independent of ID

## Forbidden until architecture approval

- modify `src/storage/schema.js` or `src/storage/indexedDb.js` without a separately reported Task 1 correctness blocker
- create `src/storage/legacyMigration.js` or implement Task 3+
- wire IndexedDB into React/App, change localStorage repositories, perform legacy/startup migration, dual-write, or create production UI outbox mutations
- implement sync, authentication, D1, Cloudflare bindings, network/backend calls, dependencies, deployment, or runtime UI changes
- bump the schema version, add IndexedDB stores, process outbox items, use server cursors, or allow a production component to import `localReplica.js`
- modify accepted calendar, bus, waste, or reminder behavior; unrelated redesign, broad refactor, or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Implementation boundary

Task 2 adds validated local-replica access APIs on top of the accepted Task 1 native IndexedDB primitives. It does not migrate current data and does not change the running application. Current production behavior continues using the existing accepted runtime/localStorage path.

## Decision gate

Task 2 implementation is authorized. Task 3 remains locked until Task 2 passes validation, fresh review, exact commit/push, and a separate explicit scope opening.
