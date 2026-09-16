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

**PHASE_A_INDEXEDDB_FOUNDATION**: ACCEPTED (`PHASE_A_FINAL_HUMAN_REVIEW = ACCEPTED`).

Current gate: **RUNTIME_CUTOVER_PLANNING** (planning only).

Tasks 1-6 are ACCEPTED / COMPLETE (Phase A range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`). Human acceptance is based on the Phase A review package recorded at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`. All accepted Task 1-6 contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` remain authoritative and unchanged.

## Accepted state carried forward

- legacy localStorage remains the runtime authority; the running application uses its existing accepted localStorage/runtime paths
- migration remains DORMANT; no live runtime migration has occurred and nothing outside `src/storage/` imports the storage foundation
- the application bundle excludes `src/storage/`
- legacy storage remains non-destructive; migration generates zero outbox mutations

## Allowed at this gate

- read-only investigation of the current runtime, the accepted Phase A foundation and target platforms
- drafting a runtime cutover plan/contract as a docs-only change, followed by an independent review before any acceptance
- docs-only governance updates recording that plan and its review

## Required cutover acceptance items

The runtime cutover plan must explicitly resolve each item below; a plan that leaves any item open cannot be accepted:

1. **Authority-switch ordering:** the exact localStorage -> IndexedDB authority switch sequence, including the last legacy write, migration, verification and the read switch, and the rule for legacy writes that occur after a completed migration (`source-changed-after-complete`).
2. **Android/PWA real-device validation:** real Android Chrome and installed-PWA validation, including storage persistence/eviction and quota-failure behavior, as a required human smoke gate.
3. **Multi-tab / blocked-open handling:** runtime behavior for `IndexedDbBlockedError`, `versionchange`, concurrent tabs and future schema upgrades.
4. **`createLocalReplica.close()` open race:** handling of `close()` called while an open is in flight, so no connection handle leaks.
5. **Transaction-body async invariant:** how runtime callers are held to awaiting only IndexedDB requests inside transaction bodies, so transactions never auto-commit mid-body.
6. **Runtime payload validation boundary:** where domain payloads are validated before runtime writes, given the replica validators check only record envelopes.

## Forbidden at this gate

- runtime implementation of any kind: any `src/**`, test, package or config change
- runtime cutover: importing storage into App/React or any production component, switching reads from localStorage to IndexedDB
- startup migration or any user data migration
- dual-write
- D1/backend, Cloudflare bindings or network calls
- authentication
- sync
- outbox mutations or outbox UI
- dependency updates (including remediation of the pre-existing `npm audit` report) or deployment
- changing accepted Phase A Task 1-6 contracts without a separately approved amendment
- modifying accepted calendar, household, waste, saved-place, bus or reminder behavior; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Decision gate

Next safe action: design and independently review the runtime cutover contract. Runtime implementation remains LOCKED until that contract resolves all six acceptance items, passes independent review, is explicitly accepted by the human and a separate implementation scope lock is opened.
