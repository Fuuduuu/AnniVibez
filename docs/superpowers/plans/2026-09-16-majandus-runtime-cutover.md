# Majandus Runtime Cutover Plan (localStorage -> IndexedDB)

Status: LOCKED PLAN, AMENDED twice after independent fresh reviews returned AMEND (amendment record in Section 12). The plan author's post-amendment falsification review returned PASS. A fresh independent review of this amended plan is still required. It authorizes no runtime code. Each implementation phase below opens only through its own separate scope-open commit after human acceptance of this plan.

**Goal:** Make the accepted Phase A IndexedDB replica the runtime authority for the three shared household domains without data loss, split authority or an unrecoverable rollback.

**Inherits unchanged:** `docs/COMMON_BACKEND_ARCHITECTURE_V1.md` and the accepted Phase A Task 1-6 contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md`. The only Phase A amendments are the ones named in C1 and C2 below.

**Out of scope:** D1, backend, network calls, authentication, sync, outbox mutations and outbox UI, legacy cleanup or deletion, schema version bumps, new object stores, dependency changes.

## 1. Cutover model

- **Scope of the switch.** Calendar events with waste imports (`majamajandus_household_events_v1`), household profile (`majamajandus_household_profile_v1`) and saved places (`sade_saved_places`) switch together, per device, in one atomic authority switch. A per-domain switch is forbidden: the Task 4 marker and digest cover all three sources, so a partial switch would leave the marker permanently stale. Rollout by domain applies to implementation order (Section 7), not to authority.
- **Device-local data stays in localStorage:** diary, reminder preferences and delivery, saved ideas and tips, `sade_profile`.
- **Authority record:** IndexedDB `meta/storageAuthorityV1` is the single source of truth (exact contract in Section 1a). IndexedDB is authoritative exactly while a *valid* record exists with `status` `active` or `reverting`.
- **Authority knowledge requires a successful open.** Authority is *proven absent* only when IndexedDB opens and the `meta` read succeeds and shows no record (or a valid record `reverted`). If the database cannot be opened or read, or the record is malformed, authority is *unknown*. Unknown authority never leads to `LEGACY`, whatever the hint says (Section 3).
- **Authority hint:** localStorage key `majandus_storage_authority_v1` (exact contract in Section 1b). The hint never grants authority, and its absence never proves legacy authority. It exists to detect loss of the IndexedDB database (`STORAGE_LOST`) and to stop legacy writes in tabs running the new build. While IndexedDB is authoritative, a verified hint is a precondition for `READY` (Section 2).
- **Legacy rollback material:** after the switch, the three legacy keys are frozen. No forward build writes them. They are retained until a separate accepted cleanup plan; no phase in this plan deletes them. The only deletions of a shared legacy key allowed anywhere are the failed-revert compensation in Section 6c.
- **Deletion:** runtime records are `syncStatus: 'local'`, `revision: 0` and never uploaded, so they are hard-deleted. Tombstones belong to the future sync phase.
- **Calendar event order:** IndexedDB calendar records carry no order. The canonical events order is ascending `id` by UTF-16 code unit, used both when rebuilding the envelope for runtime repositories and for revert export. Calendar views sort by date, time and occurrence id, so this order is not visible there. The only order-dependent display is the `KalenderTab` legend category order (cosmetic; checked in C6 smoke). All parity and verification comparisons treat events as id-keyed sets.

## 1a. Authority record contract

**Exact shape.** The key set is exactly these 9 fields; extra or missing keys are malformed.

```js
{
  key: 'storageAuthorityV1',
  status: 'active' | 'reverting' | 'reverted',
  switchId: nonEmptyString,
  switchedAt: strictValidIso,        // same strict calendar-valid ISO rule as Task 2 record timestamps
  legacyDigestAtSwitch: lowerHex64,  // /^[0-9a-f]{64}$/
  markerPreparationId: nonEmptyString,
  commitCount: nonNegativeSafeInteger,
  legacyUntrusted: boolean,
  persistGranted: null | boolean
}
```

**Fresh switch** (Section 2 step 2.7) writes every field explicitly:
- `status: 'active'`, `switchId` from the injected `newId()`;
- `switchedAt` from the injected `now()`, validated before the transaction (an invalid value throws and the switch does not happen, leaving authority proven absent, so `LEGACY`);
- `legacyDigestAtSwitch` = complete marker `sourceDigest`, `markerPreparationId` = complete marker `preparationId`;
- `commitCount: 0`, `legacyUntrusted: false`, `persistGranted: null`.
The record is validated before `put`.

**Immutable after creation:** `key`, `switchId`, `switchedAt`, `legacyDigestAtSwitch`, `markerPreparationId`.

**Allowed mutations.** Each happens in a readwrite transaction that re-reads the record, requires it valid, requires `switchId` equal to the expected value, validates the new record, and changes nothing else:

| Mutation | Guard | Change |
|---|---|---|
| runtime write | `status === 'active'` | `commitCount + 1` (a result above `Number.MAX_SAFE_INTEGER` aborts the write) |
| persist result | `status === 'active'`, `persistGranted === null` | `persistGranted` becomes the resolved boolean |
| begin revert | `status === 'active'` | `status: 'reverting'` |
| revert failed, legacy byte-identical | `status === 'reverting'`, `commitCount` unchanged | `status: 'active'`, `legacyUntrusted` unchanged |
| revert failed, legacy not proven identical | `status === 'reverting'`, `commitCount` unchanged | `status: 'active'`, `legacyUntrusted: true` |
| forward build finds `reverting` | `status === 'reverting'` | `status: 'active'`, `legacyUntrusted: true` |
| revert complete | `status === 'reverting'`, `commitCount` unchanged | `status: 'reverted'` |

- `legacyUntrusted` only ever changes from `false` to `true`. `persistGranted` only ever changes from `null` to a boolean.
- **Deletion** of the record happens only in the re-adopt transaction (`active`, `commitCount === 0`, `legacyUntrusted === false`) and the reverted reset (`reverted`).

**`persist()` lifecycle.**
- Attempted at most once per boot, only while the valid record is `active` with `persistGranted === null`.
- If it resolves to a boolean, a guarded update stores it, and it is never retried afterwards (`false` is a final answer).
- If it rejects, is unavailable (no `navigator.storage.persist`) or resolves to a non-boolean, the record is left unchanged with `persistGranted: null`, and the next boot retries.
- A failure of the guarded update itself is ignored for this boot.
- The cutover never waits for, depends on or rolls back because of `persist()`.

**Malformed record.** Any read (boot, runtime write guard, revert, reset) that finds a `storageAuthorityV1` value failing this contract gives `STORAGE_UNAVAILABLE` with reason `authority-malformed`:
- no legacy writes, no repair, no reset, no re-adopt, no revert;
- rollout STOP condition;
- in a mounted tab, the write transaction aborts with no writes and the tab moves to `STORAGE_UNAVAILABLE`.

## 1b. Authority hint contract

**Exact shape.** The value stored under `majandus_storage_authority_v1` is `JSON.stringify` of an object whose key set is exactly:

```js
{ version: 1, switchId: nonEmptyString, legacyDigestAtSwitch: lowerHex64, switchedAt: strictValidIso }
```

**Classification** of a hint read:
- `absent`: `getItem` returns `null`;
- `valid`: parses and matches the exact shape;
- `malformed`: any other non-null value, including non-JSON, wrong types, extra or missing keys and `version !== 1`;
- `unreadable`: `getItem` throws.

A valid hint *matches* an authority record when `switchId`, `legacyDigestAtSwitch` and `switchedAt` are all equal.

**Hint write (gate):** `setItem(key, JSON.stringify(hintFor(record)))`, then `getItem` read-back must equal the written string exactly. A throw or mismatch is a failure.

**Hint removal:** `removeItem(key)`, then `getItem(key) === null`. A throw or non-null value is a failure.

**Behavior matrix** (authority already read successfully and valid, unless stated):

| Authority | Hint | Result |
|---|---|---|
| `active` | valid and matching | continue |
| `active` | absent, malformed, unreadable or valid but not matching | rewrite through the hint gate; failure: `AUTHORITY_HINT_PENDING` |
| `reverting` | any | forward build: set `active` + `legacyUntrusted: true`, then as `active`; revert build: resume revert (Section 6) |
| `reverted` | absent | pre-cutover flow |
| `reverted` | valid, malformed or not matching | verified hint removal, then pre-cutover flow; removal failure: `STORAGE_UNAVAILABLE` |
| `reverted` | unreadable | `STORAGE_UNAVAILABLE` |
| absent | absent | pre-cutover flow |
| absent | valid | `STORAGE_LOST` (recovery screen with `switchedAt`) |
| absent | malformed | `STORAGE_LOST` variant without a date: blocking recovery screen, never `LEGACY`; restore only on user confirmation; rollout STOP condition |
| absent | unreadable | `STORAGE_UNAVAILABLE` (retry) |
| malformed or unknown | any | `STORAGE_UNAVAILABLE` (never inspected further) |

**LEGACY write guard:** before every legacy write, a new-build `LEGACY` tab reads the hint synchronously. Any non-null value (valid or malformed), or a throwing `getItem`, refuses the write and enters `RELOAD_REQUIRED`.

## 2. Authority switch ordering (acceptance item 1)

All steps run in the boot controller before any domain hook mounts, inside `locks.request('majandus:storage-authority')` when Web Locks exist. The lock is supplemental; correctness comes from the IndexedDB transaction guards.

1. **Open and read authority.**
   - Open the database and read `meta/storageAuthorityV1`.
   - If the open rejects with `IndexedDbBlockedError`, the state is `BLOCKED`.
   - If the IndexedDB API is missing, access throws, the open fails otherwise, the `meta` read fails, or the record is malformed (Section 1a), the state is `STORAGE_UNAVAILABLE`.
   - Either way, stop here: authority is unknown, and this applies whatever the hint says.
   - Otherwise read and classify the hint, then apply the Section 1b matrix.
2. **Authority proven absent, or a valid record `reverted`: pre-cutover device.**
   1. If the record is `reverted`, run the **reverted reset**: one readwrite transaction guarded by a valid record with `status === 'reverted'` and empty `outbox`, `auth`, `syncState`, `conflicts`. It deletes every record in `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState`, both extras keys, the marker and the authority record. Hint handling per Section 1b.
   2. If no record exists and the hint is valid or malformed, the state is `STORAGE_LOST`; continue only after user confirmation (Section 3).
   3. Run `runLegacyMigration` (Task 4, unchanged, `locks` injected).
   4. On `source-changed-after-complete` with no authority record, run the **stale reset**: one readwrite transaction guarded by authority absent, marker `complete`, empty `outbox`/`auth`/`syncState`/`conflicts`. It deletes only marker-owned records, the extras named by the marker, and the marker. Never `clear()`. Then rerun migration once.
   5. Proceed only on `completed`, `already-complete`, `prepared-recovered` or `reprepared`. Every other status is `LEGACY` for this session, which is allowed because authority was proven absent in step 1.
   6. Read the three legacy keys again and compute the digest (outside any transaction).
   7. **Switch transaction** on `meta`: require the marker record to have `status === 'complete'`, a non-empty string `preparationId` and `sourceDigest === ` the step-6 digest, and require no authority record. Write the fresh authority record exactly as in Section 1a. **localStorage stops being authoritative when this transaction commits.** A failed or aborted switch transaction leaves authority proven absent, so the state is `LEGACY`.
   8. **Hint gate:** write the hint for the new record. On failure the state is `AUTHORITY_HINT_PENDING` (Section 3): IndexedDB stays authoritative, nothing mounts, and it retries until the write succeeds. Once written, broadcast `authority-changed`.
   9. **Post-switch confirmation:** read the legacy keys again and recompute the digest. If it differs from `legacyDigestAtSwitch`, apply the divergence rule immediately, before mounting hooks.
   10. Run the `persist()` lifecycle (Section 1a). Load initial domain snapshots, then mount `READY` (the connection-event subscription has been active since the replica was created; Section 5 item 4a).
3. **Valid authority `active`:**
   - Apply the hint matrix.
   - Run the divergence check (compare the current legacy digest with `legacyDigestAtSwitch`).
   - Run the `persist()` lifecycle.
   - Load snapshots, then mount `READY`.
4. **Valid authority `reverting`:** Section 1b matrix, then Section 6.

**Legacy writes after migration or switch.**

- **Before the switch commits,** legacy is authoritative. Any change makes the step-7 guard fail or migration return `source-changed-after-complete` (stale reset), so the switch always adopts the latest validated legacy state.
- **After the switch, divergence** means `legacyDigest !== legacyDigestAtSwitch`. Its sources:
  - a tab running a pre-cutover build;
  - a new-build `LEGACY` tab whose write guard had not yet seen the hint (cross-tab localStorage propagation delay, or the crash window in Section 11).
- **Resolution:**
  - **`commitCount === 0` and `legacyUntrusted === false` (re-adopt):** verified hint removal (a failure means `STORAGE_UNAVAILABLE`, retry). Then one transaction guarded by a valid record with `status === 'active'`, same `switchId`, `commitCount === 0` and `legacyUntrusted === false` deletes marker-owned records, extras, the marker and the authority record. Then rerun steps 2.3-2.10. IndexedDB held no edits, so legacy wins losslessly.
  - **`commitCount > 0` or `legacyUntrusted` (true divergence):** IndexedDB stays authoritative. The diverged legacy values stay untouched and are never adopted or merged automatically. Show the non-blocking `LEGACY_DIVERGED` notice. Adoption requires a separate design. A field occurrence is a rollout STOP condition.
- **Detection:** at every boot, on `storage` events for the three legacy keys, and on `focus`/`visibilitychange`. A mounted tab that must re-adopt moves to `RELOAD_REQUIRED`; the next boot re-adopts.
- **Hint watch in `READY`:** on a `storage` event for the hint key or `key === null` (clear), and on `focus`/`visibilitychange`, the tab re-classifies the hint. Anything other than valid and matching is rewritten through the hint gate. A failure moves the tab to `AUTHORITY_HINT_PENDING` with writes disabled.
- **Retry bound:** at most 3 switch attempts per boot. If the step-9 confirmation still diverges on the third attempt, perform the re-adopt deletion without switching again. Authority is then proven absent, so the device stays on `LEGACY` for this session, because a pre-cutover tab is actively writing legacy.
- **New-build tabs on legacy authority:** the Section 1b `LEGACY` write guard applies. They also enter `RELOAD_REQUIRED` on a hint `storage` event or an `authority-changed` broadcast.

## 3. Startup state machine

| State | Entered when | App behavior |
|---|---|---|
| `BOOTING` | app start | minimal splash; no domain hooks mounted |
| `LEGACY` | only after IndexedDB opened and the `meta` read succeeded with authority proven absent (or the reverted reset completed with the hint handled per Section 1b), and then: migration status not switchable (including `invalid-source`/`unreadable-source`), switch transaction failed, retry bound reached, or a revert completed | existing accepted localStorage repositories, plus the hint write-guard; retry at next boot |
| `READY` | valid authority `active`, hint valid and matching, snapshots loaded and valid, connection subscription active | IndexedDB repositories |
| `READY` + `LEGACY_DIVERGED` notice | true divergence (Section 2) | fully usable; non-blocking notice |
| `DOMAIN_INVALID` (per domain) | an IndexedDB record of that domain fails runtime validation on load | that domain `writable: false` with an error message (same pattern as legacy `writable: false`); other domains usable; no auto-repair |
| `AUTHORITY_HINT_PENDING` | valid authority `active` (just switched, found at boot, or while `READY`) and the hint gate fails | blocking screen for shared domains: "Seadme salvestusruum ei võtnud muudatust vastu. Proovi uuesti."; shared domains not mounted or writes disabled; automatic retry on focus plus a retry button; IndexedDB stays authoritative; never legacy |
| `BLOCKED` | authority unknown: open rejected with `IndexedDbBlockedError` (any hint) | blocking screen for shared domains: "Sulge Majanduse teised aknad ja proovi uuesti."; retry button and automatic retry on focus; Buss and device-local tabs stay usable |
| `STORAGE_UNAVAILABLE` | authority unknown: IndexedDB API missing, access or open error, `meta` read failure, malformed authority record (reason `authority-malformed`), unreadable hint where the matrix requires it, or a failed hint removal | blocking screen for shared domains with retry; never falls back to legacy; `authority-malformed` shows no retry-to-repair and is a STOP condition |
| `STORAGE_LOST` | open and `meta` read succeed, no authority record, hint valid (dated variant) or malformed (undated variant) | recovery screen: "Kohalik andmebaas puudub. Taasta andmed seisuga <switchedAt> varukoopiast?" (undated: "Taasta andmed seadme varukoopiast?"). On confirm, run steps 2.3-2.10 with a new `switchId`; the hint gate overwrites the hint. Leftover non-owned records produce `replica-not-empty`: stay on this screen and STOP condition. The malformed variant is itself a STOP condition |
| `RELOAD_REQUIRED` | replica connection event `versionchange` or `close` (Section 5 item 4a), `VersionError` (database newer than build), authority record changed under a mounted tab, or hint appears in a `LEGACY` tab | writes disabled; banner "Majandus uuenes teises aknas. Laadi leht uuesti." with reload button |
| `REVERTING` | revert build only (Section 6) | splash until the revert completes, then `LEGACY` |
| `REVERT_FAILED` | revert build only: any revert failure (Section 6) | blocking screen for shared domains: "Taastamine vanale salvestusele ebaõnnestus. Andmed on alles. Proovi uuesti."; retry re-enters `BOOTING`; IndexedDB stays authoritative and unmounted; STOP condition. The compensation-failure variant additionally has `legacyUntrusted: true` and retained backups |

- Transitions out of `BLOCKED`, `STORAGE_UNAVAILABLE`, `AUTHORITY_HINT_PENDING`, `REVERT_FAILED` and `RELOAD_REQUIRED` happen only through a reload or retry that re-enters `BOOTING` (or, for `AUTHORITY_HINT_PENDING`, a successful hint gate). No state ever writes legacy keys after the switch, except the revert export and compensation of Section 6.
- **Availability trade-off (accepted):** a device whose IndexedDB cannot be opened or read is shown `BLOCKED` or `STORAGE_UNAVAILABLE` for shared domains, even if it never switched. Legacy authority cannot be proven there, so split authority is prevented at the cost of availability. Observing this state in smoke or the field is a STOP condition.

## 4. Multi-tab, blocked open, versionchange, schema upgrades (acceptance item 3)

- Every runtime connection follows the C1 connection-event contract (Section 5 item 4a). A `versionchange` or browser-initiated `close` closes and drops the handle, reaches the controller, and moves every mounted runtime to `RELOAD_REQUIRED`.
- Blocked open leads to `BLOCKED` in every case (authority unknown), never to `LEGACY`.
- A tab whose build is older than the database version gets `VersionError`, leading to `RELOAD_REQUIRED`. It never deletes or downgrades.
- Multi-tab freshness uses `BroadcastChannel('majandus:replica')`. `{ type: 'committed', domain }` is sent after the transaction `oncomplete`; receivers re-read that domain from IndexedDB. Without `BroadcastChannel`, tabs re-read on `focus`/`visibilitychange`.
- Mutations never write from a React snapshot. Each mutation re-reads its domain inside its own readwrite transaction (Section 5), so concurrent tabs serialize through IndexedDB.
- Every runtime write transaction includes `meta`. It applies the Section 1a runtime-write mutation (valid record, `status === 'active'`, the `switchId` the tab booted with, `commitCount + 1`). A mismatched status or `switchId` aborts with no writes and leads to `RELOAD_REQUIRED`; a malformed record leads to `STORAGE_UNAVAILABLE`.
- **Future schema upgrades:** a `DB_VERSION` bump requires its own accepted plan. `upgradeSchema` branches are additive (`if (oldVersion < N)`) and never delete stores or records. Builds never lower `DB_VERSION`. Revert builds keep the highest shipped version.

## 5. Replica close race, connection events, transaction rule, payload boundary (acceptance items 3-6)

**Item 4: `createLocalReplica.close()` during an in-flight open (C1 amendment to Task 2).**
- The replica keeps a generation counter. `close()` increments it, drops `activeDb`, awaits any in-flight open (ignoring its error) and closes the resulting handle.
- An open that resolves for a stale generation closes its handle and rejects with `DOMException` name `ReplicaClosedError`. Callers of `transact` see a rejection; Task 4 maps it to `write-failed`.
- `open()` after an explicit `close()` starts a new generation (reopen stays allowed). `close()` resolves only after no handle of an older generation remains open.

**Item 4a: connection-event path (C1 amendment to Tasks 1 and 2).**
1. **`indexedDb.js`:** the signature becomes `openMajandusDb(indexedDb = globalThis.indexedDB, { onVersionChange, onClose } = {})`, and the existing default argument and blocked/late-success behavior are unchanged. On success it installs:
   - `db.onversionchange = event => { db.close(); onVersionChange?.({ oldVersion: event.oldVersion, newVersion: event.newVersion }); }` — the handle is closed first, then the callback runs;
   - `db.onclose = () => onClose?.()` for browser-initiated closes.
   With no options, behavior equals the accepted Task 1 contract (close on `versionchange`).
2. **`localReplica.js`:** `createLocalReplica({ indexedDb, clock })` gains `replica.subscribe(listener)`, which returns an idempotent `unsubscribe` function. Listeners receive exactly `{ type: 'versionchange', oldVersion, newVersion }` or `{ type: 'close' }`.
3. The replica passes generation-bound handlers to `openMajandusDb`. When the current generation's handle receives `versionchange` or `close`, the replica:
   1. drops `activeDb` (the handle is already closed by `indexedDb.js`; `close` events need no further close);
   2. enters the terminal `lost` state;
   3. calls every current listener synchronously in subscription order. A throwing listener does not stop later listeners, and the first thrown error is rethrown from a `queueMicrotask` callback after all listeners ran.
   Events from handles of a stale generation (already closed by `close()`) are ignored.
4. **In the `lost` state,** `open()` and `transact()` reject with `DOMException` name `ReplicaConnectionLostError`, and no new `indexedDb.open` call is made. An explicit `close()` on a lost replica resolves. Recovery is only a new replica created after a reload. Transactions already running on the handle finish or fail normally (`db.close()` waits for them).
5. **Controller (C4):** the boot controller subscribes to its replica immediately after creating it, before Section 2 step 1 opens the database, and keeps the subscription for the page lifetime. The listener sets runtime state `RELOAD_REQUIRED` and notifies runtime-state subscribers. A `ReplicaConnectionLostError` from any boot step (migration, reset, switch, hint gate, snapshot load, revert) also resolves to `RELOAD_REQUIRED`, never `LEGACY`. Domain repositories then reject new mutations with `ReplicaConnectionLostError` without touching IndexedDB.
6. **Runtime wiring (C6):** hooks read runtime state. `RELOAD_REQUIRED` renders the reload banner and every shared-domain write control is disabled (`writable: false`).

**Item 5: transaction-body async invariant.**
- Runtime domain code never calls `replica.transact` or `runTransaction` directly. It uses one helper, `runReplicaMutation({ replica, authority, domain, stores, read, plan })`:
  1. **Read phase:** `read(stores)` may await only `requestResult` promises of requests issued on this transaction's stores.
  2. **Plan phase:** `plan(snapshot)` is synchronous and pure. If it returns a thenable, the helper throws `TypeError` before any write, and the transaction aborts.
  3. **Validate phase:** every planned record passes the item-6 validators synchronously.
  4. **Write phase:** all `put`/`delete` requests, plus the authority `commitCount` increment, are issued synchronously in one block with no awaits in between.
- Inside a body: no timers, `fetch`, `crypto.subtle`, locks, `BroadcastChannel`, other transactions or caller-supplied async callbacks. Digests and all other async work happen outside the transaction.
- **Enforcement:**
  - A source guard allows `transact`/`runTransaction` calls only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and `src/storage/storageAuthority.js`.
  - A Chromium test shows a thenable-returning plan writes nothing.
  - A Chromium test shows a timer await inside a raw body raises `TransactionInactiveError` before any write request is issued under the read-then-write discipline.

**Item 6: payload validation boundary.**
- Domain semantics are never re-implemented. The IndexedDB repositories run the existing accepted domain code synchronously inside `plan`, against an in-memory single-key `getItem`/`setItem` adapter:
  - **Calendar:** `createEventRepository(memoryStorage, newId)` over the raw envelope rebuilt from `calendarEvents` (canonical id order), `wasteState` and `calendarLegacyEnvelopeExtras`. Its `create`/`update`/`remove`/`importWaste` output becomes record puts and deletes.
    - Envelope fields other than `events` and `wasteImports` must be unchanged, or the plan throws.
    - With no calendar extras record, the rebuilt envelope is `{ version: 1, events, wasteImports? }` and runtime writes create no extras record.
    - A `wasteState` record exists exactly when the repository output defines `wasteImports`.
  - **Household:** `createHouseholdRepository(memoryStorage).save`, the same way.
  - **Places:** the neutral pure module `src/places/savedPlaces.js` extracted in C2 (`SAVED_PLACE_DEFAULTS`, `normalizePlace`, `normalizePlaces`), which is the same code `useSavedPlaces.js` and `useSettings.js` run.
    - `update(idx)` keeps the id at `idx`.
    - `add` appends a new id.
    - `remove(idx)` deletes that id and re-orders the rest with ids preserved.
    - Padded default entries become real records with new ids when a save persists the padded list, matching the legacy save of the padded array.
- Before any write, `validateRuntimeRecord(store, record)` (new `src/storage/runtimeRecords.js`) runs the Task 2 envelope validator plus the domain validator:
  - calendar: `validateEvent(payload)` deep-equals `payload` and `payload.id === record.id`;
  - waste: `validateImportHistory(payload.wasteImports)`;
  - household: a save through `createHouseholdRepository` on an in-memory adapter holding `{ version: 1, profile: payload }` (with `serverHouseholdId` removed) returns an equal profile, and `serverHouseholdId === null`;
  - places: `normalizePlace(payload, record.order)` from `src/places/savedPlaces.js` deep-equals `payload`, and orders are the contiguous integers `0..n-1`.
- No storage module imports a React hook. Every record also has `syncStatus: 'local'`, `revision: 0` and `deletedAt: null`.
- The same validators run on every load, producing `DOMAIN_INVALID` on failure. A failed validation aborts the whole transaction.

## 6. Fallback, rollback, quota and eviction

- **Fallback before the switch:** only when authority is proven absent. Migration failure, switch-transaction failure or a quota failure during migration or switch keeps `LEGACY` (accepted runtime) and retries at the next boot. Legacy stays authoritative and untouched. An open or read failure, or a malformed record, is never a fallback: it is `BLOCKED` or `STORAGE_UNAVAILABLE`.
- **After the switch there is no fallback to legacy writes.** Failures surface as `AUTHORITY_HINT_PENDING`, `BLOCKED`, `STORAGE_UNAVAILABLE`, `DOMAIN_INVALID` or `RELOAD_REQUIRED`.
- **Quota:** a runtime write that fails with `QuotaExceededError` (or any error) aborts atomically. The mutation promise rejects, the UI keeps the previous snapshot and shows "Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti." (existing copy). Places errors, previously swallowed, now surface the same message. A hint-write failure after the switch is `AUTHORITY_HINT_PENDING`, never `READY`.
- **Eviction:** Chromium evicts an origin's localStorage and IndexedDB together, so the switch does not increase eviction exposure. `persist()` follows the Section 1a lifecycle. Loss of IndexedDB alone is detected by the hint (`STORAGE_LOST`, guaranteed present while `READY` because of the hint gate) and recovered only with user confirmation from the frozen legacy snapshot.

### 6a. Revert export: authoritative semantic state for all three domains

Rollback is only through a revert build: the same forward code built with `VITE_STORAGE_AUTHORITY_MODE=revert` (an undefined mode means forward). The export always writes all three shared legacy keys from the current IndexedDB semantic state. A frozen legacy value is never left in place because a domain is empty.

- **Calendar**, always written as `JSON.stringify` of a valid envelope:
  - `version`: the calendar extras `sourceVersion`, or `1` with no extras record;
  - the extras `fields` (if any);
  - `events`: all `calendarEvents` payloads in canonical id order, possibly `[]`;
  - `wasteImports`: the `wasteState` payload's `wasteImports` when a waste record exists, otherwise omitted;
  - key order unspecified.
- **Household**, always written:
  - with a record: `{ ...extras.fields, version: extras ? extras.sourceVersion : 1, profile }`, where `profile` is the payload without `serverHouseholdId`;
  - with no record: the accepted legacy default semantic state `{ ...extras.fields, version: extras ? extras.sourceVersion : 1, profile: { name: '', address: '' } }` (what the legacy repository loads for an absent key), never the frozen old profile.
- **Places**, always written: `JSON.stringify(normalizePlaces(payloads))` over the `sharedPlaces` payloads in `order`, using `src/places/savedPlaces.js`. Zero records therefore export the legacy default three-place view.
- **Verification** reads back all three keys:
  - calendar: `createEventRepository(storage).load()` is `writable`, its events equal the IndexedDB payloads as an id-keyed set with no extra ids, `wasteImports` deep-equals (or both are undefined), and extra envelope fields equal;
  - household: `createHouseholdRepository(storage).load()` is `writable`, its profile equals the expected profile (record or default), and extra fields equal;
  - places: `normalizePlaces(JSON.parse(raw))` deep-equals the expected list.

### 6b. Revert backups

Backups are write-once per revert attempt, so no attempt can overwrite the originals captured by an earlier attempt.

- **Attempt id:** each backup creation uses a fresh `attemptId` from the injected `newId()`.
- **Backup keys:** `majandus_legacy_backup_v1_<switchId>_<attemptId>_calendar`, `..._household`, `..._places`.
- **Value** of each: `JSON.stringify({ version: 1, legacyKey, raw })`, where `legacyKey` is the exact shared legacy key and `raw` is the exact previous `getItem` result, preserved as a string or `null` (absent).
- **A backup is valid** when it parses to exactly these three keys, `version === 1`, `legacyKey` matches its slot, and `raw` is a string or `null`.
- **Current-attempt pointer:** key `majandus_legacy_backup_v1_<switchId>_current` holds `JSON.stringify({ version: 1, switchId, attemptId })` (exact key set). It is valid only when it matches that shape and the record's `switchId`, and all three backups it names exist and are valid.
- **Creation:**
  1. Read the three originals. A throw aborts.
  2. Write all three backups under a new `attemptId`.
  3. Read each back: the stored string must equal the written string exactly, and the parsed `raw` must be `===` the original.
  4. Write the pointer, then read it back for exact equality.
  5. Only after the pointer verifies may any shared legacy key change.
- **On creation failure** (any throw or mismatch): no shared legacy key has been touched. Backup keys of this attempt are left in place (not shared keys, never reused). The status returns `active` with `legacyUntrusted` unchanged. The state is `REVERT_FAILED`.
- **Fresh attempt from `active`:** first do a verified removal of the pointer key (a non-shared key; `removeItem` then `getItem === null`), and only then move the status to `reverting`. A removal failure means `REVERT_FAILED` with nothing changed. So while the status is `reverting`, any pointer present was created by the current attempt.
- **Resume** (the revert build boots and finds `reverting`):
  - A valid pointer means export may already have started, so the pointed backup set is the originals. Nothing is rewritten.
  - An absent or invalid pointer means export cannot have started (export requires a verified pointer), so the shared keys are untouched. Creation runs with a new `attemptId` from the current values.
- **Retention:** backup sets and pointers are never deleted by this plan (except the pointer removal at the start of a fresh attempt). They stay until a separate cleanup plan. Each attempt adds one set; the quota cost is three copies of the shared data per attempt.

### 6c. Revert procedure and compensation

For each device at boot, in the revert build, under the lock:

1. Open and read authority as in Section 2 step 1. Unknown or malformed authority is `BLOCKED`/`STORAGE_UNAVAILABLE`.
   - If there is no record, or a valid record `reverted`: handle the hint per Section 1b (verified removal of any non-null hint; removal failure is `STORAGE_UNAVAILABLE`), then `LEGACY`.
   - A record absent while the hint is non-null means IndexedDB was lost; the revert build deliberately uses the frozen legacy snapshot, because no IndexedDB data remains to export.
2. If the record is `active`: verified pointer removal (Section 6b), then a guarded mutation to `reverting`, recording `commitCount` (Section 1a). Forward tabs' writes now abort. If it is already `reverting`: resume.
3. Read and validate all three domain snapshots. On failure: when resuming with a valid pointer (export may have started), run compensation (step 8); otherwise `active` with `legacyUntrusted` unchanged, and `REVERT_FAILED`.
4. Backups per Section 6b.
5. Export per Section 6a: write the calendar, household and places keys with `setItem`. Export never calls `removeItem`.
6. Verify per Section 6a.
7. On success: guarded mutation `reverting` to `reverted` (`commitCount` unchanged). Verified hint removal (a failure is `STORAGE_UNAVAILABLE`; the next boot sees `reverted` and retries the removal). Then `LEGACY`.
8. **Compensation**, on any failure after the first export `setItem` was attempted (a throw in step 5, a verification mismatch in step 6, or a failed `reverted` transaction in step 7):
   - For each of the three shared keys, restore the original raw from the backup set named by the verified pointer: an original string gets `setItem(legacyKey, originalRaw)`; an original `null` gets `removeItem(legacyKey)`. This `removeItem` is the only allowed deletion of a shared legacy key, and only to restore a previously absent key during failed-revert compensation.
   - Verify byte-for-byte: `getItem(legacyKey) === originalRaw` for all three (`null` for originally absent keys).
   - **Compensation verified:** guarded mutation `reverting` to `active` with `legacyUntrusted` unchanged (legacy is byte-identical to before), keep the backups, `REVERT_FAILED`.
   - **Compensation failed** (any throw or mismatch): never `LEGACY`. Guarded mutation `reverting` to `active` with `legacyUntrusted: true`, keep the backups, `REVERT_FAILED` (compensation-failure variant), rollout STOP.
   - If that final guarded mutation itself fails, the record stays `reverting`, and the next boot resumes (Section 6b) with the backups as originals.
9. A forward build that finds `reverting` sets `active` with `legacyUntrusted: true` (Section 1a) and never touches legacy keys or backups.

- The IndexedDB data is never deleted by a revert. Re-forward after a revert uses the reverted reset (Section 2 step 2.1).
- **Forbidden:** deploying any pre-cutover build (without the controller) to an origin where any device may have switched.

## 7. Implementation phases (locked; each needs its own scope-open commit)

| Phase | Purpose | Exact files | Runtime behavior change |
|---|---|---|---|
| C1 | Phase A amendments: close/open race and the Section 5 item 4a connection-event contract | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` | none (dormant) |
| C2 | Prerequisite: behavior-preserving extraction of saved-place defaults and normalization into one neutral pure module | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (keeps its `DEFAULT_PLACES` export as a re-export), new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle only), `src/storage/legacyMigration.js` (comment-only update of its mirror reference; no code change) | none (behavior-preserving) |
| C3 | Runtime record validators and mutation helper (items 5, 6) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, both storage tests | none (dormant) |
| C4 | Authority controller: Sections 1a and 1b contracts, state machine, hint gate, switch, resets, re-adopt, divergence, `STORAGE_LOST`, revert export, backups and compensation, connection-event subscription | new `src/storage/storageAuthority.js`, both storage tests | none (dormant) |
| C5 | IndexedDB domain repositories (rollout order: household, then places, then calendar with waste) | new `src/storage/replicaRepositories.js`, both storage tests | none (dormant) |
| C6 | Runtime wiring (the cutover) | `src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (remove the places writer), `src/components/SeadedTab.jsx` (remove the places fallback), `src/components/EventDialog.jsx`, `src/components/HouseholdSettings.jsx`, `src/components/WasteSettings.jsx` (await async mutators), new `src/components/StorageStatus.jsx`, `src/design/shell.css`, `scripts/shell/app-shell.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/waste/browser-cases.mjs`, both storage tests (the Task 6 dormant guard becomes an allowlist guard) | yes; desktop human smoke required |
| C7 | Preview deploy and Android/PWA human gate, including the rollback drill | deploy configuration only as separately authorized; no source change | preview origin only |
| C8 | Production deploy | separate deploy gate | production |

- **Ordering:** C3 depends on C2, because `runtimeRecords.js` imports `src/places/savedPlaces.js`. C3 must not open before C2 is committed and accepted.
- **C2 scope:**
  - `savedPlaces.js` contains exactly the current `DEFAULTS`, `normalizePlace` and `normalizePlaces` logic, byte-for-byte equivalent in behavior.
  - The hooks keep their load, save, error-swallowing, padding and `resolveAddress` behavior.
  - `legacyMigration.js` keeps its accepted Task 3 mirror unchanged in code.
- **C2 characterization before extraction:** golden tables for `normalizePlace` (every `PLACE_GOLDEN` class) and `normalizePlaces` (non-array, empty, 1, 3 and 5 items, padding) are captured from the current source of both hooks. The Task 3 parity oracle now imports the neutral module instead of slicing hook source text.
- **C2 guard:** both hooks import the module and define no local `normalizePlace`/`normalizePlaces`/defaults. The module imports nothing from React or `src/storage/`. The fail-fast sweep and app-shell suite pass.
- C1-C5 keep the Task 6 guards green: nothing outside `src/storage/` imports storage until C6.
- Every `src/storage/` module receives browser capabilities by injection (`indexedDb`, `storage`, `locks`, `broadcast`, `persist`, `cryptoApi`, `clock`, `newId`, `mode`). The Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force for every storage module. C3-C5 only extend its exact module and import lists (adding `../places/savedPlaces.js`, `../calendar/eventModel.js`, `../waste/reconcile.js`). Globals are read only in `src/main.jsx` from C6 on.
- In C6, the only allowed runtime importers of `src/storage/` are `src/main.jsx`, `src/App.jsx` and the three domain hooks.
- Legacy repositories stay in the codebase for `LEGACY` mode and revert.

## 8. Automated acceptance tests (minimum, cumulative)

- **C1:**
  - **Close race:** stub-controlled open, then `close()` before success: handle closed, `ReplicaClosedError`, reopen works.
  - **Connection events (stub `indexedDb`):**
    - `versionchange` closes the handle before the listener runs;
    - the listener gets exactly `{ type: 'versionchange', oldVersion, newVersion }`;
    - `activeDb` is dropped, and later `open`/`transact` reject with `ReplicaConnectionLostError` with zero further `indexedDb.open` calls;
    - `onclose` delivers `{ type: 'close' }` with the same lost behavior;
    - listeners run in subscription order, and a throwing listener does not block later ones (its error is rethrown in a microtask);
    - `unsubscribe` is idempotent and stops delivery;
    - events from a stale generation after `close()` are not delivered;
    - `openMajandusDb` without options keeps the Task 1 close-on-`versionchange` behavior.
  - **Chromium:**
    - with replica A subscribed, a second connection opening `DB_VERSION + 1` makes A's listener fire once, A's handle close (the upgrade completes without `blocked`), and A's `transact` reject with `ReplicaConnectionLostError`;
    - `deleteDatabase` delivers `newVersion: null` and completes.
  - Task 1-6 suites stay green.
- **C2:** the golden characterization tables pass against the current hooks before extraction and against the neutral module after it; Task 3 parity passes against the module; the C2 import guard; fail-fast sweep and build.
- **C3:**
  - every validator accepts accepted domain output and rejects each invalid payload class (places validation proven against `src/places/savedPlaces.js`);
  - a thenable-returning plan writes nothing;
  - a validation failure aborts every write;
  - `commitCount` increments exactly once per committed mutation;
  - a mismatched `switchId`/status aborts;
  - a malformed authority record aborts with `STORAGE_UNAVAILABLE`;
  - the timer-await hazard test (Section 5).
- **C4 (Chromium plus stubs):** every Section 3 state and transition, plus:
  - **Authority contract (1a):**
    - a fresh switch writes exactly the 9 fields with the specified values;
    - each malformed class leads to `STORAGE_UNAVAILABLE`/`authority-malformed` at boot, in a runtime write and in revert, with zero legacy writes and no reset or repair: extra key, missing key, wrong `status`, empty `switchId`, invalid `switchedAt`, uppercase or short digest, negative or non-integer `commitCount`, non-boolean `legacyUntrusted`, `persistGranted` not null/boolean;
    - an invalid `now()` prevents the switch (`LEGACY`);
    - immutable fields never change across every mutation;
    - `legacyUntrusted` and `persistGranted` only move forward.
  - **`persist()`:**
    - resolves `true`/`false`: stored, and not retried at the next boot;
    - rejects, is unavailable or resolves to a non-boolean: `persistGranted` stays `null`, the next boot retries, and the switch is unaffected.
  - **Hint contract (1b):** every matrix row, including:
    - a malformed hint with no authority leads to the undated `STORAGE_LOST` (never `LEGACY`);
    - an unreadable hint with no authority leads to `STORAGE_UNAVAILABLE`;
    - an active authority with an absent, malformed or mismatched hint is rewritten;
    - a `reverted` record with a malformed hint gets verified removal;
    - the `LEGACY` write guard refuses on a malformed non-null hint and on a throwing `getItem`.
  - **Switch:**
    - switch success;
    - a legacy write between migration and switch leads to the stale reset, then the latest state is adopted.
  - **Unknown authority:** a blocked open is `BLOCKED` and any other open, API or `meta` read failure is `STORAGE_UNAVAILABLE`, each with the hint absent, valid and malformed, never `LEGACY`, and with zero legacy writes.
  - **Hint gate:**
    - a hint-write failure right after the switch, at boot with authority `active` and hint absent, and while `READY` after a hint clear event, each leads to `AUTHORITY_HINT_PENDING` with no domain mounted or writes disabled and no legacy write;
    - a retry success leads to `READY`;
    - a read-back mismatch counts as failure.
  - **Divergence:** post-switch divergence with `commitCount` 0 re-adopts; with a positive `commitCount` it notifies and leaves legacy bytes unchanged; a failed hint removal during re-adopt leads to `STORAGE_UNAVAILABLE`.
  - **Crash points:** after steps 2.7 and 2.8 and inside re-adopt, simulated by aborting the controller between steps, the next boot converges.
  - **Storage loss:** `STORAGE_LOST` restore.
  - **Concurrency:** two concurrent boots produce exactly one switch.
  - **Connection events:** a `versionchange` delivered through the replica subscription moves the controller to `RELOAD_REQUIRED` and repositories reject new mutations, both while mounted and when injected during migration, switch, hint gate, snapshot load and revert (never `LEGACY`).
  - **Revert export (6a):**
    - legacy contains event A, then cutover, then event A is deleted in IndexedDB, then revert: `createEventRepository(localStorage).load()` contains no event A;
    - all events deleted: calendar exported with `events: []`, extras preserved, no frozen events resurrected;
    - no household record (household originally absent at switch, and separately a household present at switch with the IndexedDB record removed by test injection): exported default profile, loaded profile `{ name: '', address: '' }`, no frozen profile;
    - zero place records and a changed place list: exported places load equal to the legacy default view and to the current ordered list respectively, matching `useSavedPlaces` load parity;
    - `wasteImports` present and absent both round-trip;
    - verification catches an injected wrong export.
  - **Backups (6b):**
    - each backup preserves a string raw and an absent `null` raw exactly;
    - a failure on the first, second or third backup write, a read-back mismatch, or a pointer write or read-back failure, each leaves all three shared keys byte-identical and gives `REVERT_FAILED` with `legacyUntrusted` unchanged;
    - resume with a valid pointer uses the pointed set as originals without rewriting;
    - resume with an absent or invalid pointer creates a new set under a new `attemptId` from current values;
    - a second attempt after a compensated first attempt removes the pointer, creates a new set, and leaves the first attempt's set byte-identical;
    - a pointer-removal failure at the start of a fresh attempt gives `REVERT_FAILED` with the status still `active`.
  - **Compensation (6c):**
    - an originally absent calendar key plus a forced export failure after its `setItem`: compensation `removeItem` restores absence (`getItem === null`), the other keys are byte-identical, the status is `active` with `legacyUntrusted` unchanged, backups are retained, and the state is `REVERT_FAILED`;
    - a forced verification failure and a forced `reverted`-transaction failure both compensate;
    - a forced compensation failure (a `setItem` or `removeItem` throw, or read-back mismatch) never gives `LEGACY` and leaves the status `active` with `legacyUntrusted: true`, backups retained, `REVERT_FAILED`;
    - a forward build seeing `reverting` sets `legacyUntrusted: true` and writes no legacy or backup key;
    - revert success then re-forward after `reverted`.
  - **Invariants:** legacy key bytes never change in any forward path; private keys are never read; no `removeItem` on a shared legacy key outside compensation (source guard plus spy storage).
- **C5:** for every domain operation, the IndexedDB repository result equals the legacy repository result on the same starting state, with events compared as id-keyed sets. The parity table covers calendar create/update occurrence and series/remove/importWaste, household save, and places update/add/remove with padding. IDs are stable; quota failure injection leaves the previous state; two-tab concurrent mutations both persist.
- **C6:**
  - app-shell, calendar, waste and reminder browser suites pass in both `LEGACY` and `READY` modes;
  - boot from a real seeded legacy profile switches and shows identical UI data;
  - reload persistence;
  - with the app mounted `READY` in Chromium, a second connection triggering `versionchange` shows the reload banner and disables every shared-domain save control;
  - a hint-write failure injected at boot shows the `AUTHORITY_HINT_PENDING` screen;
  - a malformed authority record shows `STORAGE_UNAVAILABLE`;
  - the storage allowlist guard, and a bundle check that `src/storage/` is present only via the allowed importers;
  - the full fail-fast sweep, `npm run build`, `git diff --check`.

## 9. Human smoke gates

- **C6 desktop smoke:** a human performs the C6 checks on desktop Chrome: existing data appears after the switch; create, edit and delete in every domain; reload; two tabs; an update in a second tab shows the reload banner; `KalenderTab` legend categories acceptable.
- **C7 Android/PWA gate (acceptance item 2, mandatory; stays PENDING until the human confirms):**
  1. Use one fixed Cloudflare Pages branch alias URL, because localStorage is per origin. Deploy the current accepted legacy build there. Install it as a PWA on a real Android phone (Chrome stable). Create real data: recurring and one-off events, a waste import, household profile, at least 3 places with one removed and re-added.
  2. Deploy the C6 build to the same alias. Open the installed PWA and let it update. Verify every item is unchanged, including place order, and that reminders still fire.
  3. Create, edit and delete in every domain. Force-stop the app, reopen, confirm persistence. Reboot the phone, confirm persistence. Repeat in airplane mode.
  4. Open the alias in a Chrome tab alongside the PWA, edit in one, and confirm the other shows it after focus.
  5. Deploy a new build while the PWA is open, and confirm `RELOAD_REQUIRED` or a clean reload with no data loss.
  6. Via `chrome://inspect` remote DevTools: simulate a small custom storage quota, attempt a save, and confirm the error message with the previous data intact; delete the IndexedDB database only, reload, confirm the `STORAGE_LOST` screen, restore, and confirm data equals the switch-time snapshot; record `navigator.storage.persisted()` and the stored `persistGranted`.
  7. Rollback drill: before reverting, delete one event that existed before the switch. Deploy the revert build to the alias. Confirm the data under `LEGACY` equals the pre-revert IndexedDB state, including that the deleted event stays deleted, and that backup keys exist. Then redeploy forward and confirm it converges.
- **C8 production** requires the C7 gate PASS recorded by the human and a separate deploy scope.

## 10. STOP and rollback conditions

STOP the rollout (no further phase or deploy, and investigate) on any of:
- a Task 1-6 regression or a failed accepted suite;
- any C2 characterization difference;
- any forward path writing legacy keys;
- any shared legacy key deletion outside failed-revert compensation;
- any mismatch between a migrated and a legacy view;
- `LEGACY_DIVERGED` observed in smoke or reported from the field;
- `replica-not-empty`, `DOMAIN_INVALID`, `STORAGE_LOST` (either variant), `STORAGE_UNAVAILABLE` (any reason, `authority-malformed` always), `BLOCKED`, `AUTHORITY_HINT_PENDING` or `REVERT_FAILED` observed without a deliberate trigger;
- a quota or eviction test losing previously saved data;
- revert verification failure or any revert resurrecting deleted data;
- `TransactionInactiveError` in any runtime path;
- a human smoke FAIL.

Deploy the revert build (never a pre-cutover build) when production shows data loss, a wrong-data display, repeated `BLOCKED`/`STORAGE_UNAVAILABLE`/`AUTHORITY_HINT_PENDING` states, or an unrecoverable `DOMAIN_INVALID`. The revert must be confirmed by the rollback-drill checklist before a new forward attempt.

## 11. Falsification review (post-amendment result: PASS)

Each attack was traced against Sections 1-10 and the unchanged Task 1-6 contracts. The first eight rows were re-run specifically for amendment 2.

| Attack | Result |
|---|---|
| Malformed authority | Exact 9-key contract. Any malformed value is `STORAGE_UNAVAILABLE`/`authority-malformed` at every read site (boot, runtime write, revert, reset), with no legacy write, repair, reset, re-adopt or revert, plus a STOP |
| Malformed hint | Classified `absent`/`valid`/`malformed`/`unreadable`. With authority active any non-matching hint is rewritten through the gate. With authority absent a malformed hint is the undated `STORAGE_LOST` (blocking, consent-only restore), never `LEGACY`, and an unreadable hint is `STORAGE_UNAVAILABLE`. The `LEGACY` write guard refuses on any non-null or unreadable hint |
| Authority-field durability | All fields written explicitly at switch and validated before `put`. Immutable fields fixed. Every mutation is a guarded re-read, validate and single-field change. `legacyUntrusted` and `persistGranted` only move forward. `persist()` failure never alters authority, and `null` retries per boot |
| Empty-domain rollback | Export always writes all three keys from current semantic state: calendar `events` may be `[]`, household absent exports the legacy default profile, zero places export the legacy default view. Frozen keys are never left in place |
| Deleted-data resurrection | Deleted IndexedDB events are absent from the exported envelope; verification compares id-keyed sets with no extra ids. There is an explicit event-A acceptance test and a C7 drill step |
| Partial backup | All three backups plus the attempt pointer are written and read-back-verified before the first shared-key `setItem`. Any failure leaves shared keys byte-identical, with `legacyUntrusted` unchanged. Backup sets are write-once per `attemptId`, so a later attempt never overwrites earlier originals (including preserved divergent legacy edits). The pointer is removed before `reverting` is set, so under `reverting` a valid pointer always belongs to the current attempt: a valid pointer means export may have started and its set is the originals; an absent or invalid pointer means export cannot have started |
| Failed export | Compensation restores originals from the backup set named by the verified pointer (also when snapshot validation fails on resume after export may have started), then byte-for-byte verification, then `active` with trust unchanged and `REVERT_FAILED`. A failed final transaction leaves `reverting` for resume |
| Absent-key compensation | An originally `null` raw is restored with `removeItem`, the single allowed shared-key deletion, verified by `getItem === null`. A compensation failure is never `LEGACY`: `active` with `legacyUntrusted: true`, backups retained, STOP |
| C2/C3 dependency ordering | `runtimeRecords.js` (C3) imports the neutral module created in C2; C3 cannot open before C2 is accepted; no storage module imports a React hook; the Task 3 mirror is untouched in code with its parity oracle on the module |
| Unknown authority | `LEGACY` requires a successful open, a `meta` read and a valid record proving absence or `reverted`. Blocked is `BLOCKED`; every other failure or malformed record is `STORAGE_UNAVAILABLE`, independent of the hint |
| Hint write failure | `READY` requires a valid matching hint. A gate failure at switch, at boot or while `READY` is `AUTHORITY_HINT_PENDING`, never legacy |
| Versionchange propagation | `indexedDb.js` closes and calls back; the replica drops the handle, enters `lost` and notifies; the controller, subscribed from replica creation, sets `RELOAD_REQUIRED` for any boot step or mounted state; repositories reject and hooks disable writes |
| Split authority | One valid authority record, switched transactionally. Unknown or malformed authority is never `LEGACY`. The hint is guaranteed while `READY`. The `LEGACY` guard refuses on any non-null hint. Pre-cutover tabs, propagation delay and the crash window are caught by divergence detection |
| Data loss on switch | Switch adopts only verified complete-marker data equal to the digest read immediately before the switch; legacy stays frozen |
| Partial migration or switch | Task 4 atomic preparation; switch requires `complete`; a crash at any step converges at next boot |
| Multi-tab races | IndexedDB serializes readwrite transactions; mutations re-read inside the transaction; the guarded `switchId`/`status`/`commitCount` check catches re-adopt or revert under a live tab |
| Quota or storage loss | Atomic abort with visible error. Eviction is no worse than today. IndexedDB-only loss is detected by the guaranteed hint and recovered with consent |
| Invalid payload writes | The domain repositories are the only payload producers. Validators run before every write and after every read |
| Transaction auto-commit | Structural read, sync plan, validate, write discipline; thenable plans rejected; direct `transact` confined to four files |

Residual and accepted:
- **Crash window between the switch commit (2.7) and the hint write (2.8):** only a crash in this window matters, not a persistent hint failure (that is `AUTHORITY_HINT_PENDING`).
  - Until the next boot, a pre-cutover build tab or an already-running new-build `LEGACY` tab can still write legacy. The next boot rewrites the hint through the gate and detects those writes as divergence. With `commitCount` 0, which is guaranteed because nothing mounted `READY`, they are re-adopted losslessly.
  - If IndexedDB alone is also lost inside that window, the next boot sees authority absent with no hint and migrates the current legacy state. No IndexedDB edits can be lost, because none were possible.
- **Edits in a pre-cutover build tab after IndexedDB already holds edits** are preserved but not adopted (notice plus STOP condition).
- **Availability trade-off:** devices whose IndexedDB cannot be opened or read cannot use shared domains (Section 3; STOP condition if observed).
- **Cosmetic:** the `KalenderTab` legend category order may differ after the switch, because canonical event order replaces insertion order.

## 12. Amendment record

**Amendment 1** (baseline `fac198747186e5307914b5567c7cd7b523991b3c`, independent fresh review AMEND):
- **A. Saved-place validator ordering:** new prerequisite phase C2 extracts the neutral pure module `src/places/savedPlaces.js` used by both hooks and the validators, with characterization tests. Later phases renumbered C3-C8.
- **B. Unknown authority:** `LEGACY` only after a successful open and `meta` read proving absent or reverted authority. Blocked is `BLOCKED`; any other open or read failure is `STORAGE_UNAVAILABLE`, regardless of the hint.
- **C. Hint write as `READY` gate:** new state `AUTHORITY_HINT_PENDING`; only the crash window between the authority commit and the hint write remains as a residual.
- **D. Versionchange propagation:** exact C1 contract with C1, C4 and C6 tests; the controller subscribes from replica creation.

**Amendment 2** (baseline `d7a5bbbc7d5870a92a7e2a954c7aca0cd23ff4e8`, independent fresh review AMEND):
- **A. Authority and hint records locked exactly (Sections 1a, 1b):**
  - 9-field authority contract with explicit fresh-switch values, immutable fields, guarded mutations and the `persist()` lifecycle (per-boot retry only while `null`);
  - malformed authority is `STORAGE_UNAVAILABLE`/`authority-malformed` with no repair and a STOP;
  - exact hint schema with classification and matrix; a malformed hint without authority is the undated `STORAGE_LOST`, never `LEGACY`; the `LEGACY` write guard refuses on any non-null hint.
- **B. Authoritative empty-state export (Section 6a):** all three keys always exported from the current semantic state (empty calendar `events: []`, default household profile, default places view); canonical calendar id order; event-A deletion acceptance test.
- **C. Backups and compensation (Sections 6b, 6c):**
  - exact backup representation `{ version: 1, legacyKey, raw: string|null }`, write-once per `attemptId`, with all three plus a verified current-attempt pointer before any shared-key change, and resume rules;
  - compensation restores originals byte-for-byte, using `removeItem` only to restore an originally absent key;
  - a compensation failure is never `LEGACY` (`active` with `legacyUntrusted: true`, backups retained, `REVERT_FAILED`, STOP);
  - new state `REVERT_FAILED`.
