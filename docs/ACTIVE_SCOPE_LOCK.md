# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Read and follow in this order:
1. `docs/SESSION_BOOT.md`
2. `docs/CURRENT_STATE.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Accepted baseline

- product: `Majandus`
- accepted runtime: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
- canonical production: `https://annivibe.pages.dev`
- human production/phone validation: PASS

## Current phase

**COMMON_BACKEND_ARCHITECTURE** (`architecture / planning`).

This phase authorizes planning for one shared Majandus backend foundation. It does not authorize implementation.

## Allowed in this phase

- inspect current frontend and local persistence
- map data ownership for users, households and household membership
- compare backend architecture options without selecting a technology
- design identity/authentication, shared data, API and synchronization boundaries
- design calendar, recurrence, waste, reminders and settings data responsibilities
- design offline/local-first interaction, conflict resolution, privacy, security, migration and deployment boundaries
- produce architecture and specification artifacts within a separately approved architecture pass

## Forbidden until architecture approval

- backend implementation, database creation or schema migration
- authentication integration, production secrets or backend deployment
- replacing local persistence or runtime frontend rewrites
- changes to accepted bus routing, calendar recurrence, reminders or waste behavior
- unrelated redesign, broad refactor or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Decision gate

The next implementation authority requires an accepted common-backend architecture decision. Until then, work remains architecture/planning only.
