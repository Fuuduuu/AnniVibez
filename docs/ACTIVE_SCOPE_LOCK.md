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

Current gate: **RUNTIME_CUTOVER_C5_SCOPE_OPEN** (pending its own docs-only scope-open pass). **C4 source scope: CLOSED** (ACCEPTED / CHECKPOINTED; see the Runtime cutover C4 section below). Runtime behavior change: NONE (C4 stays dormant). C5 implementation is LOCKED until its scope-open pass; C6-C8 remain LOCKED.

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

## Runtime cutover C4 (ACCEPTED / CHECKPOINTED)

Final implementation `d2d1dad0e688706609b80172e8b10a50c54d138d` (implementation history `bf4c598f5b494bb289d748d48632c77d4be96be9` → `fa4b81055a4d4449bac89ac40fb9dc44f851abef` → `858d777e0b15ef8a61197d9c49262f1818030a20` → final `d2d1dad0e688706609b80172e8b10a50c54d138d`). The accepted contract is recorded in full in `docs/ACCEPTED_CHECKPOINTS.md` (`RUNTIME_CUTOVER_C4`) and in the plan (Sections 1-6; Section 7 row C4; Section 8 C4; Section 10). It implements exactly the already-accepted plan text with no redesign or simplification: the 9-field `storageAuthorityV1` and 5-field `storageRevertAttemptV1` contracts, the exact authority hint contract and `LEGACY` write guard, the full Section 3 startup state machine (including `REVERTING`), the exact Section 2 switch ordering and no-re-adopt divergence rule, the Section 5 item 4a-5 connection-event contract, the Section 6a-6d revert/backup/compensation contract, and the mounted-`READY`/mounted-`LEGACY` runtime-signal semantics added by the final amendment (public `handleRuntimeSignal(signal)`; C4 owns every state decision, C6 only wires browser events to it; no browser globals read in `src/storage/`). Runtime behavior change: NONE; the storage foundation stays dormant. Evidence: C4 node/storage `82/82`, C4 Chromium `41/41`, storage full `82` Node + `66` Chromium, IndexedDB/Chromium full `66/66`, saved places `12/12`, calendar `13/13`, calendar UI `20/20`, app shell `52/52`, reminders + UI + native `80/80` real assertions, waste + UI `53/53`, build PASS, diff check PASS. C4 source scope: CLOSED.

**Dependency / dormancy rules (carried forward, still in force):**
- every `src/storage/` module receives browser capabilities by injection (`indexedDb`, `storage`, `locks`, `broadcast`, `persist`, `cryptoApi`, `clock`, `newId`, `mode`); the Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force;
- nothing outside `src/storage/` imports the storage foundation; the application bundle continues to exclude `src/storage/`;
- direct `replica.transact`/`runTransaction` calls remain allowed only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and `src/storage/storageAuthority.js`.

**Non-goals delivered in C4 (still true, now closed rather than open):** C5 `replicaRepositories.js` was not created; no C6 React/runtime wiring or hook/component change; the actual runtime authority in the running app was not switched; no schema, version or store change; no backend, authentication, sync, outbox or dependency work; no deployment; no legacy cleanup or deletion.

## Allowed at this gate

- a separate docs-only scope-open pass for C5 exactly as listed in the plan, if approved
- no source implementation until that C5 scope-open pass exists

## Runtime cutover phases (C1-C4 CHECKPOINTED; C5-C8 LOCKED)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 (ACCEPTED / CHECKPOINTED) | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` (close race and connection-event contract) |
| C2 (ACCEPTED / CHECKPOINTED) | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js`, new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle), `src/storage/legacyMigration.js` (comment only); behavior-preserving prerequisite for C3 |
| C3 (ACCEPTED / CHECKPOINTED) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C4 (ACCEPTED / CHECKPOINTED) | `src/storage/storageAuthority.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` |
| C5 (LOCKED; not yet scope-opened) | new `src/storage/replicaRepositories.js`, storage tests |
| C6 | runtime wiring files listed in the plan; desktop human smoke |
| C7 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C8 | production deploy gate |

## Forbidden at this gate

- any `src/**`, `scripts/**`, package or config change (C1-C4 source scopes are all CLOSED; C5 has no open scope to write into)
- opening or implementing C5 without its own separate docs-only scope-open pass (C6-C8 remain LOCKED regardless)
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

NEXT: open `RUNTIME_CUTOVER_C5_SCOPE_OPEN` through its own separate docs-only scope-open pass. The runtime cutover plan is ACCEPTED and C1-C4 are CHECKPOINTED; C5 implementation is LOCKED until that pass; C6-C8 remain LOCKED.
