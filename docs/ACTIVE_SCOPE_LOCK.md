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

Current gate: **VISUAL_POLISH_V2**, the final visual-only interlude before C1. **V2 source scope: OPEN** with the exact files in the Visual Polish V2 scope section below; implementation happens in a separate pass after the scope-open commit. Runtime/storage implementation stays closed until Visual Polish V2 is checkpointed and a separate C1 scope-open pass is approved.

V2 direction (recorded): B-lite; modern native Android; calm warm utility; Material-3 influenced; no dark mode; no storage/runtime changes.
- expected focus: EventDialog mobile bottom-sheet presentation; forms/fields consistency; Kalender, Prügivedu and Seaded visual consistency; final spacing, typography and microinteraction polish;
- still excluded: dark mode, skeleton loaders, bus countdown, dynamic theme-color, new behavior, new data logic.

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

## Visual Polish V2 scope (OPEN; implementation in a separate pass)

Opened at baseline `142e7fb105d09c46ad810b00c9475b32a7088436`. Direction: B-lite; modern native Android; calm warm utility; Material-3 influenced. Primary target 360-430px Android; the 520px centered desktop layout, no horizontal overflow, safe areas, reduced motion and 48px+ primary touch targets are preserved.

**Production write scope (exact; no other production file):**
- `src/design/shell.css`
- `src/design/calendar.css`
- `src/design/waste.css`
- `src/components/SeadedTab.jsx`
- `src/components/EventDialog.jsx`

- `EventDialog.jsx` already uses native `<dialog>` as a mobile bottom sheet and a centered desktop dialog. V2 refines presentation only; its lifecycle, handlers, state and save/delete behavior are unchanged. No swipe-to-dismiss or new JS gestures.
- `SeadedTab.jsx` may replace inline visual styles with CSS classes; all current state, timers, localStorage calls, address resolution and handlers stay byte-for-byte equivalent in behavior.
- Not writable in V2: `KalenderTab.jsx`, `WasteSettings.jsx`, `HouseholdSettings.jsx`, `NotificationSettings.jsx`. Their existing markup is styled through CSS only.

**Test write scope (only for legitimate visual/class expectation changes):**
- `scripts/shell/app-shell.test.mjs`
- `scripts/shell/visual-cases.mjs`
- `scripts/shell/visual-polish.test.mjs`
- `scripts/calendar/browser-cases.mjs`
- `scripts/calendar/calendar-ui.test.mjs`
- `scripts/waste/browser-cases.mjs`
- `scripts/waste/waste-ui.test.mjs`

**Goals:**
1. EventDialog: polished mobile bottom-sheet surface, clear top hierarchy, optional CSS-only grab handle, improved spacing, stronger sticky footer/actions, finger-friendly native forms, safe area preserved; desktop stays a centered modal with balanced width and spacing.
2. Forms and fields: unified input, select, textarea, labels, disabled states, validation/error surfaces and save/cancel actions; 48px+ controls, V1 16px card language, tonal surfaces, strong focus-visible, clear disabled vs read-only distinction.
3. Seaded: remove inline-style inconsistency; section hierarchy, profile card, saved-place cards, address lookup states, diary PIN cards/actions, destructive action presentation, status/success messages. Behavior unchanged.
4. Kalender (CSS only): month card, selected/today states, event rows, agenda rows, legend chips, empty/error states, spacing and typography. No calendar semantics or ordering changes.
5. Prügivedu (CSS only): source card hierarchy, imported and manual schedule cards, notices/statuses, buttons, schedule separation. No provider, search or import behavior change.
6. Final consistency: V1 and V2 read as one system (radii, button hierarchy, card depth, spacing rhythm, typography hierarchy, pressed/focus language).

**Excluded:** dark mode, skeleton loaders, bus countdown, dynamic theme-color, new dependencies, new data, new business logic, new timers, new async behavior, new dialog gestures, storage/runtime cutover, C1-C8.

**Authorized behavior changes:** NONE. **Authorized storage/runtime changes:** NONE.

## Allowed at this gate

- Visual Polish V2 implementation, limited to the production and test write scope above and the recorded goals
- the V2 human visual review and a docs-only checkpoint recording it
- after the V2 checkpoint: a separate docs-only scope-open pass for phase C1 exactly as listed in the runtime cutover plan, if approved

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

- any `src/**`, `scripts/**`, package or config change outside the Visual Polish V2 write scope above (including `KalenderTab.jsx`, `WasteSettings.jsx`, `HouseholdSettings.jsx`, `NotificationSettings.jsx`)
- any behavior, data, storage, hook, data-contract, bus-logic or calendar/waste semantic change during Visual Polish V2
- dark mode, skeleton loaders, bus live countdown, dynamic theme-color behavior, new dependencies, new data, new business logic, new timers, new async behavior, new dialog gestures (including swipe-to-dismiss)
- opening any phase C1-C8 without its own scope-open pass (C1 cannot open before the V2 checkpoint)
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

NEXT: implement Visual Polish V2 within its opened scope. The runtime cutover plan is ACCEPTED and Visual Polish V1 is CHECKPOINTED; runtime implementation remains LOCKED until the V2 checkpoint and a separate approved C1 scope-open pass.
