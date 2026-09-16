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

**PHASE_A_INDEXEDDB_FOUNDATION**: IMPLEMENTATION COMPLETE.

Current gate: **PHASE_A_FINAL_HUMAN_REVIEW**.

Tasks 1-6 are ACCEPTED / COMPLETE; the final implementation commit is `abdd002240e78ed093facdb3ef463d4ba6ede418` (Task 6). The Phase A range is `4e9a65af179c45ce95395aae21d577fe90ed13b2` (plan checkpoint) `..abdd002240e78ed093facdb3ef463d4ba6ede418`. All accepted Task 1-6 contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md` remain authoritative and unchanged.

## Accepted state carried forward

- legacy localStorage remains the runtime authority; the running application uses its existing accepted localStorage/runtime paths
- migration remains DORMANT; no live runtime migration has occurred and nothing outside `src/storage/` imports the storage foundation
- the application bundle excludes `src/storage/`
- legacy storage remains non-destructive; migration generates zero outbox mutations

## Allowed at this gate

- read-only human review of the Phase A diff and Chromium evidence
- docs-only governance updates that record the human decision (ACCEPT or AMEND)
- if the human decides AMEND: a separately scoped, explicitly approved amendment pass

## Forbidden at this gate

- any `src/**`, test, package or config change without a new explicit scope opening
- runtime cutover: importing storage into App/React or any production component, switching reads from localStorage to IndexedDB
- startup migration or any user data migration
- dual-write
- D1/backend, Cloudflare bindings or network calls
- authentication
- sync
- outbox mutations or outbox UI
- dependency updates (including remediation of the pre-existing `npm audit` report) or deployment
- modifying accepted calendar, household, waste, saved-place, bus or reminder behavior; unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Decision gate

HUMAN REVIEW DECISION REQUIRED: ACCEPT or AMEND the Phase A foundation. Runtime cutover remains LOCKED until explicit human acceptance, and even after acceptance requires its own plan and a separate explicit scope lock.
