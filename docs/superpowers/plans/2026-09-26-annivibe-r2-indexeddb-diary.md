# R2 IndexedDB Diary Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected Web Lock/localStorage diary mutation authority with a device-local IndexedDB state record that does not silently lose acknowledged concurrent writes.

**Architecture:** A dedicated `src/diary/diaryStore.js` owns lazy legacy migration and all diary/PIN readwrite transactions in `majandus_diary_v1`. The existing hook and UI consume committed outcomes only; legacy localStorage becomes a one-time migration source, never a second authority.

**Tech Stack:** Browser IndexedDB, React hook/UI, Node test runner, real Chromium concurrency harness.

**Spec:** `docs/ACTIVE_SCOPE_LOCK.md` (R2 section), with the G1–G4 decision/evidence record in `docs/ACCEPTED_CHECKPOINTS.md`.

## Global Constraints

- R2/BSEC-01 is CURRENT; the redesign is APPROVED but implementation is NOT ACCEPTED. Begin with a permanent failing real-concurrency RED proof before GREEN.
- Diary remains DEVICE_LOCAL_ONLY: no backend sync, D1, outbox, change_log, `src/storage/*` import, or `src/storage/storageAuthority.js` change. R3/R4 remain LOCKED.
- Database `majandus_diary_v1`, version `1`, store `diary`, one authoritative record keyed `"state"`: `key`, `version`, `pin`, `entries`, `origin`, `legacyDigest`, `migratedAt`, `updatedAt`. PIN and entries mutate together in this authority.
- Migration from `sade_diary_pin` and `sade_diary_entries` is lazy, validated, atomic and FORWARD-ONLY. Existing state prevents re-import; invalid legacy fails closed. No permanent dual-write, no automatic rollback to a pre-migration build.
- Report mutation success only after transaction completion. On failure, preserve prior durable state and the R1 draft/editor/no-false-success contracts. An already-absent delete is an idempotent success without unnecessary state change.
- Reset commits `pin = null` and `entries = []` atomically. Only after commit, attempt legacy-key cleanup best-effort; warn truthfully if cleanup fails without misreporting the committed reset as failed.
- Preserve async UI callers, pending/double-submit guards and visible errors. Remove diary Web Locks from the correctness design; no second lock without new independent proof of a separate purpose.
- Future GREEN touch set is limited to `src/diary/diaryStore.js`, `src/hooks/useDiary.js`, `src/components/PaeviikTab.jsx`, `src/components/SeadedTab.jsx`, `scripts/diary/diary-concurrency.test.mjs`, `scripts/diary/diary-persistence.test.mjs`, and `scripts/diary/diary-migration.test.mjs` if justified.
- Exact internal function signatures, migration metadata semantics and transaction failure mapping are deferred to the RED/GREEN pass; do not treat this plan as permission to invent them silently.

## Review Focus

- A success response before `readwrite` completion must not be accepted; prove acknowledged IDs in a fresh context after immediate reload/close.
- Corrupt or denied legacy reads must not become an empty diary; pin this in migration tests.
- A losing concurrent first-migration attempt must read the winner's state instead of importing stale legacy again; pin simultaneous migration and crash/restart.
- Reset versus add/delete must never leave a PIN/entries split or falsely lose an acknowledged entry; pin both races and abort behavior.
- A failed post-commit legacy cleanup must leave the reset successful while visibly warning about the old copy; pin the user-facing result.

---

### Task 1: Permanent real-concurrency RED proof

**Files:** Modify `scripts/diary/diary-concurrency.test.mjs` only.

- [ ] Add a same-origin real-Chromium test with two tabs in separate renderer processes where available; each submits 60 unique entries simultaneously behind a `BroadcastChannel` barrier, not sleeps.
- [ ] Record each result in an acknowledgment ledger, with explicit failures separately. In fresh context C, read through the product path and assert every `ok:true` ID occurs exactly once.
- [ ] Run `node --test scripts/diary/diary-concurrency.test.mjs` against the current Web Lock/localStorage implementation and retain the failing RED evidence. Do not begin GREEN if it passes vacuously or the harness lacks real concurrency.

### Task 2: Dedicated authority and forward-only migration

**Files:** Create `src/diary/diaryStore.js`; create `scripts/diary/diary-migration.test.mjs` only if needed for permanent migration evidence.

- [ ] Test existing state precedence, valid legacy import, invalid legacy fail-closed behavior, crash before/after commit, simultaneous migration, and old-tab legacy writes after migration.
- [ ] Implement one authoritative state record in the dedicated IndexedDB, with validated lazy import only when absent and atomic migration completion. Do not write legacy keys or import them after state exists.
- [ ] Run `node --test scripts/diary/diary-migration.test.mjs` if that file is added and verify fresh-context durability. Document observed `origin`/digest/timestamp semantics in the tests without broadening the record shape.

### Task 3: Transactional diary/PIN mutations and R1 integration

**Files:** Modify `src/hooks/useDiary.js`, `src/components/PaeviikTab.jsx`, `src/components/SeadedTab.jsx`, and `scripts/diary/diary-persistence.test.mjs`; update the Task 1 test.

- [ ] Test add/delete/reset/PIN setup/change under transaction abort, quota/unavailable/denied storage, stale contexts, and immediate reload. Assert success only after commit; absent delete is idempotent; reset has no partial PIN/entries state.
- [ ] Adapt the R1 fault-injection harness to IndexedDB. Compare old and new assertions explicitly: draft/editor retention, no false success/navigation, prior bytes unchanged after failed write, no undurable React publication, truthful PIN/reset failure, and reload-persistent successful save. Do not weaken any R1 semantic assertion. Run `node --test scripts/diary/diary-persistence.test.mjs` with zero failures or skips.
- [ ] Wire the hook and UI to the committed authority, preserving async callers, pending guards, visible errors and draft retention. Remove `DIARY_MUTATION_LOCK`, diary `navigator.locks` coordination and localStorage as active mutation authority.
- [ ] After a successful reset, attempt legacy-key cleanup; failure reports the old-copy warning without changing the reset's success result.

### Task 4: Concurrency and acceptance evidence

**Files:** Modify only the R2-allowed test files as required by the permanent proofs.

- [ ] Prove 2-tab and 4-tab append soaks; append/delete, delete/delete, reset/append and reset/delete races; transaction abort; acknowledged save then immediate reload/close; simultaneous migration and migration crash/restart. For append-only soaks, verify every acknowledged ID exactly once through a fresh product read. For mixed operations, assert a final state consistent with committed transaction order: stale delete never resurrects an already-removed entry, unsafe serialization fails explicitly with authored content recoverable, and a later committed reset may legitimately clear an earlier acknowledged add.
- [ ] Run focused diary persistence, concurrency and migration tests plus the relevant existing shell/storage regression and build commands. Record exact commands/results; no count is pre-approved by this plan.
- [ ] Obtain an independent audit comparing the old and new R1 contracts, the final R2 concurrency evidence and the exact diff. Human smoke and an R2 implementation commit remain blocked until that review and applicable smoke gate pass.

## Handoff

This is a governance plan only. The next authorized implementation action is `R2_INDEXEDDB_CONCURRENCY_RED`; GREEN, R3/R4, Sync V1A governance opening, Cloudflare work, deployment and client/runtime integration remain separately gated.
