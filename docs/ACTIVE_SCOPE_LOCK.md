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

**RUNTIME_CUTOVER_C3**: ACCEPTED / CHECKPOINTED (final implementation `5612953e7c9e07eef411cecc3c6bb5dd5685930d`; independent review initial AMEND, final PASS / ACCEPT; runtime behavior change NONE; storage foundation DORMANT). C3 source scope: CLOSED.

Current gate: **RUNTIME_CUTOVER_C4**. **C4 source scope: OPEN** with the exact files, locked contract and test scope in the Runtime cutover C4 scope section below; implementation happens in a separate pass. Runtime behavior change: NONE (C4 stays dormant). C5-C8 remain LOCKED.

The accepted plan is authoritative for cutover design. It resolves the six acceptance items: authority-switch ordering, the Android/installed-PWA human gate, blocked open/`versionchange`/multi-tab/schema upgrades, the `close()` open race, the transaction-body async invariant and the runtime payload-validation boundary. It also defines:
- the neutral saved-place module prerequisite (A);
- unknown authority as `BLOCKED`/`STORAGE_UNAVAILABLE`, never `LEGACY` (B);
- the hint write as a `READY` gate (C);
- the exact `versionchange` propagation contract (D);
- exact authority-record and hint contracts, authoritative empty-state revert export, and write-once backups with byte-for-byte compensation (amendment 2);
- no automatic re-adopt after the switch (divergence is `LEGACY_DIVERGED` plus STOP), a durable IndexedDB revert-attempt record gating export and resume, and the corrected calendar order note (amendment 3);
- a confirm-only `REVERT_STORAGE_LOST` state for the revert build with authority absent and a non-null hint, and collision-safe revert `attemptId` selection that never overwrites an existing backup key (amendment 4).

All accepted Phase A Task 1-6 contracts remain unchanged except the narrow C1, C2 and C3 amendments named in that plan, which take effect only when those phases are opened.

## Accepted state carried forward

- legacy localStorage remains the runtime authority; the running application uses its existing accepted localStorage/runtime paths
- the Phase A migration remains DORMANT; nothing outside `src/storage/` imports the storage foundation and the application bundle excludes `src/storage/`

## Runtime cutover C1 (ACCEPTED / CHECKPOINTED)

Final implementation `704cc7a815d1df1efdbfba979814aceb94886c09`. The accepted contract is recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C1`) and in the plan (Section 5 items 4 and 4a). Evidence: storage `65/65`, IndexedDB/Chromium `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS.

## Runtime cutover C2 (ACCEPTED / CHECKPOINTED)

Implementation `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e`. The accepted result is recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C2`): `src/places/savedPlaces.js` is the neutral pure canonical saved-place module used by both hooks; `legacyMigration.js` code is unchanged. Evidence: saved places `6/6`, storage `66/66`, IndexedDB `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS.

## Runtime cutover C3 (ACCEPTED / CHECKPOINTED)

Implementation history `41d0fdadb78ba4adfaf2bd726d6cba9dbd7bed9b` → final `5612953e7c9e07eef411cecc3c6bb5dd5685930d`. The accepted contracts are recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C3`): the runtime record validation boundary (`src/storage/runtimeRecords.js`) and the transaction-safe mutation helper `runReplicaMutation` (`src/storage/runtimeWrites.js`) with READ → synchronous PLAN → VALIDATE → synchronous WRITE, thenable plans and thenable `planned.result` rejected before writes, zero writes on validation or authority failure and exactly one `commitCount` increment per committed mutation. Both modules stay dormant; `src/storage/storageAuthority.js` does not exist yet. Evidence: C3 node `7/7`, storage `73/73`, IndexedDB/Chromium `25/25`, saved places `6/6`, calendar + UI `48/48`, app shell `23/23`, reminders + UI + native `82/82`, waste + UI `53/53`, build PASS, diff check PASS.

## Runtime cutover C4 scope (OPEN; implementation in a separate pass)

Opened at baseline `e2514e401ad93f66b24a4e2f282b7daecaa322e8`, following the accepted plan `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Sections 1-6; Section 7 row C4; Section 8 C4; Section 10). The C3 prerequisite is satisfied. Purpose: the authority controller and the complete dormant cutover state machine. Runtime behavior change: NONE; C4 stays dormant.

**Exact production scope (no other production file):**
- new `src/storage/storageAuthority.js`

**Exact test scope (no other test file):**
- `scripts/storage/storage.test.mjs`
- `scripts/storage/indexeddb-browser.test.mjs`

**Locked contract — implement exactly the already-accepted plan text; do not redesign or simplify it.**

**Authority record (plan Section 1a):**
- the exact 9-field `storageAuthorityV1` shape; extra or missing keys are malformed;
- strict validation on every read (boot, runtime write guard, revert, reset);
- a fresh switch writes every field explicitly with fresh `switchId`/`switchedAt` values, `commitCount: 0`, `legacyUntrusted: false`, `persistGranted: null`, validated before `put`;
- immutable after creation: `key`, `switchId`, `switchedAt`, `legacyDigestAtSwitch`, `markerPreparationId`;
- only the Section 1a mutation table's guarded mutations are allowed (runtime write, persist result, begin revert, revert aborted before export, compensation verified, compensation failed, forward build finds `reverting`, revert complete); `legacyUntrusted` only `false → true`; `persistGranted` only `null →` boolean;
- the authority record is deleted only in the reverted reset; no path deletes an `active` or `reverting` record or deletes because of divergence; `commitCount` is diagnostic only and never authorizes deletion or reset;
- `persist()` lifecycle exactly as specified: attempted at most once per boot while `active` and `persistGranted === null`; a resolved boolean is stored and never retried; rejection, unavailability or a non-boolean leaves it `null` and retries next boot; the cutover never waits for, depends on or rolls back because of `persist()`;
- a malformed record on any read gives `STORAGE_UNAVAILABLE`/`authority-malformed` with no legacy writes, repair, reset or revert; STOP condition.

**Authority hint (plan Section 1b):**
- the exact `majandus_storage_authority_v1` JSON shape;
- classification: `absent`/`valid`/`malformed`/`unreadable`; a valid hint matches when `switchId`, `legacyDigestAtSwitch` and `switchedAt` are all equal;
- hint write is a verified gate (`setItem` then exact `getItem` read-back); hint removal is verified (`removeItem` then `getItem === null`); either failure is a failure;
- the full behavior matrix of Section 1b, including malformed-hint-with-no-authority → undated `STORAGE_LOST` (never `LEGACY`), unreadable-hint-with-no-authority → `STORAGE_UNAVAILABLE`, and the `reverted`/absent/active rows exactly as written;
- the `LEGACY` write guard: any non-null hint value or a throwing `getItem` refuses the legacy write and enters `RELOAD_REQUIRED`.

**Revert attempt record (plan Section 1c):**
- the exact 5-field `storageRevertAttemptV1` shape under `meta`;
- validity requires the shape, authority valid `reverting`, matching `switchId`, and `commitCountAtStart === commitCount`;
- phase only moves `started → backups-verified`; `key`/`switchId`/`attemptId`/`commitCountAtStart` are immutable;
- the first shared legacy `setItem` of an export happens only after the `backups-verified` transaction reports `oncomplete` in the current session;
- orphan attempt (any value while authority is absent/`active`/`reverted`, or a different `switchId`) → `STORAGE_UNAVAILABLE`/`revert-attempt-orphan`, zero writes, STOP condition;
- missing/malformed attempt under `reverting`: revert build → `REVERT_FAILED`/`revert-attempt-invalid`, zero writes, STOP condition; forward build → the Section 1a forward row.

**Startup state machine (plan Section 3):** implement every state and its exact entry condition and app behavior — `BOOTING`, `LEGACY`, `READY`, `READY + LEGACY_DIVERGED`, `DOMAIN_INVALID` (per domain), `AUTHORITY_HINT_PENDING`, `BLOCKED`, `STORAGE_UNAVAILABLE`, `STORAGE_LOST`, `RELOAD_REQUIRED`, `REVERTING`, `REVERT_STORAGE_LOST`, `REVERT_FAILED` — exactly as the Section 3 table specifies, including the exit rules (reload/retry re-enters `BOOTING`; `AUTHORITY_HINT_PENDING` also exits on a successful hint gate) and the accepted availability trade-off.

**Switch ordering (plan Section 2):** lock the exact sequence of Section 2 step 1-10 — open/read authority (unknown authority never falls back to `LEGACY`, whatever the hint says) → hint handling → migration (`runLegacyMigration`, unchanged) → stale reset where the plan allows it → source re-read and digest recompute (outside any transaction) → the atomic switch transaction (Section 1a fresh-switch fields) → the hint gate → the post-switch divergence confirmation → the `persist()` lifecycle → snapshot load and `READY` mount. The valid-`active` and valid-`reverting` paths (Section 2 steps 3-4) apply the same hint matrix, divergence check and `persist()` lifecycle.

**Divergence (no re-adopt), plan Section 2:**
- after the switch, IndexedDB stays authoritative on any divergence; no automatic re-adopt, reset, re-migration or second switch attempt;
- no authority, marker, extras or migrated record is deleted or changed because of divergence; current legacy bytes (including absent keys) are preserved: no `setItem`/`removeItem` on a shared key and no hint removal;
- the state is `READY` with the non-blocking `LEGACY_DIVERGED` notice; a throwing legacy read during the check is treated as divergence, never writing anything;
- every occurrence is a rollout STOP condition needing an explicit, separately accepted recovery decision.

**Connection lifecycle (plan Section 5 item 4a-5):**
- the boot controller subscribes to its replica immediately after creating it, before Section 2 step 1 opens the database, and keeps the subscription for the page lifetime;
- the subscription listener sets runtime state `RELOAD_REQUIRED` and notifies runtime-state subscribers;
- a `ReplicaConnectionLostError` from any boot step (migration, reset, switch, hint gate, snapshot load, revert) also resolves to `RELOAD_REQUIRED`, never `LEGACY`;
- `versionchange`, browser-initiated `close`, `ReplicaConnectionLostError` and `VersionError` (database newer than the build) all converge to the accepted `RELOAD_REQUIRED` behavior; a `VersionError` build never deletes or downgrades;
- domain repositories reject new mutations with `ReplicaConnectionLostError` without touching IndexedDB (repository wiring itself remains C5/C6 scope; C4 only implements the controller side of this contract).

**Revert (plan Sections 6a-6d):**
- 6a: authoritative semantic export of all three domains from the current IndexedDB state (never a frozen legacy value for an empty domain), plus its exact verification reads;
- 6b: collision-safe `attemptId` selection (probe → up to 3 candidates → `REVERT_FAILED`/`revert-attempt-id-collision` or `revert-backup-key-unreadable` on failure with zero writes), write-once backup sets, the verified current-attempt pointer, the exact preparation step sequence (0-6) and its failure handling, and the retention rule that backups and pointers are never deleted by this plan;
- 6c: the full revert procedure (begin/resume, snapshot validation, preparation, export, verification, revert-complete, and byte-for-byte compensation on any post-first-write failure) exactly as specified, including the forward-build convergence from `reverting`;
- 6d: the revert-build authority-absent matrix and its confirmation flow (zero writes before confirmation, verified hint removal, then `LEGACY`), both `REVERT_STORAGE_LOST` variants as STOP conditions;
- no existing backup key is ever overwritten by any attempt, in any phase.

**Dependency / dormancy rules:**
- C4 may use the existing accepted storage foundation and C1-C3 modules, and the accepted pure domain dependencies the plan already allows (Section 5 item 6), exactly as the plan permits;
- every `src/storage/` module receives browser capabilities by injection (`indexedDb`, `storage`, `locks`, `broadcast`, `persist`, `cryptoApi`, `clock`, `newId`, `mode`); the Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force;
- nothing outside `src/storage/` imports the storage foundation; the application bundle continues to exclude `src/storage/`;
- direct `replica.transact`/`runTransaction` calls remain allowed only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and the new `src/storage/storageAuthority.js`.

**C4 test scope (Section 8 C4, cumulative — do not collapse or reduce any class):**
- every Section 3 state and transition;
- the full authority-contract matrix (fresh-switch exact fields, every malformed class at boot/runtime-write/revert, invalid `now()` prevents the switch, immutable-field and forward-only-field proofs);
- the full `persist()` matrix;
- the full hint-contract matrix (every Section 1b row, the malformed/unreadable no-authority rows, the `LEGACY` write guard);
- switch success and the stale-reset race;
- unknown-authority classification (`BLOCKED` vs `STORAGE_UNAVAILABLE`) across hint states, never `LEGACY`;
- the hint-gate failure/retry matrix;
- the full divergence/no-re-adopt case set (clear-one-key, clear-all, old-build edit, step-9 confirmation, throwing legacy read, the authority/marker/extras/domain-delete source guard);
- switch crash-window points (after steps 2.7 and 2.8);
- `STORAGE_LOST` restore;
- two-boot concurrency (exactly one switch);
- connection events delivered during every boot stage (migration, switch, hint gate, snapshot load, revert), never `LEGACY`;
- the full revert-export matrix (6a);
- the full backups matrix (6b), including the attempt-id-collision case set;
- the full revert attempt-record matrix (1c);
- the full revert-build-authority-absent matrix (6d);
- the full revert resume/crash-point matrix;
- the full compensation matrix (6c);
- the legacy-write/legacy-delete invariants and the private-key-never-read invariant;
- source guards: `storageAuthority.js` is the only new C4 direct-transaction location; no storage import outside `src/storage/`; storage stays dormant;
- C1-C3 cumulative suites (storage, IndexedDB/Chromium) remain mandatory and green throughout.

**Non-goals / forbidden in C4:** C5 `replicaRepositories.js`; C6 React/runtime wiring or any hook/component change; switching the actual runtime authority in the running app; schema, version or store changes; backend, authentication, sync, outbox or dependency work; deployment; legacy cleanup or deletion.

## Allowed at this gate

- C4 implementation, limited to the one production file, the two test files and the locked contract and test scope above
- the C4 independent review and a docs-only checkpoint recording it
- after the C4 checkpoint: a separate docs-only scope-open pass for C5 exactly as listed in the plan, if approved

## Runtime cutover phases (C1-C3 CHECKPOINTED; C4 OPEN; C5-C8 LOCKED)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 (ACCEPTED / CHECKPOINTED) | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` (close race and connection-event contract) |
| C2 (ACCEPTED / CHECKPOINTED) | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 (ACCEPTED / CHECKPOINTED) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C4 (OPEN) | new `src/storage/storageAuthority.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C5 | new `src/storage/replicaRepositories.js`, storage tests |
| C6 | runtime wiring files listed in the plan; desktop human smoke |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, `scripts/**`, package or config change outside the C4 production file and the two C4 test files (C1-C3 source scopes are CLOSED)
- redesigning, simplifying or narrowing any locked C4 contract item (Sections 1-6) relative to the accepted plan text
- opening any phase C5-C8 without its own scope-open pass (C5 not before the C4 checkpoint)
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

NEXT: implement C4 within its opened scope. The runtime cutover plan is ACCEPTED and C1-C3 are CHECKPOINTED; C5-C8 remain LOCKED.
