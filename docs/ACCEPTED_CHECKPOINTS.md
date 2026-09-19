# ACCEPTED_CHECKPOINTS.md

## Accepted checkpointid

### Phase A backend foundation authority
**Staatus:** accepted

- `COMMON_BACKEND_ARCHITECTURE_V1 = ACCEPTED`
- `PHASE_A_INDEXEDDB_FOUNDATION_PLAN = ACCEPTED`
- plan checkpoint: `4e9a65af179c45ce95395aae21d577fe90ed13b2`
- `PHASE_A_TASK_1_INDEXEDDB_SCHEMA_PRIMITIVES = ACCEPTED / COMPLETE`
- Task 1 checkpoint: `f2fe59c7b1704c5a1feb2266123606acaa4a1342` (`feat: add native IndexedDB foundation`)
- Task 1 evidence: real Chromium IndexedDB tests `5/5 PASS`, `npm run build` PASS, `git diff --check` PASS, runtime cutover NO
- `PHASE_A_TASK_2_LOCAL_REPLICA_CONTRACTS = ACCEPTED / COMPLETE`
- Task 2 checkpoint: `5d7546fbf96fff77b738b48ca0b1e5f5936cfc48` (`feat: add local replica storage contracts`)
- Task 2 evidence: Chromium storage tests `6/6 PASS` (Task 1 regression PASS, Task 2 validator/outbox tests PASS), `npm run build` PASS, `git diff --check` PASS, runtime cutover NO
- approved next action: `TASK_3_LEGACY_VALIDATION_TRANSFORM_DIGEST`; Task 4+ locked

### TASK_3_RETURN_CONTRACT_AMENDMENT
- status: ACCEPTED
- baseline: `a083c6d467c0f00fa1bce2a72544aed1184c22ef`
- closes Task 3 return-shape ambiguity only; Task 3 implementation remains incomplete and Task 4+ remains locked.

### PHASE_A_TASK_3_LEGACY_VALIDATION_TRANSFORM_DIGEST
- status: ACCEPTED / COMPLETE
- commit: `7ace02444fc3783898a14251c62ebe032113e0ea` (`feat: prepare non-destructive legacy migration`)
- surfaces: `src/storage/legacyMigration.js`, `scripts/storage/storage.test.mjs`
- evidence: storage tests `45/45 PASS`, IndexedDB regressions `6/6 PASS`, `npm run build` PASS, `git diff --check` PASS, runtime migration NO
- approved next action: `TASK_4_MIGRATION_STATE_MACHINE` behind the Claude Opus 5 gate; Task 5+ locked

### TASK_4_MIGRATION_CONTRACT_AMENDMENT
- status: ACCEPTED
- baseline: `e8aef8e2eb01cd3f21ff8ce0035b000597dabbc0`
- origin: independent Claude Opus 5 Task 4 contract review returned AMEND
- scope: durable marker, prepared recovery, atomic C+A cleanup/rebuild, changed-source ID policy, verification ownership, locks semantics and exact status mapping; defined in Plan Task 4 "Task 4 migration contracts"
- satisfies the Claude Opus 5 gate; Task 4 implementation is not started and Task 5+ remains locked

### PHASE_A_TASK_4_MIGRATION_STATE_MACHINE
- status: ACCEPTED / COMPLETE
- commit: `e651a6edb2f19bf850e5e67ceac462551f2fd37a` (`feat: harden IndexedDB migration recovery`)
- surfaces: `src/storage/legacyMigration.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- evidence: storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, `npm run build` PASS, final adversarial audit PASS
- migration remains dormant; runtime migration NO; legacy storage non-destructive; migration outbox generation `0`
- the Task 4 production source guard intentionally permits `transact` and `requestResult`
- approved next action: `TASK_5_INTEGRATION_BREADTH_ONLY` (test-only); Task 6+ locked

### PHASE_A_TASK_5_INTEGRATION_BREADTH_ONLY
- status: ACCEPTED / COMPLETE
- implementation commit: `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` (`test: cover IndexedDB migration safety`)
- surfaces: `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`; production files changed: NONE
- evidence: storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, `npm run build` PASS, `git diff --check` PASS
- proven: complete migration path; page reload plus database reopen persistence; 3 shared places in order `[0,1,2]`; marker `complete` after reopen; outbox `0`; all localStorage values unchanged; private sentinels absent from migrated records, marker, envelope extras and digest input; only the 3 approved legacy keys read
- migration remains DORMANT; no live runtime migration has occurred
- approved next action: `TASK_6_DORMANT_GUARD_AND_FAIL_FAST` (final Phase A dormant-foundation pass, test/guard-only); runtime cutover locked

### PHASE_A_TASK_6_DORMANT_GUARD_AND_FAIL_FAST
- status: ACCEPTED / COMPLETE
- commit: `abdd002240e78ed093facdb3ef463d4ba6ede418` (`feat: add IndexedDB migration foundation`)
- surfaces: `scripts/storage/storage.test.mjs`; production files changed: NONE
- fail-fast evidence: calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, storage `53/53`, IndexedDB `16/16`, build PASS, diff check PASS
- guards: source guard PASS (all runtime code files under `src/` outside `src/storage/`; static, side-effect, re-export, `require` and dynamic forms); bundle guard PASS (app-shell esbuild shape, metafile excludes `src/storage/`); runtime diff NONE

### PHASE_A_INDEXEDDB_FOUNDATION
- status: IMPLEMENTATION COMPLETE
- range: `4e9a65af179c45ce95395aae21d577fe90ed13b2` (plan checkpoint) `..abdd002240e78ed093facdb3ef463d4ba6ede418`
- implementation surfaces: added `src/storage/schema.js`, `src/storage/indexedDb.js`, `src/storage/localReplica.js`, `src/storage/legacyMigration.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`; no other source, test, package or config file changed in the range
- migration remains DORMANT; legacy localStorage remains runtime authority; no live runtime migration has occurred
- current gate: `PHASE_A_FINAL_HUMAN_REVIEW` (decision: ACCEPT or AMEND)
- locked: runtime cutover, startup migration, dual-write, D1/backend, authentication, sync, outbox UI

### PHASE_A_FINAL_HUMAN_REVIEW
- status: ACCEPTED
- Phase A foundation: ACCEPTED by the human, based on the Phase A review package recorded at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`
- all accepted Task 1-6 contracts remain unchanged
- runtime cutover: STILL LOCKED
- approved next action: `RUNTIME_CUTOVER_PLANNING` only (design and independently review a runtime cutover contract resolving the six acceptance items in `docs/ACTIVE_SCOPE_LOCK.md`); no runtime implementation, D1/backend, authentication or sync

### RUNTIME_CUTOVER_PLAN
- status: LOCKED (awaiting human acceptance)
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md`
- resolves: authority-switch ordering including legacy writes after migration or switch; mandatory Android/installed-PWA human gate with quota and eviction; blocked open, `versionchange`, multi-tab and schema upgrades; `close()` open race; transaction-body async invariant; runtime payload-validation boundary
- falsification review: PASS (plan author, same session)
- phases C1-C7 locked; no phase opens without its own scope-open commit
- runtime implementation: LOCKED

### RUNTIME_CUTOVER_PLAN_AMENDMENT_1
- status: AMENDED (plan remains LOCKED; not yet accepted)
- baseline: `fac198747186e5307914b5567c7cd7b523991b3c`
- origin: independent fresh review verdict AMEND
- A: new prerequisite phase C2 extracts the neutral pure saved-place module `src/places/savedPlaces.js` used by both hooks and runtime validators, with characterization tests; later phases renumbered C3-C8
- B: `LEGACY` only after a successful open and `meta` read proving absent or reverted authority; blocked open is `BLOCKED`, every other open or read failure `STORAGE_UNAVAILABLE`, regardless of the hint
- C: hint write is a `READY` gate (`AUTHORITY_HINT_PENDING`); only the crash window between authority commit and hint write remains as a residual
- D: exact `versionchange` path (`openMajandusDb` options, `replica.subscribe`, terminal `lost` state, controller `RELOAD_REQUIRED`, disabled writes) with C1, C4 and C6 tests
- post-amendment falsification review: PASS (plan author); fresh independent review pending
- runtime implementation: LOCKED

### RUNTIME_CUTOVER_PLAN_AMENDMENT_2
- status: AMENDED (plan remains LOCKED; not yet accepted)
- baseline: `d7a5bbbc7d5870a92a7e2a954c7aca0cd23ff4e8`
- origin: fresh independent review verdict AMEND
- A: exact `meta/storageAuthorityV1` contract (9 fields, explicit fresh-switch values, immutable fields, guarded single-field mutations, `persist()` lifecycle with per-boot retry only while `null`); malformed authority is `STORAGE_UNAVAILABLE`/`authority-malformed` with no repair and a STOP; exact hint schema, classification and matrix (malformed hint without authority is the undated `STORAGE_LOST`, never `LEGACY`; `LEGACY` write guard refuses on any non-null hint)
- B: revert export always writes all three shared keys from the current semantic state (calendar `events` may be `[]`, default household profile when absent, default places view for zero records); canonical calendar id order; deleted-event resurrection test
- C: write-once attempt-scoped backups `{ version: 1, legacyKey, raw: string|null }` plus a verified current-attempt pointer before any shared-key change; byte-for-byte compensation with `removeItem` only to restore an originally absent key; compensation failure is never `LEGACY` (`active`, `legacyUntrusted: true`, backups retained, `REVERT_FAILED`, STOP)
- post-amendment falsification review: PASS (plan author); fresh independent review pending
- runtime implementation: LOCKED

### RUNTIME_CUTOVER_PLAN_AMENDMENT_3
- status: AMENDED (plan remains LOCKED; not yet accepted)
- baseline: `37b226cdc50f0dddf495dc21c23648c06eb52fbd`
- origin: fresh independent review verdict AMEND
- A: no automatic re-adopt after the authority switch; any legacy divergence keeps IndexedDB authoritative, deletes no authority or migrated record, preserves current legacy bytes, gives `LEGACY_DIVERGED` and a STOP awaiting an explicit recovery decision; `commitCount` is diagnostic only (localStorage shared keys can be lost independently and Phase A reads absent keys as valid empty data)
- B: exact durable `meta/storageRevertAttemptV1` record `{ key, switchId, attemptId, commitCountAtStart, phase: 'started' | 'backups-verified' }` written atomically with `reverting`; first export write only after a confirmed `backups-verified` commit; `backups-verified` resume requires the exact attempt's pointer and backups, otherwise `revert-backups-lost` with no writes and no new originals; attempt-record cleanup locked for revert success, compensation success or failure, abort in `started` and a forward build finding `reverting`
- C: calendar order note corrected (`KalenderTab` legend is static; `expandOccurrences` sorts by date, time and `occurrenceId`; `WasteSettings` subtype labels are the only stored-order display found); C6 visual and smoke parity retained
- post-amendment falsification review: PASS (plan author); fresh independent review pending
- runtime implementation: LOCKED

### RUNTIME_CUTOVER_PLAN_AMENDMENT_4
- status: AMENDED (plan remains LOCKED; not yet accepted)
- baseline: `5fb0f48dec567a933838991531837934258d2365`
- origin: fresh independent review verdict AMEND
- A: revert build with authority absent has its own contract (plan Section 6d): hint absent gives `LEGACY`; valid or malformed hint gives blocking `REVERT_STORAGE_LOST` (dated or undated) with zero writes until user confirmation, then verified hint removal and `LEGACY`; unreadable hint or failed removal gives `STORAGE_UNAVAILABLE`; no silent hint removal
- B: attempt-id collision: the three target backup keys are probed before "begin revert" and before the first backup write and must all be absent; at most 3 candidates, then `REVERT_FAILED`/`revert-attempt-id-collision` with status `active` and zero writes; unreadable key gives `revert-backup-key-unreadable`; no existing backup key is ever overwritten (`started` resume with an existing target key aborts before export)
- post-amendment falsification review: PASS (plan author); fresh independent review pending
- runtime implementation: LOCKED

### RUNTIME_CUTOVER_PLAN_ACCEPTED
- status: HUMAN ACCEPTED
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (amendments 1-4)
- accepted plan checkpoint: `8077c0e2626f1be1ef149a5690f43aa1e46cb248`
- `RUNTIME_CUTOVER_PLAN_FRESH_REVIEW = PASS` (fresh independent review)
- `RUNTIME_CUTOVER_PLAN = ACCEPTED` by the human
- implementation phases C1-C8: LOCKED; each opens only through its own separate scope-open pass
- next project gate: `VISUAL_POLISH_V1`, an intentional visual-only interlude before C1
- runtime/storage implementation stays closed until Visual Polish V1 is checkpointed and a separate C1 scope-open pass is approved
- recorded state: the Visual Polish V1 implementation commit `f367f2c06f3a4d5e96abb8ca7f4f8d96028491ee` (`feat: visual polish v1 for Kodu, cards, nav and bus card`) is already on `main` ahead of this record; it is NOT yet checkpointed and awaits the V1 human visual review

### VISUAL_POLISH_V1
- status: ACCEPTED / CHECKPOINTED
- implementation: `f367f2c06f3a4d5e96abb8ca7f4f8d96028491ee` (`feat: visual polish v1 for Kodu, cards, nav and bus card`)
- checkpoint baseline: `28f55a3c78b3015f9e83096ac1a6cd9aa84b978d`
- review: PASS
- scope: Kodu dashboard hierarchy, card system (neutral, tinted, primary variants; 16px/12px radius tokens), bottom navigation active pill, button/control hierarchy and pressed states, `BussCard` on the shared card system, existing motion system retuned within 150-220ms
- changed files: `src/design/tokens.js`, `src/design/shell.css`, `src/components/ShellViews.jsx`, `src/components/BussCard.jsx`, `src/App.jsx` (CSS variables only)
- evidence: app shell `23/23`, visual `35/35`, calendar UI `29/29`, waste UI `30/30`, reminder UI `30/30`, storage `53/53`, build PASS, diff check PASS; mobile smoke at 390px and 360px plus desktop with no horizontal overflow
- behavior changes: NONE; storage/runtime changes: NONE
- next project gate: `VISUAL_POLISH_V2`, the final visual-only interlude before C1; V2 planning or implementation only after its own explicit scope-open pass
- V2 direction: B-lite; modern native Android; calm warm utility; Material-3 influenced; no dark mode; no storage/runtime changes
- V2 expected focus: EventDialog mobile bottom-sheet presentation; forms/fields consistency; Kalender, Prügivedu and Seaded visual consistency; final spacing, typography and microinteraction polish
- V2 excluded: dark mode, skeleton loaders, bus countdown, dynamic theme-color, new behavior, new data logic
- runtime cutover C1-C8: LOCKED

### VISUAL_POLISH_V2_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass)
- baseline: `142e7fb105d09c46ad810b00c9475b32a7088436`
- production write scope: `src/design/shell.css`, `src/design/calendar.css`, `src/design/waste.css`, `src/components/SeadedTab.jsx`, `src/components/EventDialog.jsx`
- test write scope (only for legitimate visual/class expectations): `scripts/shell/app-shell.test.mjs`, `scripts/shell/visual-cases.mjs`, `scripts/shell/visual-polish.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/calendar/calendar-ui.test.mjs`, `scripts/waste/browser-cases.mjs`, `scripts/waste/waste-ui.test.mjs`
- not writable: `KalenderTab.jsx`, `WasteSettings.jsx`, `HouseholdSettings.jsx`, `NotificationSettings.jsx` (CSS-only styling of their markup)
- `EventDialog.jsx`: presentation only (lifecycle, handlers, state, save/delete unchanged; no gestures); `SeadedTab.jsx`: inline styles to classes only, behavior byte-for-byte equivalent
- goals: EventDialog bottom-sheet refinement, forms/fields unification, Seaded, Kalender (CSS), Prügivedu (CSS), V1+V2 consistency
- authorized behavior changes: NONE; authorized storage/runtime changes: NONE
- runtime cutover C1-C8: LOCKED

### VISUAL_POLISH_V2
- status: ACCEPTED / CHECKPOINTED
- implementation: `67f8ad55345e3a9c41b23e233167a394123e88a5` (`feat: visual polish v2 for dialogs forms and settings`)
- independent review: PASS; behavior drift: NONE FOUND; storage/runtime changes: NONE
- changed production files (four of the five approved): `src/design/shell.css`, `src/design/calendar.css`, `src/design/waste.css`, `src/components/SeadedTab.jsx`; no test, package or config change
- `src/components/EventDialog.jsx` untouched: dialog JSX, `<dialog>` lifecycle, cancel, mode/scope state and save/update/remove logic unchanged (bottom-sheet refinement is CSS only)
- `SeadedTab.jsx` behavior preserved: with `style`/`className` attributes stripped, zero token differences; localStorage calls, timers, handlers, state and copy identical
- regression evidence: app shell `23/23`, visual `35/35`, calendar UI `29/29`, calendar domain `19/19`, waste UI `30/30`, waste domain `23/23`, reminder UI `30/30`, reminders domain `28/28`, native notifications `24/24`, storage `53/53`, build PASS, diff check PASS
- smoke: mobile 360/390/430px PASS (no overflow, Seaded buttons >=44px, dialog add/edit/view/recurring-choice/delete, sticky footer clear of fields, profile save, PIN change/error/reset-confirm, Prügivedu); desktop 1280/768px PASS (centered 520px dialog, no overflow)
- backlog (not a blocker): dialog header cancel target is 44px; consider 48px in a later visual polish
- visual-polish interlude: CLOSED
- next project gate: `RUNTIME_CUTOVER_C1_SCOPE_OPEN` (docs-only C1 scope-open pass); C1 implementation CLOSED until that pass; C2-C8 LOCKED

### RUNTIME_CUTOVER_C1_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass)
- baseline: `022b8b72cfec44b5b3e0433489f1ac5d67e7d356`
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 5 items 4 and 4a; Section 7 row C1; Section 8 C1)
- purpose: Phase A amendments only — `localReplica` close/open race (generation counter, `ReplicaClosedError`, reopen allowed) and IndexedDB connection-event contract (`openMajandusDb(indexedDb, { onVersionChange, onClose })`, `replica.subscribe`, terminal `lost` state with `ReplicaConnectionLostError`)
- source scope: `src/storage/localReplica.js`, `src/storage/indexedDb.js`
- test scope: `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- acceptance: stub close race, stub connection events, Chromium `DB_VERSION + 1` upgrade and `deleteDatabase` cases, Phase A Task 1-6 regression (full list in `docs/ACTIVE_SCOPE_LOCK.md`)
- runtime behavior change: NONE (storage foundation dormant; nothing outside `src/storage/` imports it)
- C2-C8: LOCKED

### RUNTIME_CUTOVER_C1
- status: ACCEPTED / CHECKPOINTED
- final implementation HEAD: `704cc7a815d1df1efdbfba979814aceb94886c09` (`fix: make replica close await stale opens`)
- implementation history: `e2b2c7d10e03bcdee187719a7e12bddfd9123fc7` (`feat: harden IndexedDB replica connection lifecycle`), then `704cc7a815d1df1efdbfba979814aceb94886c09` (`fix: make replica close await stale opens`)
- independent review: initial AMEND (a repeated close could resolve before the shared pending open settled), final PASS / ACCEPT
- changed files: `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- accepted behavior:
  - generation-owned connections; close/open race protection
  - repeated or concurrent `close()` waits for every older in-flight open
  - a fresh-generation reopen survives an older `close()`
  - stale opens reject with `ReplicaClosedError`
  - `openMajandusDb(indexedDb, { onVersionChange, onClose })`; the handle closes before the `versionchange` callback
  - exact connection events `{ type: 'versionchange', oldVersion, newVersion }` and `{ type: 'close' }`
  - `replica.subscribe(listener)` with idempotent unsubscribe, ordered synchronous delivery and microtask rethrow of the first listener error
  - terminal `ReplicaConnectionLostError` for `open()`/`transact()` with no further `indexedDb.open()`
  - stale-generation events ignored
  - no-options `openMajandusDb()` keeps the accepted Task 1 behavior
- evidence: storage `65/65`, IndexedDB/Chromium `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS
- runtime behavior change: NONE; storage foundation: DORMANT
- C1 source scope: CLOSED
- next project gate: `RUNTIME_CUTOVER_C2_SCOPE_OPEN` (docs-only C2 scope-open pass); C2 implementation LOCKED until that pass; C3-C8 LOCKED

### RUNTIME_CUTOVER_C2_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass)
- baseline: `552ea1b6838200d79e51cb09b082004851efe2d1`
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 7 row C2 and C2 rules; Section 8 C2)
- purpose: behavior-preserving extraction of saved-place defaults and normalization into the neutral pure module `src/places/savedPlaces.js` (`SAVED_PLACE_DEFAULTS`, `normalizePlace`, `normalizePlaces`)
- production scope: `src/places/savedPlaces.js` (new), `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, `src/storage/legacyMigration.js` (comment only)
- test scope: `scripts/places/saved-places.test.mjs` (new), `scripts/storage/storage.test.mjs`
- characterization first: golden tables from both current hooks; any disagreement between the hooks is a STOP
- guards: hooks import the module and keep no local implementations; `DEFAULT_PLACES` export compatibility; module free of React, `src/storage/` and side effects; storage stays dormant
- `legacyMigration.js` code change: FORBIDDEN (comment only; no import of the module)
- runtime behavior change: NONE
- C3-C8: LOCKED (C3 not before C2 is implemented, independently reviewed and checkpointed)

### RUNTIME_CUTOVER_C2
- status: ACCEPTED / CHECKPOINTED
- implementation: `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e` (`refactor: centralize saved place normalization`)
- independent source review: PASS / ACCEPT (exact C2 six-file diff PASS; parent hook normalization parity PASS; neutral extraction equivalence PASS; `legacyMigration.js` code unchanged PASS; behavior drift found NONE)
- changed files: new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, `src/storage/legacyMigration.js` (comment only), new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs`
- accepted result:
  - `src/places/savedPlaces.js` is the neutral pure canonical module and exports exactly `SAVED_PLACE_DEFAULTS`, `normalizePlace`, `normalizePlaces`
  - both pre-extraction hook implementations were equivalent (golden characterization before extraction)
  - `useSavedPlaces.js` and `useSettings.js` both use the neutral module
  - `DEFAULT_PLACES` compatibility preserved (`export const DEFAULT_PLACES = SAVED_PLACE_DEFAULTS`)
  - `legacyMigration.js` production code unchanged (comment-only reference update)
  - Task 3 legacy normalization remains unpadded and is parity-proven against the neutral per-item normalizer
  - storage foundation remains dormant
- evidence: saved places `6/6`, storage `66/66`, IndexedDB `18/18`, calendar `19/19`, calendar UI `29/29`, app shell `23/23`, reminders `28/28`, reminder UI `30/30`, native notifications `24/24`, waste `23/23`, waste UI `30/30`, build PASS, diff check PASS
- runtime behavior change: NONE; runtime/storage activation: NONE
- C2 source scope: CLOSED
- next project gate: `RUNTIME_CUTOVER_C3_SCOPE_OPEN` (docs-only C3 scope-open pass); C3 implementation LOCKED until that pass; C4-C8 LOCKED

### RUNTIME_CUTOVER_C4_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass)
- baseline: `e2514e401ad93f66b24a4e2f282b7daecaa322e8`
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Sections 1-6; Section 7 row C4; Section 8 C4 acceptance tests; Section 10 STOP conditions); C3 prerequisite satisfied
- purpose: authority controller and the complete dormant cutover state machine
- production scope: new `src/storage/storageAuthority.js`
- test scope: `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- locked contract: exact 9-field `storageAuthorityV1` (Section 1a), exact `majandus_storage_authority_v1` hint (Section 1b), exact 5-field `storageRevertAttemptV1` (Section 1c), the full Section 3 startup state machine, the exact Section 2 switch ordering, the no-re-adopt divergence rule, the Section 5 item 4a connection-event contract and the Section 6a-6d revert/backup/compensation contract, each exactly as already accepted; this pass does not redesign or simplify any of them
- runtime behavior change: NONE; storage foundation stays DORMANT
- C5-C8: LOCKED (C5 not before C4 is implemented, independently reviewed and checkpointed)

### RUNTIME_CUTOVER_C3_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass)
- baseline: `65e34d702fed498960c07dc88ebefd2fc917c346`
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 5 items 5 and 6; Section 1a runtime-write mutation; Section 7 row C3; Section 8 C3); C2 prerequisite satisfied
- purpose: runtime record validation boundary (`validateRuntimeRecord`) and transaction-safe runtime mutation helper (`runReplicaMutation`)
- production scope: new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`
- test scope: `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- transaction discipline: read → synchronous plan (thenable → `TypeError`) → synchronous validate → one synchronous write block including the authority `commitCount` increment; `meta/storageAuthorityV1` re-read and guarded (`active`, matching `switchId`, safe `commitCount`); mismatch aborts with zero writes; malformed authority → `STORAGE_UNAVAILABLE` / `authority-malformed`
- validation boundary: Task 2 envelope plus `local`/`0`/`null`; calendar `validateEvent` deep-equal and id match; waste `validateImportHistory`; household through the accepted repository save path with `serverHouseholdId === null`; places `normalizePlace` deep-equal with contiguous `0..n-1` orders
- direct transaction source guard: `legacyMigration.js`, `localReplica.js`, `runtimeWrites.js`, future C4 `storageAuthority.js` (not created in C3)
- runtime behavior change: NONE; storage foundation: DORMANT
- C4-C8: LOCKED

### RUNTIME_CUTOVER_C3
- status: ACCEPTED / CHECKPOINTED
- implementation history: `41d0fdadb78ba4adfaf2bd726d6cba9dbd7bed9b` (`feat: add runtime record and mutation guards`), `5612953e7c9e07eef411cecc3c6bb5dd5685930d` (`fix: reject async runtime mutation results`)
- final implementation: `5612953e7c9e07eef411cecc3c6bb5dd5685930d`
- independent review: initial AMEND (a thenable `planned.result` could be adopted and reject after the transaction committed); final PASS / ACCEPT (the result thenable is rejected synchronously before validation and write requests)
- independent source review of the final HEAD: live final HEAD verified; fix scope exactly `src/storage/runtimeWrites.js` + `scripts/storage/indexeddb-browser.test.mjs`; guard ordering PASS; result thenable non-adoption PASS; zero-write source ordering PASS; remaining C3 blocker NONE FOUND
- changed files (C3 total): new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- accepted contracts:
  - runtime record validation boundary: `validateRuntimeRecord(store, record)`
  - Task 2 envelope validators reused (not reimplemented), with `syncStatus: 'local'`, `revision: 0`, `deletedAt: null`
  - calendar: `validateEvent` plus exact payload equality and `payload.id === record.id`; no silent repair
  - waste: `validateImportHistory` import-history validation
  - household: validation through the accepted household repository save path (`serverHouseholdId === null`); household rules not duplicated
  - saved places: `normalizePlace` from `src/places/savedPlaces.js` deep-equal plus contiguous `0..n-1` order validation
  - authority write guard: exact 9-field authority record, `status === 'active'`, matching `switchId`, safe `commitCount` and safe `commitCount + 1`
  - READ → synchronous PLAN → VALIDATE → synchronous WRITE discipline in one readwrite transaction including `meta`
  - a top-level thenable plan is rejected with `TypeError` before any write
  - a thenable `planned.result` is rejected with `TypeError` before any write and is never adopted (its `then` is never invoked)
  - validation failure yields zero domain and zero meta writes
  - a successful mutation increments `commitCount` exactly once; no increment on abort or failure
  - authority mismatch/absence → `RELOAD_REQUIRED` / `authority-mismatch`; malformed authority → `STORAGE_UNAVAILABLE` / `authority-malformed`; both with zero writes
  - transaction auto-commit hazard (`TransactionInactiveError`) is reported as failure, never as success
- evidence: C3 node `7/7`, storage `73/73`, IndexedDB/Chromium `25/25`, saved places `6/6`, calendar + UI `48/48`, app shell `23/23`, reminders + UI + native `82/82`, waste + UI `53/53`, build PASS, diff check PASS
- runtime behavior change: NONE; storage foundation: DORMANT
- C3 source scope: CLOSED
- next project gate: `RUNTIME_CUTOVER_C4_SCOPE_OPEN` (docs-only C4 scope-open pass); C4 implementation LOCKED until that pass; C5-C8 LOCKED

### RUNTIME_CUTOVER_C4
- status: ACCEPTED / CHECKPOINTED
- implementation history: `bf4c598f5b494bb289d748d48632c77d4be96be9` (`feat: add dormant storage authority controller`), `fa4b81055a4d4449bac89ac40fb9dc44f851abef` (`fix: harden authority snapshot and revert guards`), `858d777e0b15ef8a61197d9c49262f1818030a20` (`fix: close authority concurrency races`), `d2d1dad0e688706609b80172e8b10a50c54d138d` (`fix: complete mounted authority state handling`)
- final implementation: `d2d1dad0e688706609b80172e8b10a50c54d138d`
- review history (recorded as supplied; the final checkpoint pass did not itself rerun a separate reviewer's commands):
  - initial implementation review: AMEND — found and fixed: missing READY snapshot/runtime validation; missing revert snapshot validation; incomplete durable authority/attempt transition guards; ambiguous revert-complete stale-attempt risk; explicit backup/preparation failure coverage gaps
  - second independent review: AMEND — found and fixed: concurrent switch loser incorrectly reaching `LEGACY`; forward-build reverting convergence using stale boot-time attempt state; stale compensation before the durable attempt guard; reset/attempt races
  - final mounted-state review: AMEND — found and fixed: mounted `READY` divergence/hint/authority rechecks missing; mounted `LEGACY` authority/hint reaction missing; `REVERTING` state missing
  - final independent source review: PASS / ACCEPT; remaining C4 source blocker: NONE FOUND
  - verified at final review: live `main == d2d1dad0e688706609b80172e8b10a50c54d138d`; parent `== 858d777e0b15ef8a61197d9c49262f1818030a20`; final amendment scope == exact C4 files; mounted-state controller semantics PASS; `REVERTING` state path PASS; prior concurrency guards retained PASS; prior durable revert guards retained PASS; storage remains dormant PASS
- changed files (final amendment `858d777..d2d1dad`): `src/storage/storageAuthority.js`, `scripts/storage/indexeddb-browser.test.mjs`, `scripts/storage/storage.test.mjs`
- accepted contracts (full locked list in `docs/ACTIVE_SCOPE_LOCK.md` Runtime cutover C4 section):
  - authority controller: exact 9-field `storageAuthorityV1`, exact 5-field `storageRevertAttemptV1`, exact hint contract, strict authority/attempt validation, guarded mutations, `persist()` lifecycle, hint gate, `LEGACY` write guard
  - boot state machine: `BOOTING`, `LEGACY`, `READY`, `READY + LEGACY_DIVERGED`, `DOMAIN_INVALID` (per domain), `AUTHORITY_HINT_PENDING`, `BLOCKED`, `STORAGE_UNAVAILABLE`, `STORAGE_LOST`, `RELOAD_REQUIRED`, `REVERTING`, `REVERT_STORAGE_LOST`, `REVERT_FAILED`
  - authority switch: unknown authority never `LEGACY`; atomic switch; hint gate after switch; post-switch divergence confirmation; concurrent migration/switch convergence; exactly one authority creation; concurrent clean boots converge on the winning authority (Web Locks supplemental; IndexedDB transaction guards are authoritative)
  - divergence (no re-adopt): IndexedDB stays authoritative; no automatic merge/re-adopt, reset, re-migration, second switch, authority/domain deletion or shared legacy write; `READY + LEGACY_DIVERGED`; a mounted `READY` tab rechecks divergence from runtime signals on the same controller, never creating a new one
  - runtime mounted state: public `handleRuntimeSignal(signal)`; C4 owns every state decision, C6 only wires browser events/signals to it; `READY` shared-key signal -> divergence recheck; `READY` hint signal -> hint gate -> `READY` or `AUTHORITY_HINT_PENDING`; `READY` foreground/authority signal -> durable authority/attempt recheck -> `RELOAD_REQUIRED` on identity/status change; `LEGACY` hint/authority-changed signal -> `RELOAD_REQUIRED`; a mounted recheck never runs the forward reverting -> active convergence; no browser globals read in `src/storage/`
  - domain validity: same C3 runtime validators on load; invalid household/calendar+waste/places+order give per-domain `DOMAIN_INVALID` with no auto-repair; other valid domains stay usable
  - connection lifecycle: `versionchange`, browser close, `ReplicaConnectionLostError`, `VersionError` all resolve `RELOAD_REQUIRED`, never `LEGACY`; controller subscription exists before the first database open
  - revert (Sections 6a-6d): authoritative semantic export of all three domains; empty-domain and deleted-data semantics; durable revert attempt; collision-checked `attemptId`; write-once backups with a verified pointer; `started -> backups-verified` only; resume semantics; exact backup-set ownership; byte-for-byte compensation; ambiguous-completion reread; confirm-only `REVERT_STORAGE_LOST`; forward-build convergence from `reverting`
  - durable transition/concurrency guarantees: begin-revert transaction-time switch guard; abort-before-export/backups-verified-transition/compensation/revert-complete each validate the exact durable attempt (compensation validates it before the first restore write); ambiguous complete rereads authority and attempt; forward-build reverting classification uses transaction-time attempt state, not the boot-time read; reset transactions re-read the attempt key
  - `REVERTING` state: a revert build with a valid active or reverting authority actually beginning or resuming a revert observes `BOOTING -> REVERTING ->` a terminal state (`LEGACY` / `REVERT_FAILED` / `STORAGE_UNAVAILABLE` / `RELOAD_REQUIRED`); never entered for authority absent, malformed/unknown or already-reverted authority
- evidence (supplied execution evidence from the implementation pass; not rerun by a separate reviewer in this checkpoint pass):
  - C4 node/storage: `82/82 PASS`; C4 Chromium: `41/41 PASS`
  - storage full: `82` Node + `66` Chromium PASS
  - IndexedDB/Chromium full: `66/66 PASS`
  - saved places `12/12 PASS`; calendar `13/13 PASS`; calendar UI `20/20 PASS`; app shell `52/52 PASS`; reminders + UI + native `80/80` real assertions PASS; waste + UI `53/53 PASS`
  - build PASS; `git diff --check` PASS
  - harness note: Windows Chromium profile cleanup `EPERM` reproduced against the unchanged `858d777` baseline; the affected reminder/native-notification runs had their own assertion bodies pass before the cleanup failure; a standalone `app-shell.test.mjs` run passed cleanly; recorded as a pre-existing Windows harness cleanup flake, not silently counted as a clean process-level PASS
- runtime behavior change: NONE; storage foundation: DORMANT; application runtime still uses the accepted legacy/localStorage paths; nothing outside `src/storage/` imports the storage foundation
- C4 source scope: CLOSED
- next project gate: `RUNTIME_CUTOVER_C5_SCOPE_OPEN` (docs-only C5 scope-open pass); C5 implementation LOCKED until that pass; C6-C8 LOCKED

### RUNTIME_CUTOVER_C5_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass)
- baseline: `590a2a7c56f63a5895a4fd56da7668ad879b95c6`
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Section 4 multi-tab/runtime-write rules; Section 5 items 5 and 6; Section 6 quota behavior; Section 7 row C5; Section 8 C5; Section 10 STOP conditions); C4 prerequisite satisfied
- purpose: dormant IndexedDB domain repositories for household, places, and calendar + waste
- production scope: new `src/storage/replicaRepositories.js`
- test scope: `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- locked architecture: mutations go only through the accepted C3 `runReplicaMutation(...)`; `replicaRepositories.js` never calls `replica.transact`/`runTransaction` directly; household reuses `createHouseholdRepository(...)`, places reuses the accepted C2 neutral module `src/places/savedPlaces.js`, calendar+waste reuses `createEventRepository(...)` — no domain semantics reimplemented; every produced record passes the accepted C3 `validateRuntimeRecord`; mutations bind to the C4 authority/switch identity (mismatch -> `RELOAD_REQUIRED`/`authority-mismatch`, malformed -> `STORAGE_UNAVAILABLE`/`authority-malformed`, both zero writes); every mutation re-reads its domain state inside its own transaction (two-tab concurrent mutations both persist); quota/write-error failures atomically preserve previous state with no fallback to legacy writes
- full locked contract, parity test matrix and required failure/concurrency tests in `docs/ACTIVE_SCOPE_LOCK.md` (Runtime cutover C5 scope)
- runtime behavior change: NONE; storage foundation stays DORMANT
- C6-C8: LOCKED (C6 not before C5 is implemented, independently reviewed and checkpointed)

### RUNTIME_CUTOVER_C5_CALENDAR_READ_SCOPE_AMEND
- status: AMENDED (C5 remains OPEN; implementation in a separate pass)
- baseline: `02b5ff1824258bf28d16121517c072d90d0b892a`
- origin: discovered during C5 TDD, before the calendar RED→GREEN cycle could proceed
- root cause: C5 must implement `calendar.load()` by rebuilding the calendar semantic envelope from `calendarEvents`, `wasteState` and `calendarLegacyEnvelopeExtras`. The accepted `src/storage/localReplica.js` already exposes `getCalendarEvent(id)`, `getWasteState()`, `getMeta(key)`, `listSharedPlaces()` and `getHouseholdProfile()`, but has no collection-read accessor for all `calendarEvents` records. `replicaRepositories.js` cannot correctly implement calendar `load()` while also preserving the rule that it never calls `replica.transact(...)`/`runTransaction(...)` directly — an interface gap in the storage foundation's read surface, not a reason to weaken the C3 mutation/transaction boundary
- resolution: widen C5's exact production scope by exactly one existing foundation file, `src/storage/localReplica.js`, for exactly one additive method, `listCalendarEvents()`: read-only, no mutation, no authority mutation, no `commitCount` change, no browser global, no new transaction abstraction; reads all `calendarEvents` records via the module's own already-accepted internal `transact(...)` helper; returns them in canonical `id` ascending order; mirrors the existing accepted `listSharedPlaces()` collection-read pattern exactly; no other `localReplica.js` behavior changes
- updated C5 exact production scope: new `src/storage/replicaRepositories.js`; `src/storage/localReplica.js` limited to the additive `listCalendarEvents()` accessor
- updated C5 exact test scope (unchanged): `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`
- direct-transaction-caller allowlist: unchanged (`src/storage/localReplica.js`, `src/storage/legacyMigration.js`, `src/storage/runtimeWrites.js`, `src/storage/storageAuthority.js`); `replicaRepositories.js` is explicitly NOT added to it
- future C5 calendar load path: `replica.listCalendarEvents()` + `replica.getWasteState()` + `replica.getMeta('calendarLegacyEnvelopeExtras')`, then validate the loaded runtime records, rebuild the semantic envelope in canonical id order, preserve extras and `wasteImports` semantics; no direct IndexedDB transaction in `replicaRepositories.js`; no domain behavior moved into `localReplica.js` (it only enumerates stored records)
- required focused coverage for the implementation pass: `listCalendarEvents` returns every record; returns canonical id order; performs zero writes; existing `localReplica.js` behavior otherwise unchanged
- full amended contract in `docs/ACTIVE_SCOPE_LOCK.md` (Runtime cutover C5 scope)
- this pass was docs/governance only; no source, test, package or config file changed; the interrupted C5 implementation draft (`src/storage/replicaRepositories.js`, `scripts/storage/storage.test.mjs`) was preserved byte-for-byte, uncommitted
- runtime behavior change: NONE; storage foundation stays DORMANT
- C6-C8: LOCKED

### RUNTIME_CUTOVER_C5_REVIEW_AMEND
- status: AMEND (C5 remains OPEN / NOT CHECKPOINTED; corrective source pass required)
- baseline: `5c3f6fee68a5af98390f28706dc759d4737f5a56`
- origin: independent C5 source review of the implementation at that HEAD (`feat: add dormant replica repositories`)
- findings (all require a corrective source pass before C5 can be checkpointed):
  - **A — invalid places collection can be auto-repaired:** `planPlacesMutation` validated every individual `sharedPlaces` record but never re-validated the *existing* collection with `validateSharedPlaceOrders(records)` before planning, so an already-invalid stored collection (for example two records both at `order: 0`) could be silently reindexed into a valid contiguous order by a normal mutation, violating the accepted "invalid stored data is not auto-repaired" contract. Required fix: validate the current collection before any transform; on failure, reject with zero `sharedPlaces` writes and zero authority/`commitCount` change, leaving stored bytes untouched. Required test: a real `repos.places.update/add/remove` call against a seeded invalid collection must reject, proven by a before/after deep-comparison — not a synthetic bad-plan substitute.
  - **B — the parity matrix must be a true oracle comparison:** tests asserted hand-computed expected values instead of seeding the legacy repository and the IndexedDB repository from equivalent state, running the same operation on each, and comparing the resulting semantic state. Required for household (`save`, including normalization/default cases, with extras verified unchanged), places (using the C2 neutral module as the oracle; ids/order asserted separately from legacy semantic equality) and calendar+waste (two independent deterministic worlds — legacy `createEventRepository` and the C5 repository — compared as id-keyed sets, plus `wasteImports`, extras, `version` and writable/error semantics).
  - **C — a generic write-error case is required in addition to `QuotaExceededError`:** the accepted failure matrix requires both; add a second write-request-level failure (e.g. a `DOMException` named `UnknownError`) through a real C5 mutation, with the same atomicity invariant as the quota case.
  - **D — `requestResult` is an explicit, accepted C5 dependency:** C5's `runReplicaMutation(...).read(...)` callbacks genuinely need it (the C3 transaction contract requires `READ` to await request promises through it), but the dependency allowlist omitted it. Amended to allow `requestResult` from `./indexedDb.js`, scoped only to request promises issued from the stores passed into `read(...)`; grants nothing else (no `replica.transact`, `runTransaction`, `openMajandusDb`, schema access or direct database opening from `replicaRepositories.js`).
  - **E — the canonical event-id order must be locale-independent:** `listCalendarEvents()` used locale-sensitive `left.id.localeCompare(right.id)` instead of the same locale-independent `<`/`>` comparator C4's revert/export already uses, which is not guaranteed identical for arbitrary valid event ids. Required fix applies the C4 comparator consistently in `listCalendarEvents()` and the C5 calendar envelope reconstruction (C4's own revert/export code is unchanged). Required test uses ids where locale collation could differ from relational order, deriving expected order from `<`/`>`; required falsification check temporarily swaps in `localeCompare()` and confirms the regression test fails (removing the explicit sort is not an acceptable substitute, since IndexedDB's own key enumeration may already happen to return canonical order).
- corrective source pass locked to exactly: `src/storage/replicaRepositories.js` (finding A) and `src/storage/localReplica.js` (finding E); no other production behavior change; C5 test scope unchanged (`scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`); existing C5 tests preserved unless a redundant assertion is cleanly folded into a stronger oracle test
- full amended contract in `docs/ACTIVE_SCOPE_LOCK.md` (Runtime cutover C5 scope)
- this pass was docs/governance only; no source, test, package or config file changed
- runtime behavior change: NONE; storage foundation stays DORMANT
- C6-C8: LOCKED

### RUNTIME_CUTOVER_C5
- status: ACCEPTED / CHECKPOINTED
- implementation history: scope open `590a2a7c56f63a5895a4fd56da7668ad879b95c6` (`docs: open runtime cutover c5`) → calendar-read scope amendment `02b5ff1824258bf28d16121517c072d90d0b892a` (`docs: amend c5 calendar read scope`) → initial implementation `5c3f6fee68a5af98390f28706dc759d4737f5a56` (`feat: add dormant replica repositories`) → review-amend governance `fbbff8b9dc4fa237ab144a1ac066d70244ef7a4f` (`docs: amend c5 after independent review`) → final corrective implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b` (`fix: harden dormant replica repositories`)
- final implementation: `f8f5fecab2442db1347ac4741a79dd66650dd68b`
- review history:
  - initial independent source review of `5c3f6fee68a5af98390f28706dc759d4737f5a56`: AMEND (five findings A-E, recorded in `RUNTIME_CUTOVER_C5_REVIEW_AMEND` above)
  - final independent source review of `f8f5fecab2442db1347ac4741a79dd66650dd68b`: PASS / ACCEPT; remaining C5 source blocker: NONE FOUND
  - verified at final review: corrective commit scope stayed within C5; the invalid-existing-places pre-state guard is present; true oracle tests are present for household/places/calendar; the generic write-error test is present; `requestResult` usage remains scoped to `read(...)` callbacks; the direct-transaction prohibition is preserved; the canonical comparator is aligned with C4; `runtimeWrites.js` still performs PLAN before all writes; storage remains dormant
- changed files (final corrective amendment `5c3f6fee..f8f5fec`): `src/storage/replicaRepositories.js` (+1 line: `validateSharedPlaceOrders(records)` before any places transform), `src/storage/localReplica.js` (2-line comparator fix inside the already-accepted `listCalendarEvents()`), `scripts/storage/indexeddb-browser.test.mjs` (+329 lines)
- accepted public API: `createReplicaRepositories({ replica, authority, newId, clock })` → `{ household: {load, save}, places: {load, update, add, remove}, calendar: {load, create, update, remove, importWaste} }`; no React or runtime/browser wiring
- accepted contracts (full detail in `docs/ACTIVE_SCOPE_LOCK.md` Runtime cutover C5 section):
  - transaction architecture: every mutation through `runReplicaMutation(...)` only; `replicaRepositories.js` never calls `replica.transact`/`runTransaction` directly (allowlist unchanged); every successful mutation re-reads durable authority, requires active status and matching booted `switchId`, and increments `commitCount` exactly once; every failure writes nothing and leaves `commitCount` unchanged; `requestResult` from `./indexedDb.js` is an explicit, scoped C5 dependency
  - household: `createHouseholdRepository(...)` is the sole oracle; `serverHouseholdId === null`; invalid stored state is `writable: false` with no repair; retained extras untouched
  - places: the C2 neutral module is the sole oracle; existing ids survive updates/shifts, new ids only for materialized entries, orders stay contiguous `0..n-1`; an invalid *existing* collection is validated and rejected before any transform, with zero writes and no auto-repair (finding A); the inherited C3 resulting-order guard remains active too
  - calendar + waste: `createEventRepository(...)` is the sole oracle (recurrence, overrides, series behavior, imported-event protection and waste reconciliation never reimplemented); canonical event-id order uses the same locale-independent `<`/`>` comparator as C4 (finding E), never `localeCompare()`; extras/`version` preserved, no extras invented when absent, `wasteState` exists exactly when `wasteImports` is defined
  - failure/atomicity: `QuotaExceededError` and a distinct generic `UnknownError` write failure (finding C) both atomically preserve previous state; authority mismatch, malformed authority, invalid planned record, invalid resulting places order and invalid existing places collection all reject with zero writes
  - multi-tab: two-tab concurrent household/places/calendar mutations all persist correctly, no lost update, `commitCount` advances once per successful mutation
  - parity: true oracle-comparison tests (finding B) for household, places and calendar+waste, each seeding two independent worlds from equivalent state and comparing the resulting semantic state (calendar events as id-keyed sets)
- evidence: C5 focused `20/20`, storage Node `82/82`, storage Chromium/IndexedDB `86/86`, saved places `12/12`, calendar `13/13`, calendar UI `20/20` real assertions, app shell `52/52` combined (`23/23` clean standalone), reminders + UI + native `82/82` combined (`80/80` real assertions before documented cleanup-only EPERM failures), waste + UI `53/53`, build PASS, diff check PASS
- harness note: the pre-existing Windows Chromium profile-cleanup EPERM (documented since C4) recurred in combined runs; assertion bodies completed before the `finally` block's `rmSync` failure each time; a standalone app-shell rerun passed cleanly; not misrepresented as a clean process-level PASS
- runtime behavior change: NONE; storage foundation stays DORMANT; legacy/localStorage remains the application runtime authority; nothing outside `src/storage/` imports the storage foundation; the application bundle excludes the storage foundation
- C5 source scope: CLOSED
- next project gate: `RUNTIME_CUTOVER_C6_SCOPE_OPEN` (docs-only C6 scope-open pass); C6 implementation LOCKED until that pass; C7-C8 LOCKED

### RUNTIME_CUTOVER_C6_SCOPE_OPEN
- status: OPEN (docs-only scope open; implementation in a separate pass; NOT implemented, NOT checkpointed)
- baseline: `f919c7f6bef6fbfed15e20609c8cd2e12cdbb878` (`docs: checkpoint runtime cutover c5`)
- plan: `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (Sections 1a, 1b, 2, 3, 4, 5 items 4a-6, 6; Section 7 row C6; Section 8 C6; Section 9 C6 desktop smoke; Section 10 STOP conditions); C1-C5 prerequisites satisfied
- purpose: wire the accepted C1-C5 storage foundation into the actual application runtime (`LEGACY` -> existing localStorage repositories; `READY` -> C5 IndexedDB repositories; no other authority model)
- production scope (12 files at scope open; 13 after `RUNTIME_CUTOVER_C6_AUTHORITY_IDENTITY_SCOPE_AMEND` below, which adds `src/storage/storageAuthority.js` for one accessor): `src/main.jsx`, `src/App.jsx`, `src/calendar/useHouseholdEvents.js`, `src/waste/useHousehold.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (remove the duplicate places writer), `src/components/SeadedTab.jsx` (remove the places fallback), `src/components/EventDialog.jsx`, `src/components/HouseholdSettings.jsx`, `src/components/WasteSettings.jsx` (await async mutators), new `src/components/StorageStatus.jsx`, `src/design/shell.css`
- test scope (5 files at scope open; 6 after `RUNTIME_CUTOVER_C6_REMINDER_TEST_SCOPE_AMEND` below): `scripts/shell/app-shell.test.mjs`, `scripts/calendar/browser-cases.mjs`, `scripts/waste/browser-cases.mjs`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs`; the Task 6 dormant import guard becomes the C6 importer-allowlist guard; reminder, native-notification and saved-places suites are run-only
- locked architecture: boot order create controller -> wire runtime signals -> boot -> resolve state -> only then mount shared-domain hooks; only `src/main.jsx`, `src/App.jsx`, `useHouseholdEvents.js`, `useHousehold.js` and `useSavedPlaces.js` may import `src/storage/**` (`useSettings.js` removes its places writer, no component imports storage); browser globals only at the runtime wiring boundary (`src/main.jsx`), never in `src/storage/**`; state decisions stay in C4 (`controller.handleRuntimeSignal`), C6 only forwards `storage`/`focus`/`visibilitychange`/`authority-changed` signals; `BroadcastChannel('majandus:replica')` `committed` posted only after the mutation promise completes, with `focus`/`visibilitychange` re-read fallback and no polling; centralized `StorageStatus.jsx` with the exact accepted state copy; async mutators awaited and write failures surfaced with the accepted save-error copy; `LEGACY_DIVERGED` non-blocking with no repair/merge/re-adopt/reset; `DOMAIN_INVALID` per domain only
- clarification recorded (no plan change): plan Section 9 item 5 is read with Section 4 — an ordinary committed update refreshes the other `READY` tab by domain re-read; the reload banner is the required behavior for authority/connection changes
- schema: unchanged (no `DB_VERSION` bump, store, index, record cleanup or legacy deletion); no backend, authentication, sync, outbox UI, dependency change, preview deploy or Android/PWA validation (C7)
- full locked contract, automated acceptance and desktop human smoke in `docs/ACTIVE_SCOPE_LOCK.md` (Runtime cutover C6 section)
- runtime behavior change: YES, effective only after an accepted C6 implementation; until then the accepted production/runtime baseline is unchanged
- C6 checkpoint requires: implementation, automated GREEN, independent source review PASS / ACCEPT, desktop Chrome human smoke PASS (`PENDING` until the human confirms), then a docs-only checkpoint
- C7-C8: LOCKED

### RUNTIME_CUTOVER_C6_REMINDER_TEST_SCOPE_AMEND
- status: AMENDED (C6 remains OPEN; not implemented; implementation in a separate pass)
- baseline: `07a74aafc174aea3aab43aa99d60e8721f396553` (`docs: open runtime cutover c6`)
- origin: discovered before C6 implementation
- root cause: C6 requires the reminder browser suite to pass in `LEGACY` and `READY`, but `scripts/reminders/browser-cases.mjs` reads current calendar state directly from `localStorage['majamajandus_household_events_v1']` (explicit reminder-none persistence check and malformed reminder-delivery-state + calendar CRUD check). That is valid only in `LEGACY`; in `READY` IndexedDB is authoritative and the legacy calendar bytes stay frozen, so the read would assert stale data and could hide a real C6 regression
- resolution: add exactly one writable C6 test file, `scripts/reminders/browser-cases.mjs` (total 6 writable C6 test files), changed only to remove the assumption that current calendar state lives in the legacy key; preferred shape `runReminderChecks({ ...existingHelpers, readCalendarEvents })` with a TEST-ONLY mode-aware `readCalendarEvents()` provided by `scripts/shell/app-shell.test.mjs` (`LEGACY`: accepted legacy/localStorage calendar state; `READY`: authoritative IndexedDB/C5 calendar state); assertions are not weakened; no production test API
- run-only (not writable): `scripts/reminders/reminder-ui.test.mjs`, `scripts/reminders/native-notification.test.mjs` (both set an env flag and import `scripts/shell/app-shell.test.mjs`), `scripts/reminders/reminders.test.mjs`
- device-local reminder state unchanged: `majamajandus_reminder_preferences_v1` and `majamajandus_reminder_delivery_v1` stay direct-localStorage assertions; not migrated, not made mode-aware
- legacy mirror workaround: FORBIDDEN (no test writes IndexedDB calendar state back into `majamajandus_household_events_v1` or keeps it synchronized)
- C6 production scope: UNCHANGED by this amendment (12 files at that time; no `src/storage/**` file made writable); C6 architecture unchanged; the amendment authorized no workaround for `READY` authority identity: C5 repositories bind to the switch identity proven by the C4 boot, and if that needs a closed storage file changed, STOP (resolved by `RUNTIME_CUTOVER_C6_AUTHORITY_IDENTITY_SCOPE_AMEND` below through an explicit docs-only amendment)
- this pass was docs/governance only; no source, test, package or config file changed
- runtime behavior change: YES once C6 is implemented and accepted (unchanged); currently NONE
- C7-C8: LOCKED

### RUNTIME_CUTOVER_C6_AUTHORITY_IDENTITY_SCOPE_AMEND
- status: AMENDED (C6 remains OPEN; not implemented; implementation in a separate pass)
- baseline: `8e15c47e3d29b3cbcde88c7d42e55ceba720715c` (`docs: amend c6 reminder test scope`)
- origin: discovered before C6 implementation (the production-interface blocker the reminder amendment's STOP note anticipated)
- root cause: C5 repositories need the switch identity established by the C4 boot so `runReplicaMutation({ authority: { switchId }, ... })` rejects stale-tab writes after durable authority changes. C4 tracks the exact validated authority internally as `mountedAuthority` (set at `READY` entry, reset on `BOOTING`), but the public controller API (`replica`, `getState`, `getResult`, `subscribe`, `boot`, `retry`, `confirmStorageLost`, `confirmRevertStorageLost`, `handleRuntimeSignal`, `close`) does not expose it, and `readyDetail()` carries only `divergence` and `domainInvalid`
- why a C6-side recovery is unsafe (all forbidden): re-reading `controller.replica.getMeta('storageAuthorityV1')` after boot, parsing the localStorage hint, or caching a value from C6's own `newId()` wrapper. Race: C4 mounts `READY` on authority A, another tab changes or reverts authority to B, and before C6 processes the signal a C6-side re-read binds repositories to B, so a tab mounted under A would obtain B's identity instead of failing stale
- resolution: widen C6 production scope by exactly one previously closed storage file, `src/storage/storageAuthority.js` (total 13 production files), for exactly one additive read-only accessor `getReadyAuthorityIdentity()`: `state === 'READY' && mountedAuthority ? { switchId: mountedAuthority.switchId } : null` (a fresh minimal object with only `switchId`, never the internal authority object; `getResult()` payloads unchanged). `READY`, `READY` + `LEGACY_DIVERGED` and `READY` + `domainInvalid` return the mounted identity; every non-`READY` state returns `null` (a fresh `BOOTING` already resets `mountedAuthority`)
- C6 usage: only after `boot()` resolves `READY` and the accessor returns a non-null non-empty `switchId`, create `createReplicaRepositories({ replica: controller.replica, authority, newId, clock })` once; never refresh identity by reading meta after mount; a fresh identity comes only from a fresh C4 boot
- stale-tab safety: on a durable authority change C4 moves the tab to `RELOAD_REQUIRED` and the accessor returns `null`; a mutation racing the transition through repositories bound to A is rejected by C3's transactional authority guard
- required tests (in the already-writable storage test files, RED before `storageAuthority.js` is modified): `null` before boot and after a `LEGACY` boot; exact mounted `switchId` on `READY`, `READY` + `LEGACY_DIVERGED` and `READY` + `domainInvalid`; `RELOAD_REQUIRED` and `null` after an authority-change signal on a mounted tab; old identity not exposed once a fresh boot begins. Required review falsification: swap the accessor to a freshly observed authority (for example via `replica.getMeta(...)`), construct the A-then-B race, confirm the test fails, restore
- forbidden inside `storageAuthority.js`: any state-machine, `READY` detail, validation, hint, switch-ordering, revert, broadcast, mounted-signal, transaction or schema change; one accessor only
- unchanged: 6 writable test files (including the reminder amendment), C6 architecture, importer allowlist, C7-C8 LOCKED. Updated C6 scope: 13 production files, 6 writable test files
- this pass was docs/governance only; no source, test, package or config file changed
- runtime behavior change: YES once C6 is implemented and accepted (unchanged); currently NONE
- C7-C8: LOCKED

### RUNTIME_CUTOVER_C6
- status: ACCEPTED / CHECKPOINTED; C6 source scope CLOSED
- implementation history: scope open `07a74aafc174aea3aab43aa99d60e8721f396553` → reminder test-scope amendment `8e15c47e3d29b3cbcde88c7d42e55ceba720715c` → authority-identity amendment `6123c12567efea7040d5a5995dd8ba5f738c73a1` → initial implementation `6a5739fb4c7809d9e50ce4d6e6bdf6d866474360` → final corrective implementation `7146d0ac85c28da0cb8846b944099bf1307b9ece`
- final implementation: `7146d0ac85c28da0cb8846b944099bf1307b9ece` (`fix: harden runtime cutover coordination`); implementation range `6a5739fb4c7809d9e50ce4d6e6bdf6d866474360..7146d0ac85c28da0cb8846b944099bf1307b9ece`
- initial independent source review: AMEND — signal/committed/focus refresh ordering race; stale visible saved-place inputs after remote refresh; pending EventDialog cancellation; generic `STORAGE_UNAVAILABLE` copy overclaim
- final independent C6 source review: PASS / ACCEPT; reviewed final commit `7146d0ac85c28da0cb8846b944099bf1307b9ece`; remaining C6 source blocker: NONE FOUND. The reviewer verified live Git, diff scope, final source and test definitions; supplied ThinkPad command counts were implementation execution evidence and were not independently rerun by that reviewer.
- accepted runtime: `LEGACY` uses the guarded accepted localStorage repositories; `READY` uses C5 IndexedDB repositories bound only to the exact C4-mounted `switchId` from `getReadyAuthorityIdentity()`, never a C6-side meta/hint/newId rediscovery. The page-lifetime signal pipeline orders storage, foreground, authority-change and committed-domain handling so an A-mounted tab never adopts a B snapshot before C4 can require reload.
- accepted runtime behavior: shared hooks mount only after C4 authority resolution; normal READY committed mutations refresh only their domain in another tab without `RELOAD_REQUIRED`; authority/connection change produces `RELOAD_REQUIRED` and disables shared writes; no forward legacy mirror/write after switch; `DOMAIN_INVALID` stays per-domain; async UI reports success only after persistence and blocks pending dialog cancellation.
- automated evidence: authority accessor Chromium `2/2` plus Node API coverage; storage Node `83/83`; IndexedDB Chromium `88/88`; saved places `6/6`; calendar core `19/19`; calendar UI LEGACY/READY `31/31`, `31/31`; app shell LEGACY/READY `32/32`, `48/48`; reminders core `28/28`; reminder UI LEGACY/READY `32/32`, `32/32`; native notifications LEGACY/READY `26/26`, `26/26`; waste core `23/23`; waste UI LEGACY/READY `33/33`, `33/33`; visual polish `72/72`; build PASS; `git diff --check` PASS. A previously observed one-off LEGACY native-notification failure did not recur in final validation; it is recorded only as intermittent, not as a proven pre-existing defect.
- TDD record: initial C6 implementation used partial TDD; corrective A-D used strict RED→GREEN with mutation/falsification evidence.
- desktop Chrome human smoke: PASS at `http://127.0.0.1:4176/`, switching legacy build `6123c12567efea7040d5a5995dd8ba5f738c73a1` to C6 build `7146d0ac85c28da0cb8846b944099bf1307b9ece`. Existing data after switch, calendar/household/places/waste CRUD, reload persistence, two-tab committed refresh, visible saved-place refresh, reload-banner path, writes disabled under `RELOAD_REQUIRED`, and visual parity all PASS; unexpected storage state NONE; `TransactionInactiveError` NO.
- waste import human note: waste CRUD PASS; a separate waste-import action was NOT SEPARATELY CONFIRMED in the desktop smoke. This does not weaken automated LEGACY/READY waste coverage.
- runtime behavior change: YES. C6 implementation is accepted. The expectation that canonical production would remain unchanged was superseded by later Cloudflare metadata: Git auto-deployments put C6-containing code in production before C7/C8 governance. This observed production state is recorded below and is not a C8 acceptance.
- next gate: `RUNTIME_CUTOVER_C7_SCOPE_OPEN`; C7 preview/implementation and C8 remain LOCKED.

### RUNTIME_CUTOVER_C7_SCOPE_OPEN
- status: OPEN (docs-only scope open; no deployment, build artifact, source, test, package or repository deployment-configuration change in this pass)
- baseline: `9dac8c021be1b99bf7ec1227615cb6f3bd874674` (`docs: checkpoint runtime cutover c6`); C1-C6 are ACCEPTED / CHECKPOINTED and C6 source scope remains CLOSED
- purpose at scope-open: validate the accepted C6 cutover on one real fixed Cloudflare Pages preview origin with a real Android installed PWA. The prior forensic/destructive-drill model is superseded by `RUNTIME_CUTOVER_C7_FINAL_PREVIEW_GATE` below.
- source scope: NO SOURCE CHANGES. Forbidden: `src/**`, `scripts/**`, `public/**`, `functions/**`, package files, Vite config, repository deployment configuration and generated artifacts. A discovered source defect STOPs C7 and requires a separately governed source amendment.
- deployment boundary: use only existing external Cloudflare Pages infrastructure; do not invent or commit a workflow or `wrangler.toml`. Future C7 execution may build the specified accepted commits, deploy their distinct external artifacts to an existing Pages project and inspect its metadata, but only after selecting one immutable fixed preview/branch-alias origin. Canonical production is the frozen observed C6-containing accidental deployment recorded below; it is not a C8 accepted deployment and must not be intentionally deployed during C7.
- fixed-origin rule: select and record exactly one C7 preview/branch alias before the first deployment. Every legacy, forward, revert and re-forward deployment uses that one origin; changing it fails and restarts C7 from Step 1. A generated unique deployment URL is not a substitute.
- build matrix: legacy seed `6123c12567efea7040d5a5995dd8ba5f738c73a1` in normal mode; C6 forward `9dac8c021be1b99bf7ec1227615cb6f3bd874674` with `VITE_STORAGE_AUTHORITY_MODE` unset/`forward`; revert from the same checkpoint with `VITE_STORAGE_AUTHORITY_MODE=revert`; re-forward from the same checkpoint in normal mode. Artifacts remain distinct and uncommitted.
- human gate: OPEN / PENDING. This historical scope-open sequence is superseded below by the human-approved C7 final preview gate; only the final Android smoke may mark C7 PASS.
- waste import: attempt the real import if available; otherwise record `WASTE_IMPORT: NOT AVAILABLE`. Do not fabricate PASS.
- C8: LOCKED. C7 acceptance requires a later docs-only checkpoint after complete human evidence; no production deployment is authorized here.

### C7_PRODUCTION_BREACH_CONTAINMENT_CHECKPOINT
- status: CHECKPOINTED. This is an incident/containment record only; it does not accept C7 or C8 and authorizes no source, test, package, configuration, workflow, build-artifact or deployment change.
- incident: Cloudflare Pages project `annivibe` had Git integration `github` with production branch `main`. Before containment, pushes to `main` triggered automatic production deployments (`GIT_AUTO_DEPLOY` / `github:push`) outside the intended C7/C8 deployment gates.
- first C6-containing production deployment: `4c81dd4f-158b-4ef5-9065-9217ffa93dd5`, commit `6a5739fb4c7809d9e50ce4d6e6bdf6d866474360`. It occurred before the formal C6 final review and human gate. Last pre-C6 production deployment: `a00aba42-bde6-4c44-ad17-b07ac2c975f3`, commit `6123c12567efea7040d5a5995dd8ba5f738c73a1`.
- observed production timeline: `a00aba42-bde6-4c44-ad17-b07ac2c975f3` / `6123c12567efea7040d5a5995dd8ba5f738c73a1` (pre-C6), `4c81dd4f-158b-4ef5-9065-9217ffa93dd5` / `6a5739fb4c7809d9e50ce4d6e6bdf6d866474360` (first C6-containing), `acb23ec2-4db3-4a21-8060-c3b4e81a7595` / `7146d0ac85c28da0cb8846b944099bf1307b9ece` (C6 corrective), `01788266-50bf-4b4d-b0b4-3391f58de666` / `9dac8c021be1b99bf7ec1227615cb6f3bd874674` (C6 docs), and current `0cca08f2-3a87-4176-99e2-7bc107bf8ce5` / `549203d3a0eced020fc954cab62721ee85a06936` (C7 scope docs).
- current production: `0cca08f2-3a87-4176-99e2-7bc107bf8ce5`, commit `549203d3a0eced020fc954cab62721ee85a06936`, branch `main`, C6-containing runtime. It is an accidental observed rollout, not an official C6 production rollout and not a C8 accepted deployment. Freeze it in place.
- rollback: NOT PERFORMED. A pre-C6 rollback is unsafe because clients may already have switched their local authority from legacy localStorage to IndexedDB, which a pre-C6 application cannot safely understand. The accepted rollback remains the governed revert build, not a pre-C6 production rollback.
- containment: the human disabled Pages automatic production-branch deployments. Independent read-only project inspection reports `production_branch: main`, `production_deployments_enabled: false`, preview deployment setting `all`, and Git integration `github`; no production deployment occurred during containment verification.
- policy: a `main` push MUST NOT auto-deploy production. C7 deploys only to its later fixed preview branch alias; C8 is the only intentional production-deployment gate. Any unexpected production deployment before C8 is a STOP.
- C7: scope remains OPEN and is superseded below by the Step 1 human checkpoint. C8: LOCKED.
- build provenance remains: legacy seed `6123c12567efea7040d5a5995dd8ba5f738c73a1`; forward `9dac8c021be1b99bf7ec1227615cb6f3bd874674`; revert is the same forward checkpoint with `VITE_STORAGE_AUTHORITY_MODE=revert`; re-forward is the same forward checkpoint in normal mode. Docs commits are not build provenance.

### RUNTIME_CUTOVER_C7_HUMAN_STEP1_CHECKPOINT
- status: CHECKPOINTED. Docs-only governance amendment; no source, test, package, configuration, workflow, deployment-configuration or runtime-artifact change. C7 overall is not accepted.
- UI capability amendment: both legacy `6123c12567efea7040d5a5995dd8ba5f738c73a1` and C6 forward `9dac8c021be1b99bf7ec1227615cb6f3bd874674` expose saved-place `update`, `add` and `remove` runtime APIs, but `SeadedTab` exposes only editing/saving of its three visible rows. There is no user-visible saved-place add or remove control. This is a human-gate specification mismatch, not an application regression. Step 1 now requires: “Save meaningful values into all three user-visible saved-place rows and record their visible top-to-bottom order before cutover.” Step 3 now requires every user-visible shared-domain mutation: Calendar create/edit/delete; Household edit/save plus persistence; Saved places edit/save of the three rows plus order preservation, persistence and multi-context refresh; and actual exposed Waste operations. Automated coverage remains authoritative for non-exposed add/remove.
- fixed C7 preview: branch `c7-storage-cutover`; origin `https://c7-storage-cutover.annivibe.pages.dev`; incomplete first preview deployment `3fdf1f45-9c64-4d70-b5d9-05a0fb9225b2`; accepted recovery deployment `342c1212-7023-48e5-a195-be0f3896748c`, environment `preview`, legacy provenance `6123c12567efea7040d5a5995dd8ba5f738c73a1`. Recovery proof: `sw.js`, `workbox-66610c77.js` and `registerSW.js -> /sw.js`; stable `dist` snapshot; local/remote SHA-256 equality; valid remote service-worker JavaScript MIME and syntax. No production change.
- C7 HUMAN STEP 1: PASS. Installed PWA/fixed-origin operation PASS; one-off event PASS; recurring event PASS; household profile PASS; three visible saved places PASS; saved-place add/remove `NOT USER-EXPOSED`; reminder setup PASS; browser notification permission PASS; default reminder `1 päev enne`; `WASTE_IMPORT: NOT AVAILABLE`; manual waste schedule PASS; unexpected error/state NONE reported.
- `PLACE_ORDER_BEFORE` (Step 2 continuity oracle):
  1. Kodu — Õie 58
  2. Vanaema — Kaevu 10
  3. Trenn — Pikk 23
- After forward cutover this order must remain exact unless the human deliberately changes the data before Step 2; then STOP and establish a new explicit baseline before deployment.
- C7 state at this checkpoint: Step 1 deployment prep PASS; Human Step 1 PASS; later Step 2A and Steps 3-7 are superseded by the final preview gate below. C8: LOCKED.

### RUNTIME_CUTOVER_C7_FINAL_PREVIEW_GATE
- status: OPEN / FINAL GATE. Docs-only simplification; no runtime source, test, package, configuration, workflow, deployment-configuration or runtime-artifact change. C8 remains LOCKED.
- human-approved waiver: **MANUAL C7 FORENSIC/DESTRUCTIVE DRILLS: WAIVED BY HUMAN FOR FINAL ACCEPTANCE GATE.** Waived and not claimed executed: raw localStorage SHA snapshot, mandatory remote DevTools storage inspection, quota simulation, manual IndexedDB deletion, manual shared-legacy-key deletion, deliberate `LEGACY_DIVERGED`, and destructive rollback/re-forward phone drill. Accepted automated/runtime coverage remains required.
- required automated/deploy gate: exact forward provenance `9dac8c021be1b99bf7ec1227615cb6f3bd874674` with `VITE_STORAGE_AUTHORITY_MODE` absent; complete accepted C6 automated validation; fresh focused source review; build PASS; complete/stable PWA artifact gate; remote/local artifact equality; deployment only to fixed alias `https://c7-storage-cutover.annivibe.pages.dev`; canonical production unchanged.
- final human Android-PWA smoke remains PENDING: continuity for existing one-off/recurring events, household, locked place order, reminder and manual waste schedule; Calendar create/edit/delete; household and saved-place edit/save; close/reopen persistence; and no unexpected storage/error state. C7 may be marked PASS only after this human smoke and the automated/deploy gate both PASS.

### 1. Initial governance baseline
**Staatus:** accepted

Sisu:
- 4-failine minimaalne truth-layer on defineeritud
- canonical docs mudel on valitud
- Pass 1 on docs-only

### 2. Current app baseline (target direction)
**Staatus:** accepted

Sisu:
- AnniVibe v1 scope on fikseeritud:
  - Kodu
  - Buss
  - Loo
  - Päevik
  - Tugi
  - Seaded
- Trendid ja Loo oma trend on v1-st väljas
- `src/` on canonical app baseline
- `/api/ullata` route on oodatud arhitektuurne suund
- saved places shape on `{ name, address, lat, lon }`

### 3. Clean repo integrity verification (blocked baseline)
**Staatus:** accepted

Sisu:
- `npm install` succeeded
- `npm run build` failed with:
  - `[vite-plugin-pwa:build] Could not resolve entry module "index.html"`
- `index.html` is missing
- `functions/api/ullata.js` is missing
- `public/manifest.webmanifest` exists but references missing `/screenshots/kodu.png`
- repo is **not build-ready yet**

### 4. Pass 2 docs-only integrity mapping
**Staatus:** accepted

Sisu:
- `docs/CODEBASE_MAP.md` created
- `docs/CHANGE_SURFACES.md` created
- blocker state documented without code changes

### 5. Pass 3 restore build runtime baseline
**Staatus:** accepted

Sisu:
- `index.html` restored
- `functions/api/ullata.js` restored
- `npm run build` succeeded
- `git status --short` clean
- `main` is synced with `origin/main` (`0 0`)

### 6. Pass 4 manifest screenshot cleanup
**Staatus:** accepted

Sisu:
- `public/manifest.webmanifest` `screenshots` section removed
- `/screenshots/kodu.png` manifest blocker closed
- `npm run build` succeeded after change

### 7. Pass 5 mobile QA / pre-deploy smoke test
**Staatus:** accepted

Sisu:
- `npm run build` succeeded
- local dev server smoke test passed
- bottom nav passed
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` passed
- `Loo -> Joonistamise nipid` count `17` passed
- `Loo -> Üllata` returned idea/fallback passed
- console runtime critical errors/warnings = `0`
- GO decision recorded
- limitation: real Android Chrome same-Wi-Fi physical device smoke test was not completed in this Codex session

### 8. Pass 7 Cloudflare Pages deploy
**Staatus:** accepted

Sisu:
- Cloudflare auth worked
- Pages project `annivibe` exists
- GitHub source connected: `Fuuduuu/AnniVibez`, branch `main`
- build command: `npm run build`
- output dir: `dist`
- root dir: repo root (`/`)
- functions directory: `functions`
- production deploy succeeded
- live URL: `https://annivibe.pages.dev`
- deployment URL: `https://3a1eeec4.annivibe.pages.dev`
- live smoke test passed in mobile viewport `390x844`
- app opens
- bottom nav works
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` pass
- `Loo -> Joonistamise nipid` count `17` pass
- `Loo -> Üllata` returned idea/fallback pass
- `/api/ullata` POST returned JSON with `idea` and `source`
- `/api/ullata` source currently = `local`
- console errors/warnings/page errors = `0/0/0`
- GO decision recorded
- no critical deploy blockers remain

### 9. Pass 8 Mermaid docs mapping pass
**Staatus:** accepted

Sisu:
- Mermaid project mapping pass accepted
- `docs/PROJECT_MAP.md` added
- `docs/PROJECT_MINI_MAP.md` added
- commit: `825af77` (`Add Mermaid project maps`)
- scope did not change
- no code/runtime/deploy settings changed
- post-commit `git status --short` was clean

### 10. Pass 9 deploy verification + manual Wrangler deploy checkpoint
**Staatus:** accepted

Sisu:
- verification workdir: `C:\Users\Kasutaja\Desktop\AnniVibez_clean`
- `git status --short` clean
- `npm run build` succeeded
- manual Wrangler deployment URL verified:
  - `https://b9e6bc21.annivibe.pages.dev`
- production alias verified:
  - `https://annivibe.pages.dev`
- both URLs returned `200` and same frontend asset hash:
  - `assets/index-DuNsa792.js`
- `/api/ullata` POST returned JSON with:
  - `idea` (object)
  - `source` (`local`)
- current validation baseline is manual deployment `b9e6bc21`
- GO for deploy validation on manual deployment
- follow-up remains open:
  - Cloudflare Git-backed deploy path previously built old commit `165d23e`

### 11. Pass 10 Cloudflare Git-backed deploy path verification/fix
**Staatus:** accepted

Sisu:
- GitHub latest `main` commit verified:
  - `121a8e2fb1f3299f9b6046d6669a5c0c36e29ab1`
- Cloudflare Pages source verified:
  - GitHub repo `Fuuduuu/AnniVibez`
  - branch `main`
- latest production deployment verified:
  - short id `238aef14`
  - trigger `github:push`
  - status `success`
- production deployment used latest `main` commit:
  - `121a8e2fb1f3299f9b6046d6669a5c0c36e29ab1`
- future automatic deploys: `GO`
- manual Wrangler deploy remains fallback only
- old commit drift issue (`165d23e`) is downgraded from active blocker to monitor-only history note

### 12. Pass 11 BUS_LOGIC_PASS destination/upcoming sequence logic
**Staatus:** accepted

Sisu:
- files changed:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
- `depsWithMeta` added
- `deps` remains backward-compatible
- destination can resolve from group/name/stopId to stopIds
- valid route rule:
  - origin and destination in same pattern/context AND destination `seq >` origin `seq`
- clear empty reason added
- manual stop selection preserves stopId-based origin
- `npm run build` succeeded
- validation cases passed:
  - no destination selected preserved
  - Piira -> Näpi departures shown
  - Kauba -> Bussijaam gives clear invalid direction reason
  - Õie/Tulika stopIds remain distinct
- untouched:
  - App
  - Loo
  - Päevik
  - Tugi
  - Seaded
  - `/api/ullata`
  - deploy config
  - design tokens
  - Trends
- pass is accepted/checkpointable

### 13. Pass 12 QA_PASS live bus smoke after Cloudflare auto-deploy
**Staatus:** accepted

Sisu:
- deploy/commit check:
  - latest `main` commit: `00f7ab1a61ee9b6fc393cca63a7355425140dd5d`
  - production deploy: `d7b76b63`
  - deployment URL: `https://d7b76b63.annivibe.pages.dev`
  - trigger: `github:push`
  - status: `success`
  - deploy commit matched latest `main`
- live URLs:
  - `https://annivibe.pages.dev` -> `200`
  - `https://d7b76b63.annivibe.pages.dev` -> `200`
- both URLs served same asset bundle:
  - `assets/index-wD-CtbNR.js`
- buss smoke cases passed:
  - no destination selected preserved
  - valid origin -> destination by group/name (Piira -> Näpi) returned departures
  - destination by stopId (Piira -> `5900508-1`) returned departures
  - invalid direction (Kauba -> Bussijaam) returned `count=0` + clear reason
  - manual origin stopId case passed
  - no valid upcoming destination case passed with clear time-based reason
  - Õie/Tulika stopIds remained distinct
- empty/invalid state message confirmed clear:
  - `Valitud suunas sobivat liini ei leitud`
- `npm run build` succeeded
- no runtime/code files changed in PASS 12
- pass accepted/checkpointable

### 14. Pass 14B GEMINI_RUNTIME_PROVIDER
**Staatus:** accepted

Sisu:
- minimal Gemini provider support added in:
  - `functions/api/ullata.js`
- endpoint remained POST-only
- `Cache-Control: no-store` preserved
- local deterministic fallback preserved
- provider priority:
  - `GEMINI_API_KEY` present -> `source=gemini`
  - else `OPENAI_API_KEY` present -> `source=openai`
  - else -> `source=local`
- no Üllata UI redesign/refactor
- bus files untouched:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
- `npm run build` succeeded
- runtime/code diff stayed narrow (`functions/api/ullata.js` only)

### 15. Pass 14C PROVIDER_RUNTIME_VERIFY
**Staatus:** accepted

Sisu:
- Cloudflare production secrets include:
  - `GEMINI_API_KEY` (encrypted)
  - `OPENAI_API_KEY` (encrypted)
- production deploy verified:
  - `https://b0876d63.annivibe.pages.dev`
- canonical URL verified:
  - `https://annivibe.pages.dev`
- `/api/ullata` on both URLs returned `source=gemini`
- repeated same payload produced different Gemini ideas:
  - `Loo oma maagiline amuletti`
  - `Maagiline unenäopüüdja`
  - `Maagiline taskuraamat`
- endpoint no longer stuck in deterministic `source=local` fallback in production
- repeated curl port parse error treated as shell parsing artifact, not API failure
- LF/CRLF warnings treated as line-ending warnings only
- pass accepted/checkpointable

### 16. Pass 16 OIE_TULIKA_NEARBY_DIRECTION
**Staatus:** accepted

Sisu:
- root cause was nearest-stop selection UX, not route filtering
- previous behavior selected one best stop-point and surfaced only that stop in UI
- changed files:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
- implemented:
  - `nearest()` now returns primary stop + nearby `candidates`
  - small local Õie↔Tulika pair-rule to surface this confusing nearby/opposite-side pair
  - `BussTab` shows `Lähedal ka` options with distance and allows direct stop choice
  - `BussCard` shows `Lähedal ka` context row
- deterministic validation confirmed shared nearby context:
  - `OIE: Õie ... | Tulika ...`
  - `TULIKA: Tulika ... | Õie ...`
  - `MID: Tulika ... | Õie ...`
- `npm run build` succeeded
- untouched:
  - `functions/api/ullata.js` (Üllata/Gemini/provider code)
- `depsWithMeta(...)` logic
- destination sequence rule (`destination seq > origin seq`)
- pass accepted/checkpointable

### 17. Pass 17_PREP AUDIT_FINDINGS_BACKLOG_SYNC
**Staatus:** accepted

Sisu:
- docs/planning pass only
- Claude audit findings synced as pending backlog
- new planning doc:
  - `docs/AUDIT_FINDINGS_BACKLOG.md`
- findings were marked pending/planned, not fixed
- future fixes constrained to one narrow pass at a time
- no runtime/app logic changes in this prep pass
- pass accepted/checkpointable

### 18. Pass 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET
**Staatus:** accepted

Sisu:
- changed files:
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
- fixed sibling/display code usage in departures calls:
  - origin code priority now uses `displayCodes || codes || [code]`
- destination is reset on manual origin change in `BussTab`
- preserved behavior:
  - no route sequence/filter rewrite
  - `depsWithMeta(...)` unchanged
  - `src/utils/bus.js` unchanged in this pass
  - `src/data/busData.js` unchanged in this pass
  - `functions/api/ullata.js` untouched in this pass
  - `src/components/LooTab.jsx` untouched in this pass
- pass implementation was validated in PASS 18

### 19. Pass 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT
**Staatus:** accepted

Sisu:
- validation/checkpoint pass only (no new implementation)
- `npm run build` succeeded
- source/manual checks passed:
  - Kivi sibling codes present and usable:
    - `5900286-1`
    - `5900287-1`
  - Kesk sibling codes present and usable:
    - `5900229-1`
    - `5900230-1`
  - no-destination flow still returns departures
  - invalid direction still returns clear `emptyReason`
  - Õie/Tulika nearby UX remains intact
- confirmed unchanged:
  - `depsWithMeta(...)` sequence logic
  - bus data
  - Üllata/API/provider surfaces
- PASS 17 is safe to checkpoint

### 20. PASS 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO
**Staatus:** accepted

Sisu:
- changed file:
  - `src/components/LooTab.jsx`
- Üllata `Salvesta` now persists generated idea entries to localStorage key:
  - `annivibe_saved_ideas`
- saved entry shape includes:
  - `id`
  - `createdAt`
  - `title`
  - `text`
  - `type`
  - `meta: { with, time, mood, material, source }`
- duplicate save of same idea is prevented
- corrupt JSON in saved ideas localStorage is recovered safely as `[]`
- `Uus idee` / obsolete current idea resets `savedIdea` UI state
- `npm run build` succeeded
- untouched in this pass:
  - `functions/api/ullata.js`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`
- PASS 19_MAIN applied on real `main` repo baseline

### 21. PASS 20 ULLATA_PROVIDER_TIMEOUT
**Staatus:** accepted

Sisu:
- changed file:
  - `functions/api/ullata.js`
- provider fetch timeout hardening added with helper:
  - `fetchWithTimeout(url, options, timeoutMs = 8000)`
- timeout mechanism:
  - `AbortController` signal passed into provider fetch
  - timeout timer cleared in `finally`
- wired in both provider calls:
  - `generateWithGemini(...)`
  - `generateWithOpenAI(...)`
- preserved behavior:
  - same request body/headers/json parsing/normalization
  - same provider priority/policy (`GEMINI -> local`, else `OPENAI -> local`)
  - no Gemini -> OpenAI chain added in this pass
  - local fallback path remains
- `npm run build` succeeded
- untouched in this pass:
  - `src/components/LooTab.jsx`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`

### 22. PASS 21 ULLATA_LOCAL_VARIATION_NONCE
**Staatus:** accepted

Sisu:
- changed files:
  - `src/components/LooTab.jsx`
  - `functions/api/ullata.js`
- frontend now sends `variationNonce` with Üllata generation request
- `Uus idee` now increments nonce each generation request
- backend payload normalization now includes `variationNonce`
- backend local fallback seed now includes `variationNonce`
- behavior validation:
  - same input + same nonce => deterministic same fallback output
  - same input + different nonce => fallback can vary when template space allows
- preserved behavior:
  - PASS 19 save localStorage logic remains intact
  - PASS 20 timeout helper remains intact (`PROVIDER_TIMEOUT_MS = 8000`, `fetchWithTimeout(...)`)
  - provider priority/policy unchanged (no Gemini -> OpenAI chain in this pass)
- `npm run build` succeeded
- untouched in this pass:
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`

### 23. PASS 22 PROVIDER_FALLBACK_CHAIN
**Staatus:** accepted

Sisu:
- changed file:
  - `functions/api/ullata.js`
- provider fallback policy is now explicit:
  - `Gemini -> OpenAI -> local`
- behavior:
  - if Gemini succeeds -> `source=gemini`
  - if Gemini fails/timeouts and OpenAI key exists -> OpenAI is attempted
  - if OpenAI succeeds -> `source=openai`
  - if both providers fail/missing -> local fallback `source=local`
- preserved behavior:
  - PASS 20 timeout helper unchanged (`PROVIDER_TIMEOUT_MS = 8000`, `fetchWithTimeout(...)` on both providers)
  - PASS 21 variationNonce unchanged (normalized + included in local fallback seed)
  - response shape unchanged
  - no raw provider errors exposed to user
- `npm run build` succeeded
- lightweight mock/provider-order validation passed:
  - `both_keys_gemini_fail_openai_ok -> source=openai`
  - `both_keys_gemini_ok -> source=gemini`
  - `gemini_missing_openai_ok -> source=openai`
  - `both_missing_or_fail -> source=local`
- untouched in this pass:
  - `src/components/LooTab.jsx`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`

### 24. PASS 23A BUS_DESTINATION_FIRST_UX_PLAN
**Staatus:** accepted (docs-only)

Sisu:
- docs-only pass; code changes were not made
- destination-first Bus UX direction locked:
  - primary question: `Kuhu soovid minna?`
  - flow target: destination first -> auto/current/manual origin -> route recommendation
- MVP constraints locked:
  - keep existing `depsWithMeta(...)` as initial routing engine
  - no map in MVP
- locked future order:
  1. destination-first MVP without map
  2. destination-first `BussTab` state flow implementation
  3. Rakvere validation
  4. map destination picker later
- pass is checkpointable as docs-direction lock

### 25. PASS 23B BUS_DESTINATION_FIRST_MVP_NO_MAP
**Staatus:** accepted

Sisu:
- changed file:
  - `src/components/BussTab.jsx`
- destination-first Bus MVP implemented:
  - destination chooser is primary (`Kuhu soovid minna?`)
  - effective origin is `manualOriginOverride ?? currentOrigin`
  - manual origin override is toggleable (`Muuda lähtekoht`)
- wrapper behavior added in `BussTab`:
  - uses `depsWithMeta(...)` as routing engine
  - preserves origin code handling: `displayCodes || codes || [code]`
  - tries up to 2 nearby origin candidates if primary origin has no departures
  - merges/sorts/deduplicates route options with origin context
- empty states added/kept for destination-first flow:
  - `Vali sihtkoht, et näha marsruute`
  - `Vali lähtekoht, et näha marsruute`
  - `Vali erinev sihtkoht`
- `npm run build` succeeded
- untouched in this pass:
  - `src/utils/bus.js`
  - `src/data/busData.js`
  - `src/components/BussCard.jsx`
  - `src/components/LooTab.jsx`
  - `functions/api/ullata.js`
- no map implementation was added in this pass

### 26. PASS 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP
**Staatus:** accepted

Sisu:
- validation/docs/commit-prep pass (no new runtime implementation)
- `npm run build` succeeded
- live smoke deploy verified:
  - `https://968d08cb.annivibe.pages.dev`
- canonical URL verified:
  - `https://annivibe.pages.dev`
  - served bundle `assets/index-DjBNfPlr.js`
- `/api/ullata` POST returned `source=gemini`
- destination-first checks confirmed in `BussTab`:
  - primary destination prompt `Kuhu soovid minna?`
  - `manualOriginOverride ?? currentOrigin`
  - `displayCodes || codes || [code]`
  - nearby fallback capped to 2 candidates
- unchanged/guarded surfaces:
  - `depsWithMeta(...)` remained unchanged
  - `src/data/busData.js` remained unchanged
- no map implementation added
- PASS 23B is checkpoint-ready for commit

### 27. PASS 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY
**Staatus:** accepted (docs-only)

Sisu:
- docs/planning pass only; runtime code was not changed
- map picker architecture direction documented in:
  - `docs/BUS_MAP_PICKER_PLAN.md`
- locked rule:
  - map picker must feed existing destination-first flow
  - no separate routing engine is allowed
- locked phased plan:
  - `PASS 25A — ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP`
  - `PASS 25B — TYPED_STOP_SEARCH`
  - `PASS 25C — DESTINATION_POINT_AND_CANDIDATE_STATE_PREP`
  - `PASS 25D — LEAFLET_MAP_PICKER_SKELETON`
  - `PASS 25E — MAP_PICKER_INTEGRATION`
  - `PASS 25F — MAP_ROUTE_LIVE_SMOKE`
- guardrails preserved:
  - `depsWithMeta(...)` unchanged
  - `src/utils/bus.js` unchanged
- `src/data/busData.js` unchanged
- no map UI implementation added

### 28. PASS 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP
**Staatus:** accepted

Sisu:
- narrow runtime enrichment in `src/components/BussTab.jsx`
- route cards now include destination/get-off context:
  - `Mine peatusesse: [origin]`
  - `Sõida liiniga: [line]`
  - `Välju peatuses: [selected destination]`
- destination label uses selected destination group/name (no fake destination walking distance)
- accepted destination-first behavior stayed intact:
  - `manualOriginOverride ?? currentOrigin`
  - destination-first render order and empty states
  - nearby-origin fallback up to 2 candidates
  - sibling-code handling via `displayCodes || codes || [code]`
- guardrails preserved:
  - `depsWithMeta(...)` unchanged
  - `src/utils/bus.js` unchanged
  - `src/data/busData.js` unchanged
  - no map implementation added
- validation:
  - `npm run build` passed
  - no `dist/*` git noise remained

### 29. PASS 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC
**Staatus:** accepted (docs-only)

Sisu:
- Tehnika-style prompt governance dokumenteeriti:
  - `docs/PROMPT_SYSTEM.md`
- prompt mallid sünkrooniti PASS-põhiste placeholder-mallidega:
  - `docs/PROMPT_TEMPLATES.md`
- Mermaid diagram opportunity + starter diagram docs lisati:
  - `docs/MERMAID_DIAGRAMS.md`
- minimal docs index sync:
  - `docs/TRUTH_INDEX.md`
- runtime/source/deploy loogikat ei muudetud
- map implementationit ei lisatud

### 30. PASS 24 DEPLOY_ENV_DOCS
**Staatus:** accepted (docs-only)

Sisu:
- deployment/env dokumentatsioon lisati:
  - `docs/DEPLOYMENT.md`
- safe env sample lisati:
  - `.env.example`
- Cloudflare Pages/Wrangler workflow dokumenteeriti:
  - build/deploy/checklist
  - `/api/ullata` smoke näide
  - known recovery notes (`10500`, temporary auth/API retry path)
- provider env var nimed kinnitati `functions/api/ullata.js` järgi:
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL`
  - `OPENAI_API_KEY`
- `OPENAI_MODEL`
- runtime/source/deploy execution changes were not made in this pass

### 31. PASS 25B PLACE_DESTINATION_MODEL_DOCS
**Staatus:** accepted (docs-only)

Sisu:
- POI/place-first destination model was documented in:
  - `docs/BUS_POI_DESTINATION_PLAN.md`
- stop-name search was demoted to fallback/advanced path
- destination resolver layering was documented without runtime changes
- map/runtime implementation was explicitly deferred
- updated next-pass chain:
  - `PASS 25C — LOCAL_POI_DATASET_RAKVERE`
  - `PASS 25D — PLACE_SEARCH_UI_NO_MAP`
  - `PASS 25E — ROUTE_RECOMMENDATION_SCORING_NO_MAP`
  - `PASS 25F — MAP_PICKER_SKELETON`
  - `PASS 25G — MAP_PIN_TO_DESTINATION_CANDIDATES`
  - `PASS 25H — LIVE_FIELD_TEST`
- runtime/source code remained unchanged in this pass

### 32. Motion polish
**Staatus:** accepted

Sisu:
- checkpoint: `20ac51b481c1b2a7ea58ce2251f28ceb96f31046` (`style: add subtle native motion`)
- subtle page entrance, tactile bottom navigation, button/row press feedback, calendar state motion and event-dialog entrance are accepted
- reduced-motion support is preserved
- validation: `211 PASS`, `0 FAIL`
- human phone acceptance: PASS

### 33. Calendar UX v2
**Staatus:** accepted

Sisu:
- checkpoint: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
- visible `+ Lisa`, integrated `Täna`, month-aligned selected-day content and a post-content category legend are accepted
- essential event fields appear first; `Rohkem valikuid` contains recurrence, reminder and notes
- meaningful existing advanced values open the advanced section; imported-event protections and recurring-event semantics are preserved
- validation: `206 PASS`, `0 FAIL`
- production smoke and human phone acceptance: PASS

## Accepted not-yet-done areas

Need on teadaolevad puuduvad või lõpetamata osad, aga ei ava automaatselt uut scope’i:

- optional real Android Chrome same-Wi-Fi physical-device smoke remains recommended
- optional docs-only setup note for server-side secret handling
- stop-point coordinates may be partly generalized; exact road-side precision depends on source data quality
- Claude audit pending backlog is tracked in `docs/AUDIT_FINDINGS_BACKLOG.md`
- remaining pending audit items:
  - PASS 26B — MERMAID_DIAGRAMS_RENDER_REVIEW
  - PASS 25C — LOCAL_POI_DATASET_RAKVERE
  - PASS 25D — PLACE_SEARCH_UI_NO_MAP
  - PASS 25E — ROUTE_RECOMMENDATION_SCORING_NO_MAP
  - PASS 25F — MAP_PICKER_SKELETON
  - PASS 25G — MAP_PIN_TO_DESTINATION_CANDIDATES
  - PASS 25H — LIVE_FIELD_TEST
  - optional real mobile/GPS field testing

## Rejected / quarantine

### 1. Trends in v1
**Staatus:** rejected current scope jaoks

Põhjus:
- teadlikult v1-st väljas
- scope drift risk

### 2. Broad refactor / backend direction rewrite
**Staatus:** quarantine

Põhjus:
- vastuolus kitsa-passilise töökorraldusega
- nõuab eraldi locki

## Historical active phase (superseded)

- Pass 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET completed
- Pass 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT completed
- Pass 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO completed
- Pass 20 ULLATA_PROVIDER_TIMEOUT completed
- Pass 21 ULLATA_LOCAL_VARIATION_NONCE completed
- Pass 22 PROVIDER_FALLBACK_CHAIN completed
- Pass 23A BUS_DESTINATION_FIRST_UX_PLAN completed (docs-only)
- Pass 23B BUS_DESTINATION_FIRST_MVP_NO_MAP completed
- Pass 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP completed
- Pass 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY completed (docs-only)
- Pass 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP completed
- Pass 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC completed (docs-only)
- Pass 24 DEPLOY_ENV_DOCS completed (docs-only)
- Pass 25B PLACE_DESTINATION_MODEL_DOCS completed (docs-only)
- This historical queue is superseded by `COMMON_BACKEND_ARCHITECTURE` in `docs/ACTIVE_SCOPE_LOCK.md`.

## Historical next allowed step (superseded)

- PASS 25C: LOCAL_POI_DATASET_RAKVERE
- focus:
  - add verified local POI dataset and alias mapping for destination resolver
  - keep stop/group input as fallback path
  - keep existing routing engine stable (`depsWithMeta(...)` baseline)
- rules:
  - no bus engine rewrite in this pass
  - no map picker implementation in this pass
  - no typed-search UI implementation in this pass
- no broad runtime refactor
  - no redesign/refactor
  - no new feature scope
- no feature work
- no Trends
- no redesign
- no broad refactor
- no secrets in repo

## Implementation pass status

- Pass 14B GEMINI_RUNTIME_PROVIDER accepted and closed
- Pass 14C PROVIDER_RUNTIME_VERIFY accepted and closed
- Pass 16 OIE_TULIKA_NEARBY_DIRECTION accepted and closed
- Pass 17_PREP AUDIT_FINDINGS_BACKLOG_SYNC accepted and closed
- Pass 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET accepted and closed
- Pass 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT accepted and closed
- Pass 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO accepted and closed
- Pass 20 ULLATA_PROVIDER_TIMEOUT accepted and closed
- Pass 21 ULLATA_LOCAL_VARIATION_NONCE accepted and closed
- Pass 22 PROVIDER_FALLBACK_CHAIN accepted and closed
- Pass 23A BUS_DESTINATION_FIRST_UX_PLAN accepted and closed (docs-only)
- Pass 23B BUS_DESTINATION_FIRST_MVP_NO_MAP accepted and closed
- Pass 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP accepted and closed
- Pass 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY accepted and closed (docs-only)
- Pass 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP accepted and closed
- Pass 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC accepted and closed (docs-only)
- Pass 24 DEPLOY_ENV_DOCS accepted and closed (docs-only)
- Pass 25B PLACE_DESTINATION_MODEL_DOCS accepted and closed (docs-only)
- broad implementation pass ilma kitsa lockita: keelatud
