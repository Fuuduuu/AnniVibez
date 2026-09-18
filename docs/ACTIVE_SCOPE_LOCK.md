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

Current gate: **RUNTIME_CUTOVER_C6** (C6 SOURCE SCOPE: **OPEN**; opened by the docs-only pass `RUNTIME_CUTOVER_C6_SCOPE_OPEN`; see the Runtime cutover C6 section below). **C5 source scope: CLOSED** (ACCEPTED / CHECKPOINTED). C6 is the actual cutover: runtime behavior change **YES**, but only once C6 is implemented, independently reviewed and accepted; until then the accepted production/runtime baseline is unchanged. C7-C8 remain LOCKED.

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

- legacy localStorage remains the runtime authority in the currently accepted code; the running application uses its existing accepted localStorage/runtime paths until C6 is implemented, reviewed and accepted
- the Phase A migration remains DORMANT in the accepted code; nothing outside `src/storage/` imports the storage foundation and the application bundle excludes `src/storage/` until the C6 implementation is accepted (the C6 importer allowlist below then replaces this rule)

## Runtime cutover C1 (ACCEPTED / CHECKPOINTED)

Final implementation `704cc7a815d1df1efdbfba979814aceb94886c09`. The accepted contract is recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C1`) and in the plan (Section 5 items 4 and 4a). Evidence: storage `65/65`, IndexedDB/Chromium `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS.

## Runtime cutover C2 (ACCEPTED / CHECKPOINTED)

Implementation `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e`. The accepted result is recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C2`): `src/places/savedPlaces.js` is the neutral pure canonical saved-place module used by both hooks; `legacyMigration.js` code is unchanged. Evidence: saved places `6/6`, storage `66/66`, IndexedDB `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS.

## Runtime cutover C3 (ACCEPTED / CHECKPOINTED)

Implementation history `41d0fdadb78ba4adfaf2bd726d6cba9dbd7bed9b` → final `5612953e7c9e07eef411cecc3c6bb5dd5685930d`. The accepted contracts are recorded in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C3`): the runtime record validation boundary (`src/storage/runtimeRecords.js`) and the transaction-safe mutation helper `runReplicaMutation` (`src/storage/runtimeWrites.js`) with READ → synchronous PLAN → VALIDATE → synchronous WRITE, thenable plans and thenable `planned.result` rejected before writes, zero writes on validation or authority failure and exactly one `commitCount` increment per committed mutation. Both modules stay dormant; `src/storage/storageAuthority.js` does not exist yet. Evidence: C3 node `7/7`, storage `73/73`, IndexedDB/Chromium `25/25`, saved places `6/6`, calendar + UI `48/48`, app shell `23/23`, reminders + UI + native `82/82`, waste + UI `53/53`, build PASS, diff check PASS.

## Runtime cutover C4 (ACCEPTED / CHECKPOINTED)

Final implementation `d2d1dad0e688706609b80172e8b10a50c54d138d` (implementation history `bf4c598f5b494bb289d748d48632c77d4be96be9` → `fa4b81055a4d4449bac89ac40fb9dc44f851abef` → `858d777e0b15ef8a61197d9c49262f1818030a20` → final `d2d1dad0e688706609b80172e8b10a50c54d138d`). The accepted contract is recorded in full in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C4`) and in the plan (Sections 1-6; Section 7 row C4; Section 8 C4; Section 10). It implements exactly the already-accepted plan text with no redesign or simplification: the 9-field `storageAuthorityV1` and 5-field `storageRevertAttemptV1` contracts, the exact authority hint contract and `LEGACY` write guard, the full Section 3 startup state machine (including `REVERTING`), the exact Section 2 switch ordering and no-re-adopt divergence rule, the Section 5 item 4a-5 connection-event contract, the Section 6a-6d revert/backup/compensation contract, and the mounted-`READY`/mounted-`LEGACY` runtime-signal semantics added by the final amendment (public `handleRuntimeSignal(signal)`; C4 owns every state decision, C6 only wires browser events to it; no browser globals read in `src/storage/`). Runtime behavior change: NONE; the storage foundation stays dormant. Evidence: C4 node/storage `82/82`, C4 Chromium `41/41`, storage full `82` Node + `66` Chromium, IndexedDB/Chromium full `66/66`, saved places `12/12`, calendar `13/13`, calendar UI `20/20`, app shell `52/52`, reminders + UI + native `80/80` real assertions, waste + UI `53/53`, build PASS, diff check PASS. C4 source scope: CLOSED.

**Dependency / dormancy rules (carried forward, still in force):**
- every `src/storage/` module receives browser capabilities by injection (`indexedDb`, `storage`, `locks`, `broadcast`, `persist`, `cryptoApi`, `clock`, `newId`, `mode`); the Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force;
- nothing outside `src/storage/` imports the storage foundation; the application bundle continues to exclude `src/storage/`;
- direct `replica.transact`/`runTransaction` calls remain allowed only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and `src/storage/storageAuthority.js`.

**Non-goals delivered in C4 (still true, now closed rather than open):** C5 `replicaRepositories.js` was not created; no C6 React/runtime wiring or hook/component change; the actual runtime authority in the running app was not switched; no schema, version or store change; no backend, authentication, sync, outbox or dependency work; no deployment; no legacy cleanup or deletion.

## Runtime cutover C5 (ACCEPTED / CHECKPOINTED)

Final implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b` (implementation history: scope open `590a2a7c56f63a5895a4fd56da7668ad879b95c6` → calendar-read scope amendment `02b5ff1824258bf28d16121517c072d90d0b892a` → initial implementation `5c3f6fee68a5af98390f28706dc759d4737f5a56` → review-amend governance `fbbff8b9dc4fa237ab144a1ac066d70244ef7a4f` → final corrective implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b`). The accepted contract is recorded in full in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C5_SCOPE_OPEN`, `RUNTIME_CUTOVER_C5_CALENDAR_READ_SCOPE_AMEND`, `RUNTIME_CUTOVER_C5_REVIEW_AMEND`, `RUNTIME_CUTOVER_C5`) and in the plan (Section 4; Section 5 items 5 and 6; Section 6; Section 7 row C5; Section 8 C5; Section 10). Dormant IndexedDB domain repositories for household, places, and calendar + waste: `createReplicaRepositories({ replica, authority, newId, clock })` returns `{ household: {load, save}, places: {load, update, add, remove}, calendar: {load, create, update, remove, importWaste} }`. Runtime behavior change: NONE; the storage foundation stays dormant; the application still uses the accepted legacy/localStorage runtime paths.

**Governance chain:**
- `RUNTIME_CUTOVER_C5_CALENDAR_READ_SCOPE_AMEND` (baseline `02b5ff1824258bf28d16121517c072d90d0b892a`): the accepted `localReplica.js` read surface had no collection-read accessor for `calendarEvents`, and `replicaRepositories.js` may never call `replica.transact`/`runTransaction` directly. Resolution: one additive `listCalendarEvents()` accessor in `localReplica.js`, mirroring the accepted `listSharedPlaces()` pattern; no other `localReplica.js` behavior changed; the direct-transaction-caller allowlist is unchanged and does not gain `replicaRepositories.js`.
- `RUNTIME_CUTOVER_C5_REVIEW_AMEND` (baseline `5c3f6fee68a5af98390f28706dc759d4737f5a56`): the independent review of the initial implementation returned AMEND on five findings — (A) an invalid existing places collection could be silently auto-repaired instead of rejected; (B) the parity tests asserted hand-computed values instead of a true legacy-vs-IndexedDB oracle comparison; (C) the failure matrix lacked a generic/other write-error case alongside `QuotaExceededError`; (D) the dependency allowlist omitted the already-necessary `requestResult`; (E) `listCalendarEvents()` used locale-sensitive `localeCompare()` instead of C4's locale-independent `<`/`>` comparator.
- Final corrective implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b` resolved all five findings; the further independent source review returned **PASS / ACCEPT** with remaining C5 source blocker: NONE FOUND.

**Accepted transaction architecture:** every mutation goes only through the accepted C3 `runReplicaMutation(...)`; `replicaRepositories.js` never calls `replica.transact(...)` or `runTransaction(...)` directly (the direct-transaction-caller allowlist stays exactly `localReplica.js`, `legacyMigration.js`, `runtimeWrites.js`, `storageAuthority.js`); every successful mutation re-reads durable authority, requires `status === 'active'` with the matching booted `switchId`, and increments `commitCount` exactly once; every failed mutation writes zero partial domain records and leaves `commitCount` unchanged. `requestResult` from `./indexedDb.js` is an explicit, accepted C5 dependency, scoped only to request promises issued from the stores passed into a `read(...)` callback; it does not authorize `runTransaction`, `openMajandusDb`, direct database opening or schema manipulation.

**Household contract:** `createHouseholdRepository(...)` is the sole semantic authority, run against an in-memory legacy-shaped adapter inside the synchronous PLAN; preserves legacy normalization, partial-patch behavior, default semantics, `serverHouseholdId === null`, `syncStatus: 'local'`, `revision: 0`, `deletedAt: null`; invalid stored state gives `writable: false` with no repair and no write; retained household extras (`householdLegacyEnvelopeExtras`) are never read or written by C5 and stay untouched.

**Places contract:** the accepted C2 neutral module (`normalizePlace`, `normalizePlaces`) is the sole semantic authority for `update`/`add`/`remove`/padding; existing record ids survive updates and position shifts, new ids are minted only for actually new/materialized padded entries, and orders stay contiguous `0..n-1`. Critical guard: every existing record is validated and `validateSharedPlaceOrders(existing records)` runs *before* any transform or reindexing; an invalid existing collection rejects the mutation with zero writes and zero `commitCount` change, with no auto-repair. The inherited C3 resulting-state order validation remains active in addition.

**Calendar + waste contract:** `createEventRepository(memoryStorage, newId)` is the sole semantic authority for `create`/update occurrence/update series/`remove`/`importWaste` — recurrence, occurrence overrides, series behavior, imported-event protection and waste reconciliation are never reimplemented in C5. The semantic envelope is rebuilt from `calendarEvents`, `wasteState` and `calendarLegacyEnvelopeExtras` in canonical event-id order, using the same locale-independent comparator C4's revert/export already uses (`left.id < right.id ? -1 : left.id > right.id ? 1 : 0`, never `localeCompare()`). Envelope fields other than `events`/`wasteImports` stay unchanged, `version` is preserved, and no extras record is created when none existed; a `wasteState` record exists exactly when the semantic output defines `wasteImports`. Invalid stored state gives `writable: false` with no auto-repair.

**Failure/atomicity and multi-tab (accepted evidence):** `QuotaExceededError` and a distinct generic `UnknownError` write failure both atomically preserve previous domain state and `commitCount`, with zero partial writes and no legacy fallback; authority mismatch, malformed authority, an invalid planned record, an invalid resulting places order and an invalid existing places collection all reject with zero writes. Two-tab concurrent household, places and calendar mutations all persist correctly (no lost update; every mutation re-reads current durable state inside its own transaction, never a stale caller snapshot); `commitCount` advances exactly once per successful mutation.

**True parity evidence:** household, places and calendar+waste each have a true oracle-comparison test — two independent worlds (the real accepted legacy code path, and the C5 IndexedDB repository) seeded from semantically equivalent state, run through the same operation, with the resulting semantic state compared directly (calendar events as id-keyed sets, never array position). Calendar coverage includes recurrence, `excludedDates`, `overrides`, the series-date-change reset of both, imported-event protection (both worlds refuse identically) and extras/`version` preservation.

**Evidence:** C5 focused `20/20`, storage Node `82/82`, storage Chromium/IndexedDB `86/86`, saved places `12/12`, calendar `13/13`, calendar UI `20/20` (real assertions), app shell `52/52` combined (`23/23` clean standalone), reminders + UI + native `82/82` combined (`80/80` real assertions before documented cleanup-only EPERM failures), waste + UI `53/53`, build PASS, diff check PASS. The pre-existing Windows Chromium profile-cleanup EPERM (documented since the C4 pass) recurred in combined runs; assertion bodies completed before the `finally` block's `rmSync` failure each time, and a standalone app-shell rerun passed cleanly.

**Dormancy / source guards:** nothing outside `src/storage/` imports the storage foundation; the application bundle continues to exclude `src/storage/`; the runtime remains localStorage. No React import, no hook import, no browser globals (`navigator`, `localStorage`, `window.`), no network, no backend, no schema/version/store change, no dependency update.

**Non-goals delivered in C5 (still true, now closed rather than open):** no C6 runtime wiring; no `main.jsx`/`App.jsx`/hook/component changes; no `StorageStatus` UI; no `BroadcastChannel` or focus/storage DOM listener wiring; the actual runtime authority in the running app was not switched; no backend/auth/sync/outbox work; no schema/version/store changes; no deployment; no legacy cleanup.

**Dependency / dormancy rules (carried forward, still in force):**
- every `src/storage/` module receives browser capabilities by injection; the Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force;
- nothing outside `src/storage/` imports the storage foundation; the application bundle continues to exclude `src/storage/`;
- direct `replica.transact`/`runTransaction` calls remain allowed only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and `src/storage/storageAuthority.js`.

## Runtime cutover C6 (SCOPE OPEN; implementation NOT started)

Opened by the docs-only pass `RUNTIME_CUTOVER_C6_SCOPE_OPEN` at baseline `f919c7f6bef6fbfed15e20609c8cd2e12cdbb878`. Authority: plan Section 1a/1b (authority and hint contracts), Section 2 (switch ordering), Section 3 (startup state machine), Section 4 (multi-tab), Section 5 items 4a-6, Section 6 (fallback/quota/rollback), Section 7 row C6, Section 8 C6, Section 9 (C6 desktop smoke), Section 10 (STOP conditions). This section restates nothing the plan already fixes beyond what is needed to lock the C6 boundary; where they differ the plan wins and the pass STOPs.

**Purpose:** wire the accepted C1-C5 storage foundation into the actual application runtime. `LEGACY` state uses the existing accepted localStorage repositories; `READY` state uses the C5 IndexedDB repositories. No other authority model. **Runtime behavior change: YES** (the first phase where it is), effective only after an accepted C6 implementation.

**Exact production scope (12 files; no other production file):**
`src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (remove the duplicate places writer), `src/components/SeadedTab.jsx` (remove the places fallback), `src/components/EventDialog.jsx`, `src/components/HouseholdSettings.jsx`, `src/components/WasteSettings.jsx` (await async mutators, surface write failure), NEW `src/components/StorageStatus.jsx`, `src/design/shell.css`.

**Exact test scope (5 files; no other test file):**
`scripts/shell/app-shell.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/waste/browser-cases.mjs`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`. The Task 6 dormant import guard becomes the accepted C6 importer-allowlist guard. The reminder, native-notification, saved-places and other existing suites are **run-only** (the reminder UI and native suites already run through `scripts/shell/app-shell.test.mjs`); if READY-mode coverage of any of them needs a change outside the five test files, STOP.

**Runtime import boundary.** After C6 the only permitted importers of `src/storage/**` outside `src/storage/` are `src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`. `useSettings.js` removes its places writer and does not become a storage importer. No component imports storage internals (`StorageStatus.jsx` and the three dialogs/settings components receive state and mutators from the runtime boundary). No generic service layer. This allowlist replaces the C1-C5 "nothing outside `src/storage/` imports storage" rule; every other dormancy rule stays.

**Browser global boundary (unchanged rule, first applied).** `src/storage/**` receives browser capabilities by injection only; the Task 6 forbidden-token guard stays in force. From C6 on, browser globals are read only at the runtime wiring boundary, primarily `src/main.jsx`: `indexedDB`, `localStorage`, `navigator.locks`, `BroadcastChannel`, `navigator.storage.persist`, `crypto`, clock/`newId`, `VITE_STORAGE_AUTHORITY_MODE`. No browser global moves into a storage module.

**Boot order (hard lock, plan Section 2 authoritative):** create controller → subscribe/wire runtime signals → boot controller → resolve storage state → ONLY THEN mount shared-domain hooks. Shared-domain hooks never mount during `BOOTING`, `AUTHORITY_HINT_PENDING`, `BLOCKED`, `STORAGE_UNAVAILABLE`, `STORAGE_LOST`, `REVERTING`, `REVERT_STORAGE_LOST`, `REVERT_FAILED`, except that Buss and device-local functionality stay usable where the plan allows it. No domain hook races migration or switch.

**State → runtime mode:**
- `LEGACY`: existing accepted localStorage repositories; same data, behavior and UI semantics; every new-build `LEGACY` write goes through the accepted C4 hint write guard; a non-null/unreadable hint or an authority-change signal gives `RELOAD_REQUIRED`; never a silent switch inside a mounted `LEGACY` tab.
- `READY`: C5 `createReplicaRepositories(...)`, bound to the `switchId`/authority identity of the successful C4 boot; all mutations async; no hook writes IndexedDB directly or calls `replica.transact()`.
- `READY` + `LEGACY_DIVERGED`: usable from IndexedDB with the accepted non-blocking notice; no legacy repair, merge, re-adopt, legacy write or reset. Rollout STOP condition, not a data-blocking state.
- `DOMAIN_INVALID`: per domain only; that domain `writable: false` with the accepted error, no auto-repair; other valid domains stay usable; never a global fallback to `LEGACY`.

**Storage-state UI:** centralized in NEW `src/components/StorageStatus.jsx` (or the minimal equivalent responsibility inside that exact file); no state-machine logic scattered across components. Exact copy and actions:
- `BOOTING`: minimal splash; no shared-domain hooks.
- `AUTHORITY_HINT_PENDING`: blocking shared-domain screen "Seadme salvestusruum ei võtnud muudatust vastu. Proovi uuesti."; retry button and automatic retry on focus; no `LEGACY` fallback.
- `BLOCKED`: blocking shared-domain screen "Sulge Majanduse teised aknad ja proovi uuesti."; retry button and automatic retry on focus; Buss and device-local functionality stay usable; never silently `LEGACY`.
- `STORAGE_UNAVAILABLE`: blocking shared-domain screen; retry where the plan state contract allows; `authority-malformed` offers no repair/rewrite/retry-to-repair; never `LEGACY`.
- `STORAGE_LOST`: forward recovery screen, dated "Kohalik andmebaas puudub. Taasta andmed seisuga <switchedAt> varukoopiast?" / undated "Taasta andmed seadme varukoopiast?"; confirmation calls the accepted controller recovery path; never automatic.
- `RELOAD_REQUIRED`: banner "Majandus uuenes teises aknas. Laadi leht uuesti." with a reload action; every shared-domain write control disabled.
- `REVERTING`: minimal blocking splash until the revert finishes.
- `REVERT_STORAGE_LOST`: dated "Kohalik andmebaas puudub. Kas kasutada vana salvestust seisuga <switchedAt>? Hilisemad muudatused võivad puududa." / undated "Kohalik andmebaas puudub. Kas kasutada seadme vana salvestust? Hilisemad muudatused võivad puududa."; exactly one confirmation action "Kasuta vana salvestust"; no automatic transition.
- `REVERT_FAILED`: blocking shared-domain state "Taastamine vanale salvestusele ebaõnnestus. Andmed on alles. Proovi uuesti."; retry re-enters `BOOTING`; no `LEGACY` fallback.

**Runtime signal wiring.** C4 owns every state decision through `controller.handleRuntimeSignal(signal)`; C6 only forwards browser signals and never re-implements authority logic in React. Forward: `storage` events (shared legacy keys, the authority hint key, `key === null` on `storage.clear()`), `focus`, `visibilitychange`, and the `authority-changed` broadcast. C6 does not interpret authority semantics (`READY` divergence/hint handling and `LEGACY` -> `RELOAD_REQUIRED` stay in C4).

**Multi-tab / BroadcastChannel.** Channel `majandus:replica`; messages `{ type: 'authority-changed' }` and `{ type: 'committed', domain }`. `authority-changed` -> forwarded to the controller. `committed`/domain -> `READY` receivers re-read that domain from IndexedDB. After a successful domain mutation post `{ type: 'committed', domain }` only after the mutation promise has completed; never before commit. Without `BroadcastChannel`, `focus`/`visibilitychange` re-read the `READY` domain state; no polling. Every mutation plans from transaction-time state (C5). A lost DB connection, `versionchange`, `VersionError` or an authority change under a mounted tab gives `RELOAD_REQUIRED` and disables every shared-domain save control. Plan Section 9 item 5 ("an update in a second tab shows the reload banner") is read together with Section 4: an ordinary committed update refreshes the other `READY` tab (domain re-read), and the reload banner is the required behavior for authority/connection changes; the smoke check follows the accepted signal path.

**Hook contracts.** `useHouseholdEvents`, `useHousehold` and `useSavedPlaces` become dual-mode adapters that consume runtime/storage state supplied by the App/runtime boundary and never decide authority. `LEGACY` keeps the existing repositories; `READY` uses the C5 calendar / household / places repositories. Preserved: event API, recurrence semantics, waste imports, reminders behavior and existing UI state shape where practical (`useHouseholdEvents`); component-facing semantics (`useHousehold`); padding semantics, place order, address-resolution behavior and UI behavior (`useSavedPlaces`). Async mutators propagate rejected writes; a `READY` places write failure is no longer swallowed.

**Places single path.** `useSettings.js` loses its places writer and `SeadedTab.jsx` loses its places fallback; one runtime places path only, no second compatibility writer.

**Async mutators.** `EventDialog.jsx`, `HouseholdSettings.jsx` and `WasteSettings.jsx` await the shared-domain mutators. Failure copy stays the accepted "Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti."; no optimistic success before the IndexedDB commit completes; the previous UI snapshot remains on a failed save; places failures now surface.

**Device-local features unchanged.** The cutover applies only to the three accepted shared domains (calendar events with waste imports, household profile, saved places). Diary, reminder preferences and delivery, saved ideas/tips, `sade_profile` and Buss stay as they are; Buss and device-local availability in blocked/recovery states follows the plan.

**Schema and non-goals.** No `DB_VERSION` bump, new store, store deletion, index change, record cleanup or legacy deletion. No authentication, backend, Cloudflare bindings, network sync, outbox UI, server sync or conflict resolution; the outbox/auth/sync stores stay unused. No dependency change, no preview deployment, no Android/PWA validation (all C7). Forward paths never write a shared legacy key after the switch.

**Automated acceptance (plan Section 8 C6 minimum).** (1) app-shell, calendar, waste and reminder browser suites pass in both `LEGACY` and `READY`; (2) a real seeded legacy profile (household, places, calendar events, waste imports) boots the real runtime, switches, mounts `READY`, and shows semantically identical data with no visible loss; (3) reload persistence after `READY` mutations; (4) real Chromium `versionchange` with the app mounted `READY` (second connection) shows the reload banner and disables every shared-domain write control; (5) an injected hint-write failure at boot shows `AUTHORITY_HINT_PENDING` with no domain hooks mounted and writes disabled; (6) an injected malformed authority record shows `STORAGE_UNAVAILABLE`, never `LEGACY`; (7) the storage importer-allowlist guard (the converted Task 6 guard) finds no unexpected importer; (8) a bundle check that `src/storage/` is present only through the accepted importer set, with no component-level or unrelated import. Full validation: storage, IndexedDB Chromium, saved places, calendar, calendar UI, app shell, reminders, reminder UI, native notifications, waste, waste UI, `npm run build`, `git diff --check`, plus the new C6 `LEGACY`/`READY` runtime cases. Any accepted-suite regression is a STOP.

**Desktop human smoke (mandatory after C6 source review; cannot be replaced by automated tests).** On desktop Chrome: (1) existing data appears after the switch; (2) create/edit/delete in every shared domain; (3) reload confirms persistence; (4) two-tab behavior; (5) an update in the second tab refreshes or requires reload per the accepted signal path; (6) trigger/observe the reload-banner path; (7) visual parity against the pre-switch legacy UI for calendar grid, agenda, home upcoming list, `KalenderTab` legend and `WasteSettings` imported subtype labels. Accepted exception: `WasteSettings` imported subtype label order may differ. Any other visual or data difference is a FAIL. Smoke stays `PENDING` until the human confirms; an agent never marks it PASS. A FAIL blocks the C6 checkpoint and C7.

**STOP conditions (plan Section 10 locked in full), especially for C6:** legacy/`READY` UI or data mismatch; a forward path writing a shared legacy key after the switch; a shared legacy key deletion outside revert compensation; `LEGACY_DIVERGED` in normal smoke; unexpected `DOMAIN_INVALID`, `STORAGE_LOST`, `STORAGE_UNAVAILABLE`, `BLOCKED`, `AUTHORITY_HINT_PENDING` or `REVERT_FAILED`; a quota test losing previous data; `TransactionInactiveError`; `versionchange` allowing another shared-domain write; a human desktop smoke FAIL. Also STOP (and do not widen scope) if C6 needs any production or test file outside the lists above, a schema/version/store change, backend/sync work, or preview/deploy work. No phase advancement after any STOP.

**C6 checkpoint requires:** implementation; automated GREEN; independent source review PASS / ACCEPT; desktop Chrome human smoke PASS; then a docs-only checkpoint. C7-C8 stay LOCKED until then.

## Allowed at this gate

- C6 implementation, strictly inside the exact 12 production files and 5 test files listed in the Runtime cutover C6 section
- docs-only governance for C6 (review-amend records, the C6 checkpoint after review and human smoke)
- no other source, test, package, config or deployment change

## Runtime cutover phases (C1-C5 CHECKPOINTED; C6 SCOPE OPEN; C7-C8 LOCKED)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 (ACCEPTED / CHECKPOINTED) | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` (close race and connection-event contract) |
| C2 (ACCEPTED / CHECKPOINTED) | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 (ACCEPTED / CHECKPOINTED) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C4 (ACCEPTED / CHECKPOINTED) | `src/storage/storageAuthority.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C5 (ACCEPTED / CHECKPOINTED) | `src/storage/replicaRepositories.js`, `src/storage/localReplica.js` (additive `listCalendarEvents()` only), `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C6 (SCOPE OPEN; not yet implemented) | `src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (remove places writer), `src/components/SeadedTab.jsx` (remove places fallback), `src/components/EventDialog.jsx`, `src/components/HouseholdSettings.jsx`, `src/components/WasteSettings.jsx`, new `src/components/StorageStatus.jsx`, `src/design/shell.css`, `scripts/shell/app-shell.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/waste/browser-cases.mjs`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`; desktop human smoke mandatory |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, `scripts/**`, package or config change outside the exact C6 file lists (C1-C5 source scopes are all CLOSED)
- opening or implementing C7-C8 (C7-C8 remain LOCKED)
- any import of `src/storage/` from outside `src/storage/` other than the five C6 allowlisted importers (`src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`); any component importing storage internals; a generic service layer; browser globals inside `src/storage/**`
- widening C6 silently: any additional production or test file, schema/`DB_VERSION`/store/index change, backend or sync work, or preview/deploy work requires a new docs-only amendment first
- further visual-polish source work (the interlude is closed; the 44px dialog header cancel target is a backlog note only)
- startup migration or user data migration outside the accepted C4 controller path; legacy cleanup or deletion
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

NEXT: implement C6 strictly within the exact file lists in the Runtime cutover C6 section, then automated validation, independent source review, desktop Chrome human smoke and a docs-only C6 checkpoint. The runtime cutover plan is ACCEPTED, C1-C5 are CHECKPOINTED and C6 SOURCE SCOPE is OPEN; C7-C8 remain LOCKED.
