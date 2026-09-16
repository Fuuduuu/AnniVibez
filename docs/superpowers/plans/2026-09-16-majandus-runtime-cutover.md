# Majandus Runtime Cutover Plan (localStorage -> IndexedDB)

Status: LOCKED PLAN, AMENDED once after an independent fresh review returned AMEND (amendments A-D, Section 12). A post-amendment falsification review by the plan author returned PASS. A fresh independent review of this amended plan is still required. It authorizes no runtime code. Each implementation phase below opens only through its own separate scope-open commit after human acceptance of this plan.

**Goal:** Make the accepted Phase A IndexedDB replica the runtime authority for the three shared household domains without data loss, split authority or an unrecoverable rollback.

**Inherits unchanged:** `docs/COMMON_BACKEND_ARCHITECTURE_V1.md` and the accepted Phase A Task 1-6 contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md`. The only Phase A amendments are the ones named in C1 and C2 below.

**Out of scope:** D1, backend, network calls, authentication, sync, outbox mutations and outbox UI, legacy cleanup or deletion, schema version bumps, new object stores, dependency changes.

## 1. Cutover model

- **Scope of the switch.** Calendar events with waste imports (`majamajandus_household_events_v1`), household profile (`majamajandus_household_profile_v1`) and saved places (`sade_saved_places`) switch together, per device, in one atomic authority switch. A per-domain switch is forbidden: the Task 4 marker and digest cover all three sources, so a partial switch would leave the marker permanently stale. Rollout by domain applies to implementation order (Section 7), not to authority.
- **Device-local data stays in localStorage:** diary, reminder preferences and delivery, saved ideas and tips, `sade_profile`.
- **Authority record (single source of truth):** IndexedDB `meta` record `storageAuthorityV1`:
  `{ key, status: 'active'|'reverting'|'reverted', switchId, switchedAt, legacyDigestAtSwitch, markerPreparationId, commitCount, legacyUntrusted, persistGranted }`.
  IndexedDB is authoritative exactly while this record exists with `status` `active` or `reverting`.
- **Authority knowledge requires a successful open.** Authority is *proven absent* only when IndexedDB opens and the `meta` read succeeds and shows no record (or a record `reverted`). If the database cannot be opened or read, authority is *unknown*. Unknown authority never leads to `LEGACY`, whatever the hint says (Section 3).
- **Authority hint:** localStorage key `majandus_storage_authority_v1` = `{ version: 1, switchId, legacyDigestAtSwitch, switchedAt }`. The hint never grants authority, and its absence never proves legacy authority. It exists to detect loss of the IndexedDB database (`STORAGE_LOST`) and to stop legacy writes in tabs running the new build. While IndexedDB is authoritative, a verified hint is a precondition for `READY` (Section 2).
- **Legacy rollback material:** after the switch, the three legacy keys are frozen. No forward build writes them. They are retained until a separate accepted cleanup plan; no phase in this plan deletes them.
- **Deletion:** runtime records are `syncStatus: 'local'`, `revision: 0` and never uploaded, so they are hard-deleted. Tombstones belong to the future sync phase.
- **Hint write:** `setItem` of the hint JSON followed by `getItem` read-back equality. A throw or mismatch is a hint-write failure. **Hint removal:** `removeItem` followed by `getItem() === null`.

## 2. Authority switch ordering (acceptance item 1)

All steps run in the boot controller before any domain hook mounts, inside `locks.request('majandus:storage-authority')` when Web Locks exist. The lock is supplemental; correctness comes from the IndexedDB transaction guards.

1. Open the database and read `meta/storageAuthorityV1`. If the open rejects with `IndexedDbBlockedError`, the state is `BLOCKED`. If the IndexedDB API is missing, access throws, the open fails otherwise, or the `meta` read fails, the state is `STORAGE_UNAVAILABLE`. Either way, stop here: authority is unknown, and this applies whether or not the hint exists. Otherwise read the hint.
2. **Authority proven absent, or record `reverted`: pre-cutover device.**
   1. If the record is `reverted`, run the **reverted reset**: one readwrite transaction guarded by `status === 'reverted'` and empty `outbox`, `auth`, `syncState`, `conflicts`. It deletes every record in `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState`, both extras keys, the marker and the authority record. Then remove the hint if present; a removal failure leads to `STORAGE_UNAVAILABLE` (retry).
   2. If no record exists and the hint is present, the state is `STORAGE_LOST`; continue only after user confirmation (Section 3).
   3. Run `runLegacyMigration` (Task 4, unchanged, `locks` injected).
   4. On `source-changed-after-complete` with no authority record, run the **stale reset**: one readwrite transaction guarded by authority absent, marker `complete`, empty `outbox`/`auth`/`syncState`/`conflicts`. It deletes only marker-owned records, the extras named by the marker, and the marker. Never `clear()`. Then rerun migration once.
   5. Proceed only on `completed`, `already-complete`, `prepared-recovered` or `reprepared`. Every other status is `LEGACY` for this session, which is allowed because authority was proven absent in step 1.
   6. Read the three legacy keys again and compute the digest (outside any transaction).
   7. **Switch transaction** on `meta`: require marker `status === 'complete'`, `marker.sourceDigest === ` the step-6 digest, and no authority record with status `active` or `reverting`. Write the authority record (`status: 'active'`, fresh `switchId`, `commitCount: 0`, `legacyUntrusted: false`, `legacyDigestAtSwitch` = marker digest). **localStorage stops being authoritative when this transaction commits.** A failed switch transaction leaves authority proven absent, so the state is `LEGACY`.
   8. **Hint gate:** write the hint. On failure the state is `AUTHORITY_HINT_PENDING` (Section 3): IndexedDB stays authoritative, nothing mounts, and it retries until the write succeeds. Once written, broadcast `authority-changed`.
   9. **Post-switch confirmation:** read the legacy keys again and recompute the digest. If it differs from `legacyDigestAtSwitch`, apply the divergence rule immediately, before mounting hooks.
   10. Call the injected `persist()` (`navigator.storage.persist`) once. Write its result to `persistGranted` in a separate `meta` transaction guarded by the same `switchId`; the switch never depends on it. Load initial domain snapshots, then mount `READY` (the connection-event subscription has been active since the replica was created; Section 5 item 4a).
3. **Authority `active`:**
   - If the hint is absent or differs, rewrite it through the hint gate: a failure means `AUTHORITY_HINT_PENDING`.
   - Run the divergence check (compare the current legacy digest with `legacyDigestAtSwitch`).
   - Load snapshots, then mount `READY`.
4. **Authority `reverting` in a forward build:** Section 6 step 9, then continue as in step 3.

**Legacy writes after migration or switch.**

- **Before the switch commits,** legacy is authoritative. Any change makes the step-7 guard fail or migration return `source-changed-after-complete` (stale reset), so the switch always adopts the latest validated legacy state.
- **After the switch, divergence** means `legacyDigest !== legacyDigestAtSwitch`. Its sources:
  - a tab running a pre-cutover build;
  - a new-build `LEGACY` tab whose write guard had not yet seen the hint (cross-tab localStorage propagation delay, or the crash window in Section 11).
- **Resolution:**
  - **`commitCount === 0` and `legacyUntrusted === false` (re-adopt):** remove the hint (a failure means `STORAGE_UNAVAILABLE`, retry). Then one transaction guarded by `status === 'active'`, same `switchId`, `commitCount === 0` deletes marker-owned records, extras, the marker and the authority record. Then rerun steps 2.3-2.10. IndexedDB held no edits, so legacy wins losslessly.
  - **`commitCount > 0` or `legacyUntrusted` (true divergence):** IndexedDB stays authoritative. The diverged legacy values stay untouched and are never adopted or merged automatically. Show the non-blocking `LEGACY_DIVERGED` notice. Adoption requires a separate design. A field occurrence is a rollout STOP condition.
- **Detection:** at every boot, on `storage` events for the three legacy keys, and on `focus`/`visibilitychange`. A mounted tab that must re-adopt moves to `RELOAD_REQUIRED`; the next boot re-adopts.
- **Hint watch in `READY`:** on a `storage` event for the hint key or `key === null` (clear), and on `focus`/`visibilitychange`, the tab re-verifies the hint. If it is missing or different, the tab rewrites it through the hint gate. A failure moves the tab to `AUTHORITY_HINT_PENDING` with writes disabled.
- **Retry bound:** at most 3 switch attempts per boot. If the step-9 confirmation still diverges on the third attempt, perform the re-adopt deletion without switching again. Authority is then proven absent, so the device stays on `LEGACY` for this session, because a pre-cutover tab is actively writing legacy.
- **New-build tabs on legacy authority:** before every legacy write, synchronously read the hint. If it is present, refuse the write and enter `RELOAD_REQUIRED`. They also enter `RELOAD_REQUIRED` on a hint `storage` event or an `authority-changed` broadcast.

## 3. Startup state machine

| State | Entered when | App behavior |
|---|---|---|
| `BOOTING` | app start | minimal splash; no domain hooks mounted |
| `LEGACY` | only after IndexedDB opened and the `meta` read succeeded with authority proven absent (or the reverted reset completed and the hint was removed), and then: migration status not switchable (including `invalid-source`/`unreadable-source`), switch transaction failed, or retry bound reached | existing accepted localStorage repositories, plus the hint write-guard; retry at next boot |
| `READY` | authority `active`, hint verified, snapshots loaded and valid, connection subscription active | IndexedDB repositories |
| `READY` + `LEGACY_DIVERGED` notice | true divergence (Section 2) | fully usable; non-blocking notice |
| `DOMAIN_INVALID` (per domain) | an IndexedDB record of that domain fails runtime validation on load | that domain `writable: false` with an error message (same pattern as legacy `writable: false`); other domains usable; no auto-repair |
| `AUTHORITY_HINT_PENDING` | authority `active` (just switched, found at boot, or while `READY`) and the hint write or read-back fails | blocking screen for shared domains: "Seadme salvestusruum ei võtnud muudatust vastu. Proovi uuesti."; shared domains not mounted or writes disabled; automatic retry on focus plus a retry button; IndexedDB stays authoritative; never legacy |
| `BLOCKED` | authority unknown: open rejected with `IndexedDbBlockedError` (hint present or not) | blocking screen for shared domains: "Sulge Majanduse teised aknad ja proovi uuesti."; retry button and automatic retry on focus; Buss and device-local tabs stay usable |
| `STORAGE_UNAVAILABLE` | authority unknown: IndexedDB API missing, access or open error, or `meta` read failure (hint present or not); also a failed hint removal during re-adopt or revert | blocking screen for shared domains with retry; never falls back to legacy |
| `STORAGE_LOST` | open and `meta` read succeed, no authority record, hint present | recovery screen: "Kohalik andmebaas puudub. Taasta andmed seisuga <switchedAt> varukoopiast?". On confirm, run steps 2.3-2.10 with a new `switchId`; the hint gate overwrites the hint. Leftover non-owned records produce `replica-not-empty`: stay on this screen and STOP condition |
| `RELOAD_REQUIRED` | replica connection event `versionchange` or `close` (Section 5 item 4a), `VersionError` (database newer than build), authority record changed under a mounted tab, or hint appears in a `LEGACY` tab | writes disabled; banner "Majandus uuenes teises aknas. Laadi leht uuesti." with reload button |
| `REVERTING` | revert build only (Section 6) | splash until export finishes, then `LEGACY` |

- Transitions out of `BLOCKED`, `STORAGE_UNAVAILABLE`, `AUTHORITY_HINT_PENDING` and `RELOAD_REQUIRED` happen only through a reload or retry that re-enters `BOOTING` (or, for `AUTHORITY_HINT_PENDING`, a successful hint gate). No state ever writes legacy keys after the switch.
- **Availability trade-off (accepted):** a device whose IndexedDB cannot be opened or read is shown `BLOCKED` or `STORAGE_UNAVAILABLE` for shared domains, even if it never switched. Legacy authority cannot be proven there, so split authority is prevented at the cost of availability. Observing this state in smoke or the field is a STOP condition.

## 4. Multi-tab, blocked open, versionchange, schema upgrades (acceptance item 3)

- Every runtime connection follows the C1 connection-event contract (Section 5 item 4a). A `versionchange` or browser-initiated `close` closes and drops the handle, reaches the controller, and moves every mounted runtime to `RELOAD_REQUIRED`.
- Blocked open leads to `BLOCKED` in every case (authority unknown), never to `LEGACY`.
- A tab whose build is older than the database version gets `VersionError`, leading to `RELOAD_REQUIRED`. It never deletes or downgrades.
- Multi-tab freshness uses `BroadcastChannel('majandus:replica')`. `{ type: 'committed', domain }` is sent after the transaction `oncomplete`; receivers re-read that domain from IndexedDB. Without `BroadcastChannel`, tabs re-read on `focus`/`visibilitychange`.
- Mutations never write from a React snapshot. Each mutation re-reads its domain inside its own readwrite transaction (Section 5), so concurrent tabs serialize through IndexedDB.
- Every runtime write transaction includes `meta`. It requires authority `status === 'active'` with the `switchId` the tab booted with, and increments `commitCount` in the same transaction. Any mismatch aborts with no writes and leads to `RELOAD_REQUIRED`.
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
5. **Controller (C4):** the boot controller subscribes to its replica immediately after creating it, before Section 2 step 1 opens the database, and keeps the subscription for the page lifetime. The listener sets runtime state `RELOAD_REQUIRED` and notifies runtime-state subscribers. A `ReplicaConnectionLostError` from any boot step (migration, reset, switch, hint gate, snapshot load) also resolves to `RELOAD_REQUIRED`, never `LEGACY`. Domain repositories then reject new mutations with `ReplicaConnectionLostError` without touching IndexedDB.
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
  - **Calendar:** `createEventRepository(memoryStorage, newId)` over the raw envelope rebuilt from `calendarEvents`, `wasteState` and `calendarLegacyEnvelopeExtras`. Its `create`/`update`/`remove`/`importWaste` output becomes record puts and deletes.
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

- **Fallback before the switch:** only when authority is proven absent. Migration failure, switch-transaction failure or a quota failure during migration or switch keeps `LEGACY` (accepted runtime) and retries at the next boot. Legacy stays authoritative and untouched. An open or read failure is never a fallback: it is `BLOCKED` or `STORAGE_UNAVAILABLE`.
- **After the switch there is no fallback to legacy writes.** Failures surface as `AUTHORITY_HINT_PENDING`, `BLOCKED`, `STORAGE_UNAVAILABLE`, `DOMAIN_INVALID` or `RELOAD_REQUIRED`.
- **Quota:** a runtime write that fails with `QuotaExceededError` (or any error) aborts atomically. The mutation promise rejects, the UI keeps the previous snapshot and shows "Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti." (existing copy). Places errors, previously swallowed, now surface the same message. A hint-write failure after the switch is `AUTHORITY_HINT_PENDING`, never `READY`.
- **Eviction:** Chromium evicts an origin's localStorage and IndexedDB together, so the switch does not increase eviction exposure. `navigator.storage.persist()` is requested at the switch. Loss of IndexedDB alone is detected by the hint (`STORAGE_LOST`, guaranteed present while `READY` because of the hint gate) and recovered only with user confirmation from the frozen legacy snapshot.
- **Rollback is only through a revert build.** This is the same forward code built with `VITE_STORAGE_AUTHORITY_MODE=revert`; an undefined mode means forward. For each device at boot, under the lock:
  1. Open and read authority as in Section 2 step 1 (unknown authority leads to `BLOCKED`/`STORAGE_UNAVAILABLE`). If the record is absent or `reverted`, remove the hint if present (a failure means `STORAGE_UNAVAILABLE`) and run `LEGACY`. A record that is absent while the hint is present means IndexedDB was lost. The revert build then deliberately uses the frozen legacy snapshot, because no IndexedDB data remains to export.
  2. Transaction: `active` becomes `reverting`, recording `commitCount`. Forward tabs' writes now abort.
  3. Read and validate all domain snapshots.
  4. Write backup keys `majandus_legacy_backup_<switchId>_{calendar,household,places}` holding the current legacy raw values. A backup failure means abort.
  5. Export the IndexedDB state to the three legacy keys in the exact legacy envelope formats, with extras restored. A domain is exported only when IndexedDB holds any record for it (including its extras record); otherwise its legacy key stays untouched. Export never calls `removeItem`.
  6. Verify by loading through `createEventRepository`, `createHouseholdRepository` and `normalizePlaces` from `src/places/savedPlaces.js`, deep-equal to the IndexedDB snapshots.
  7. Transaction guarded by `reverting` and an unchanged `commitCount`: set `reverted`. Remove the hint; a removal failure means `STORAGE_UNAVAILABLE`, and the next boot retries step 1. Run `LEGACY` only after the hint removal is verified.
  8. On any failure after step 4: restore the original legacy raw values from memory (best effort), set the status back to `active` with `legacyUntrusted: true`, and stay on IndexedDB through the hint gate with a notice.
  9. A forward build that finds `reverting` sets `active` with `legacyUntrusted: true` (re-adopt disabled).
- The IndexedDB data is never deleted by a revert. Re-forward after a revert uses the reverted reset (step 2.1).
- **Forbidden:** deploying any pre-cutover build (without the controller) to an origin where any device may have switched.

## 7. Implementation phases (locked; each needs its own scope-open commit)

| Phase | Purpose | Exact files | Runtime behavior change |
|---|---|---|---|
| C1 | Phase A amendments: close/open race and the Section 5 item 4a connection-event contract | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` | none (dormant) |
| C2 | Prerequisite: behavior-preserving extraction of saved-place defaults and normalization into one neutral pure module | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (keeps its `DEFAULT_PLACES` export as a re-export), new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle only), `src/storage/legacyMigration.js` (comment-only update of its mirror reference; no code change) | none (behavior-preserving) |
| C3 | Runtime record validators and mutation helper (items 5, 6) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, both storage tests | none (dormant) |
| C4 | Authority controller: state machine, hint gate, switch, resets, re-adopt, divergence, `STORAGE_LOST`, revert, connection-event subscription | new `src/storage/storageAuthority.js`, both storage tests | none (dormant) |
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
  - the timer-await hazard test (Section 5).
- **C4 (Chromium plus stubs):** every Section 3 state and transition:
  - **Switch:**
    - switch success;
    - a legacy write between migration and switch leads to the stale reset, then the latest state is adopted.
  - **Unknown authority:** a blocked open is `BLOCKED` and any other open, API or `meta` read failure is `STORAGE_UNAVAILABLE`, each with the hint present and absent, never `LEGACY`, and with zero legacy writes.
  - **Hint gate:**
    - a hint-write failure right after the switch, at boot with authority `active` and hint absent, and while `READY` after a hint clear event, each leads to `AUTHORITY_HINT_PENDING` with no domain mounted or writes disabled and no legacy write;
    - a retry success leads to `READY`;
    - a read-back mismatch counts as failure.
  - **Divergence:** post-switch divergence with `commitCount` 0 re-adopts; with a positive `commitCount` it notifies and leaves legacy bytes unchanged; a failed hint removal during re-adopt leads to `STORAGE_UNAVAILABLE`.
  - **Crash points:** after steps 2.7 and 2.8 and inside re-adopt, simulated by aborting the controller between steps, the next boot converges.
  - **Storage loss:** `STORAGE_LOST` restore.
  - **Concurrency:** two concurrent boots produce exactly one switch.
  - **Connection events:** a `versionchange` delivered through the replica subscription moves the controller to `RELOAD_REQUIRED` and repositories reject new mutations, both while mounted and when injected during migration, switch, hint gate and snapshot load (never `LEGACY`).
  - **Revert:**
    - success;
    - backup-write failure;
    - verify failure;
    - hint-removal failure leads to `STORAGE_UNAVAILABLE`;
    - a forward build seeing `reverting`;
    - re-forward after `reverted`.
  - **Invariants:** legacy key bytes never change in any forward path; private keys are never read.
- **C5:** for every domain operation, the IndexedDB repository result deep-equals the legacy repository result on the same starting state (a parity table covering calendar create/update occurrence and series/remove/importWaste, household save, places update/add/remove with padding); IDs are stable; quota failure injection leaves the previous state; two-tab concurrent mutations both persist.
- **C6:**
  - app-shell, calendar, waste and reminder browser suites pass in both `LEGACY` and `READY` modes;
  - boot from a real seeded legacy profile switches and shows identical UI data;
  - reload persistence;
  - with the app mounted `READY` in Chromium, a second connection triggering `versionchange` shows the reload banner and disables every shared-domain save control;
  - a hint-write failure injected at boot shows the `AUTHORITY_HINT_PENDING` screen;
  - the storage allowlist guard, and a bundle check that `src/storage/` is present only via the allowed importers;
  - the full fail-fast sweep, `npm run build`, `git diff --check`.

## 9. Human smoke gates

- **C6 desktop smoke:** a human performs the C6 checks on desktop Chrome: existing data appears after the switch; create, edit and delete in every domain; reload; two tabs; an update in a second tab shows the reload banner.
- **C7 Android/PWA gate (acceptance item 2, mandatory; stays PENDING until the human confirms):**
  1. Use one fixed Cloudflare Pages branch alias URL, because localStorage is per origin. Deploy the current accepted legacy build there. Install it as a PWA on a real Android phone (Chrome stable). Create real data: recurring and one-off events, a waste import, household profile, at least 3 places with one removed and re-added.
  2. Deploy the C6 build to the same alias. Open the installed PWA and let it update. Verify every item is unchanged, including place order, and that reminders still fire.
  3. Create, edit and delete in every domain. Force-stop the app, reopen, confirm persistence. Reboot the phone, confirm persistence. Repeat in airplane mode.
  4. Open the alias in a Chrome tab alongside the PWA, edit in one, and confirm the other shows it after focus.
  5. Deploy a new build while the PWA is open, and confirm `RELOAD_REQUIRED` or a clean reload with no data loss.
  6. Via `chrome://inspect` remote DevTools: simulate a small custom storage quota, attempt a save, and confirm the error message with the previous data intact; delete the IndexedDB database only, reload, confirm the `STORAGE_LOST` screen, restore, and confirm data equals the switch-time snapshot; record `navigator.storage.persisted()`.
  7. Rollback drill: deploy the revert build to the alias, confirm the data is visible under `LEGACY` and backup keys exist; then redeploy forward and confirm it converges.
- **C8 production** requires the C7 gate PASS recorded by the human and a separate deploy scope.

## 10. STOP and rollback conditions

STOP the rollout (no further phase or deploy, and investigate) on any of:
- a Task 1-6 regression or a failed accepted suite;
- any C2 characterization difference;
- any forward path writing legacy keys;
- any mismatch between a migrated and a legacy view;
- `LEGACY_DIVERGED` observed in smoke or reported from the field;
- `replica-not-empty`, `DOMAIN_INVALID`, `STORAGE_LOST`, `STORAGE_UNAVAILABLE`, `BLOCKED` or `AUTHORITY_HINT_PENDING` observed without a deliberate trigger;
- a quota or eviction test losing previously saved data;
- revert verification failure;
- `TransactionInactiveError` in any runtime path;
- a human smoke FAIL.

Deploy the revert build (never a pre-cutover build) when production shows data loss, a wrong-data display, repeated `BLOCKED`/`STORAGE_UNAVAILABLE`/`AUTHORITY_HINT_PENDING` states, or an unrecoverable `DOMAIN_INVALID`. The revert must be confirmed by the rollback-drill checklist before a new forward attempt.

## 11. Falsification review (post-amendment result: PASS)

Each attack was traced against Sections 1-10 and the unchanged Task 1-6 contracts. The first five rows were re-run specifically for amendments A-D.

| Attack | Result |
|---|---|
| C2/C4 (now C2/C3) dependency ordering | `runtimeRecords.js` (C3) imports the neutral module created in C2; C3 cannot open before C2 is accepted. The module is the single definition consumed by both hooks and the validators, and no storage module imports a React hook. The Task 3 mirror is untouched in code and its parity oracle now targets the module, so duplication is not increased and parity stays proven |
| Unknown authority | `LEGACY` requires a successful open plus `meta` read proving absence. Blocked is `BLOCKED`; every other open, API or read failure is `STORAGE_UNAVAILABLE`, independent of the hint. The former residual (hint loss plus blocked open leading to `LEGACY`) is removed |
| Hint write failure | `READY` requires a verified hint. Hint-write failure right after the switch, at boot, or after a clear while `READY` is `AUTHORITY_HINT_PENDING`, blocking, IndexedDB-authoritative, never legacy. A persistent hint failure can therefore never coexist with shared-domain writes |
| Versionchange propagation | Exact path: `indexedDb.js` closes the handle, then calls `onVersionChange`; the replica drops the handle, enters terminal `lost` and notifies subscribers; the controller, subscribed from replica creation, sets `RELOAD_REQUIRED` (also for a loss during any boot step); repositories reject and hooks disable writes. A lost replica cannot silently reopen. Stale-generation events are ignored. C1, C4 and C6 tests cover each hop |
| Split authority | One authority record, switched transactionally. Unknown authority is never `LEGACY`. New-build legacy tabs refuse writes once the hint exists, and the hint is guaranteed while `READY`. Remaining sources (pre-cutover build tabs, cross-tab localStorage propagation delay, the crash window below) are caught by divergence detection, re-adopted when lossless, and otherwise preserved and flagged |
| Data loss on switch | Switch adopts only verified complete-marker data equal to the digest read immediately before the switch; legacy stays frozen |
| Legacy edit between migration and switch | Stale reset, then re-migration |
| Partial migration | Task 4 guarantees atomic preparation; the switch requires `complete` |
| Partial switch | A crash at any step converges at next boot (Section 2 step 3; re-adopt removes the hint first) |
| Partial runtime write | Single transaction per mutation; all writes after validation |
| Multi-tab races | IndexedDB serializes readwrite transactions. Mutations re-read inside the transaction. The authority `switchId`/`commitCount` guard catches re-adopt or revert under a live tab. Concurrent boots serialize through the lock and switch guard |
| Blocked database | Always `BLOCKED` with retry; never writes legacy |
| Quota or storage loss | Atomic abort with visible error. Eviction is no worse than today. IndexedDB-only loss is detected by the guaranteed hint and recovered with user consent |
| Rollback impossibility | Revert build with backup, verify, guarded status transitions, verified hint removal before `LEGACY`, and a failure path back to IndexedDB. Pre-cutover build deployment is forbidden |
| Invalid payload writes | The domain repositories are the only payload producers. Validators run before every write and after every read |
| Transaction auto-commit | Structural read, sync plan, validate, write discipline; thenable plans rejected; direct `transact` use confined to four files by a source guard |

Residual and accepted:
- **Crash window between the switch commit (2.7) and the hint write (2.8):** only a crash in this window matters, not a persistent hint failure (that is `AUTHORITY_HINT_PENDING`).
  - Until the next boot, a pre-cutover build tab or an already-running new-build `LEGACY` tab can still write legacy. The next boot finds authority `active`, rewrites the hint through the gate, and detects those writes as divergence. With `commitCount` 0, which is guaranteed because nothing mounted `READY`, they are re-adopted losslessly.
  - If IndexedDB alone is also lost inside that window, the next boot sees authority absent with no hint and migrates the current legacy state. No IndexedDB edits can be lost, because none were possible.
- **Edits in a pre-cutover build tab after IndexedDB already holds edits** are preserved but not adopted (notice plus STOP condition).
- **Availability trade-off:** devices whose IndexedDB cannot be opened or read cannot use shared domains (Section 3; STOP condition if observed).

## 12. Amendment record

Independent fresh review verdict: AMEND. Resolved as follows:
- **A. Saved-place validator ordering:** new prerequisite phase C2 extracts the neutral pure module `src/places/savedPlaces.js` used by both hooks and the validators, with characterization tests. Later phases renumbered C3-C8.
- **B. Unknown authority:** `LEGACY` only after a successful open and `meta` read proving absent or reverted authority. Blocked is `BLOCKED`; any other open or read failure is `STORAGE_UNAVAILABLE`, regardless of the hint. The hint-loss plus blocked-open residual is removed.
- **C. Hint write as `READY` gate:** new state `AUTHORITY_HINT_PENDING`. A hint failure after the switch never mounts `READY` and never falls back to legacy. Only the crash window between the authority commit and the hint write remains as a residual.
- **D. Versionchange propagation:** exact C1 contract (`openMajandusDb` options, `replica.subscribe`, terminal `lost` state with `ReplicaConnectionLostError`, controller `RELOAD_REQUIRED`, disabled writes) with C1, C4 and C6 tests.
