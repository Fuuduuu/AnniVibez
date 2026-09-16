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

**PHASE_A_INDEXEDDB_FOUNDATION**: ACCEPTED (`PHASE_A_FINAL_HUMAN_REVIEW = ACCEPTED`; range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`).

**RUNTIME_CUTOVER_PLAN**: HUMAN ACCEPTED in `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (accepted plan checkpoint `8077c0e2626f1be1ef149a5690f43aa1e46cb248`). Four independent fresh reviews returned AMEND and amendments 1 (A-D), 2 (A-C), 3 (A-C) and 4 (A-B) were applied (plan Section 12); the final fresh independent review is PASS. Implementation phases C1-C8 remain LOCKED.

**VISUAL_POLISH_V1**: ACCEPTED / CHECKPOINTED (implementation `f367f2c06f3a4d5e96abb8ca7f4f8d96028491ee`; review PASS; behavior and storage/runtime changes NONE).

**VISUAL_POLISH_V2**: ACCEPTED / CHECKPOINTED (implementation `67f8ad55345e3a9c41b23e233167a394123e88a5`; independent review PASS; behavior drift NONE FOUND; storage/runtime changes NONE). The visual-polish interlude is CLOSED.

Current gate: **RUNTIME_CUTOVER_C1**. **C1 source scope: OPEN** with the exact files in the Runtime cutover C1 scope section below; implementation happens in a separate pass. Runtime behavior change: NONE (storage foundation stays dormant). C2-C8 remain LOCKED.

The accepted plan is authoritative for cutover design. It resolves the six acceptance items: authority-switch ordering, the Android/installed-PWA human gate, blocked open/`versionchange`/multi-tab/schema upgrades, the `close()` open race, the transaction-body async invariant and the runtime payload-validation boundary. It also defines:
- the neutral saved-place module prerequisite (A);
- unknown authority as `BLOCKED`/`STORAGE_UNAVAILABLE`, never `LEGACY` (B);
- the hint write as a `READY` gate (C);
- the exact `versionchange` propagation contract (D);
- exact authority-record and hint contracts, authoritative empty-state revert export, and write-once backups with byte-for-byte compensation (amendment 2);
- no automatic re-adopt after the switch (divergence is `LEGACY_DIVERGED` plus STOP), a durable IndexedDB revert-attempt record gating export and resume, and the corrected calendar order note (amendment 3);
- a confirm-only `REVERT_STORAGE_LOST` state for the revert build with authority absent and a non-null hint, and collision-safe revert `attemptId` selection that never overwrites an existing backup key (amendment 4).

All accepted Phase A Task 1-6 contracts remain unchanged except the narrow C1 and C2 amendments named in that plan, which take effect only when those phases are opened.

## Accepted state carried forward

- legacy localStorage remains the runtime authority; the running application uses its existing accepted localStorage/runtime paths
- the Phase A migration remains DORMANT; nothing outside `src/storage/` imports the storage foundation and the application bundle excludes `src/storage/`

## Runtime cutover C1 scope (OPEN; implementation in a separate pass)

Opened at baseline `022b8b72cfec44b5b3e0433489f1ac5d67e7d356`, following the accepted plan `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 5 items 4 and 4a; Section 7 row C1; Section 8 C1). Purpose: Phase A amendments only — the `localReplica` close/open race and the IndexedDB connection-event contract. Runtime behavior change: NONE; the storage foundation stays dormant.

**Exact write scope (no other source or test file):**
- `src/storage/localReplica.js`
- `src/storage/indexedDb.js`
- `scripts/storage/storage.test.mjs`
- `scripts/storage/indexeddb-browser.test.mjs`

**Contract: `localReplica` close/open race**
- the replica keeps a generation counter; `close()` increments it, drops `activeDb`, awaits any in-flight open (ignoring its error) and closes the resulting handle;
- an open that resolves for a stale generation closes its handle and rejects with `DOMException` name `ReplicaClosedError`;
- `open()` after an explicit `close()` starts a new generation (reopen stays allowed);
- `close()` resolves only after no handle of an older generation remains open.

**Contract: IndexedDB connection events**
- signature `openMajandusDb(indexedDb = globalThis.indexedDB, { onVersionChange, onClose } = {})`; existing default argument and blocked/late-success behavior unchanged;
- `versionchange`: close the DB handle first, then call `onVersionChange({ oldVersion, newVersion })`;
- browser-initiated `close`: call `onClose()`;
- without options, behavior equals the accepted Task 1 contract (close on `versionchange`).

**Contract: replica subscription and lost state**
- `replica.subscribe(listener)` returns an idempotent `unsubscribe`; events are exactly `{ type: 'versionchange', oldVersion, newVersion }` or `{ type: 'close' }`;
- for a current-generation connection event: drop `activeDb`, enter the terminal `lost` state, then notify every current listener synchronously in subscription order; a throwing listener does not block later listeners, and the first thrown error is rethrown from a `queueMicrotask` callback after all listeners ran;
- events from a stale generation are ignored;
- in `lost`: `open()` and `transact()` reject with `DOMException` name `ReplicaConnectionLostError`, with no additional `indexedDb.open()` call; explicit `close()` on a lost replica resolves; recovery is only a new replica after a reload.

**Acceptance tests (C1)**
- stub close race: controlled in-flight open; `close()` before success; resulting handle closed; stale caller receives `ReplicaClosedError`; subsequent reopen succeeds;
- stub connection events: `versionchange` closes the handle before the listener runs; exact `versionchange` payload; active handle dropped; later `open`/`transact` reject `ReplicaConnectionLostError`; zero additional `indexedDb.open` calls; `onclose` delivers exactly `{ type: 'close' }`; listeners run in subscription order; a throwing listener does not block later listeners (error rethrown in a microtask); `unsubscribe` is idempotent and prevents delivery; stale-generation events are ignored; `openMajandusDb()` without options keeps close-on-`versionchange`;
- Chromium: replica A subscribed; a second connection opens `DB_VERSION + 1`; A receives exactly one `versionchange`; A's handle closes; the upgrade completes without `blocked`; A's `transact` rejects `ReplicaConnectionLostError`; `deleteDatabase` delivers `newVersion: null` and completes;
- regression: all accepted Phase A Task 1-6 suites stay green.

**Boundaries:** nothing outside `src/storage/` imports the storage foundation; no React/runtime wiring; no startup migration; no cutover; no backend, authentication, sync or outbox work; the Task 6 source and bundle guards stay green.

## Allowed at this gate

- C1 implementation, limited to the four files and the contract and tests in the Runtime cutover C1 scope section above
- the C1 review and a docs-only checkpoint recording it
- after the C1 checkpoint: a separate docs-only scope-open pass for C2 exactly as listed in the plan, if approved

## Runtime cutover phases (C1 OPEN; C2-C8 LOCKED)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 (OPEN) | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` (close race and connection-event contract) |
| C2 | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, storage tests; opens only after C2 is accepted |
| C4 | new `src/storage/storageAuthority.js`, storage tests |
| C5 | new `src/storage/replicaRepositories.js`, storage tests |
| C6 | runtime wiring files listed in the plan; desktop human smoke |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, `scripts/**`, package or config change outside the four C1 files
- opening any phase C2-C8 without its own scope-open pass
- any import of `src/storage/` from outside `src/storage/`; React/runtime wiring; changing the application runtime behavior
- further visual-polish source work (the interlude is closed; the 44px dialog header cancel target is a backlog note only)
- runtime cutover: importing storage into App/React or any production component, switching reads from localStorage to IndexedDB, startup migration or any user data migration
- writes to legacy keys by any forward cutover path (only the revert export defined in the plan may write them)
- D1/backend, Cloudflare bindings, network calls, authentication, sync, outbox mutations or outbox UI
- dependency updates (including remediation of the pre-existing `npm audit` report) or deployment
- deploying a pre-cutover build to an origin where any device may have switched
- modifying accepted calendar, household, waste, saved-place, bus or reminder behavior; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Decision gate

NEXT: implement C1 within its opened scope. The runtime cutover plan is ACCEPTED; C2-C8 remain LOCKED.
