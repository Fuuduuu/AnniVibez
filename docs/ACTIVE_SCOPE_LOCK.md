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

**RUNTIME_CUTOVER_PLAN**: LOCKED in `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` (falsification review PASS).

Current gate: **RUNTIME_CUTOVER_PLAN_HUMAN_ACCEPTANCE**.

The locked plan is authoritative for cutover design. It resolves the six acceptance items: authority-switch ordering, the Android/installed-PWA human gate, blocked open/`versionchange`/multi-tab/schema upgrades, the `close()` open race, the transaction-body async invariant and the runtime payload-validation boundary. All accepted Phase A Task 1-6 contracts remain unchanged except the narrow C1 amendments named in that plan, which take effect only when C1 is opened.

## Accepted state carried forward

- legacy localStorage remains the runtime authority; the running application uses its existing accepted localStorage/runtime paths
- the Phase A migration remains DORMANT; nothing outside `src/storage/` imports the storage foundation and the application bundle excludes `src/storage/`

## Allowed at this gate

- human review and acceptance (or amendment) of the locked cutover plan
- docs-only governance updates recording that decision
- after acceptance: a separate docs-only scope-open commit for phase C1 exactly as listed in the plan

## Locked phases (none open)

| Phase | Files (exact list in plan Section 7) |
|---|---|
| C1 | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, storage tests |
| C2 | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, storage tests |
| C3 | new `src/storage/storageAuthority.js`, storage tests |
| C4 | new `src/storage/replicaRepositories.js`, `src/hooks/useSavedPlaces.js` (pure exports only), storage tests |
| C5 | runtime wiring files listed in the plan; desktop human smoke |
| C6 | preview deploy and Android/installed-PWA human gate, including the rollback drill |
| C7 | production deploy gate |

## Forbidden at this gate

- any `src/**`, test, package or config change
- opening any phase C1-C7 without its own scope-open commit
- runtime cutover: importing storage into App/React or any production component, switching reads from localStorage to IndexedDB, startup migration or any user data migration
- writes to legacy keys by any forward cutover path (only the plan's revert export may write them)
- D1/backend, Cloudflare bindings, network calls, authentication, sync, outbox mutations or outbox UI
- dependency updates (including remediation of the pre-existing `npm audit` report) or deployment
- deploying a pre-cutover build to an origin where any device may have switched
- modifying accepted calendar, household, waste, saved-place, bus or reminder behavior; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Decision gate

HUMAN DECISION REQUIRED: accept or amend the locked runtime cutover plan. Runtime implementation remains LOCKED until acceptance and a separate C1 scope-open commit.
