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
