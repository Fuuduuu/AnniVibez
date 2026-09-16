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

Current gate: **RUNTIME_CUTOVER_C2**. **C2 source scope: OPEN** with the exact files in the Runtime cutover C2 scope section below; implementation happens in a separate pass. Runtime behavior change: NONE. `legacyMigration.js` code change: FORBIDDEN (comment only). C3-C8 remain LOCKED.

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

## Runtime cutover C2 scope (OPEN; implementation in a separate pass)

Opened at baseline `552ea1b6838200d79e51cb09b082004851efe2d1`, following the accepted plan `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 7 row C2 and its C2 scope, characterization and guard rules; Section 8 C2). Purpose: behavior-preserving extraction of saved-place defaults and normalization into one neutral pure module. Runtime behavior change: NONE.

**Exact production scope (no other production file):**
- new `src/places/savedPlaces.js`
- `src/hooks/useSavedPlaces.js`
- `src/hooks/useSettings.js`
- `src/storage/legacyMigration.js` — COMMENT ONLY: update the existing mirror/reference comment to point to `src/places/savedPlaces.js`; no code change, no import of the new module, accepted Task 3 behavior unchanged

**Exact test scope (no other test file):**
- new `scripts/places/saved-places.test.mjs`
- `scripts/storage/storage.test.mjs`

**Contract: neutral module**
- `src/places/savedPlaces.js` exports `SAVED_PLACE_DEFAULTS`, `normalizePlace` and `normalizePlaces`, containing exactly the current behavior of the duplicated implementations in `src/hooks/useSavedPlaces.js` and `src/hooks/useSettings.js` (byte-for-byte equivalent behavior).

**Contract: `useSavedPlaces.js`**
- replace local `DEFAULTS`, `normalizePlace` and `normalizePlaces` with imports from the neutral module;
- unchanged: `KEY`, load, save, error swallowing, padding, `update`, `add`, `remove`, `resolveAddress`, localStorage semantics.

**Contract: `useSettings.js`**
- replace local defaults and normalizers with the neutral module;
- keep public compatibility: `DEFAULT_PLACES` stays exported (for example `export const DEFAULT_PLACES = SAVED_PLACE_DEFAULTS`, or an equivalent re-export preserving the existing export contract);
- unchanged: profile behavior, places load/save, error swallowing, padding, `saveName`, `updatePlace`, `resolvePlaceAddress`, localStorage semantics.

**Characterization first (before extraction)**
- golden tables captured from both current hook implementations;
- `normalizePlace` classes, at minimum: valid place; missing/null place; blank name; trimmed name; non-string name; missing address; non-string address; valid numeric lat/lon; numeric-string lat/lon; invalid lat; invalid lon; Infinity/NaN-like values; index within defaults; index beyond defaults (`Koht`); extra input properties ignored;
- `normalizePlaces`: non-array; empty array; 1, 3 and 5 items; padding to 3 defaults; no truncation above 3; fresh default objects with no shared mutation;
- both current hooks must agree in every case before extraction. On any difference: STOP (do not pick one behavior).

**Tests**
- `scripts/places/saved-places.test.mjs` proves the golden tables against the neutral module;
- the Task 3 parity oracle in `scripts/storage/storage.test.mjs` imports and uses the neutral module instead of slicing normalization source from a React hook; Task 3 migration output stays identical.

**Guards (after extraction)**
- `useSavedPlaces.js` imports the neutral module and defines no local defaults, `normalizePlace` or `normalizePlaces`;
- `useSettings.js` imports the neutral module, defines no local `normalizePlace`, `normalizePlaces` or default implementation, and keeps the `DEFAULT_PLACES` export;
- `savedPlaces.js` imports nothing from React or `src/storage/` and has no browser, global, storage or network side effects;
- the storage foundation stays dormant: nothing outside `src/storage/` imports it; Task 6 source and bundle guards, the fail-fast sweep and the app-shell suite stay green.

C3 cannot open until C2 is implemented, independently reviewed and checkpointed.

## Allowed at this gate

- C2 implementation, limited to the production and test scope and the contract, characterization and guards above
- the C2 independent review and a docs-only checkpoint recording it
- after the C2 checkpoint: a separate docs-only scope-open pass for C3 exactly as listed in the plan, if approved

## Runtime cutover phases (C1 CHECKPOINTED; C2 OPEN; C3-C8 LOCKED)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 (ACCEPTED / CHECKPOINTED) | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` (close race and connection-event contract) |
| C2 (OPEN) | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, storage tests; opens only after C2 is accepted |
| C4 | new `src/storage/storageAuthority.js`, storage tests |
| C5 | new `src/storage/replicaRepositories.js`, storage tests |
| C6 | runtime wiring files listed in the plan; desktop human smoke |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, `scripts/**`, package or config change outside the six C2 files
- any code change in `src/storage/legacyMigration.js` (comment only), or importing the neutral module into it during C2
- opening any phase C3-C8 without its own scope-open pass (C3 not before the C2 checkpoint)
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

NEXT: implement C2 within its opened scope (characterization first). The runtime cutover plan is ACCEPTED and C1 is CHECKPOINTED; C3-C8 remain LOCKED.
