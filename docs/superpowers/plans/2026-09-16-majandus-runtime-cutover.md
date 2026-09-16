# Majandus Runtime Cutover Plan (localStorage -> IndexedDB)

Status: LOCKED PLAN, falsification review PASS (performed by the plan author, Claude Opus 5, in the planning session). It authorizes no runtime code. Each implementation phase below opens only through its own separate scope-open commit after human acceptance of this plan.

**Goal:** Make the accepted Phase A IndexedDB replica the runtime authority for the three shared household domains without data loss, split authority or an unrecoverable rollback.

**Inherits unchanged:** `docs/COMMON_BACKEND_ARCHITECTURE_V1.md` and the accepted Phase A Task 1-6 contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md`. The only Phase A amendments are the ones named in C1 below.

**Out of scope:** D1, backend, network calls, authentication, sync, outbox mutations and outbox UI, legacy cleanup or deletion, schema version bumps, new object stores, dependency changes.

## 1. Cutover model

- **Scope of the switch.** Calendar events with waste imports (`majamajandus_household_events_v1`), household profile (`majamajandus_household_profile_v1`) and saved places (`sade_saved_places`) switch together, per device, in one atomic authority switch. A per-domain switch is forbidden: the Task 4 marker and digest cover all three sources, so a partial switch would leave the marker permanently stale. Rollout by domain applies to implementation order (Section 7), not to authority.
- **Device-local data stays in localStorage:** diary, reminder preferences and delivery, saved ideas and tips, `sade_profile`.
- **Authority record (single source of truth):** IndexedDB `meta` record `storageAuthorityV1`:
  `{ key, status: 'active'|'reverting'|'reverted', switchId, switchedAt, legacyDigestAtSwitch, markerPreparationId, commitCount, legacyUntrusted, persistGranted }`.
  IndexedDB is authoritative exactly while this record exists with `status` `active` or `reverting`.
- **Authority hint:** localStorage key `majandus_storage_authority_v1` = `{ version: 1, switchId, legacyDigestAtSwitch, switchedAt }`. The hint never grants authority. It exists only to detect loss of the IndexedDB database and to stop legacy writes in tabs running the new build.
- **Legacy rollback material:** after the switch, the three legacy keys are frozen. No forward build writes them. They are retained until a separate accepted cleanup plan; no phase in this plan deletes them.
- **Deletion:** runtime records are `syncStatus: 'local'`, `revision: 0` and never uploaded, so they are hard-deleted. Tombstones belong to the future sync phase.

## 2. Authority switch ordering (acceptance item 1)

All steps run in the boot controller before any domain hook mounts, inside `locks.request('majandus:storage-authority')` when Web Locks exist. The lock is supplemental; correctness comes from the IndexedDB transaction guards.

1. Open the database. Read the authority record and the hint.
2. No authority record and no hint, or a record `reverted` (hint present or not): pre-cutover device.
   1. If the record is `reverted`, run the **reverted reset**: one readwrite transaction guarded by `status === 'reverted'` and empty `outbox`, `auth`, `syncState`, `conflicts`. It deletes every record in `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState`, both extras keys, the marker and the authority record. Then remove the hint if present.
   2. Run `runLegacyMigration` (Task 4, unchanged, `locks` injected).
   3. On `source-changed-after-complete` with no authority record, run the **stale reset**: one readwrite transaction guarded by authority absent, marker `complete`, empty `outbox`/`auth`/`syncState`/`conflicts`. It deletes only marker-owned records, the extras named by the marker, and the marker. Never `clear()`. Then rerun migration once.
   4. Proceed only on `completed`, `already-complete`, `prepared-recovered` or `reprepared`. Every other status leaves the device on legacy authority for this session (Section 3).
   5. Read the three legacy keys again and compute the digest (outside any transaction).
   6. **Switch transaction** on `meta`: require marker `status === 'complete'`, `marker.sourceDigest === ` the step-5 digest, and no authority record with status `active` or `reverting`. Write the authority record (`status: 'active'`, fresh `switchId`, `commitCount: 0`, `legacyUntrusted: false`, `legacyDigestAtSwitch` = marker digest). **localStorage stops being authoritative when this transaction commits.**
   7. Write the hint. Broadcast `authority-changed`.
   8. **Post-switch confirmation:** read the legacy keys again and recompute the digest. If it differs from `legacyDigestAtSwitch`, apply the divergence rule immediately, before mounting hooks.
   9. Call the injected `persist()` (`navigator.storage.persist`) once. Write its result to `persistGranted` in a separate `meta` transaction guarded by the same `switchId`; the switch never depends on it. Load initial domain snapshots, then mount.
3. Authority `active`, hint absent or different: rewrite the hint (a crash between steps 6 and 7).
4. Authority `active`: run the divergence check (compare the current legacy digest with `legacyDigestAtSwitch`), then load snapshots and mount.
5. No authority record at all, but the hint present: `STORAGE_LOST` (Section 3). Nothing runs without user confirmation.
6. Authority `reverting` in a forward build: Section 6 step 9.

**Legacy writes after migration or switch.**

- **Before the switch commits,** legacy is authoritative. Any change makes the step-6 guard fail or migration return `source-changed-after-complete` (stale reset), so the switch always adopts the latest validated legacy state.
- **After the switch, divergence** means `legacyDigest !== legacyDigestAtSwitch`. Its only sources are a tab running a pre-cutover build or a sub-millisecond cross-tab race.
  - **`commitCount === 0` and `legacyUntrusted === false` (re-adopt):** remove the hint, then one transaction guarded by `status === 'active'`, same `switchId`, `commitCount === 0`. It deletes marker-owned records, extras, the marker and the authority record. Then rerun steps 2.2-2.9. IndexedDB held no edits, so legacy wins losslessly.
  - **`commitCount > 0` or `legacyUntrusted` (true divergence):** IndexedDB stays authoritative. The diverged legacy values stay untouched and are never adopted or merged automatically. Show the non-blocking `LEGACY_DIVERGED` notice. Adoption requires a separate design. A field occurrence is a rollout STOP condition.
- **Detection:** at every boot, on `storage` events for the three legacy keys, and on `focus`/`visibilitychange`. A mounted tab that must re-adopt moves to `RELOAD_REQUIRED`; the next boot re-adopts.
- **Retry bound:** at most 3 switch attempts per boot. If the step-8 confirmation still diverges on the third attempt, perform the re-adopt deletion without switching again. The device stays on `LEGACY` for this session, because a pre-cutover tab is actively writing legacy.
- **New-build tabs on legacy authority:** before every legacy write, synchronously read the hint. If it is present, refuse the write and enter `RELOAD_REQUIRED`. They also enter `RELOAD_REQUIRED` on a hint `storage` event or an `authority-changed` broadcast.

## 3. Startup state machine

| State | Entered when | App behavior |
|---|---|---|
| `BOOTING` | app start | minimal splash; no domain hooks mounted |
| `LEGACY` | hint absent and one of: IndexedDB missing, open error, open blocked, migration status not switchable (including `invalid-source`/`unreadable-source`), or retry bound reached | existing accepted localStorage repositories, plus the hint write-guard; retry at next boot |
| `READY` | authority `active`, snapshots loaded and valid | IndexedDB repositories |
| `READY` + `LEGACY_DIVERGED` notice | true divergence (Section 2) | fully usable; non-blocking notice |
| `DOMAIN_INVALID` (per domain) | an IndexedDB record of that domain fails runtime validation on load | that domain `writable: false` with an error message (same pattern as legacy `writable: false`); other domains usable; no auto-repair |
| `BLOCKED` | hint present and open rejected with `IndexedDbBlockedError` (the authority record cannot be read, so the hint decides) | blocking screen for shared domains: "Sulge Majanduse teised aknad ja proovi uuesti."; retry button and automatic retry on focus; Buss and device-local tabs stay usable |
| `STORAGE_UNAVAILABLE` | hint present and open fails for any other reason (including IndexedDB missing) | blocking screen for shared domains with retry; never falls back to legacy |
| `STORAGE_LOST` | open succeeds, no authority record, hint present | recovery screen: "Kohalik andmebaas puudub. Taasta andmed seisuga <switchedAt> varukoopiast?". On confirm, run the pre-cutover flow (steps 2.2-2.9) with a new `switchId` and overwrite the hint. Leftover non-owned records produce `replica-not-empty`: stay on this screen and STOP condition |
| `RELOAD_REQUIRED` | `versionchange`, `VersionError` (database newer than build), authority record changed under a mounted tab, or hint appears in a `LEGACY` tab | writes disabled; banner "Majandus uuenes teises aknas. Laadi leht uuesti." with reload button |
| `REVERTING` | revert build only (Section 6) | splash until export finishes, then `LEGACY` |

Transitions from `BLOCKED`, `STORAGE_UNAVAILABLE` and `RELOAD_REQUIRED` happen only through a reload or retry that re-enters `BOOTING`. No state ever writes legacy keys after the switch.

## 4. Multi-tab, blocked open, versionchange, schema upgrades (acceptance item 3)

- Every runtime connection handles `versionchange` by closing the handle, dropping it from the replica and emitting `RELOAD_REQUIRED`.
- Blocked open before the switch leads to `LEGACY` for the session. After the switch it leads to `BLOCKED` (never a legacy fallback).
- A tab whose build is older than the database version gets `VersionError`, leading to `RELOAD_REQUIRED`. It never deletes or downgrades.
- Multi-tab freshness uses `BroadcastChannel('majandus:replica')`. `{ type: 'committed', domain }` is sent after the transaction `oncomplete`; receivers re-read that domain from IndexedDB. Without `BroadcastChannel`, tabs re-read on `focus`/`visibilitychange`.
- Mutations never write from a React snapshot. Each mutation re-reads its domain inside its own readwrite transaction (Section 5), so concurrent tabs serialize through IndexedDB.
- Every runtime write transaction includes `meta`. It requires authority `status === 'active'` with the `switchId` the tab booted with, and increments `commitCount` in the same transaction. Any mismatch aborts with no writes and leads to `RELOAD_REQUIRED`.
- **Future schema upgrades:** a `DB_VERSION` bump requires its own accepted plan. `upgradeSchema` branches are additive (`if (oldVersion < N)`) and never delete stores or records. Builds never lower `DB_VERSION`. Revert builds keep the highest shipped version.

## 5. Replica close race, transaction rule, payload boundary (acceptance items 4-6)

**Item 4: `createLocalReplica.close()` during an in-flight open (C1 amendment to Task 2).**
- The replica keeps a generation counter. `close()` increments it, drops `activeDb`, awaits any in-flight open (ignoring its error) and closes the resulting handle.
- An open that resolves for a stale generation closes its handle and rejects with `DOMException` name `ReplicaClosedError`. Callers of `transact` see a rejection; Task 4 maps it to `write-failed`.
- `open()` after `close()` starts a new generation (reopen stays allowed). `close()` resolves only after no handle of an older generation remains open.
- `db.onversionchange` and `db.onclose` also drop `activeDb`. `openMajandusDb(indexedDb, { onVersionChange })` forwards the event (C1 amendment to Task 1).

**Item 5: transaction-body async invariant.**
- Runtime domain code never calls `replica.transact` or `runTransaction` directly. It uses one helper, `runReplicaMutation({ replica, authority, domain, stores, read, plan })`:
  1. **Read phase:** `read(stores)` may await only `requestResult` promises of requests issued on this transaction's stores.
  2. **Plan phase:** `plan(snapshot)` is synchronous and pure. If it returns a thenable, the helper throws `TypeError` before any write, and the transaction aborts.
  3. **Validate phase:** every planned record passes the Section 5 item-6 validators synchronously.
  4. **Write phase:** all `put`/`delete` requests, plus the authority `commitCount` increment, are issued synchronously in one block with no awaits in between.
- Inside a body: no timers, `fetch`, `crypto.subtle`, locks, `BroadcastChannel`, other transactions or caller-supplied async callbacks. Digests and all other async work happen outside the transaction.
- **Enforcement:**
  - A source guard allows `transact`/`runTransaction` calls only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and `src/storage/storageAuthority.js`.
  - A Chromium test shows a thenable-returning plan writes nothing.
  - A Chromium test shows a timer await inside a raw body raises `TransactionInactiveError` before any write request is issued under the read-then-write discipline.

**Item 6: payload validation boundary.**
- Domain semantics are never re-implemented. The IndexedDB repositories run the existing accepted domain code synchronously inside `plan`, against an in-memory single-key `getItem`/`setItem` adapter:
  - **Calendar:** `createEventRepository(memoryStorage, newId)` over the raw envelope rebuilt from `calendarEvents`, `wasteState` and `calendarLegacyEnvelopeExtras`. Its `create`/`update`/`remove`/`importWaste` output becomes record puts and deletes. Envelope fields other than `events` and `wasteImports` must be unchanged, or the plan throws. With no calendar extras record, the rebuilt envelope is `{ version: 1, events, wasteImports? }` and runtime writes create no extras record. A `wasteState` record exists exactly when the repository output defines `wasteImports`.
  - **Household:** `createHouseholdRepository(memoryStorage).save`, the same way.
  - **Places:** the pure normalization and padding of `useSavedPlaces` (exported in C4 as pure functions, behavior unchanged). `update(idx)` keeps the id at `idx`. `add` appends a new id. `remove(idx)` deletes that id and re-orders the rest with ids preserved. Padded default entries become real records with new ids when a save persists the padded list, matching the legacy save of the padded array.
- Before any write, `validateRuntimeRecord(store, record)` (new `src/storage/runtimeRecords.js`) runs the Task 2 envelope validator plus the domain validator:
  - calendar: `validateEvent(payload)` deep-equals `payload` and `payload.id === record.id`;
  - waste: `validateImportHistory(payload.wasteImports)`;
  - household: the household normalize is idempotent and `serverHouseholdId === null`;
  - places: `normalizePlace(payload)` is idempotent, and orders are the contiguous integers `0..n-1`.
- Every record also has `syncStatus: 'local'`, `revision: 0` and `deletedAt: null`.
- The same validators run on every load, producing `DOMAIN_INVALID` on failure. A failed validation aborts the whole transaction.

## 6. Fallback, rollback, quota and eviction

- **Fallback before the switch:** any failure leaves the device on `LEGACY` (accepted runtime) and retries at the next boot. Legacy stays authoritative and untouched.
- **After the switch there is no fallback to legacy writes.** Failures surface as `BLOCKED`, `STORAGE_UNAVAILABLE`, `DOMAIN_INVALID` or `RELOAD_REQUIRED`.
- **Quota:** a runtime write that fails with `QuotaExceededError` (or any error) aborts atomically. The mutation promise rejects, the UI keeps the previous snapshot and shows "Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti." (existing copy). Places errors, previously swallowed, now surface the same message. A quota failure during migration or switch means `LEGACY` and a retry at the next boot. A failure to write the hint is retried at every boot.
- **Eviction:** Chromium evicts an origin's localStorage and IndexedDB together, so the switch does not increase eviction exposure. `navigator.storage.persist()` is requested at the switch. Loss of IndexedDB alone is detected by the hint (`STORAGE_LOST`) and recovered only with user confirmation from the frozen legacy snapshot.
- **Rollback is only through a revert build.** This is the same forward code built with `VITE_STORAGE_AUTHORITY_MODE=revert`; an undefined mode means forward. For each device at boot, under the lock:
  1. If the authority record is absent or `reverted`, run `LEGACY`.
  2. Transaction: `active` becomes `reverting`, recording `commitCount`. Forward tabs' writes now abort.
  3. Read and validate all domain snapshots.
  4. Write backup keys `majandus_legacy_backup_<switchId>_{calendar,household,places}` holding the current legacy raw values. A backup failure means abort.
  5. Export the IndexedDB state to the three legacy keys in the exact legacy envelope formats, with extras restored. A domain is exported only when IndexedDB holds any record for it (including its extras record); otherwise its legacy key stays untouched. Export never calls `removeItem`.
  6. Verify by loading through `createEventRepository`, `createHouseholdRepository` and the places normalizer, deep-equal to the IndexedDB snapshots.
  7. Transaction guarded by `reverting` and an unchanged `commitCount`: set `reverted`. Remove the hint. Run `LEGACY`.
  8. On any failure after step 4: restore the original legacy raw values from memory (best effort), set the status back to `active` with `legacyUntrusted: true`, and stay on IndexedDB with a notice.
  9. A forward build that finds `reverting` sets `active` with `legacyUntrusted: true` (re-adopt disabled).
- The IndexedDB data is never deleted by a revert. Re-forward after a revert uses the reverted reset (step 2.1).
- **Forbidden:** deploying any pre-cutover build (without the controller) to an origin where any device may have switched.

## 7. Implementation phases (locked; each needs its own scope-open commit)

| Phase | Purpose | Exact files | Runtime behavior change |
|---|---|---|---|
| C1 | Phase A amendments: close/open race, versionchange drop and callback | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` | none (dormant) |
| C2 | Runtime record validators and mutation helper (items 5, 6) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, both storage tests | none (dormant) |
| C3 | Authority controller: state machine, switch, resets, re-adopt, divergence, `STORAGE_LOST`, revert | new `src/storage/storageAuthority.js`, both storage tests | none (dormant) |
| C4 | IndexedDB domain repositories (rollout order: household, then places, then calendar with waste) | new `src/storage/replicaRepositories.js`, `src/hooks/useSavedPlaces.js` (export pure normalization only, no behavior change), both storage tests | none (dormant) |
| C5 | Runtime wiring (the cutover) | `src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (remove the places writer), `src/components/SeadedTab.jsx` (remove the places fallback), `src/components/EventDialog.jsx`, `src/components/HouseholdSettings.jsx`, `src/components/WasteSettings.jsx` (await async mutators), new `src/components/StorageStatus.jsx`, `src/design/shell.css`, `scripts/shell/app-shell.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/waste/browser-cases.mjs`, both storage tests (the Task 6 dormant guard becomes an allowlist guard) | yes; desktop human smoke required |
| C6 | Preview deploy and Android/PWA human gate, including the rollback drill | deploy configuration only as separately authorized; no source change | preview origin only |
| C7 | Production deploy | separate deploy gate | production |

- C1-C4 keep the Task 6 guards green: nothing outside `src/storage/` imports storage until C5.
- Every `src/storage/` module receives browser capabilities by injection (`indexedDb`, `storage`, `locks`, `broadcast`, `persist`, `cryptoApi`, `clock`, `newId`, `mode`). The Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force for every storage module. C2-C4 only extend its exact module list. Globals are read only in `src/main.jsx` from C5 on.
- In C5, the only allowed runtime importers of `src/storage/` are `src/main.jsx`, `src/App.jsx` and the three domain hooks.
- Legacy repositories stay in the codebase for `LEGACY` mode and revert.

## 8. Automated acceptance tests (minimum, cumulative)

- **C1:**
  - stub-controlled open, then `close()` before success: handle closed, `ReplicaClosedError`, reopen works;
  - Chromium: `versionchange` from a second connection drops the handle and fires the callback;
  - Task 1-6 suites stay green.
- **C2:**
  - every validator accepts accepted domain output and rejects each invalid payload class;
  - a thenable-returning plan writes nothing;
  - a validation failure aborts every write;
  - `commitCount` increments exactly once per committed mutation;
  - a mismatched `switchId`/status aborts;
  - the timer-await hazard test (Section 5).
- **C3 (Chromium plus stubs):** every Section 3 state and transition:
  - switch success;
  - legacy write between migration and switch leads to the stale reset, then the latest state is adopted;
  - post-switch divergence with `commitCount` 0 re-adopts; with a positive `commitCount` it notifies and leaves legacy bytes unchanged;
  - crash points after steps 2.6 and 2.7 and inside re-adopt, simulated by aborting the controller between steps: next boot converges;
  - `STORAGE_LOST` restore;
  - blocked or unavailable before the switch leads to `LEGACY`; after the switch to `BLOCKED` or `STORAGE_UNAVAILABLE`;
  - two concurrent boots produce exactly one switch;
  - revert: success, backup-write failure, verify failure, then a forward build seeing `reverting`, then re-forward after `reverted`;
  - legacy key bytes never change in any forward path;
  - private keys never read.
- **C4:** for every domain operation, the IndexedDB repository result deep-equals the legacy repository result on the same starting state (a parity table covering calendar create/update occurrence and series/remove/importWaste, household save, places update/add/remove with padding); IDs are stable; quota failure injection leaves the previous state; two-tab concurrent mutations both persist.
- **C5:**
  - app-shell, calendar, waste and reminder browser suites pass in both `LEGACY` and `READY` modes;
  - boot from a real seeded legacy profile switches and shows identical UI data;
  - reload persistence;
  - `RELOAD_REQUIRED` on `versionchange`;
  - the storage allowlist guard, and a bundle check that `src/storage/` is present only via the allowed importers;
  - the full fail-fast sweep, `npm run build`, `git diff --check`.

## 9. Human smoke gates

- **C5 desktop smoke:** a human performs the C5 checks on desktop Chrome: existing data appears after the switch; create, edit and delete in every domain; reload; two tabs.
- **C6 Android/PWA gate (acceptance item 2, mandatory; stays PENDING until the human confirms):**
  1. Use one fixed Cloudflare Pages branch alias URL, because localStorage is per origin. Deploy the current accepted legacy build there. Install it as a PWA on a real Android phone (Chrome stable). Create real data: recurring and one-off events, a waste import, household profile, at least 3 places with one removed and re-added.
  2. Deploy the C5 build to the same alias. Open the installed PWA and let it update. Verify every item is unchanged, including place order, and that reminders still fire.
  3. Create, edit and delete in every domain. Force-stop the app, reopen, confirm persistence. Reboot the phone, confirm persistence. Repeat in airplane mode.
  4. Open the alias in a Chrome tab alongside the PWA, edit in one, and confirm the other shows it after focus.
  5. Deploy a new build while the PWA is open, and confirm `RELOAD_REQUIRED` or a clean reload with no data loss.
  6. Via `chrome://inspect` remote DevTools: simulate a small custom storage quota, attempt a save, and confirm the error message with the previous data intact; delete the IndexedDB database only, reload, confirm the `STORAGE_LOST` screen, restore, and confirm data equals the switch-time snapshot; record `navigator.storage.persisted()`.
  7. Rollback drill: deploy the revert build to the alias, confirm the data is visible under `LEGACY` and backup keys exist; then redeploy forward and confirm it converges.
- **C7 production** requires the C6 gate PASS recorded by the human and a separate deploy scope.

## 10. STOP and rollback conditions

STOP the rollout (no further phase or deploy, and investigate) on any of:
- a Task 1-6 regression or a failed accepted suite;
- any forward path writing legacy keys;
- any mismatch between a migrated and a legacy view;
- `LEGACY_DIVERGED` observed in smoke or reported from the field;
- `replica-not-empty`, `DOMAIN_INVALID` or `STORAGE_LOST` observed without a deliberate trigger;
- a quota or eviction test losing previously saved data;
- revert verification failure;
- `TransactionInactiveError` in any runtime path;
- a human smoke FAIL.

Deploy the revert build (never a pre-cutover build) when production shows data loss, a wrong-data display, repeated `BLOCKED`/`STORAGE_UNAVAILABLE` states, or an unrecoverable `DOMAIN_INVALID`. The revert must be confirmed by the rollback-drill checklist before a new forward attempt.

## 11. Falsification review (result: PASS)

Each attack was traced against Sections 1-10 and the unchanged Task 1-6 contracts:

| Attack | Result |
|---|---|
| Data loss on switch | Switch adopts only verified complete-marker data equal to the digest read immediately before the switch; legacy stays frozen |
| Legacy edit between migration and switch | Stale reset, then re-migration |
| Legacy edit after switch | Re-adopt when lossless; otherwise preserved and notified, never overwritten |
| Split authority | One authority record, switched transactionally. New-build legacy tabs refuse writes once the hint exists. Residual cross-tab localStorage propagation delay and pre-cutover builds are caught by divergence detection |
| Partial migration | Task 4 guarantees atomic preparation; the switch requires `complete` |
| Partial switch | A crash at any step converges at next boot (Section 2 steps 3-4, re-adopt ordering removes the hint first) |
| Partial runtime write | Single transaction per mutation; all writes after validation |
| Multi-tab races | IndexedDB serializes readwrite transactions. Mutations re-read inside the transaction. The authority `switchId`/`commitCount` guard catches re-adopt or revert under a live tab. Concurrent boots serialize through the lock and switch guard |
| Blocked database | Before the switch it falls back to legacy (still authoritative). After the switch it blocks with retry and never writes legacy |
| Quota or storage loss | Atomic abort with visible error. Eviction is no worse than today. IndexedDB-only loss is detected and recovered with user consent |
| Rollback impossibility | Revert build with backup, verify, guarded status transitions and a failure path back to IndexedDB. Pre-cutover build deployment is forbidden |
| Invalid payload writes | The domain repositories are the only payload producers. Validators run before every write and after every read |
| Transaction auto-commit | Structural read, sync plan, validate, write discipline; thenable plans rejected; direct `transact` use confined to four files by a source guard |

Residual and accepted:
- Edits made in a pre-cutover build tab after a device switched, while IndexedDB already holds edits, are preserved but not adopted (notice plus STOP condition).
- A failed hint write followed by IndexedDB-only loss would restore the switch-time snapshot without the recovery prompt. The hint is retried at every boot.
- If localStorage alone is cleared (hint lost) while IndexedDB stays authoritative and the next open is blocked or fails, that session runs `LEGACY` on empty legacy data. Its writes are then detected as divergence at the next successful boot and preserved, not adopted.
