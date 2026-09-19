# Majandus Runtime Cutover Plan (localStorage -> IndexedDB)

Status: HUMAN ACCEPTED (plan checkpoint `8077c0e2626f1be1ef149a5690f43aa1e46cb248`). AMENDED four times after independent fresh reviews returned AMEND (amendment record in Section 12); the final fresh independent review returned PASS. It authorizes no runtime code by itself. Each phase opens only through its own separate scope-open pass. C1 ACCEPTED / CHECKPOINTED at `704cc7a815d1df1efdbfba979814aceb94886c09`; C2 ACCEPTED / CHECKPOINTED at `cdacf4ec2f9b9f0767d485708c5a5e9c4c0f379e`; C3 ACCEPTED / CHECKPOINTED at `5612953e7c9e07eef411cecc3c6bb5dd5685930d`; C4 ACCEPTED / CHECKPOINTED at final implementation `d2d1dad0e688706609b80172e8b10a50c54d138d` (history `bf4c598f5b494bb289d748d48632c77d4be96be9` → `fa4b81055a4d4449bac89ac40fb9dc44f851abef` → `858d777e0b15ef8a61197d9c49262f1818030a20` → final `d2d1dad0e688706609b80172e8b10a50c54d138d`); C5 ACCEPTED / CHECKPOINTED at final implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b` (history: scope open `590a2a7c56f63a5895a4fd56da7668ad879b95c6` → calendar-read scope amendment `02b5ff1824258bf28d16121517c072d90d0b892a` → initial implementation `5c3f6fee68a5af98390f28706dc759d4737f5a56` → review-amend governance `fbbff8b9dc4fa237ab144a1ac066d70244ef7a4f` → final corrective implementation `f8f5fecab2442db1347ac4741a79dd66650dd68b`; initial independent review AMEND on five findings, final independent review PASS / ACCEPT of the corrective pass); C6 ACCEPTED / CHECKPOINTED at final implementation `7146d0ac85c28da0cb8846b944099bf1307b9ece` (history: scope open `07a74aafc174aea3aab43aa99d60e8721f396553` → reminder test-scope amendment `8e15c47e3d29b3cbcde88c7d42e55ceba720715c` → authority-identity amendment `6123c12567efea7040d5a5995dd8ba5f738c73a1` → initial implementation `6a5739fb4c7809d9e50ce4d6e6bdf6d866474360` → final corrective implementation `7146d0ac85c28da0cb8846b944099bf1307b9ece`; initial review AMEND, final independent source review PASS / ACCEPT, desktop Chrome human smoke PASS). C6 source scope is CLOSED and runtime behavior change YES. Cloudflare Git auto-deploys nevertheless placed C6-containing code in canonical production before C7/C8 governance; the current frozen observed deployment is `0cca08f2-3a87-4176-99e2-7bc107bf8ce5` from `549203d3a0eced020fc954cab62721ee85a06936`, which is not a C8 accepted deployment. C7 SCOPE OPEN at baseline `9dac8c021be1b99bf7ec1227615cb6f3bd874674` for its external fixed-preview/Android-PWA human gate only: no repository source or deployment-config change. Pages containment is verified (`production_branch: main`, automatic production deployments `false`, preview setting `all`, Git integration `github`); a `main` push MUST NOT auto-deploy production and any unexpected production deployment before C8 is a STOP. C8 LOCKED.

**Goal:** Make the accepted Phase A IndexedDB replica the runtime authority for the three shared household domains without data loss, split authority or an unrecoverable rollback.

**Inherits unchanged:** `docs/COMMON_BACKEND_ARCHITECTURE_V1.md` and the accepted Phase A Task 1-6 contracts in `docs/superpowers/plans/2026-09-14-majandus-phase-a-indexeddb-foundation.md`. The only Phase A amendments are the ones named in C1 and C2 below.

**Out of scope:** D1, backend, network calls, authentication, sync, outbox mutations and outbox UI, legacy cleanup or deletion, schema version bumps, new object stores, dependency changes.

## 1. Cutover model

- **Scope of the switch.** Calendar events with waste imports (`majamajandus_household_events_v1`), household profile (`majamajandus_household_profile_v1`) and saved places (`sade_saved_places`) switch together, per device, in one atomic authority switch. A per-domain switch is forbidden: the Task 4 marker and digest cover all three sources, so a partial switch would leave the marker permanently stale. Rollout by domain applies to implementation order (Section 7), not to authority.
- **Device-local data stays in localStorage:** diary, reminder preferences and delivery, saved ideas and tips, `sade_profile`.
- **Authority record:** IndexedDB `meta/storageAuthorityV1` is the single source of truth (exact contract in Section 1a). IndexedDB is authoritative exactly while a *valid* record exists with `status` `active` or `reverting`.
- **Authority knowledge requires a successful open.** Authority is *proven absent* only when IndexedDB opens and the `meta` read succeeds and shows no record (or a valid record `reverted`). If the database cannot be opened or read, or the record is malformed, authority is *unknown*. Unknown authority never leads to `LEGACY`, whatever the hint says (Section 3).
- **Authority hint:** localStorage key `majandus_storage_authority_v1` (exact contract in Section 1b). The hint never grants authority, and its absence never proves legacy authority. It exists to detect loss of the IndexedDB database (`STORAGE_LOST`) and to stop legacy writes in tabs running the new build. While IndexedDB is authoritative, a verified hint is a precondition for `READY` (Section 2).
- **Legacy rollback material:** after the switch, the three legacy keys are frozen. No forward build writes them. They are retained until a separate accepted cleanup plan; no phase in this plan deletes them. The only deletions of a shared legacy key allowed anywhere are the failed-revert compensation in Section 6c.
- **Deletion:** runtime records are `syncStatus: 'local'`, `revision: 0` and never uploaded, so they are hard-deleted. Tombstones belong to the future sync phase.
- **Calendar event order:** IndexedDB calendar records carry no order. The canonical events order is ascending `id` by UTF-16 code unit, used both when rebuilding the envelope for runtime repositories and for revert export. All parity and verification comparisons treat events as id-keyed sets. Verified against the current source:
  - the `KalenderTab` legend renders the static `CATEGORIES` map, so it does not depend on event order;
  - `expandOccurrences`, `upcomingOccurrences` and `homeOccurrences` already sort by date, time and `occurrenceId`, so calendar, agenda, home and reminder views do not depend on stored event order;
  - `WasteSettings` builds its imported subtype label list with `new Set` over `calendar.events` in stored order, so that label order can differ after the switch (cosmetic).
  C6 keeps visual and smoke parity checks for these views. The plan claims no legend order change.

## 1a. Authority record contract

**Exact shape.** The key set is exactly these 9 fields; extra or missing keys are malformed.

```js
{
  key: 'storageAuthorityV1',
  status: 'active' | 'reverting' | 'reverted',
  switchId: nonEmptyString,
  switchedAt: strictValidIso,        // same strict calendar-valid ISO rule as Task 2 record timestamps
  legacyDigestAtSwitch: lowerHex64,  // /^[0-9a-f]{64}$/
  markerPreparationId: nonEmptyString,
  commitCount: nonNegativeSafeInteger,
  legacyUntrusted: boolean,
  persistGranted: null | boolean
}
```

**Fresh switch** (Section 2 step 2.7) writes every field explicitly:
- `status: 'active'`, `switchId` from the injected `newId()`;
- `switchedAt` from the injected `now()`, validated before the transaction (an invalid value throws and the switch does not happen, leaving authority proven absent, so `LEGACY`);
- `legacyDigestAtSwitch` = complete marker `sourceDigest`, `markerPreparationId` = complete marker `preparationId`;
- `commitCount: 0`, `legacyUntrusted: false`, `persistGranted: null`.
The record is validated before `put`.

**Immutable after creation:** `key`, `switchId`, `switchedAt`, `legacyDigestAtSwitch`, `markerPreparationId`.

**Allowed mutations.** Each happens in a readwrite transaction that re-reads the record, requires it valid, requires `switchId` equal to the expected value, validates the new record, and changes nothing else:

| Mutation | Guard | Change |
|---|---|---|
| runtime write | `status === 'active'` | `commitCount + 1` (a result above `Number.MAX_SAFE_INTEGER` aborts the write) |
| persist result | `status === 'active'`, `persistGranted === null` | `persistGranted` becomes the resolved boolean |
| begin revert | `status === 'active'`, no `storageRevertAttemptV1` value | `status: 'reverting'` and, in the same transaction, `put` of a fresh attempt record (Section 1c) |
| revert aborted before export | `status === 'reverting'`, attempt record valid with `phase === 'started'` and `commitCountAtStart === commitCount` | `status: 'active'`, `legacyUntrusted` unchanged; delete the attempt record |
| compensation verified | `status === 'reverting'`, attempt record valid with `phase === 'backups-verified'` and `commitCountAtStart === commitCount` | `status: 'active'`, `legacyUntrusted` unchanged; delete the attempt record |
| compensation failed | `status === 'reverting'`, attempt record valid with `phase === 'backups-verified'` and `commitCountAtStart === commitCount` | `status: 'active'`, `legacyUntrusted: true`; delete the attempt record |
| forward build finds `reverting` | `status === 'reverting'` | `status: 'active'`; `legacyUntrusted` unchanged when the attempt record is valid with `phase === 'started'`, otherwise `legacyUntrusted: true` (phase `backups-verified`, or the attempt value absent or malformed); delete any value under the attempt key |
| revert complete | `status === 'reverting'`, attempt record valid with `phase === 'backups-verified'` and `commitCountAtStart === commitCount` | `status: 'reverted'`; delete the attempt record |

- `legacyUntrusted` only ever changes from `false` to `true`. `persistGranted` only ever changes from `null` to a boolean.
- **Deletion** of the authority record happens only in the reverted reset (`reverted`, no attempt record). No path deletes an `active` or `reverting` authority record, and no path deletes authority or migrated records because of legacy divergence (Section 2). `commitCount` is diagnostic only and never authorizes a deletion or reset.

**`persist()` lifecycle.**
- Attempted at most once per boot, only while the valid record is `active` with `persistGranted === null`.
- If it resolves to a boolean, a guarded update stores it, and it is never retried afterwards (`false` is a final answer).
- If it rejects, is unavailable (no `navigator.storage.persist`) or resolves to a non-boolean, the record is left unchanged with `persistGranted: null`, and the next boot retries.
- A failure of the guarded update itself is ignored for this boot.
- The cutover never waits for, depends on or rolls back because of `persist()`.

**Malformed record.** Any read (boot, runtime write guard, revert, reset) that finds a `storageAuthorityV1` value failing this contract gives `STORAGE_UNAVAILABLE` with reason `authority-malformed`:
- no legacy writes, no repair, no reset, no revert;
- rollout STOP condition;
- in a mounted tab, the write transaction aborts with no writes and the tab moves to `STORAGE_UNAVAILABLE`.

## 1b. Authority hint contract

**Exact shape.** The value stored under `majandus_storage_authority_v1` is `JSON.stringify` of an object whose key set is exactly:

```js
{ version: 1, switchId: nonEmptyString, legacyDigestAtSwitch: lowerHex64, switchedAt: strictValidIso }
```

**Classification** of a hint read:
- `absent`: `getItem` returns `null`;
- `valid`: parses and matches the exact shape;
- `malformed`: any other non-null value, including non-JSON, wrong types, extra or missing keys and `version !== 1`;
- `unreadable`: `getItem` throws.

A valid hint *matches* an authority record when `switchId`, `legacyDigestAtSwitch` and `switchedAt` are all equal.

**Hint write (gate):** `setItem(key, JSON.stringify(hintFor(record)))`, then `getItem` read-back must equal the written string exactly. A throw or mismatch is a failure.

**Hint removal:** `removeItem(key)`, then `getItem(key) === null`. A throw or non-null value is a failure.

**Behavior matrix** (forward build; authority already read successfully and valid, unless stated). The revert build does not use the `absent` rows of this matrix; it uses the revert-build authority-absent contract in Section 6d:

| Authority | Hint | Result |
|---|---|---|
| `active` | valid and matching | continue |
| `active` | absent, malformed, unreadable or valid but not matching | rewrite through the hint gate; failure: `AUTHORITY_HINT_PENDING` |
| `reverting` | any | forward build: Section 1a forward row (`active`, attempt record deleted, `legacyUntrusted` per phase), then as `active`; revert build: resume revert per the durable attempt phase (Sections 1c, 6b) |
| `reverted` | absent | pre-cutover flow |
| `reverted` | valid, malformed or not matching | verified hint removal, then pre-cutover flow; removal failure: `STORAGE_UNAVAILABLE` |
| `reverted` | unreadable | `STORAGE_UNAVAILABLE` |
| absent | absent | pre-cutover flow |
| absent | valid | `STORAGE_LOST` (recovery screen with `switchedAt`) |
| absent | malformed | `STORAGE_LOST` variant without a date: blocking recovery screen, never `LEGACY`; restore only on user confirmation; rollout STOP condition |
| absent | unreadable | `STORAGE_UNAVAILABLE` (retry) |
| malformed or unknown | any | `STORAGE_UNAVAILABLE` (never inspected further) |

**LEGACY write guard:** before every legacy write, a new-build `LEGACY` tab reads the hint synchronously. Any non-null value (valid or malformed), or a throwing `getItem`, refuses the write and enters `RELOAD_REQUIRED`.

## 1c. Revert attempt record contract

Revert progress is durable in IndexedDB. It is never inferred from localStorage alone (pointer or backup keys).

**Exact shape.** Stored in `meta` under key `storageRevertAttemptV1`. The key set is exactly these 5 fields; extra or missing keys are malformed.

```js
{
  key: 'storageRevertAttemptV1',
  switchId: nonEmptyString,                 // equals the authority record switchId
  attemptId: nonEmptyString,                // from the injected newId(); names the backup set and pointer
  commitCountAtStart: nonNegativeSafeInteger, // equals the authority commitCount at begin revert
  phase: 'started' | 'backups-verified'
}
```

**Consistency.** An attempt record is *valid* when it matches the shape, the authority record is valid with `status === 'reverting'`, `switchId` is equal, and `commitCountAtStart === commitCount`. Runtime writes require `active`, so `commitCount` cannot change while `reverting`.

**Phase meaning.**
- `started`: no shared legacy key has been written by this attempt. Export is forbidden in this phase.
- `backups-verified`: the backup set for `attemptId` and the pointer were written and read back verified, and export may have begun. From this phase on, the backup set of `attemptId` is the only set of originals for this attempt and is never rewritten or replaced.

**Transitions.** Each is one readwrite transaction on `meta` that re-reads and validates both records, requires the expected `switchId` and `attemptId`, and validates the new values before writing:

| Transition | Guard | Change |
|---|---|---|
| begin revert | authority valid `active`; no value under `storageRevertAttemptV1` | authority `status: 'reverting'`; `put` `{ key, switchId, attemptId, commitCountAtStart: commitCount, phase: 'started' }` where `attemptId` is a collision-checked candidate (Section 6b) |
| backups verified | attempt valid, `phase === 'started'`, same `attemptId` | `phase: 'backups-verified'` (no other field changes) |
| abort before export, compensation verified, compensation failed, forward build finds `reverting`, revert complete | as in Section 1a | authority change per Section 1a, and delete the attempt record in the same transaction |

- `phase` only ever moves from `started` to `backups-verified`. `key`, `switchId`, `attemptId` and `commitCountAtStart` are immutable.
- The first shared legacy `setItem` of an export happens only after the `backups verified` transaction reported `oncomplete` in the current session. A failed or unconfirmed phase transaction means no export in this session: `REVERT_FAILED` with the status left `reverting`, and the next boot resumes from the durable phase.

**Invalid attempt states** (checked at every authority read, in both builds):
- **Orphan:** any value under `storageRevertAttemptV1` while authority is absent, `active` or `reverted`, or with a different `switchId`: `STORAGE_UNAVAILABLE` with reason `revert-attempt-orphan`. No legacy writes, no repair, no reset, no revert; STOP condition.
- **Missing or malformed under `reverting`:**
  - revert build: `REVERT_FAILED` with reason `revert-attempt-invalid`. No legacy or backup writes, no IndexedDB mutation, no new attempt; STOP condition;
  - forward build: the Section 1a forward row (`active`, `legacyUntrusted: true`, delete any attempt value).

## 2. Authority switch ordering (acceptance item 1)

All steps run in the boot controller before any domain hook mounts, inside `locks.request('majandus:storage-authority')` when Web Locks exist. The lock is supplemental; correctness comes from the IndexedDB transaction guards.

1. **Open and read authority.**
   - Open the database and read `meta/storageAuthorityV1`.
   - If the open rejects with `IndexedDbBlockedError`, the state is `BLOCKED`.
   - If the IndexedDB API is missing, access throws, the open fails otherwise, the `meta` read fails, or the record is malformed (Section 1a), the state is `STORAGE_UNAVAILABLE`.
   - Either way, stop here: authority is unknown, and this applies whatever the hint says.
   - Otherwise read and classify the hint, then apply the Section 1b matrix.
2. **Authority proven absent, or a valid record `reverted`: pre-cutover device.**
   1. If the record is `reverted`, run the **reverted reset**: one readwrite transaction guarded by a valid record with `status === 'reverted'` and empty `outbox`, `auth`, `syncState`, `conflicts`. It deletes every record in `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState`, both extras keys, the marker and the authority record. Hint handling per Section 1b.
   2. If no record exists and the hint is valid or malformed, the state is `STORAGE_LOST`; continue only after user confirmation (Section 3).
   3. Run `runLegacyMigration` (Task 4, unchanged, `locks` injected).
   4. On `source-changed-after-complete` with no authority record, run the **stale reset**: one readwrite transaction guarded by authority absent, marker `complete`, empty `outbox`/`auth`/`syncState`/`conflicts`. It deletes only marker-owned records, the extras named by the marker, and the marker. Never `clear()`. Then rerun migration once.
   5. Proceed only on `completed`, `already-complete`, `prepared-recovered` or `reprepared`. Every other status is `LEGACY` for this session, which is allowed because authority was proven absent in step 1.
   6. Read the three legacy keys again and compute the digest (outside any transaction).
   7. **Switch transaction** on `meta`: require the marker record to have `status === 'complete'`, a non-empty string `preparationId` and `sourceDigest === ` the step-6 digest, and require no authority record. Write the fresh authority record exactly as in Section 1a. **localStorage stops being authoritative when this transaction commits.** A failed or aborted switch transaction leaves authority proven absent, so the state is `LEGACY`.
   8. **Hint gate:** write the hint for the new record. On failure the state is `AUTHORITY_HINT_PENDING` (Section 3): IndexedDB stays authoritative, nothing mounts, and it retries until the write succeeds. Once written, broadcast `authority-changed`.
   9. **Post-switch confirmation:** read the legacy keys again and recompute the digest. If it differs from `legacyDigestAtSwitch`, apply the divergence rule (IndexedDB stays authoritative, `LEGACY_DIVERGED`) before mounting hooks. There is no second switch attempt and no reset.
   10. Run the `persist()` lifecycle (Section 1a). Load initial domain snapshots, then mount `READY` (the connection-event subscription has been active since the replica was created; Section 5 item 4a).
3. **Valid authority `active`:**
   - Apply the hint matrix.
   - Run the divergence check (compare the current legacy digest with `legacyDigestAtSwitch`).
   - Run the `persist()` lifecycle.
   - Load snapshots, then mount `READY`.
4. **Valid authority `reverting`:** Section 1b matrix, then Section 6.

**Legacy writes after migration or switch.**

- **Before the switch commits,** legacy is authoritative. Any change makes the step-7 guard fail or migration return `source-changed-after-complete` (stale reset), so the switch always adopts the latest validated legacy state.
- **After the switch, divergence** means the current legacy digest `!== legacyDigestAtSwitch`. The digest cannot tell a user edit from data loss, because Phase A treats an absent legacy key as valid empty data. Its sources include:
  - a tab running a pre-cutover build writing legacy;
  - a new-build `LEGACY` tab whose write guard had not yet seen the hint (cross-tab localStorage propagation delay, or the crash window in Section 11);
  - loss of one, two or all three shared legacy keys in localStorage while IndexedDB survives (clearing, eviction or tooling acting on localStorage only).
- **Resolution (single rule, whatever `commitCount` or `legacyUntrusted` hold):**
  - IndexedDB stays authoritative. There is no automatic re-adopt, reset, re-migration or second switch after the authority record exists.
  - No authority, marker, extras or migrated record is deleted or changed because of divergence. `commitCount` is diagnostic only.
  - The current legacy bytes (including absent keys) are preserved: no `setItem` or `removeItem` on a shared key, and no hint removal.
  - The state is `READY` with the non-blocking `LEGACY_DIVERGED` notice. Legacy values are never adopted or merged automatically.
  - Every occurrence is a rollout STOP condition and needs an explicit recovery decision, which requires a separate accepted design.
- **Legacy read failure during the check:** a throwing `getItem` on a shared key, or a failing digest, is treated as divergence (`LEGACY_DIVERGED`, same rule). It never deletes or writes anything.
- **Detection:** at every boot, on `storage` events for the three legacy keys or `key === null`, and on `focus`/`visibilitychange`. A mounted tab shows the notice and stays `READY`.
- **Hint watch in `READY`:** on a `storage` event for the hint key or `key === null` (clear), and on `focus`/`visibilitychange`, the tab re-classifies the hint. Anything other than valid and matching is rewritten through the hint gate. A failure moves the tab to `AUTHORITY_HINT_PENDING` with writes disabled.
- **New-build tabs on legacy authority:** the Section 1b `LEGACY` write guard applies. They also enter `RELOAD_REQUIRED` on a hint `storage` event or an `authority-changed` broadcast.

## 3. Startup state machine

| State | Entered when | App behavior |
|---|---|---|
| `BOOTING` | app start | minimal splash; no domain hooks mounted |
| `LEGACY` | only after IndexedDB opened and the `meta` read succeeded with authority proven absent (or the reverted reset completed with the hint handled per Section 1b), and then: migration status not switchable (including `invalid-source`/`unreadable-source`), switch transaction failed, or a revert completed | existing accepted localStorage repositories, plus the hint write-guard; retry at next boot |
| `READY` | valid authority `active`, hint valid and matching, snapshots loaded and valid, connection subscription active | IndexedDB repositories |
| `READY` + `LEGACY_DIVERGED` notice | any post-switch legacy divergence, including localStorage-only key loss and an unreadable legacy key (Section 2) | fully usable on IndexedDB; non-blocking notice; legacy bytes and IndexedDB records unchanged by the notice; STOP condition awaiting an explicit recovery decision |
| `DOMAIN_INVALID` (per domain) | an IndexedDB record of that domain fails runtime validation on load | that domain `writable: false` with an error message (same pattern as legacy `writable: false`); other domains usable; no auto-repair |
| `AUTHORITY_HINT_PENDING` | valid authority `active` (just switched, found at boot, or while `READY`) and the hint gate fails | blocking screen for shared domains: "Seadme salvestusruum ei võtnud muudatust vastu. Proovi uuesti."; shared domains not mounted or writes disabled; automatic retry on focus plus a retry button; IndexedDB stays authoritative; never legacy |
| `BLOCKED` | authority unknown: open rejected with `IndexedDbBlockedError` (any hint) | blocking screen for shared domains: "Sulge Majanduse teised aknad ja proovi uuesti."; retry button and automatic retry on focus; Buss and device-local tabs stay usable |
| `STORAGE_UNAVAILABLE` | authority unknown: IndexedDB API missing, access or open error, `meta` read failure, malformed authority record (reason `authority-malformed`), unreadable hint where the matrix requires it, or a failed hint removal | blocking screen for shared domains with retry; never falls back to legacy; `authority-malformed` shows no retry-to-repair and is a STOP condition |
| `STORAGE_LOST` | open and `meta` read succeed, no authority record, hint valid (dated variant) or malformed (undated variant) | recovery screen: "Kohalik andmebaas puudub. Taasta andmed seisuga <switchedAt> varukoopiast?" (undated: "Taasta andmed seadme varukoopiast?"). On confirm, run steps 2.3-2.10 with a new `switchId`; the hint gate overwrites the hint. Leftover non-owned records produce `replica-not-empty`: stay on this screen and STOP condition. The malformed variant is itself a STOP condition |
| `RELOAD_REQUIRED` | replica connection event `versionchange` or `close` (Section 5 item 4a), `VersionError` (database newer than build), authority record changed under a mounted tab, or hint appears in a `LEGACY` tab | writes disabled; banner "Majandus uuenes teises aknas. Laadi leht uuesti." with reload button |
| `REVERTING` | revert build only (Section 6) | splash until the revert completes, then `LEGACY` |
| `REVERT_STORAGE_LOST` | revert build only: open and `meta` read succeed, no authority record, no attempt value, hint classified `valid` (dated variant) or `malformed` (undated variant) (Section 6d) | blocking screen for shared domains; Buss and device-local tabs stay usable. Dated: "Kohalik andmebaas puudub. Kas kasutada vana salvestust seisuga <switchedAt>? Hilisemad muudatused võivad puududa." Undated: "Kohalik andmebaas puudub. Kas kasutada seadme vana salvestust? Hilisemad muudatused võivad puududa." One confirm button ("Kasuta vana salvestust"); no automatic transition, no timer, no default. Before confirmation: zero writes to localStorage and IndexedDB, no legacy repository mounted. Confirmation is per boot and never persisted. STOP condition (both variants) |
| `REVERT_FAILED` | revert build only: any revert failure (Section 6) | blocking screen for shared domains: "Taastamine vanale salvestusele ebaõnnestus. Andmed on alles. Proovi uuesti."; retry re-enters `BOOTING`; IndexedDB stays authoritative and unmounted; STOP condition. The compensation-failure variant additionally has `legacyUntrusted: true` and retained backups. The `revert-attempt-id-collision` and `revert-backup-key-unreadable` variants (Section 6b) write no backup, pointer or shared key, and leave the status `active` (collision found before begin revert) or return it to `active` through "revert aborted before export". The `revert-backups-lost` and `revert-attempt-invalid` variants leave the status `reverting` with the attempt record untouched, write nothing, and never create a new backup set |

- `REVERT_STORAGE_LOST` leaves only through user confirmation (Section 6d) or a reload that re-enters `BOOTING`.
- Transitions out of `BLOCKED`, `STORAGE_UNAVAILABLE`, `AUTHORITY_HINT_PENDING`, `REVERT_FAILED` and `RELOAD_REQUIRED` happen only through a reload or retry that re-enters `BOOTING` (or, for `AUTHORITY_HINT_PENDING`, a successful hint gate). No state ever writes legacy keys after the switch, except the revert export and compensation of Section 6.
- **Availability trade-off (accepted):** a device whose IndexedDB cannot be opened or read is shown `BLOCKED` or `STORAGE_UNAVAILABLE` for shared domains, even if it never switched. Legacy authority cannot be proven there, so split authority is prevented at the cost of availability. Observing this state in smoke or the field is a STOP condition.

## 4. Multi-tab, blocked open, versionchange, schema upgrades (acceptance item 3)

- Every runtime connection follows the C1 connection-event contract (Section 5 item 4a). A `versionchange` or browser-initiated `close` closes and drops the handle, reaches the controller, and moves every mounted runtime to `RELOAD_REQUIRED`.
- Blocked open leads to `BLOCKED` in every case (authority unknown), never to `LEGACY`.
- A tab whose build is older than the database version gets `VersionError`, leading to `RELOAD_REQUIRED`. It never deletes or downgrades.
- Multi-tab freshness uses `BroadcastChannel('majandus:replica')`. `{ type: 'committed', domain }` is sent after the transaction `oncomplete`; receivers re-read that domain from IndexedDB. Without `BroadcastChannel`, tabs re-read on `focus`/`visibilitychange`.
- Mutations never write from a React snapshot. Each mutation re-reads its domain inside its own readwrite transaction (Section 5), so concurrent tabs serialize through IndexedDB.
- Every runtime write transaction includes `meta`. It applies the Section 1a runtime-write mutation (valid record, `status === 'active'`, the `switchId` the tab booted with, `commitCount + 1`). A mismatched status or `switchId` aborts with no writes and leads to `RELOAD_REQUIRED`; a malformed record leads to `STORAGE_UNAVAILABLE`.
- **Future schema upgrades:** a `DB_VERSION` bump requires its own accepted plan. `upgradeSchema` branches are additive (`if (oldVersion < N)`) and never delete stores or records. Builds never lower `DB_VERSION`. Revert builds keep the highest shipped version.

## 5. Replica close race, connection events, transaction rule, payload boundary (acceptance items 3-6)

**Item 4: `createLocalReplica.close()` during an in-flight open (C1 amendment to Task 2).**
- The replica keeps a generation counter. `close()` increments it, drops `activeDb`, awaits any in-flight open (ignoring its error) and closes the resulting handle.
- An open that resolves for a stale generation closes its handle and rejects with `DOMException` name `ReplicaClosedError`. Callers of `transact` see a rejection; Task 4 maps it to `write-failed`.
- `open()` after an explicit `close()` starts a new generation (reopen stays allowed). `close()` resolves only after no handle of an older generation remains open.

**Item 4a: connection-event path (C1 amendment to Tasks 1 and 2).**
1. **`indexedDb.js`:** the signature becomes `openMajandusDb(indexedDb = globalThis.indexedDB, { onVersionChange, onClose } = {})`, and the existing default argument and blocked/late-success behavior are unchanged. On success it installs:
   - `db.onversionchange = event => { db.close(); onVersionChange?.({ oldVersion: event.oldVersion, newVersion: event.newVersion }); }` — the handle is closed first, then the callback runs;
   - `db.onclose = () => onClose?.()` for browser-initiated closes.
   With no options, behavior equals the accepted Task 1 contract (close on `versionchange`).
2. **`localReplica.js`:** `createLocalReplica({ indexedDb, clock })` gains `replica.subscribe(listener)`, which returns an idempotent `unsubscribe` function. Listeners receive exactly `{ type: 'versionchange', oldVersion, newVersion }` or `{ type: 'close' }`.
3. The replica passes generation-bound handlers to `openMajandusDb`. When the current generation's handle receives `versionchange` or `close`, the replica:
   1. drops `activeDb` (the handle is already closed by `indexedDb.js`; `close` events need no further close);
   2. enters the terminal `lost` state;
   3. calls every current listener synchronously in subscription order. A throwing listener does not stop later listeners, and the first thrown error is rethrown from a `queueMicrotask` callback after all listeners ran.
   Events from handles of a stale generation (already closed by `close()`) are ignored.
4. **In the `lost` state,** `open()` and `transact()` reject with `DOMException` name `ReplicaConnectionLostError`, and no new `indexedDb.open` call is made. An explicit `close()` on a lost replica resolves. Recovery is only a new replica created after a reload. Transactions already running on the handle finish or fail normally (`db.close()` waits for them).
5. **Controller (C4):** the boot controller subscribes to its replica immediately after creating it, before Section 2 step 1 opens the database, and keeps the subscription for the page lifetime. The listener sets runtime state `RELOAD_REQUIRED` and notifies runtime-state subscribers. A `ReplicaConnectionLostError` from any boot step (migration, reset, switch, hint gate, snapshot load, revert) also resolves to `RELOAD_REQUIRED`, never `LEGACY`. Domain repositories then reject new mutations with `ReplicaConnectionLostError` without touching IndexedDB.
6. **Runtime wiring (C6):** hooks read runtime state. `RELOAD_REQUIRED` renders the reload banner and every shared-domain write control is disabled (`writable: false`).

**Item 5: transaction-body async invariant.**
- Runtime domain code never calls `replica.transact` or `runTransaction` directly. It uses one helper, `runReplicaMutation({ replica, authority, domain, stores, read, plan })`:
  1. **Read phase:** `read(stores)` may await only `requestResult` promises of requests issued on this transaction's stores.
  2. **Plan phase:** `plan(snapshot)` is synchronous and pure. If it returns a thenable, the helper throws `TypeError` before any write, and the transaction aborts.
  3. **Validate phase:** every planned record passes the item-6 validators synchronously.
  4. **Write phase:** all `put`/`delete` requests, plus the authority `commitCount` increment, are issued synchronously in one block with no awaits in between.
- Inside a body: no timers, `fetch`, `crypto.subtle`, locks, `BroadcastChannel`, other transactions or caller-supplied async callbacks. Digests and all other async work happen outside the transaction.
- **Enforcement:**
  - A source guard allows `transact`/`runTransaction` calls only in `src/storage/legacyMigration.js`, `src/storage/localReplica.js`, `src/storage/runtimeWrites.js` and `src/storage/storageAuthority.js`.
  - A Chromium test shows a thenable-returning plan writes nothing.
  - A Chromium test shows a timer await inside a raw body raises `TransactionInactiveError` before any write request is issued under the read-then-write discipline.

**Item 6: payload validation boundary.**
- Domain semantics are never re-implemented. The IndexedDB repositories run the existing accepted domain code synchronously inside `plan`, against an in-memory single-key `getItem`/`setItem` adapter:
  - **Calendar:** `createEventRepository(memoryStorage, newId)` over the raw envelope rebuilt from `calendarEvents` (canonical id order), `wasteState` and `calendarLegacyEnvelopeExtras`. Its `create`/`update`/`remove`/`importWaste` output becomes record puts and deletes.
    - Envelope fields other than `events` and `wasteImports` must be unchanged, or the plan throws.
    - With no calendar extras record, the rebuilt envelope is `{ version: 1, events, wasteImports? }` and runtime writes create no extras record.
    - A `wasteState` record exists exactly when the repository output defines `wasteImports`.
  - **Household:** `createHouseholdRepository(memoryStorage).save`, the same way.
  - **Places:** the neutral pure module `src/places/savedPlaces.js` extracted in C2 (`SAVED_PLACE_DEFAULTS`, `normalizePlace`, `normalizePlaces`), which is the same code `useSavedPlaces.js` and `useSettings.js` run.
    - `update(idx)` keeps the id at `idx`.
    - `add` appends a new id.
    - `remove(idx)` deletes that id and re-orders the rest with ids preserved.
    - Padded default entries become real records with new ids when a save persists the padded list, matching the legacy save of the padded array.
- Before any write, `validateRuntimeRecord(store, record)` (new `src/storage/runtimeRecords.js`) runs the Task 2 envelope validator plus the domain validator:
  - calendar: `validateEvent(payload)` deep-equals `payload` and `payload.id === record.id`;
  - waste: `validateImportHistory(payload.wasteImports)`;
  - household: a save through `createHouseholdRepository` on an in-memory adapter holding `{ version: 1, profile: payload }` (with `serverHouseholdId` removed) returns an equal profile, and `serverHouseholdId === null`;
  - places: `normalizePlace(payload, record.order)` from `src/places/savedPlaces.js` deep-equals `payload`, and orders are the contiguous integers `0..n-1`.
- No storage module imports a React hook. Every record also has `syncStatus: 'local'`, `revision: 0` and `deletedAt: null`.
- The same validators run on every load, producing `DOMAIN_INVALID` on failure. A failed validation aborts the whole transaction.

## 6. Fallback, rollback, quota and eviction

- **Fallback before the switch:** only when authority is proven absent. Migration failure, switch-transaction failure or a quota failure during migration or switch keeps `LEGACY` (accepted runtime) and retries at the next boot. Legacy stays authoritative and untouched. An open or read failure, or a malformed record, is never a fallback: it is `BLOCKED` or `STORAGE_UNAVAILABLE`.
- **After the switch there is no fallback to legacy writes.** Failures surface as `AUTHORITY_HINT_PENDING`, `BLOCKED`, `STORAGE_UNAVAILABLE`, `DOMAIN_INVALID` or `RELOAD_REQUIRED`.
- **Quota:** a runtime write that fails with `QuotaExceededError` (or any error) aborts atomically. The mutation promise rejects, the UI keeps the previous snapshot and shows "Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti." (existing copy). Places errors, previously swallowed, now surface the same message. A hint-write failure after the switch is `AUTHORITY_HINT_PENDING`, never `READY`.
- **Eviction:** Chromium evicts an origin's localStorage and IndexedDB together, so the switch does not increase eviction exposure. `persist()` follows the Section 1a lifecycle. Loss of IndexedDB alone is detected by the hint (`STORAGE_LOST`, guaranteed present while `READY` because of the hint gate) and recovered only with user confirmation from the frozen legacy snapshot.

### 6a. Revert export: authoritative semantic state for all three domains

Rollback is only through a revert build: the same forward code built with `VITE_STORAGE_AUTHORITY_MODE=revert` (an undefined mode means forward). The export always writes all three shared legacy keys from the current IndexedDB semantic state. A frozen legacy value is never left in place because a domain is empty.

- **Calendar**, always written as `JSON.stringify` of a valid envelope:
  - `version`: the calendar extras `sourceVersion`, or `1` with no extras record;
  - the extras `fields` (if any);
  - `events`: all `calendarEvents` payloads in canonical id order, possibly `[]`;
  - `wasteImports`: the `wasteState` payload's `wasteImports` when a waste record exists, otherwise omitted;
  - key order unspecified.
- **Household**, always written:
  - with a record: `{ ...extras.fields, version: extras ? extras.sourceVersion : 1, profile }`, where `profile` is the payload without `serverHouseholdId`;
  - with no record: the accepted legacy default semantic state `{ ...extras.fields, version: extras ? extras.sourceVersion : 1, profile: { name: '', address: '' } }` (what the legacy repository loads for an absent key), never the frozen old profile.
- **Places**, always written: `JSON.stringify(normalizePlaces(payloads))` over the `sharedPlaces` payloads in `order`, using `src/places/savedPlaces.js`. Zero records therefore export the legacy default three-place view.
- **Verification** reads back all three keys:
  - calendar: `createEventRepository(storage).load()` is `writable`, its events equal the IndexedDB payloads as an id-keyed set with no extra ids, `wasteImports` deep-equals (or both are undefined), and extra envelope fields equal;
  - household: `createHouseholdRepository(storage).load()` is `writable`, its profile equals the expected profile (record or default), and extra fields equal;
  - places: `normalizePlaces(JSON.parse(raw))` deep-equals the expected list.

### 6b. Revert backups and durable attempt

Backups are write-once once their attempt reaches `backups-verified`, so no attempt can overwrite or replace the originals of an attempt whose export may have begun. Revert progress comes from the IndexedDB attempt record (Section 1c), never from localStorage alone.

- **Attempt id:** the `attemptId` of the durable attempt record. One attempt record owns exactly one backup set and one pointer value. No backup key that already exists is ever overwritten, by any attempt, in any phase.
- **Target-key probe** for a `switchId` and candidate `attemptId`: `getItem` on exactly the three backup keys of that pair. The result is `free` when all three return `null`, `taken` when any returns non-null (whatever its content, valid or not), and `unreadable` when any `getItem` throws. The probe writes nothing.
- **Candidate selection** (revert build, authority valid `active`, before the "begin revert" transaction):
  1. Take `candidate = newId()`; it must be a non-empty string (otherwise it counts as `taken`).
  2. Probe. `free`: use the candidate for "begin revert". `taken`: discard it, and take a new candidate. `unreadable`: stop with `REVERT_FAILED` reason `revert-backup-key-unreadable`.
  3. At most 3 candidates per boot. If all 3 are `taken`: `REVERT_FAILED` reason `revert-attempt-id-collision`.
  - On either failure nothing has been written: no backup key, no pointer, no shared key, no IndexedDB mutation; the status stays `active`; STOP condition.
  - An existing backup set, including a verified set from an earlier attempt, and the existing pointer stay byte-identical.
- **Backup keys:** `majandus_legacy_backup_v1_<switchId>_<attemptId>_calendar`, `..._household`, `..._places`.
- **Value** of each: `JSON.stringify({ version: 1, legacyKey, raw })`, where `legacyKey` is the exact shared legacy key and `raw` is the exact previous `getItem` result, preserved as a string or `null` (absent).
- **A backup is valid** when it parses to exactly these three keys, `version === 1`, `legacyKey` matches its slot, and `raw` is a string or `null`.
- **Current-attempt pointer:** key `majandus_legacy_backup_v1_<switchId>_current` holds `JSON.stringify({ version: 1, switchId, attemptId })` (exact key set). It is valid only when it matches that shape, its `switchId` and `attemptId` equal the durable attempt record, and all three backups it names exist and are valid. A pointer naming another `attemptId` is invalid for this attempt; it is overwritten only while the attempt is `started`.
- **Preparation** (only while the durable phase is `started`):
  0. Probe the attempt's three target keys again, immediately before any backup write. `free`: continue. `taken`: "revert aborted before export" with `REVERT_FAILED` reason `revert-attempt-id-collision`. `unreadable`: "revert aborted before export" with `REVERT_FAILED` reason `revert-backup-key-unreadable`. Neither writes a backup key or the pointer.
  1. Read the three current shared values. A throw aborts preparation.
  2. Write all three backups under the attempt's `attemptId` (all three were proven absent in step 0 of this session).
  3. Read each back: the stored string must equal the written string exactly, and the parsed `raw` must be `===` the value read in step 1.
  4. Write the pointer, then read it back for exact equality. The pointer is the only pre-existing key preparation may overwrite, and only after step 0 proved the attempt's own set collision-free and steps 2-3 verified it.
  5. Guarded IndexedDB transition `started` to `backups-verified` (Section 1c), confirmed by `oncomplete`.
  6. Only now may the first shared legacy `setItem` happen.
- **Preparation failure** (any throw or mismatch in steps 1-4, or a step-0 `taken`/`unreadable` result): no shared legacy key has been touched. Guarded "revert aborted before export" (Section 1a: `active`, `legacyUntrusted` unchanged, attempt record deleted in the same transaction), then `REVERT_FAILED`. Backup keys already written by this attempt stay in place and are never reused (the next attempt gets a new candidate). If that transaction fails, the status stays `reverting` with phase `started`, and the next boot resumes safely.
- **Step-5 failure** (throw, abort or no `oncomplete`): no export in this session, `REVERT_FAILED`, nothing else changed. The next boot reads the durable phase: `started` follows the phase-`started` resume rule; `backups-verified` (the transition committed after all) resumes with the verified set.
- **Resume** (the revert build boots and finds authority `reverting`):
  - **Attempt record missing or malformed:** `REVERT_FAILED` reason `revert-attempt-invalid`; no writes of any kind, no new attempt (Section 1c).
  - **Phase `started`:** export provably never began, because export requires a committed `backups-verified` phase. The shared keys hold only values written by other tabs or builds, never by this attempt. Preparation runs from step 0 under the same `attemptId`: if all three target keys are absent it continues; if any exists (a partial set from the interrupted session) or a probe throws, the attempt is aborted before export (`active`, trust unchanged, attempt record deleted), nothing is overwritten, and the state is `REVERT_FAILED` (`revert-attempt-id-collision` or `revert-backup-key-unreadable`). A retry starts a fresh attempt with a new collision-checked candidate. Existing backup keys are never rewritten.
  - **Phase `backups-verified`:** export may have begun, and shared keys may hold partially exported values. The pointer and all three backups of the exact `attemptId` must be valid.
    - If valid: they are the originals; nothing is rewritten; continue at Section 6c step 3.
    - If the pointer is absent, malformed or names another `attemptId`, or any backup of the attempt is absent, unparsable or invalid: `REVERT_FAILED` reason `revert-backups-lost`. No shared-key write, no compensation, no backup or pointer write, no new `attemptId`, and no IndexedDB mutation. Authority stays `reverting` (IndexedDB authoritative). STOP condition; recovery needs an explicit decision (deploying the forward build converges to `active` with `legacyUntrusted: true`).
- **Retention:** backup sets (including partial sets of aborted attempts) and pointers are never deleted by this plan. They stay until a separate cleanup plan. Each attempt adds at most one set; the quota cost is three copies of the shared data per attempt.

### 6c. Revert procedure and compensation

For each device at boot, in the revert build, under the lock:

1. Open and read authority and the attempt record as in Section 2 step 1 and Section 1c. Unknown or malformed authority is `BLOCKED`/`STORAGE_UNAVAILABLE`; an orphan attempt record is `STORAGE_UNAVAILABLE`/`revert-attempt-orphan`.
   - A valid record `reverted`: verified removal of any non-null hint (a throwing hint read or removal failure is `STORAGE_UNAVAILABLE`), then `LEGACY`. This is the normal end of a completed revert.
   - No record: the revert-build authority-absent contract (Section 6d). The revert build never silently removes a non-null hint and never runs migration or a switch.
2. If the record is `active`: the "begin revert" transaction (Sections 1a, 1c) sets `reverting` and writes the attempt record with phase `started` atomically. Forward tabs' writes now abort. If it is already `reverting`: resume per Section 6b.
3. Read and validate all three domain snapshots. On failure:
   - phase `started`: "revert aborted before export" (`active`, trust unchanged, attempt record deleted), `REVERT_FAILED`;
   - phase `backups-verified` with a valid exact backup set: compensation (step 8);
   - phase `backups-verified` without it: `revert-backups-lost` (Section 6b).
4. Phase `started`: preparation per Section 6b (steps 1-5). Phase `backups-verified`: already verified, skip.
5. Export per Section 6a: write the calendar, household and places keys with `setItem`. Export never calls `removeItem`.
6. Verify per Section 6a.
7. On success: guarded "revert complete" transaction (`reverted`, attempt record deleted). Verified hint removal (a failure is `STORAGE_UNAVAILABLE`; the next boot sees `reverted` and retries the removal). Then `LEGACY`.
   - If the "revert complete" transaction fails, re-read authority in a new read transaction before any compensation: `reverted` means it committed (continue as success); a valid `reverting` with the same attempt in `backups-verified` means compensation (step 8); a failed read means `REVERT_FAILED` with no legacy writes, and the next boot resumes from the durable state.
8. **Compensation**, on any failure after the first export `setItem` was attempted (a throw in step 5, a verification mismatch in step 6, a confirmed-uncommitted step 7, or a step-3 failure on resume in `backups-verified`). It requires a valid exact backup set for the attempt record's `attemptId`; otherwise `revert-backups-lost`.
   - For each of the three shared keys, restore the original raw from that backup set: an original string gets `setItem(legacyKey, originalRaw)`; an original `null` gets `removeItem(legacyKey)`. This `removeItem` is the only allowed deletion of a shared legacy key, and only to restore a previously absent key during failed-revert compensation.
   - Verify byte-for-byte: `getItem(legacyKey) === originalRaw` for all three (`null` for originally absent keys).
   - **Compensation verified:** guarded "compensation verified" transaction (`active`, `legacyUntrusted` unchanged, attempt record deleted), keep the backups, `REVERT_FAILED`.
   - **Compensation failed** (any throw or mismatch): never `LEGACY`. Guarded "compensation failed" transaction (`active`, `legacyUntrusted: true`, attempt record deleted), keep the backups, `REVERT_FAILED` (compensation-failure variant), rollout STOP.
   - If that final transaction itself fails, the status stays `reverting` with phase `backups-verified`, and the next boot resumes with the same backup set as originals.
9. A forward build that finds `reverting` applies the Section 1a forward row in one transaction (`active`; `legacyUntrusted: true` unless the attempt record is valid with phase `started`; attempt value deleted) and never touches legacy keys, backups or the pointer.

### 6d. Revert build with authority absent

Applies when the revert build opens IndexedDB, the `meta` read succeeds, there is no authority record and no attempt value (an attempt value here is `revert-attempt-orphan`). The hint is classified per Section 1b:

| Hint | Result |
|---|---|
| `absent` | `LEGACY`; no write |
| `valid` | `REVERT_STORAGE_LOST`, dated variant (`switchedAt` from the hint) |
| `malformed` | `REVERT_STORAGE_LOST`, undated variant |
| `unreadable` | `STORAGE_UNAVAILABLE` (retry); no write |

**Confirmation** (from `REVERT_STORAGE_LOST` only, under the lock):
1. Re-open and re-read authority, the attempt key and the hint. Continue only if authority and the attempt key are still absent and the hint still classifies as the same variant with the identical raw string. Anything else re-enters `BOOTING` with no write (unknown authority is `BLOCKED`/`STORAGE_UNAVAILABLE` as usual).
2. Verified hint removal (`removeItem`, then `getItem === null`). A throw or a non-null read-back is `STORAGE_UNAVAILABLE`, with no other write; the next boot shows `REVERT_STORAGE_LOST` again if the hint survived.
3. `LEGACY` with the frozen legacy snapshot. Shared legacy keys, backups and IndexedDB are not written by this flow.

- Before confirmation nothing is written, and legacy repositories are not mounted, so a user who does not confirm keeps the evidence (hint, legacy bytes, retained backups) intact.
- A forward build seeing the same state still uses the Section 1b matrix (`STORAGE_LOST`, restore by migration).
- Both variants are STOP conditions.

- The IndexedDB data is never deleted by a revert. Re-forward after a revert uses the reverted reset (Section 2 step 2.1).
- **Forbidden:** deploying any pre-cutover build (without the controller) to an origin where any device may have switched.

## 7. Implementation phases (locked; each needs its own scope-open commit)

| Phase | Purpose | Exact files | Runtime behavior change |
|---|---|---|---|
| C1 | Phase A amendments: close/open race and the Section 5 item 4a connection-event contract | `src/storage/localReplica.js`, `src/storage/indexedDb.js`, `scripts/storage/storage.test.mjs`, `scripts/storage/indexeddb-browser.test.mjs` | none (dormant) |
| C2 | Prerequisite: behavior-preserving extraction of saved-place defaults and normalization into one neutral pure module | new `src/places/savedPlaces.js`, `src/hooks/useSavedPlaces.js`, `src/hooks/useSettings.js` (keeps its `DEFAULT_PLACES` export as a re-export), new `scripts/places/saved-places.test.mjs`, `scripts/storage/storage.test.mjs` (parity oracle only), `src/storage/legacyMigration.js` (comment-only update of its mirror reference; no code change) | none (behavior-preserving) |
| C3 | Runtime record validators and mutation helper (items 5, 6) | new `src/storage/runtimeRecords.js`, new `src/storage/runtimeWrites.js`, both storage tests | none (dormant) |
| C4 | Authority controller: Sections 1a, 1b and 1c contracts, state machine, hint gate, switch, resets, divergence (no re-adopt), `STORAGE_LOST`, revert export, durable revert attempt, backups and compensation, connection-event subscription | new `src/storage/storageAuthority.js`, both storage tests | none (dormant) |
| C5 | IndexedDB domain repositories (rollout order: household, then places, then calendar with waste) | new `src/storage/replicaRepositories.js`, both storage tests | none (dormant) |
| C6 | Runtime wiring (the cutover; ACCEPTED / CHECKPOINTED) | Final implementation `7146d0ac85c28da0cb8846b944099bf1307b9ece`; source scope CLOSED after automated GREEN, final independent source review PASS / ACCEPT and desktop Chrome human smoke PASS | yes; implemented; no intentional production deployment accepted. A later observed accidental Git auto-deployment is recorded in the C7 containment checkpoint |
| C7 (SCOPE OPEN) | Preview deploy and Android/PWA human gate, including the rollback drill | existing external Pages infrastructure only; no repository source or deployment-configuration change | preview origin only |
| C8 | Production deploy | separate deploy gate | production |

- **Ordering:** C3 depends on C2, because `runtimeRecords.js` imports `src/places/savedPlaces.js`. C3 must not open before C2 is committed and accepted.
- **C2 scope:**
  - `savedPlaces.js` contains exactly the current `DEFAULTS`, `normalizePlace` and `normalizePlaces` logic, byte-for-byte equivalent in behavior.
  - The hooks keep their load, save, error-swallowing, padding and `resolveAddress` behavior.
  - `legacyMigration.js` keeps its accepted Task 3 mirror unchanged in code.
- **C2 characterization before extraction:** golden tables for `normalizePlace` (every `PLACE_GOLDEN` class) and `normalizePlaces` (non-array, empty, 1, 3 and 5 items, padding) are captured from the current source of both hooks. The Task 3 parity oracle now imports the neutral module instead of slicing hook source text.
- **C2 guard:** both hooks import the module and define no local `normalizePlace`/`normalizePlaces`/defaults. The module imports nothing from React or `src/storage/`. The fail-fast sweep and app-shell suite pass.
- C1-C6 source scopes are closed. The C6 importer allowlist remains in force; no source work may broaden it without a new authorized scope.
- Every `src/storage/` module receives browser capabilities by injection (`indexedDb`, `storage`, `locks`, `broadcast`, `persist`, `cryptoApi`, `clock`, `newId`, `mode`). The Task 6 forbidden-token guard (no `navigator`, `localStorage`, `window.`, network or React) stays in force for every storage module. C3-C5 only extend its exact module and import lists (adding `../places/savedPlaces.js`, `../calendar/eventModel.js`, `../waste/reconcile.js`). Globals are read only in `src/main.jsx` from C6 on.
- In C6, the only allowed runtime importers of `src/storage/` are `src/main.jsx`, `src/App.jsx` and the three domain hooks.
- C6 authority identity amendment (`RUNTIME_CUTOVER_C6_AUTHORITY_IDENTITY_SCOPE_AMEND`; no change to the plan's design): Section 4 requires every runtime write to bind to the `switchId` the tab booted with, and Section 5 item 4a-5 keeps every state decision in the C4 controller. The C4 controller did not expose the mounted `READY` identity, so C6 gets one additive read-only accessor, `getReadyAuthorityIdentity()` in `src/storage/storageAuthority.js` (`{ switchId }` of the identity C4 mounted, only in `READY`, otherwise `null`). C6 must never recover the identity by re-reading meta, parsing the hint or using its own `newId()` values; full contract and tests in `docs/ACTIVE_SCOPE_LOCK.md`.
- C6 scope-open note (no change to the plan's design): the C6 file lists above are opened exactly as written in `docs/ACTIVE_SCOPE_LOCK.md`; the reminder wrappers (`reminder-ui.test.mjs`, `native-notification.test.mjs`, `reminders.test.mjs`) and the saved-places suite are run-only (the reminder UI and native wrappers run through `scripts/shell/app-shell.test.mjs`), while `scripts/reminders/browser-cases.mjs` is writable solely for a test-only mode-aware `readCalendarEvents` helper replacing its direct reads of the frozen legacy calendar key (`RUNTIME_CUTOVER_C6_REMINDER_TEST_SCOPE_AMEND`; a legacy-key mirror from IndexedDB is forbidden); Section 9 item 5 (update in a second tab) is read with Section 4 — an ordinary committed update refreshes the other `READY` tab by domain re-read, and the reload banner is the required behavior for authority/connection changes.
- C7 scope-open note: before Step 1 select and record exactly one existing Cloudflare Pages preview/branch-alias origin. It is immutable for the legacy seed, forward, revert and re-forward artifacts. C7 is human-gated and PENDING until the human confirms every required step; intentional canonical production deployment, C8 and all repository source/deployment configuration remain outside C7. After the C7 containment checkpoint, a `main` push MUST NOT auto-deploy production; any unexpected production deployment before C8 is a STOP.
- Legacy repositories stay in the codebase for `LEGACY` mode and revert.

## 8. Automated acceptance tests (minimum, cumulative)

- **C1:**
  - **Close race:** stub-controlled open, then `close()` before success: handle closed, `ReplicaClosedError`, reopen works.
  - **Connection events (stub `indexedDb`):**
    - `versionchange` closes the handle before the listener runs;
    - the listener gets exactly `{ type: 'versionchange', oldVersion, newVersion }`;
    - `activeDb` is dropped, and later `open`/`transact` reject with `ReplicaConnectionLostError` with zero further `indexedDb.open` calls;
    - `onclose` delivers `{ type: 'close' }` with the same lost behavior;
    - listeners run in subscription order, and a throwing listener does not block later ones (its error is rethrown in a microtask);
    - `unsubscribe` is idempotent and stops delivery;
    - events from a stale generation after `close()` are not delivered;
    - `openMajandusDb` without options keeps the Task 1 close-on-`versionchange` behavior.
  - **Chromium:**
    - with replica A subscribed, a second connection opening `DB_VERSION + 1` makes A's listener fire once, A's handle close (the upgrade completes without `blocked`), and A's `transact` reject with `ReplicaConnectionLostError`;
    - `deleteDatabase` delivers `newVersion: null` and completes.
  - Task 1-6 suites stay green.
- **C2:** the golden characterization tables pass against the current hooks before extraction and against the neutral module after it; Task 3 parity passes against the module; the C2 import guard; fail-fast sweep and build.
- **C3:**
  - every validator accepts accepted domain output and rejects each invalid payload class (places validation proven against `src/places/savedPlaces.js`);
  - a thenable-returning plan writes nothing;
  - a validation failure aborts every write;
  - `commitCount` increments exactly once per committed mutation;
  - a mismatched `switchId`/status aborts;
  - a malformed authority record aborts with `STORAGE_UNAVAILABLE`;
  - the timer-await hazard test (Section 5).
- **C4 (Chromium plus stubs):** every Section 3 state and transition, plus:
  - **Authority contract (1a):**
    - a fresh switch writes exactly the 9 fields with the specified values;
    - each malformed class leads to `STORAGE_UNAVAILABLE`/`authority-malformed` at boot, in a runtime write and in revert, with zero legacy writes and no reset or repair: extra key, missing key, wrong `status`, empty `switchId`, invalid `switchedAt`, uppercase or short digest, negative or non-integer `commitCount`, non-boolean `legacyUntrusted`, `persistGranted` not null/boolean;
    - an invalid `now()` prevents the switch (`LEGACY`);
    - immutable fields never change across every mutation;
    - `legacyUntrusted` and `persistGranted` only move forward.
  - **`persist()`:**
    - resolves `true`/`false`: stored, and not retried at the next boot;
    - rejects, is unavailable or resolves to a non-boolean: `persistGranted` stays `null`, the next boot retries, and the switch is unaffected.
  - **Hint contract (1b):** every matrix row, including:
    - a malformed hint with no authority leads to the undated `STORAGE_LOST` (never `LEGACY`);
    - an unreadable hint with no authority leads to `STORAGE_UNAVAILABLE`;
    - an active authority with an absent, malformed or mismatched hint is rewritten;
    - a `reverted` record with a malformed hint gets verified removal;
    - the `LEGACY` write guard refuses on a malformed non-null hint and on a throwing `getItem`.
  - **Switch:**
    - switch success;
    - a legacy write between migration and switch leads to the stale reset, then the latest state is adopted.
  - **Unknown authority:** a blocked open is `BLOCKED` and any other open, API or `meta` read failure is `STORAGE_UNAVAILABLE`, each with the hint absent, valid and malformed, never `LEGACY`, and with zero legacy writes.
  - **Hint gate:**
    - a hint-write failure right after the switch, at boot with authority `active` and hint absent, and while `READY` after a hint clear event, each leads to `AUTHORITY_HINT_PENDING` with no domain mounted or writes disabled and no legacy write;
    - a retry success leads to `READY`;
    - a read-back mismatch counts as failure.
  - **Divergence (no re-adopt).** Each case asserts: IndexedDB records (authority, marker, extras, domain stores) deep-equal their pre-boot snapshot; the current legacy bytes are unchanged; state `READY` + `LEGACY_DIVERGED`; zero migration, reset, switch or record-delete writes (spy `replica`, spy storage):
    - switch with real legacy data in all three keys, `commitCount` 0, then clear all three legacy keys only (hint kept), reboot;
    - the same with `commitCount` 0 and all of localStorage cleared (hint rewritten through the gate, legacy keys stay absent);
    - one-key loss: only `majamajandus_household_profile_v1` removed, `commitCount` 0; and separately only `sade_saved_places` removed with `commitCount > 0`;
    - old-build legacy edit: after the switch, a pre-cutover build writes a changed calendar envelope, with `commitCount` 0 and with `commitCount > 0`; detected at boot and via a `storage` event in a mounted tab (stays `READY`, notice shown);
    - divergence found at the step-9 post-switch confirmation: no second switch;
    - a throwing legacy `getItem` during the check: `LEGACY_DIVERGED`, nothing written;
    - source guard: no controller path deletes an `active` or `reverting` authority record, and `commitCount` is not read by any branch that deletes or resets.
  - **Crash points:** after steps 2.7 and 2.8, simulated by aborting the controller between steps: the next boot keeps authority `active`, rewrites the hint, and reports any legacy write made in the window as `LEGACY_DIVERGED` without re-adopt.
  - **Storage loss:** `STORAGE_LOST` restore.
  - **Concurrency:** two concurrent boots produce exactly one switch.
  - **Connection events:** a `versionchange` delivered through the replica subscription moves the controller to `RELOAD_REQUIRED` and repositories reject new mutations, both while mounted and when injected during migration, switch, hint gate, snapshot load and revert (never `LEGACY`).
  - **Revert export (6a):**
    - legacy contains event A, then cutover, then event A is deleted in IndexedDB, then revert: `createEventRepository(localStorage).load()` contains no event A;
    - all events deleted: calendar exported with `events: []`, extras preserved, no frozen events resurrected;
    - no household record (household originally absent at switch, and separately a household present at switch with the IndexedDB record removed by test injection): exported default profile, loaded profile `{ name: '', address: '' }`, no frozen profile;
    - zero place records and a changed place list: exported places load equal to the legacy default view and to the current ordered list respectively, matching `useSavedPlaces` load parity;
    - `wasteImports` present and absent both round-trip;
    - verification catches an injected wrong export.
  - **Backups (6b):**
    - each backup preserves a string raw and an absent `null` raw exactly;
    - a failure on the first, second or third backup write, a read-back mismatch, or a pointer write or read-back failure, each leaves all three shared keys byte-identical and gives `REVERT_FAILED` with `legacyUntrusted` unchanged;
    - a second attempt after a compensated first attempt gets a new `attemptId`, creates a new set, and leaves the first attempt's set byte-identical.
  - **Attempt-id collision (6b).** Deterministic injected `newId()`; spy storage records every `setItem`/`removeItem`; each case also asserts shared legacy keys byte-identical and no shared-key `setItem` issued:
    - an earlier attempt's verified set and pointer exist (left by a compensated revert); the new revert's `newId()` returns that earlier `attemptId` first, then a fresh id: the old set and pointer are byte-identical until the fresh candidate's set is verified, the fresh id is used, and the export compensates or completes using only the fresh set as originals;
    - `newId()` returns the earlier `attemptId` 3 times: `REVERT_FAILED`/`revert-attempt-id-collision`, status `active`, no attempt record, zero `setItem`/`removeItem` calls of any kind, old set and pointer byte-identical;
    - only one of the three target keys exists (for example only `..._places`, with arbitrary or invalid content): counts as `taken`, never overwritten;
    - `newId()` returns an empty string: counts as `taken`;
    - a throwing `getItem` on one target backup key during candidate selection: `REVERT_FAILED`/`revert-backup-key-unreadable`, status `active`, zero writes;
    - a target key created between candidate selection and preparation (injected after the "begin revert" commit): step 0 finds `taken`, aborts before export to `active`, the injected bytes are unchanged, no backup or pointer write;
    - a throwing target-key `getItem` at step 0: abort before export, `revert-backup-key-unreadable`, zero backup or pointer writes;
    - ordering proof: no backup key or pointer `setItem` precedes a `free` probe of the attempt's own three keys in the same session.
  - **Revert attempt record (1c):**
    - begin revert writes `reverting` and the exact 5-field attempt record (`phase: 'started'`, `commitCountAtStart === commitCount`) in one transaction; an injected abort leaves `active` with no attempt record;
    - each malformed class (extra or missing key, empty `switchId`/`attemptId`, bad `commitCountAtStart`, unknown `phase`) and a missing record under `reverting` give `revert-attempt-invalid` in the revert build with zero writes;
    - an attempt value with authority absent, `active`, `reverted` or a different `switchId` gives `STORAGE_UNAVAILABLE`/`revert-attempt-orphan` with zero writes;
    - `phase` never moves backwards, and immutable fields never change;
    - no shared-key `setItem` is issued before the `backups-verified` transaction completes (spy storage ordering); an injected failure of that transaction gives `REVERT_FAILED`, zero shared-key writes, status `reverting`;
    - cleanup deletes the attempt record in the same transaction for: successful revert (`reverted`), verified compensation, failed compensation, preparation abort (`started`), and a forward build finding `reverting` (with `legacyUntrusted` unchanged for phase `started` and `true` for phase `backups-verified`, a malformed value or a missing value);
    - reverted reset refuses while any attempt value exists.
  - **Revert build with authority absent (6d).** Each case starts from an opened database with no authority record and no attempt value; spy storage and spy replica:
    - hint absent: `LEGACY`, zero writes;
    - valid hint: `REVERT_STORAGE_LOST` dated variant showing the hint's `switchedAt`; before confirmation zero localStorage and IndexedDB writes, no legacy repository mounted, shared-domain controls absent, Buss and device-local tabs usable; a reload shows the same screen again;
    - malformed hint (non-JSON, extra key, `version: 2`): the undated variant, with the same zero-write assertions;
    - confirmation: verified hint removal then `LEGACY`; the only write is the hint `removeItem`; shared keys and backups byte-identical;
    - confirmation when the hint was changed or an authority record appeared since the screen was shown: re-enters `BOOTING`, zero writes;
    - hint removal throws, and separately read-back stays non-null: `STORAGE_UNAVAILABLE`, no `LEGACY`, no other write;
    - unreadable hint: `STORAGE_UNAVAILABLE`, zero writes;
    - an attempt value with authority absent: `revert-attempt-orphan`, zero writes;
    - source guard: no revert-build path removes a non-null hint with authority absent except the confirmation handler;
    - the valid `reverted` record path still removes the hint without confirmation.
  - **Revert resume and crash (1c, 6b, 6c).** Every case asserts IndexedDB domain records unchanged, and "no new originals": no backup key or pointer write for any other `attemptId`, and no rewrite of the exact attempt's backup keys once `backups-verified`:
    - crash in phase `started` after one backup write: resume finds that key `taken`, aborts before export (`active`, trust unchanged, attempt record deleted), leaves the partial backup byte-identical, and a retry completes under a new `attemptId`;
    - crash in phase `started` before any backup write: resume finds all three absent and completes under the same `attemptId`;
    - crash after `backups-verified` committed but before export: resume uses the exact set without rewriting it, exports, verifies, `reverted`;
    - crash after the first export `setItem`, then the pointer removed: `REVERT_FAILED`/`revert-backups-lost`, status `reverting`, attempt record unchanged, zero shared-key, backup and pointer writes;
    - pointer corrupted (malformed JSON, and separately a valid shape naming another `attemptId`) after export started: same result;
    - one backup key removed, and separately one backup value corrupted, after export started: same result;
    - resume in `backups-verified` with a valid set and invalid snapshots: compensation from the exact set;
    - a `revert complete` transaction reported failed but actually committed (re-read shows `reverted`): no compensation, `LEGACY` with exported data;
    - a forward build deployed after `revert-backups-lost`: `active`, `legacyUntrusted: true`, attempt record deleted, no legacy or backup writes.
  - **Compensation (6c):**
    - an originally absent calendar key plus a forced export failure after its `setItem`: compensation `removeItem` restores absence (`getItem === null`), the other keys are byte-identical, the status is `active` with `legacyUntrusted` unchanged, backups are retained, and the state is `REVERT_FAILED`;
    - a forced verification failure, and a forced `reverted`-transaction failure whose re-read confirms `reverting`, both compensate from the exact attempt set;
    - a forced compensation failure (a `setItem` or `removeItem` throw, or read-back mismatch) never gives `LEGACY` and leaves the status `active` with `legacyUntrusted: true`, backups retained, `REVERT_FAILED`;
    - a forward build seeing `reverting` in phase `backups-verified` sets `legacyUntrusted: true` and writes no legacy or backup key;
    - revert success then re-forward after `reverted`.
  - **Invariants:** legacy key bytes never change in any forward path; private keys are never read; no `removeItem` on a shared legacy key outside compensation (source guard plus spy storage).
- **C5:** for every domain operation, the IndexedDB repository result equals the legacy repository result on the same starting state, with events compared as id-keyed sets. The parity table covers calendar create/update occurrence and series/remove/importWaste, household save, and places update/add/remove with padding. IDs are stable; quota failure injection leaves the previous state; two-tab concurrent mutations both persist.
- **C6:**
  - app-shell, calendar, waste and reminder browser suites pass in both `LEGACY` and `READY` modes;
  - boot from a real seeded legacy profile switches and shows identical UI data;
  - reload persistence;
  - with the app mounted `READY` in Chromium, a second connection triggering `versionchange` shows the reload banner and disables every shared-domain save control;
  - a hint-write failure injected at boot shows the `AUTHORITY_HINT_PENDING` screen;
  - a malformed authority record shows `STORAGE_UNAVAILABLE`;
  - the storage allowlist guard, and a bundle check that `src/storage/` is present only via the allowed importers;
  - the full fail-fast sweep, `npm run build`, `git diff --check`.

## 9. Human smoke gates

- **C6 desktop smoke (PASS recorded at the C6 checkpoint):** a human checks that existing data appears after the switch; creates, edits and deletes in every domain; reloads; checks two tabs; confirms that an ordinary committed domain update refreshes the other `READY` tab without `RELOAD_REQUIRED`; and separately confirms that an authority/connection change shows the reload banner and disables shared writes. Visual parity covers the calendar grid, agenda, home upcoming list, `KalenderTab` legend and `WasteSettings` imported subtype labels against the pre-switch legacy view (subtype label order may differ; any other difference is a FAIL). Waste CRUD passed; a separate waste-import action was not separately human-confirmed.
- **C7 Android/PWA gate (acceptance item 2, mandatory; stays PENDING until the human confirms):**
  1. Use one fixed Cloudflare Pages branch alias URL, because localStorage is per origin. Deploy the current accepted legacy build there. Install it as a PWA on a real Android phone (Chrome stable). Create real data: recurring and one-off events and a household profile. Save meaningful values into all three user-visible saved-place rows and record their visible top-to-bottom order before cutover. Attempt a real waste import if a usable source is available, otherwise record `WASTE_IMPORT: NOT AVAILABLE`; create a manual waste schedule when that operation is exposed. Saved-place add/remove is not required through the UI because no user-visible control exposes it.
  2. Deploy the C6 build to the same alias. Open the installed PWA and let it update. Verify every item is unchanged, including place order, and that reminders still fire.
  3. Exercise every user-visible mutation offered by each shared domain: Calendar create/edit/delete; Household edit/save plus persistence; Saved places edit/save the three visible rows plus order preservation, persistence and multi-context refresh; Waste actual exposed operations. Do not require saved-place add/remove through UI. Force-stop the app, reopen, confirm persistence. Reboot the phone, confirm persistence. Repeat in airplane mode.
  4. Open the alias in a Chrome tab alongside the PWA, edit in one, and confirm the other shows it after focus.
  5. Deploy a new build while the PWA is open, and confirm `RELOAD_REQUIRED` or a clean reload with no data loss.
  6. Via `chrome://inspect` remote DevTools: simulate a small custom storage quota, attempt a save, and confirm the error message with the previous data intact; delete the IndexedDB database only, reload, confirm the `STORAGE_LOST` screen, restore, and confirm data equals the switch-time snapshot; separately remove only the three shared legacy keys, reload, confirm the `LEGACY_DIVERGED` notice with all IndexedDB data unchanged and still writable; record `navigator.storage.persisted()` and the stored `persistGranted`.
  7. Rollback drill: before reverting, delete one event that existed before the switch. Deploy the revert build to the alias. Confirm the data under `LEGACY` equals the pre-revert IndexedDB state, including that the deleted event stays deleted, and that backup keys exist. Then redeploy forward and confirm it converges.
- **C8 production** requires the C7 gate PASS recorded by the human and a separate deploy scope.

## 10. STOP and rollback conditions

STOP the rollout (no further phase or deploy, and investigate) on any of:
- a Task 1-6 regression or a failed accepted suite;
- any C2 characterization difference;
- any forward path writing legacy keys;
- any shared legacy key deletion outside failed-revert compensation;
- any mismatch between a migrated and a legacy view;
- `LEGACY_DIVERGED` observed in smoke or reported from the field (any cause, including localStorage-only key loss), or any code path deleting authority or migrated records because of divergence;
- `REVERT_STORAGE_LOST` (either variant), `revert-attempt-orphan`, `revert-attempt-invalid`, `revert-backups-lost`, `revert-attempt-id-collision` or `revert-backup-key-unreadable` observed anywhere; any overwrite of an existing backup key; or any revert creating a new backup set or rewriting backups after its attempt reached `backups-verified`;
- `replica-not-empty`, `DOMAIN_INVALID`, `STORAGE_LOST` (either variant), `STORAGE_UNAVAILABLE` (any reason, `authority-malformed` always), `BLOCKED`, `AUTHORITY_HINT_PENDING` or `REVERT_FAILED` observed without a deliberate trigger;
- a quota or eviction test losing previously saved data;
- revert verification failure or any revert resurrecting deleted data;
- `TransactionInactiveError` in any runtime path;
- a human smoke FAIL.

Deploy the revert build (never a pre-cutover build) when production shows data loss, a wrong-data display, repeated `BLOCKED`/`STORAGE_UNAVAILABLE`/`AUTHORITY_HINT_PENDING` states, or an unrecoverable `DOMAIN_INVALID`. The revert must be confirmed by the rollback-drill checklist before a new forward attempt.

## 11. Falsification review (post-amendment result: PASS)

Each attack was traced against Sections 1-10 and the unchanged Task 1-6 contracts. The first six rows were added and re-run for amendment 4; the next seven were added for amendment 3 (the pointer-loss row is updated for amendment 4); the rest were re-checked against amendments 3 and 4.

| Attack | Result |
|---|---|
| Authority absent + valid hint (revert build) | Section 6d replaces the forward matrix row: `REVERT_STORAGE_LOST` dated, zero writes until confirmation; confirmation re-reads state, performs verified hint removal, then `LEGACY` on the frozen snapshot. No silent removal; unconfirmed boots keep hint, legacy bytes and backups. STOP |
| Authority absent + malformed hint | Revert build: undated `REVERT_STORAGE_LOST` with the same zero-write and confirm-only rules. Forward build: unchanged undated `STORAGE_LOST`. Never `LEGACY` without confirmation |
| Authority absent + unreadable hint | Both builds: `STORAGE_UNAVAILABLE`, zero writes, retry. A throwing removal or re-read during confirmation is also `STORAGE_UNAVAILABLE` |
| Repeated `attemptId` | Each candidate's three target keys are probed before "begin revert"; any existing key discards the candidate; at most 3 candidates, then `revert-attempt-id-collision` with status `active` and zero writes. Step 0 re-probes after the commit, before any backup write |
| Existing retained backup collision | An existing key (valid, partial or invalid) is `taken` and never overwritten, in candidate selection, at step 0 and on `started` resume (which now aborts instead of rewriting). The pointer is overwritten only after the attempt's own set is proven free and verified, and export uses only that set as originals |
| Backup-key read failure | A throwing target-key `getItem` is `unreadable`: before "begin revert" `REVERT_FAILED`/`revert-backup-key-unreadable` with status `active`; at step 0 abort before export to `active`. No backup, pointer or shared-key write in either case |
| localStorage-only shared-key loss | Phase A reads an absent key as valid empty data, so loss changes the digest. After the switch, any divergence keeps IndexedDB authoritative: no deletion of authority, marker, extras or migrated records, no re-migration, no legacy write, `LEGACY_DIVERGED` plus STOP. Whole-localStorage loss also loses the hint, which is rewritten through the gate while authority stays `active`. Tested for all three keys, one key and full clear |
| `commitCount === 0` divergence | `commitCount` is diagnostic only. No branch deletes or resets on it. `commitCount` 0 with cleared keys, one lost key, or an old-build edit all give `READY` + `LEGACY_DIVERGED` with IndexedDB records deep-equal and zero migration or reset writes |
| Crash-window divergence | A crash between 2.7 and 2.8 leaves `active`; the next boot rewrites the hint and reports window legacy writes as `LEGACY_DIVERGED`. Those bytes stay in place (not adopted, not deleted); recovery is an explicit decision. No automatic re-adopt path exists anywhere |
| Revert pointer loss | Progress is the IndexedDB attempt phase, not the pointer. In `started` export provably never began, so preparation continues under the same `attemptId` only if its target keys are all absent, otherwise it aborts before export without overwriting. In `backups-verified` a missing pointer is `revert-backups-lost`: zero shared-key, backup, pointer or IndexedDB writes, status stays `reverting`, STOP |
| Revert pointer corruption | A malformed pointer, or one naming another `attemptId`, is invalid. `started`: overwritten during preparation (no export yet). `backups-verified`: `revert-backups-lost`, no new originals |
| Backup loss after export began | Phase `backups-verified` requires all three backups of the exact `attemptId`. Any absent or invalid backup gives `revert-backups-lost`; compensation never runs from a partial set and no set is rebuilt from partially exported shared values |
| Durable revert-attempt resume | Begin revert writes `reverting` and the attempt record atomically. The first export `setItem` requires a confirmed `backups-verified` commit. A failed phase commit prevents export in-session and resumes from the durable phase. An ambiguous `revert complete` failure is re-read before compensating, so a committed `reverted` is never followed by restoring old bytes. Every exit (`reverted`, compensation verified, compensation failed, abort in `started`, forward build) deletes the attempt record in the same transaction; orphans and malformed records STOP with no writes |
| Malformed authority | Exact 9-key contract. Any malformed value is `STORAGE_UNAVAILABLE`/`authority-malformed` at every read site (boot, runtime write, revert, reset), with no legacy write, repair, reset or revert, plus a STOP |
| Malformed hint | Classified `absent`/`valid`/`malformed`/`unreadable`. With authority active any non-matching hint is rewritten through the gate. With authority absent a malformed hint is the undated `STORAGE_LOST` (blocking, consent-only restore), never `LEGACY`, and an unreadable hint is `STORAGE_UNAVAILABLE`. The `LEGACY` write guard refuses on any non-null or unreadable hint |
| Authority-field durability | All fields written explicitly at switch and validated before `put`. Immutable fields fixed. Every mutation is a guarded re-read and validate with only the listed changes. `legacyUntrusted` and `persistGranted` only move forward. `persist()` failure never alters authority, and `null` retries per boot |
| Empty-domain rollback | Export always writes all three keys from current semantic state: calendar `events` may be `[]`, household absent exports the legacy default profile, zero places export the legacy default view. Frozen keys are never left in place |
| Deleted-data resurrection | Deleted IndexedDB events are absent from the exported envelope; verification compares id-keyed sets with no extra ids. There is an explicit event-A acceptance test and a C7 drill step |
| Partial backup | All three backups plus the pointer are written and read-back-verified, then the durable phase moves to `backups-verified`, before the first shared-key `setItem`. A failure before that leaves shared keys byte-identical, with `legacyUntrusted` unchanged. Each attempt owns one `attemptId`; a later attempt never overwrites an earlier attempt's set (including preserved divergent legacy edits) |
| Failed export | Compensation restores originals from the exact attempt set (also when snapshot validation fails on resume in `backups-verified`), then byte-for-byte verification, then `active` with trust unchanged and `REVERT_FAILED`. A failed final transaction leaves `reverting`/`backups-verified` for resume |
| Absent-key compensation | An originally `null` raw is restored with `removeItem`, the single allowed shared-key deletion, verified by `getItem === null`. A compensation failure is never `LEGACY`: `active` with `legacyUntrusted: true`, backups retained, STOP |
| C2/C3 dependency ordering | `runtimeRecords.js` (C3) imports the neutral module created in C2; C3 cannot open before C2 is accepted; no storage module imports a React hook; the Task 3 mirror is untouched in code with its parity oracle on the module |
| Unknown authority | `LEGACY` requires a successful open, a `meta` read and a valid record proving absence or `reverted`. Blocked is `BLOCKED`; every other failure or malformed record is `STORAGE_UNAVAILABLE`, independent of the hint |
| Hint write failure | `READY` requires a valid matching hint. A gate failure at switch, at boot or while `READY` is `AUTHORITY_HINT_PENDING`, never legacy |
| Versionchange propagation | `indexedDb.js` closes and calls back; the replica drops the handle, enters `lost` and notifies; the controller, subscribed from replica creation, sets `RELOAD_REQUIRED` for any boot step or mounted state; repositories reject and hooks disable writes |
| Split authority | One valid authority record, switched transactionally. Unknown or malformed authority is never `LEGACY`. The hint is guaranteed while `READY`. The `LEGACY` guard refuses on any non-null hint. Pre-cutover tabs, propagation delay and the crash window are reported by divergence detection and never flip authority back |
| Data loss on switch | Switch adopts only verified complete-marker data equal to the digest read immediately before the switch; legacy stays frozen |
| Partial migration or switch | Task 4 atomic preparation; switch requires `complete`; a crash before the switch commit converges at next boot; after it, authority stays `active` |
| Multi-tab races | IndexedDB serializes readwrite transactions; mutations re-read inside the transaction; the guarded `switchId`/`status` check catches a revert under a live tab |
| Quota or storage loss | Atomic abort with visible error. Eviction is no worse than today. IndexedDB-only loss is detected by the guaranteed hint and recovered with consent; localStorage-only loss is `LEGACY_DIVERGED` with IndexedDB intact |
| Invalid payload writes | The domain repositories are the only payload producers. Validators run before every write and after every read |
| Transaction auto-commit | Structural read, sync plan, validate, write discipline; thenable plans rejected; direct `transact` confined to four files |

Residual and accepted:
- **Crash window between the switch commit (2.7) and the hint write (2.8):** only a crash in this window matters, not a persistent hint failure (that is `AUTHORITY_HINT_PENDING`).
  - Until the next boot, a pre-cutover build tab or an already-running new-build `LEGACY` tab can still write legacy. The next boot rewrites the hint through the gate and reports those writes as `LEGACY_DIVERGED`. The edits are preserved in the legacy keys but not adopted; recovering them needs an explicit decision (STOP).
  - If IndexedDB alone is also lost inside that window, the next boot sees authority absent with no hint and migrates the current legacy state. No IndexedDB edits can be lost, because none were possible.
- **Legacy edits after the switch** (pre-cutover tab, propagation delay) are preserved but not adopted (notice plus STOP condition), whatever `commitCount` holds.
- **`revert-backups-lost`** leaves a device on `REVERT_FAILED` with IndexedDB authoritative until an explicit recovery decision (a forward redeploy converges to `active` with `legacyUntrusted: true`).
- **`REVERT_STORAGE_LOST`** keeps shared domains blocked on a device that lost IndexedDB until the user confirms using the frozen legacy snapshot, which may lack later edits.
- **Interrupted `started` attempts** leave a retained partial backup set and need one retry, which uses a new `attemptId`.
- **Availability trade-off:** devices whose IndexedDB cannot be opened or read cannot use shared domains (Section 3; STOP condition if observed).
- **Cosmetic:** the `WasteSettings` imported subtype label order may differ after the switch, because canonical event order replaces insertion order. Calendar views and the `KalenderTab` legend are not affected (Section 1).

## 12. Amendment record

**Amendment 1** (baseline `fac198747186e5307914b5567c7cd7b523991b3c`, independent fresh review AMEND):
- **A. Saved-place validator ordering:** new prerequisite phase C2 extracts the neutral pure module `src/places/savedPlaces.js` used by both hooks and the validators, with characterization tests. Later phases renumbered C3-C8.
- **B. Unknown authority:** `LEGACY` only after a successful open and `meta` read proving absent or reverted authority. Blocked is `BLOCKED`; any other open or read failure is `STORAGE_UNAVAILABLE`, regardless of the hint.
- **C. Hint write as `READY` gate:** new state `AUTHORITY_HINT_PENDING`; only the crash window between the authority commit and the hint write remains as a residual.
- **D. Versionchange propagation:** exact C1 contract with C1, C4 and C6 tests; the controller subscribes from replica creation.

**Amendment 2** (baseline `d7a5bbbc7d5870a92a7e2a954c7aca0cd23ff4e8`, independent fresh review AMEND):
- **A. Authority and hint records locked exactly (Sections 1a, 1b):**
  - 9-field authority contract with explicit fresh-switch values, immutable fields, guarded mutations and the `persist()` lifecycle (per-boot retry only while `null`);
  - malformed authority is `STORAGE_UNAVAILABLE`/`authority-malformed` with no repair and a STOP;
  - exact hint schema with classification and matrix; a malformed hint without authority is the undated `STORAGE_LOST`, never `LEGACY`; the `LEGACY` write guard refuses on any non-null hint.
- **B. Authoritative empty-state export (Section 6a):** all three keys always exported from the current semantic state (empty calendar `events: []`, default household profile, default places view); canonical calendar id order; event-A deletion acceptance test.
- **C. Backups and compensation (Sections 6b, 6c):**
  - exact backup representation `{ version: 1, legacyKey, raw: string|null }`, write-once per `attemptId`, with all three plus a verified current-attempt pointer before any shared-key change, and resume rules;
  - compensation restores originals byte-for-byte, using `removeItem` only to restore an originally absent key;
  - a compensation failure is never `LEGACY` (`active` with `legacyUntrusted: true`, backups retained, `REVERT_FAILED`, STOP);
  - new state `REVERT_FAILED`.

**Amendment 3** (baseline `37b226cdc50f0dddf495dc21c23648c06eb52fbd`, independent fresh review AMEND):
- **A. No automatic re-adopt after the switch (Sections 1a, 2, 3, 8, 11):**
  - any post-switch legacy divergence keeps IndexedDB authoritative, deletes no authority or migrated record, preserves the current legacy bytes, shows `LEGACY_DIVERGED` and is a STOP awaiting an explicit recovery decision;
  - `commitCount` is diagnostic only; the re-adopt transaction, the switch retry bound and the re-adopt crash point are removed; the authority record is deleted only by the reverted reset;
  - reason: localStorage shared keys can be lost independently, and Phase A reads absent keys as valid empty data;
  - tests: all three legacy keys cleared with `commitCount` 0, one-key loss, full localStorage clear, old-build legacy edit, unreadable legacy key.
- **B. Durable revert attempt (Sections 1a, 1c, 3, 6b, 6c, 8):**
  - exact 5-field `meta/storageRevertAttemptV1` record `{ key, switchId, attemptId, commitCountAtStart, phase: 'started' | 'backups-verified' }`, written atomically with `reverting`;
  - the first shared-key export write requires a confirmed `backups-verified` commit; `started` restarts preparation under the same `attemptId`; `backups-verified` requires the exact attempt's pointer and backups, otherwise `revert-backups-lost` with no writes and no new originals;
  - attempt-record cleanup locked in the same transaction for successful revert, verified compensation, failed compensation, abort in `started` and a forward build finding `reverting`; orphan and invalid records STOP;
  - the pre-attempt pointer removal is replaced by `attemptId` matching; an ambiguous `revert complete` failure is re-read before compensating;
  - crash tests: after backups verified before export, after the first export write with the pointer removed, pointer corrupted after export started, backup missing after export started.
- **C. Calendar order note corrected (Sections 1, 9, 11):** the `KalenderTab` legend is static and `expandOccurrences` already sorts by date, time and `occurrenceId`; the only stored-order display found by the source audit is the `WasteSettings` subtype label list; C6 visual and smoke parity are retained.

**Amendment 4** (baseline `5fb0f48dec567a933838991531837934258d2365`, independent fresh review AMEND):
- **A. Revert build with authority absent (Sections 1b, 3, 6c, 6d, 8, 10, 11):**
  - the forward hint matrix `absent` rows no longer apply to the revert build;
  - hint absent gives `LEGACY`; a valid or malformed hint gives the new blocking state `REVERT_STORAGE_LOST` (dated or undated), with zero writes until the user confirms; confirmation re-reads state, does a verified hint removal, then `LEGACY`; an unreadable hint or failed removal gives `STORAGE_UNAVAILABLE`;
  - replaces the amendment 3 wording that silently removed a non-null hint and entered `LEGACY`.
- **B. Attempt-id collision (Sections 1c, 3, 6b, 8, 10, 11):**
  - the three target backup keys are probed before "begin revert" and again before the first backup write; they must all be absent;
  - option 1 locked: bounded regeneration of at most 3 candidates, then `REVERT_FAILED`/`revert-attempt-id-collision` with status `active` and zero writes; an unreadable key gives `revert-backup-key-unreadable`;
  - no existing backup key is ever overwritten; `started` resume with any existing target key aborts before export instead of rewriting (replaces the amendment 3 same-`attemptId` rewrite);
  - deterministic `newId()` collision tests against an earlier verified set, partial-key, empty-id, read-failure and ordering cases.
