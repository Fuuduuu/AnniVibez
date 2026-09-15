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

Current pass: **TASK_4_MIGRATION_STATE_MACHINE**.

The durable migration contract is "Task 4 migration contracts" in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` (accepted as `TASK_4_MIGRATION_CONTRACT_AMENDMENT`). It is authoritative for Task 4; this lock summarizes it and adds scope limits.

## Claude Opus 5 gate

Satisfied. The independent Claude Opus 5 contract review returned AMEND; the accepted amendment defines the durable marker, prepared recovery, atomic C+A, changed-source ID policy, verification ownership, locks semantics and exact status mapping. Implementation must follow that contract without inventing further durable or public semantics; any newly found material ambiguity means STOP and propose another narrow amendment.

## Allowed in this phase

- modify only `src/storage/legacyMigration.js`, `scripts/storage/storage.test.mjs` and `scripts/storage/indexeddb-browser.test.mjs`
- add `runLegacyMigration({ replica, storage, cryptoApi, newId, newPreparationId, now, locks })`; Task 3 exports and return contracts are otherwise preserved
- every result is exactly `{ status, legacyMutated: false }` using only the plan's status mapping: `completed`, `already-complete`, `source-changed-after-complete`, `prepared-recovered`, `reprepared`, `invalid-source`, `unreadable-source`, `replica-not-empty`, `concurrent-migration`, `verification-failed`, `write-failed`; unexpected non-IndexedDB exceptions are thrown, never mapped to a status
- legacy storage is non-destructive: read only the approved sources; never `setItem`, `removeItem`, `clear`, rewrite, normalize in place or delete legacy data
- marker `meta/legacyMigrationV1` has exactly `key`, `status` (`prepared` | `complete`), `preparationId`, `sourceDigest` (64 lowercase hex), `preparedAt`, `generatedIds.sharedPlaces`, `migratedCalendarIds`, `migratedMetaKeys` and `migratedSingletonKeys`, validated as the plan specifies; a marker failing validation, or a prepared marker whose saved place IDs cannot be reused for its same-digest source, returns `replica-not-empty` with no parsing, writes, cleanup or repair
- `preparedAt` is the only marker timestamp (no `completedAt`), equals every prepared record's `updatedAt`, and Task 4 validates it itself before any marker write, including a clean install with zero domain records
- order: read raw sources (unreadable returns `unreadable-source`), compute the digest, read and validate the marker; legacy-domain parsing only where the branch requires it
- complete marker: same digest `already-complete`; changed digest `source-changed-after-complete` before parsing or validating the changed source, even if malformed (for example `{oops`), with marker, records, legacy storage and outbox unchanged
- transaction A re-reads the marker (`concurrent-migration` if present); any record in `householdProfile`, `calendarEvents`, `sharedPlaces` or `wasteState`, or an existing migration extras key, returns `replica-not-empty` with no cleanup; `meta/outboxSequence`, other non-migration meta, `auth` and `syncState` are allowed and preserved; otherwise it writes all prepared records, extras and the prepared marker together with zero outbox mutations
- verification reads only marker-owned keys, never whole stores, and compares with the expected Task 3 replica via `verifyReplica`; mismatch `verification-failed` (marker stays prepared); IndexedDB read/request/transaction failure `write-failed`
- transaction B re-reads the marker and requires `status === 'prepared'` plus exact equality of `preparationId`, `sourceDigest` and all four ownership arrays; otherwise `concurrent-migration` with no write; on match it changes only `status` to `complete`
- prepared marker, same digest: rebuild expected state with the marker's `preparationId`, `preparedAt` and shared-place IDs, without calling `newId`, `newPreparationId` or `now`; verified data runs B and returns `prepared-recovered`; mismatch runs C+A with the same identities, then verify and B, returning `prepared-recovered`
- prepared marker, changed digest: validate and prepare the current source first with fresh `newPreparationId()`, fresh `now()` and fresh place IDs (old place IDs are never reused across a changed source); invalid returns `invalid-source` with the old preparation untouched; valid runs C+A, verify and B, returning `reprepared`
- C+A is one readwrite transaction: re-check `status === 'prepared'` with the observed old `preparationId` and `sourceDigest` (`concurrent-migration` otherwise); delete only records named by the old marker, never `clear()` or unrelated records; apply the transaction-A target-space rule in the same transaction, aborting everything with `replica-not-empty` if unrelated entity records or extras collisions remain (old preparation, old marker and unrelated records stay intact); otherwise write the new prepared state and replace the marker
- `locks` is optional `{ request(name, callback) }`; when provided, `locks.request('majandus:legacy-migration', callback)` wraps the whole run, otherwise the run executes directly; production code never accesses `navigator.locks`; correctness comes only from the A, B and C+A marker re-checks
- concurrency test omits `locks` or passes a pass-through, mechanically holds both executions just before transaction A and releases both: exactly one `completed`, one `concurrent-migration`, no random sleeps; a separate test proves a supplied `locks.request` wraps a run
- `invalid-source` and `unreadable-source` produce zero new migrated records, no new marker, zero outbox mutations and unchanged legacy storage; browser corrupt-source tests seed the other two approved sources valid
- clean install (all approved sources absent) completes with zero domain entities, a completed marker and zero outbox items
- after every successful migration, recovery or reprepare path the outbox count is `0`; migrated records remain `syncStatus: 'local'` and `revision: 0`
- failure injection for A, B, C+A and write failures uses test-only replica/transaction wrappers; production code has no failure flags
- prove behavior with strict RED -> GREEN tests run by `node --test scripts/storage/storage.test.mjs` and `node --test scripts/storage/indexeddb-browser.test.mjs`

## Forbidden in this pass

- modify `src/storage/schema.js`, `src/storage/indexedDb.js`, `src/storage/localReplica.js` or any file outside the three allowed files; a proven upstream correctness defect means STOP and report, not a fix
- bump the schema version or add IndexedDB stores
- mutate legacy storage in any way, or change Task 3 exports or return contracts beyond adding `runLegacyMigration`
- add marker fields, result fields, statuses or production failure flags beyond the accepted Task 4 migration contracts
- Task 5+: additional integration breadth or dormant import/bundle guards, except where a Task 4 acceptance test necessarily shares existing helpers
- import storage migration into App/React or any production component, run migration at startup, switch reads from localStorage to IndexedDB, dual-write, or create outbox mutations
- implement sync, authentication, D1, Cloudflare bindings, network/backend calls, dependencies or deployment
- modify accepted calendar, household, waste, saved-place, bus or reminder behavior or repositories; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Implementation boundary

Task 4 adds a dormant migration state machine exercised only by tests. The running Majandus application continues using its existing accepted localStorage/runtime paths; nothing invokes migration at runtime and no user data is migrated.

## Decision gate

Task 4 implementation is authorized under the accepted Task 4 migration contracts, beginning with strict RED tests before adding `runLegacyMigration`. Task 5+ is locked until Task 4 passes validation, fresh independent review, exact commit/push, and a separate explicit scope opening.
