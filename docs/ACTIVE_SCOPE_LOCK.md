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

Current pass: **TASK_3_LEGACY_VALIDATION_TRANSFORM_DIGEST**.

Task 3 in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` is authoritative where more specific.

## Allowed in this phase

- create only `src/storage/legacyMigration.js` and `scripts/storage/storage.test.mjs`
- export only `LEGACY_SHARED_KEYS`, `readLegacySources(storage)`, `validateLegacySources(sources)`, `sourceDigest(sources, cryptoApi)`, `prepareLegacyMigration({ validated, newId, now, preparationId, savedIds })` and `verifyReplica({ expected, actual })`
- read only `majamajandus_household_events_v1`, `majamajandus_household_profile_v1` and `sade_saved_places`, in that order, with `getItem` only; production code contains no other legacy storage key strings, and private/device-local key lists exist only in tests
- classify sources: `null` or `undefined` storage, or a thrown approved `getItem`, is `unreadable-source`; absent means only `getItem(key) === null` and is not corrupt; all three absent is a valid clean-install input
- validate calendar and household through read-only snapshot adapters over the current `createEventRepository` and `createHouseholdRepository`; adapters permit the approved `getItem` and throw on writes, enumeration and any other key; do not hand-duplicate repository validation rules
- household invalid parity covers at least version 2, `null` profile and name over 100 characters; a household record exists only for a present valid household source, with `serverHouseholdId: null`; a waste record exists only for a present calendar source with defined `wasteImports`
- retain existing valid calendar event IDs; never mint replacement calendar IDs
- saved places mirror current `normalizePlace` semantics from `src/hooks/useSavedPlaces.js` (not exported; do not modify or import it) with golden parity for `null`, number and string items, invalid coordinates, blank name, missing address and short arrays; never pad Kodu/Kool/Trenn defaults
- prepared shared places are `{ id, order, payload, revision: 0, updatedAt, deletedAt: null, syncStatus: 'local' }`; `id` is a generated permanent ID and `order` is the integer legacy index, not identity
- preserve only raw parsed envelope extras: `{ key: 'calendarLegacyEnvelopeExtras', value: { sourceVersion, fields } }` excluding `version`, `events`, `wasteImports`; household equivalent excluding `version`, `profile`; present source with no extras uses `fields: {}`; absent source has no extras record
- digest is lowercase Web Crypto SHA-256 hex over exactly `JSON.stringify([rawCalendarOrNull, rawHouseholdOrNull, rawPlacesOrNull])`; no normalized or private data enters the digest
- `newId`, `now` and `preparationId` are injectable; no IDs are generated during validation; provided `savedIds` are reused exactly
- prepared household, calendar-event, shared-place and waste records must pass the matching Task 2 exported validator; Task 2 exports no meta-record validator, so extras records are checked against the exact shape above inside `legacyMigration.js`
- preparation creates no outbox records
- `verifyReplica` performs deterministic structural comparison only: no writes, repair, after-the-fact normalization, network or localStorage access
- prove behavior with strict RED -> GREEN Node tests run by `node --test scripts/storage/storage.test.mjs`

## Forbidden in this pass

- modify `src/storage/schema.js`, `src/storage/indexedDb.js`, `src/storage/localReplica.js` or `scripts/storage/indexeddb-browser.test.mjs`; a real Task 1 or Task 2 correctness defect means STOP and report, not a fix
- Task 4+: `runLegacyMigration`, migration transactions A/B/C, prepared/complete marker state machine, concurrent migration locking, cleanup/recovery executor, `source-changed-after-complete` execution, startup migration
- write migration data or markers to IndexedDB, delete or rewrite localStorage, dual-write, create outbox mutations, or cut runtime reads/writes over to IndexedDB
- import `src/storage/` from React/App or any production component; change UI/runtime or accepted calendar, household, waste, saved-place, bus or reminder behavior or repositories
- implement sync, authentication, D1, Cloudflare bindings, network/backend calls, dependencies or deployment
- bump the schema version or add IndexedDB stores; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Implementation boundary

Task 3 only validates and prepares legacy shared data. The running Majandus application continues using its existing accepted localStorage/runtime paths. No user data is migrated during Task 3.

## Decision gate

Task 3 implementation is authorized. Task 4+ is locked until Task 3 passes validation, fresh review, exact commit/push, and a separate explicit scope opening. Task 4 is a high-risk migration-state-machine pass and requires its own opened scope with an independent Claude Opus 5 review/implementation workflow.
