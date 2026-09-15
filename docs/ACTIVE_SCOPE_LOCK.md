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

Task 4 in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` is authoritative where more specific; this lock adds the safety requirements below.

## Claude Opus 5 gate

Task 4 is a high-risk migration-state-machine pass. Before writing production Task 4 code, Claude Opus 5 must independently review the current plan, Task 1–3 implementation contracts, and this scope lock for contradictions or underspecified durable state.

If that review finds ambiguity that can materially affect data preservation, marker recovery, cleanup ownership, concurrency or idempotence, Claude must stop before production implementation and propose a narrow docs contract amendment. Minor naming/style choices are not blockers.

The plan already names these marker identities: meta key `legacyMigrationV1`, `preparationId`, `sourceDigest`, `generatedIds.sharedPlaces` and `migratedSingletonKeys`. It requires, but does not name, the migrated calendar IDs, migrated meta keys and prepared/complete state fields, and it defines no marker timestamp fields. The review must confirm or amend these before implementation; do not invent a durable marker schema silently.

## Allowed in this phase

- modify only `src/storage/legacyMigration.js`, `scripts/storage/storage.test.mjs` and `scripts/storage/indexeddb-browser.test.mjs`
- add `runLegacyMigration({ replica, storage, cryptoApi, newId, newPreparationId, now, locks })`; Task 3 exports and return contracts are otherwise preserved
- return only `completed`, `already-complete`, `source-changed-after-complete`, `prepared-recovered`, `reprepared`, `invalid-source`, `unreadable-source`, `replica-not-empty`, `concurrent-migration`, `verification-failed` or `write-failed`; every result includes `legacyMutated: false`; other result metadata only where needed for deterministic testing/diagnostics and only after the Claude gate confirms it creates no conflicting public contract
- legacy storage is non-destructive: read only the approved sources; never `setItem`, `removeItem`, `clear`, rewrite, normalize in place or delete legacy data
- persist the accepted migration marker in IndexedDB `meta`, sufficient to recover and retry safely, carrying `preparationId`, `sourceDigest`, generated shared-place IDs, migrated calendar IDs, migrated meta keys, migrated singleton keys and prepared/complete state, using the plan's exact names where specified
- marker timestamp safety: Task 4 validates every timestamp it persists in the marker as a real acceptable ISO timestamp itself, never indirectly through Task 3 record validators (a clean install prepares no domain records); do not modify Task 3 for this
- before any IndexedDB transaction: legacy reads, parsing, validation, digest, ID generation, preparation and lock coordination
- order: read raw approved values, compute the source digest, then inspect the marker
- complete marker: matching digest returns `already-complete`; a changed digest returns `source-changed-after-complete` before any parsing, validation or writing of the changed source, even when it is now malformed (for example calendar `{oops`), with marker, IndexedDB records and legacy storage unchanged
- no marker: validate and prepare, then transaction A
- transaction A atomically writes the prepared marker and the prepared household (if any), calendar, shared-place, waste (if any) and migration meta extras records; it enqueues no outbox mutations; before writing it re-checks the marker and that the migration-owned target space is safe per the plan: entity stores `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState` and migration meta keys only, where an existing `{ key: 'outboxSequence', ... }` is valid; unsafe existing replica state returns `replica-not-empty` with no destructive cleanup; never overwrite unrelated or pre-existing replica entities
- verify: after A commits, read the actual migration-owned replica state and compare it with the expected prepared state using Task 3 `verifyReplica`; a mismatch returns `verification-failed` and never marks the migration complete
- transaction B marks a prepared migration complete only after re-checking the matching prepared marker; it never completes a different or stale `preparationId`, `sourceDigest` or marker state; if B fails after A succeeded, the prepared state stays recoverable and a retry can return `prepared-recovered` with the original prepared IDs
- transaction C is guarded cleanup of migration-owned IndexedDB records only: before deleting it re-checks marker state prepared, matching `preparationId` and matching `sourceDigest`; it deletes only records named by the prepared marker (generated shared-place IDs, migrated calendar IDs, migrated meta keys, migrated singleton keys) and the marker as appropriate to the accepted recovery path; never broad-clear stores, delete unrelated records or touch legacy storage
- prepared marker with matching digest: verify the prepared replica; if it matches, finish through B with the original saved IDs and return `prepared-recovered`; on mismatch follow the plan (guarded C, then rebuild with saved IDs); never mint new IDs
- prepared marker with changed digest: validate and prepare the current source first; an invalid or unreadable current source returns that status with no cleanup, leaving the old preparation recoverable; only then may guarded C remove the old migration-owned prepared data and rebuild with deterministic accepted ID handling; `reprepared` only after the new A, verify and B succeed
- concurrency: handle overlapping executions; the browser test mechanically forces overlap before transaction A so one execution returns `completed` and the other `concurrent-migration`, never relying on timing; `locks` is injectable so tests can coordinate overlap deterministically; the Claude gate reviews lock semantics; add no Web Locks usage or runtime dependency unless the accepted contract justifies it
- `invalid-source` and `unreadable-source` produce zero new migrated records, no new marker, zero outbox mutations and unchanged legacy storage; browser corrupt-source tests seed the other two approved sources valid
- clean install (all approved sources absent) completes with zero domain entities, a completed marker and zero outbox items
- after every successful migration, recovery or reprepare path the outbox count is `0`; migrated records remain `syncStatus: 'local'` and `revision: 0`
- prove behavior with strict RED -> GREEN tests run by `node --test scripts/storage/storage.test.mjs` and `node --test scripts/storage/indexeddb-browser.test.mjs`

## Forbidden in this pass

- modify `src/storage/schema.js`, `src/storage/indexedDb.js`, `src/storage/localReplica.js` or any file outside the three allowed files; a proven upstream correctness defect means STOP and report, not a fix
- bump the schema version or add IndexedDB stores
- mutate legacy storage in any way, or change Task 3 exports or return contracts beyond adding `runLegacyMigration`
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

Task 4 implementation is authorized once this docs checkpoint is committed, subject to the Claude Opus 5 gate above. Task 5+ is locked until Task 4 passes validation, fresh independent review, exact commit/push, and a separate explicit scope opening.
