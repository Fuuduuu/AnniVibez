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

**RUNTIME_CUTOVER_C1**: ACCEPTED / CHECKPOINTED (final implementation `704cc7a815d1df1efdbfba979814aceb94886c09`; independent review initial AMEND, final PASS / ACCEPT; runtime behavior change NONE; storage foundation DORMANT). C1 source scope: CLOSED.

**RUNTIME_CUTOVER_C2**: ACCEPTED / CHECKPOINTED (implementation `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e`; independent source review PASS / ACCEPT; runtime behavior change NONE; runtime/storage activation NONE). C2 source scope: CLOSED.

Current gate: **RUNTIME_CUTOVER_C3**. **C3 source scope: OPEN** with the exact files in the Runtime cutover C3 scope section below; implementation happens in a separate pass. Runtime behavior change: NONE (C3 stays dormant). C4-C8 remain LOCKED.

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

## Runtime cutover C1 (ACCEPTED / CHECKPOINTED)

Final implementation `704cc7a815d1df1efdbfba979814aceb94886c09`. The accepted contract is recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C1`) and in the plan (Section 5 items 4 and 4a). Evidence: storage `65/65`, IndexedDB/Chromium `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS.

## Runtime cutover C2 (ACCEPTED / CHECKPOINTED)

Implementation `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e`. The accepted result is recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C2`): `src/places/savedPlaces.js` is the neutral pure canonical saved-place module used by both hooks; `legacyMigration.js` code is unchanged. Evidence: saved places `6/6`, storage `66/66`, IndexedDB `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS.

## Runtime cutover C3 scope (OPEN; implementation in a separate pass)

Opened at baseline `65e34d702fed498960c07dc88ebefd2fc917c346`, following the accepted plan `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 5 items 5 and 6; Section 1a runtime-write mutation; Section 7 row C3; Section 8 C3). The C2 prerequisite is satisfied. Purpose: (1) the runtime record validation boundary and (2) the transaction-safe runtime mutation helper. Runtime behavior change: NONE; C3 stays dormant.

**Exact production scope (no other production file):**
- new `src/storage/runtimeRecords.js`
- new `src/storage/runtimeWrites.js`

**Exact test scope (no other test file):**
- `scripts/storage/storage.test.mjs`
- `scripts/storage/indexeddb-browser.test.mjs`

**Contract: runtime records (`runtimeRecords.js`)**
- provides `validateRuntimeRecord(store, record)`, reusing the accepted Task 2 envelope validators instead of reimplementing their semantics;
- every runtime domain record keeps `syncStatus: 'local'`, `revision: 0`, `deletedAt: null`, then the accepted domain semantics apply:
  - `calendarEvents`: `validateEvent(record.payload)` deep-equals the original payload and `record.payload.id === record.id`; normalization never silently repairs or changes the payload;
  - `wasteState`: `validateImportHistory(record.payload.wasteImports)` (accepted waste semantics only);
  - `householdProfile`: validated through the accepted household repository save path (`createHouseholdRepository`) on an in-memory adapter; `serverHouseholdId === null`; the profile returned by the save path equals the supplied payload after the defined `serverHouseholdId` handling; household rules are not duplicated;
  - `sharedPlaces`: `normalizePlace(payload, record.order)` from `src/places/savedPlaces.js` deep-equals the payload, and orders are the contiguous integers `0..n-1` over the relevant collection or plan (not merely "an integer");
- no storage module imports a React hook.

**Contract: mutation helper (`runtimeWrites.js`)**
- provides exactly `runReplicaMutation({ replica, authority, domain, stores, read, plan })`;
- discipline: READ → SYNCHRONOUS PLAN → VALIDATE → SYNCHRONOUS WRITE ISSUE:
  1. read: `read(stores)` may await only `requestResult(...)` promises for requests issued on this transaction's stores; no unrelated async work;
  2. plan: `plan(snapshot)` is synchronous and pure; a thenable result throws `TypeError` before any write request is issued, and the transaction aborts;
  3. validate: every planned runtime record passes the C3 validators synchronously before any write; a failure aborts the whole transaction with zero domain writes and zero authority mutation;
  4. write: all planned `put`/`delete` requests and the authority `commitCount` update are issued synchronously in one block, with no `await` between them;
- every runtime mutation transaction includes `meta` and re-reads `meta/storageAuthorityV1` before writing; it requires a valid authority record, `status === 'active'`, `switchId` equal to the runtime's `switchId`, `commitCount` a non-negative safe integer and `commitCount + 1` still safe;
- a committed mutation increments `commitCount` exactly once; no increment on abort or failure;
- a status or `switchId` mismatch aborts with zero writes; a malformed authority aborts before writes with the plan's `STORAGE_UNAVAILABLE` / `authority-malformed` semantics;
- C3 does not implement the C4 controller or UI state machine.

**Transaction invariant**
- inside a transaction body: no timers, `fetch`, `crypto.subtle`, Web Locks, `BroadcastChannel`, other transactions, caller-supplied async callbacks or other unrelated async work (digests and similar work happen outside the transaction in later phases);
- source guard: direct `replica.transact` / `runTransaction` calls are allowed only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and the future C4 `src/storage/storageAuthority.js`; `storageAuthority.js` is NOT created in C3.

**Dependencies**
- C3 may use the accepted pure/domain dependencies named by Section 5, including `src/places/savedPlaces.js`, `src/calendar/eventModel.js`, `src/waste/reconcile.js` and the accepted household repository; the Task 6 module and import lists are extended only for these;
- the storage forbidden-token guard stays in force (no `navigator`, `localStorage`, `window.`, network or React); no new browser capability is read globally; nothing outside `src/storage/` imports the storage foundation.

**Acceptance tests (C3, minimum)**
- runtime validators: each accepts accepted domain output, rejects each invalid payload class and never silently normalizes invalid data into validity; places validation proven against `src/places/savedPlaces.js`, including collection-order cases proving contiguous `0..n-1`;
- Chromium thenable plan: `plan` returns a thenable → `TypeError` → zero writes;
- validation failure: read and plan succeed, validation fails → transaction abort → every domain and meta write absent;
- authority `commitCount`: one committed runtime mutation increments it exactly once; no increment on abort or failure;
- authority mismatch: wrong `switchId`, and separately `status !== 'active'` → abort, zero domain writes, zero `commitCount` update;
- malformed authority: each malformed class relevant to the C3 write guard aborts before writes with `STORAGE_UNAVAILABLE` / `authority-malformed`;
- Chromium auto-commit hazard: raw read → timer await → attempted write → `TransactionInactiveError`, with proof that no write request was issued before the failure under the read-then-write discipline;
- source guards: `runtimeWrites.js` is the only new C3 direct transaction location; `runtimeRecords.js` imports no React hook; no storage import outside `src/storage/`; storage stays dormant.

**Non-goals / forbidden in C3:** C4 authority controller or state machine; C5 repositories; C6 React/runtime wiring; switching runtime authority; startup migration; legacy writes; `BroadcastChannel` runtime behavior; UI or hook changes; schema, version or store changes; backend, authentication, sync or outbox work; dependencies; deployment.

## Allowed at this gate

- C3 implementation, limited to the four files and the contracts and tests above
- the C3 independent review and a docs-only checkpoint recording it
- after the C3 checkpoint: a separate docs-only scope-open pass for C4 exactly as listed in the plan, if approved

## Runtime cutover phases (C1-C2 CHECKPOINTED; C3 OPEN; C4-C8 LOCKED)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 (ACCEPTED / CHECKPOINTED) | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` (close race and connection-event contract) |
| C2 (ACCEPTED / CHECKPOINTED) | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 (OPEN) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C4 | new `src/storage/storageAuthority.js`, storage tests |
| C5 | new `src/storage/replicaRepositories.js`, storage tests |
| C6 | runtime wiring files listed in the plan; desktop human smoke |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, `scripts/**`, package or config change outside the four C3 files (including creating `src/storage/storageAuthority.js`)
- opening any phase C4-C8 without its own scope-open pass (C4 not before the C3 checkpoint)
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

NEXT: implement C3 within its opened scope. The runtime cutover plan is ACCEPTED and C1-C2 are CHECKPOINTED; C4-C8 remain LOCKED.
