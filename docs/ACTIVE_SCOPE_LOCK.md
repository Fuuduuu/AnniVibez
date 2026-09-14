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

**PHASE_A_INDEXEDDB_FOUNDATION**.

Current pass: **TASK_1_INDEXEDDB_SCHEMA_PRIMITIVES**.

## Allowed in this phase

- create only `src/storage/schema.js`, `src/storage/indexedDb.js`, and `scripts/storage/indexeddb-browser.test.mjs`
- define the `majandus_local_v1` schema, its nine approved object stores, and outbox `bySequence`
- implement native IndexedDB open, close, request, and transaction primitives
- add real Chromium/CDP validation for commit, rollback, versionchange, and blocked-open semantics

## Forbidden until architecture approval

- create `src/storage/localReplica.js` or `src/storage/legacyMigration.js`, or implement Task 2+
- wire IndexedDB into React/App, change localStorage repositories, perform legacy/startup migration, dual-write, or create production UI outbox mutations
- implement sync, authentication, D1, Cloudflare bindings, network/backend calls, dependencies, deployment, or runtime UI changes
- modify accepted calendar, bus, waste, or reminder behavior; unrelated redesign, broad refactor, or Trends work

## Protected current behavior

- Preserve concrete stop_id identity and the accepted shared bus read-model.
- Treat `depsWithMeta(...)` and `displayCodes` as transitional where they remain; do not expand them into new architecture by default.
- Preserve imported-event and recurrence protections.

## Implementation boundary

Task 1 creates a dormant storage foundation only. Current production behavior continues using the existing accepted runtime/localStorage path.

## Decision gate

Task 1 implementation is authorized. Task 2 remains locked until Task 1 passes validation, fresh review, exact commit/push, and a separate explicit scope opening.
