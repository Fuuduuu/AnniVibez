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

Current gate: **VISUAL_POLISH_V1**, an intentional visual-only interlude before C1. Runtime/storage implementation stays closed until Visual Polish V1 is checkpointed and a separate C1 scope-open pass is approved.

Recorded state: the Visual Polish V1 implementation commit `f367f2c06f3a4d5e96abb8ca7f4f8d96028491ee` is already on `main`; it is not yet checkpointed.

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

## Allowed at this gate

- Visual Polish V1 only: visual presentation of the Kodu dashboard, card system, bottom navigation, buttons/controls, `BussCard` and existing motion
- V1 surfaces: `src/design/tokens.js`, `src/design/shell.css`, `src/components/ShellViews.jsx`, `src/components/BussCard.jsx`, `src/components/ShellIcon.jsx`; `src/App.jsx` only for visual shell structure, classes or CSS variables with zero behavioral change; tests only where visual structure or class expectations legitimately change
- the V1 human visual review and a docs-only checkpoint recording it
- after the V1 checkpoint: a separate docs-only scope-open pass for phase C1 exactly as listed in the plan, if approved

## Locked phases (none open)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, storage tests (close race and connection-event contract) |
| C2 | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, storage tests; opens only after C2 is accepted |
| C4 | new `src/storage/storageAuthority.js`, storage tests |
| C5 | new `src/storage/replicaRepositories.js`, storage tests |
| C6 | runtime wiring files listed in the plan; desktop human smoke |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, test, package or config change outside the Visual Polish V1 surfaces above
- any behavior, data, storage, hook, data-contract, bus-logic or calendar/waste semantic change during Visual Polish V1
- dark mode, skeleton loaders, bus live countdown, dynamic theme-color behavior, bottom-sheet dialogs, new dependencies, or Visual Polish V2 work
- opening any phase C1-C8 without its own scope-open pass (C1 cannot open before the V1 checkpoint)
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

NEXT: Visual Polish V1 human visual review and checkpoint. The runtime cutover plan is ACCEPTED; runtime implementation remains LOCKED until the V1 checkpoint and a separate approved C1 scope-open pass.
