# Majandus Phase A IndexedDB Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested native IndexedDB foundation and non-destructive legacy migration without changing current runtime behavior.

**Architecture:** Phase A is dormant. Existing React and synchronous localStorage repositories remain the only production runtime path. Native IndexedDB holds a verified local copy only; there is no D1, network, sync, auth, dual-write, startup migration, or dependency addition.

**Tech Stack:** React 18, native IndexedDB, Web Crypto SHA-256, Node test runner, existing Chromium/CDP harness.

**Spec:** `docs/COMMON_BACKEND_ARCHITECTURE_V1.md`

## Global Constraints

- Database `majandus_local_v1`, version `1`; stores `meta`, `auth`, `householdProfile`, `calendarEvents`, `sharedPlaces`, `wasteState`, `outbox`, `syncState`, `conflicts`.
- Production migration reads only `majamajandus_household_events_v1`, `majamajandus_household_profile_v1`, `sade_saved_places`, in that order; it never enumerates localStorage.
- It never reads/writes/digests reminder, diary, saved-idea, saved-tip, or `sade_profile` keys. Tests alone own private-key lists.
- `ABSENT` is `getItem(key) === null`; null/undefined storage or thrown approved `getItem` is `UNREADABLE`, returning `unreadable-source` with no records/marker and unchanged legacy storage.
- Malformed available source is `invalid-source`, with no records/marker. All absent sources complete with zero entities and complete marker.
- Calendar IDs remain. Shared places have UUID IDs and `order` equal legacy index; order is not identity.
- Singleton records are `{key:'household',serverHouseholdId:null,...}` and `{key:'waste',...}`. Household exists only for present valid household source; waste only for present calendar source with defined `wasteImports`.
- Migrated records use `revision:0`, `syncStatus:'local'`, `deletedAt:null`; `local` has no upload/outbox. Only future approved sync can transition `local -> pending -> synced|conflict`.

## Task 1: Schema, primitive, and Chromium harness

**Files:** Create `src/storage/schema.js`, `src/storage/indexedDb.js`, `scripts/storage/indexeddb-browser.test.mjs`.

**Interfaces:** `DB_NAME`, `DB_VERSION`, `STORE_NAMES`, `upgradeSchema(db,oldVersion,transaction)`, `openMajandusDb(indexedDb=globalThis.indexedDB)`, `closeDb(db)`, `requestResult(request)`, `runTransaction(db,storeNames,mode,body)`, `pageReload()`, `get(db,store,key)`, `manualAbortProbe(db)`.

Task 1 defines a fresh `mkdtempSync` Chromium profile, `--remote-debugging-port=0`, `waitForBrowserEndpoint`, CDP WebSocket, `Runtime.evaluate` with `awaitPromise`, `Page.reload`, esbuild in-memory fixture, and a `node:http` server on `127.0.0.1`. Fail when Chromium is unavailable. Delete `majandus_local_v1` before each case. `onblocked` rejects named `IndexedDbBlockedError`, closes late `onsuccess` result, and has an injected-IDB stub test. Browser versionchange/delete is separate.

`body` receives `{transaction,stores}`. `runTransaction` resolves only at `oncomplete`; rejection is `transaction.error ?? bodyError ?? new DOMException('Transaction aborted','AbortError')`. Request success never means commit. The body awaits only transaction-request promises; locks, crypto, timers, parsing, and storage reads occur before it.

- [ ] **Step 1: Write RED tests**

```js
await runTransaction(db,['meta','auth'],'readwrite',({stores})=>{
  stores.meta.put({key:'a',value:1}); stores.auth.put({key:'b',value:2});
});
closeDb(db); await pageReload(); const reopened=await openMajandusDb();
assert.deepEqual(await get(reopened,'meta','a'),{key:'a',value:1});
assert.deepEqual(await get(reopened,'auth','b'),{key:'b',value:2});
let aSucceeded=false,bSucceeded=false;
await assert.rejects(runTransaction(db,['meta','auth'],'readwrite',async({transaction,stores})=>{
  await requestResult(stores.meta.put({key:'abort-a',value:1})); aSucceeded=true;
  await requestResult(stores.auth.put({key:'abort-b',value:2})); bSucceeded=true;
  transaction.abort();
}),error=>error?.name==='AbortError');
assert.equal(aSucceeded,true);assert.equal(bSucceeded,true);
closeDb(db);await pageReload();assert.equal(await get(await openMajandusDb(),'meta','abort-a'),undefined);
assert.equal(await get(await openMajandusDb(),'auth','abort-b'),undefined);
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement schema and primitive**

Create key paths: `meta/auth/syncState` use `key`; `householdProfile/wasteState` use `key`; calendar/shared places/conflicts use `id`; outbox uses `mutationId` and unique `bySequence`. Create only at `oldVersion < 1`.

- [ ] **Step 4: Add real atomicity/lifecycle tests**

Test duplicate `add` after prior `put` rolls back both; test versionchange closes handles and deletion completes. The injected blocked test proves late successful open closes the result.

- [ ] **Step 5: GREEN and checkpoint**

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Commit: `feat: add native IndexedDB foundation`

**STOP:** Browser evidence proves real IndexedDB, successful pre-abort requests, rollback, reload persistence, and lifecycle.

## Task 2: Replica contracts, validators, singleton access, ordered outbox

**Files:** Create `src/storage/localReplica.js`; modify `scripts/storage/indexeddb-browser.test.mjs`.

**Interfaces:** Export `validateHouseholdProfileRecord`, `validateCalendarEventRecord`, `validateSharedPlaceRecord`, `validateWasteStateRecord`, `validateOutboxRecord`, and `createLocalReplica({indexedDb,clock})`. Replica returns `open`, `close`, `transact`, singleton get/put, calendar get/put, shared-place list/put, meta get/put, `enqueueOutbox`, `listOutboxBySequence`.

Validators require `local => revision===0`, `synced => revision>=1`, and pending/conflict nonnegative integer revision; timestamps are ISO, deletedAt null/ISO. Household key is exactly `household`, waste key exactly `waste`. Shared place has `{id,order,payload,...}`; list sorts `order`, then ID. Outbox counter is `{key:'outboxSequence',value:integer}` in the same meta/outbox transaction. CREATE uses baseRevision 0; UPDATE/DELETE positive revision.

- [ ] **Step 1: Write RED tests**

```js
await replica.enqueueOutbox(item('z-create','CREATE',0));
await replica.enqueueOutbox(item('a-update','UPDATE',1));
assert.deepEqual((await replica.listOutboxBySequence()).map(x=>x.mutationId),['z-create','a-update']);
assert.deepEqual((await replica.listOutboxBySequence()).map(x=>x.sequence),[1,2]);
await replica.putSharedPlace({id:'z',order:0,payload:{},revision:0,updatedAt:stamp,deletedAt:null,syncStatus:'local'});
await replica.putSharedPlace({id:'a',order:1,payload:{},revision:0,updatedAt:stamp,deletedAt:null,syncStatus:'local'});
assert.deepEqual((await replica.listSharedPlaces()).map(x=>x.id),['z','a']);
```

- [ ] **Step 2: RED command**

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Expected: FAIL because replica is absent.

- [ ] **Step 3: Minimal implementation and GREEN**

`replica.transact(storeNames,mode,body)` delegates to Task 1 exact transaction contract. No React/localStorage/network imports.

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Commit: `feat: add local replica storage contracts`

**STOP:** Task 3 consumes exported validators without changing Task 2.

## Task 3: Three-key validation, transformation, digest

**Files:** Create `src/storage/legacyMigration.js`, `scripts/storage/storage.test.mjs`.

**Interfaces:** `LEGACY_SHARED_KEYS`, `readLegacySources(storage)`, `validateLegacySources(sources)`, `sourceDigest(sources,cryptoApi)`, `prepareLegacyMigration({validated,newId,now,preparationId,savedIds})`, `verifyReplica({expected,actual})`.

### Task 3 return contracts

`readLegacySources(storage)` returns `{status:'readable',raw:{calendar,household,places}}`, where each raw value is the exact string or `null` read in `LEGACY_SHARED_KEYS` order. `null`/`undefined` storage or any approved read failure returns `{status:'unreadable-source',raw:null}`; no partial snapshot is returned. Empty and malformed strings are present data.

`validateLegacySources(sources)` accepts that result and returns `{status:'unreadable-source'}`, `{status:'invalid-source',source:'calendar'|'household'|'places'}` (the first invalid source in key order), or `{status:'valid',raw,parsed:{calendar,household,places},data:{calendarEvents,wasteImports,householdProfile,sharedPlaces}}`. Parsed values are raw parsed sources. Calendar IDs are retained; `wasteImports` is defined only for a present calendar envelope that defines it; absent household maps to `householdProfile:null`; places are normalized but never padded; validation mints no IDs.

`prepareLegacyMigration({validated,newId,now,preparationId,savedIds})` requires `validated.status === 'valid'` or throws `TypeError`. `now` is a zero-argument function called exactly once, whose ISO result is used for every record. Absent `savedIds` generates one ID per actual shared place. Present `savedIds.sharedPlaces` must be an array of non-empty strings whose length exactly matches the place count; all are reused or the function throws. It returns exactly:

```js
{ preparationId, generatedIds:{sharedPlaces:Array<string>}, replica:{householdProfile,calendarEvents,sharedPlaces,wasteState,meta,outbox:[]} }
```

`generatedIds.sharedPlaces` is the exact IDs used, in legacy order, including reused IDs. Household is `null` when absent, otherwise `{key:'household',payload:{...householdProfile,serverHouseholdId:null},revision:0,updatedAt:stamp,deletedAt:null,syncStatus:'local'}`. Calendar records retain legacy IDs and use the legacy event as payload. Shared places use `{id,order,payload,revision:0,updatedAt:stamp,deletedAt:null,syncStatus:'local'}`. Waste is `null` unless calendar is present and `wasteImports !== undefined`; otherwise it is the fixed `waste` singleton with payload `{wasteImports}`. All domain records pass their Task 2 validators.

`replica.meta` contains calendar extras only for a present calendar source as `{key:'calendarLegacyEnvelopeExtras',value:{sourceVersion,fields}}`, excluding raw `version`, `events`, and `wasteImports`; household extras are equivalent with key `householdLegacyEnvelopeExtras`, excluding `version` and `profile`. Present envelopes with no extras use `fields:{}`. Digest remains separate and is not in preparation.

`verifyReplica({expected,actual})` returns `true` for semantically identical replica structures and `false` for any structural/data mismatch; invalid arguments may throw `TypeError`. It is pure. Only collection ordering is canonicalized: calendar by `id`, places by `order` then `id`, meta by `key`, and outbox by `sequence`; singleton values compare exactly.

Use read-only snapshot adapters with current `createEventRepository` and `createHouseholdRepository`; adapters allow one approved read and throw on write/enumeration/other key. Validate every prepared record with Task-2 exported validators before transaction A. Places match current normalization, do not pad, and golden parity includes null, number, string, invalid coordinates, blank name, missing address, short arrays. Household invalid parity includes version 2, null profile, and name length over 100.

Raw parsed extras only: calendar `{key:'calendarLegacyEnvelopeExtras',value:{sourceVersion,fields}}` excludes version/events/wasteImports; household equivalent excludes version/profile. Present zero-extras source uses `fields:{}`; absent source has no extras. Digest is Web Crypto SHA-256 hex over `JSON.stringify([rawCalendarOrNull,rawHouseholdOrNull,rawPlacesOrNull])`.

- [ ] **Step 1: RED test and command**

```js
assert.equal(readLegacySources(null).status,'unreadable-source');
assert.equal(readLegacySources(undefined).status,'unreadable-source');
assert.deepEqual(approvedOnlyStorage(raw).requests,LEGACY_SHARED_KEYS);
```

Run: `node --test scripts/storage/storage.test.mjs`

Expected: FAIL because migration module is absent.

- [ ] **Step 2: GREEN and checkpoint**

Run: `node --test scripts/storage/storage.test.mjs`

Commit: `feat: prepare non-destructive legacy migration`

**STOP:** Production migration contains only three shared-key strings; no IDs are minted during validation.

## Task 4: Migration state machine

**Files:** Modify migration module and both storage tests.

**Interfaces:** `runLegacyMigration({replica,storage,cryptoApi,newId,newPreparationId,now,locks})` returns `completed`, `already-complete`, `source-changed-after-complete`, `prepared-recovered`, `reprepared`, `invalid-source`, `unreadable-source`, `replica-not-empty`, `concurrent-migration`, `verification-failed`, or `write-failed`, always with `legacyMutated:false`. `newPreparationId` is injectable.

### Task 4 migration contracts

These contracts are authoritative for Task 4.

**A. Durable marker.** Store `meta`, key `legacyMigrationV1`, exact key set:

```js
{ key:'legacyMigrationV1', status:'prepared'|'complete', preparationId, sourceDigest, preparedAt,
  generatedIds:{sharedPlaces:string[]}, migratedCalendarIds:string[],
  migratedMetaKeys:('calendarLegacyEnvelopeExtras'|'householdLegacyEnvelopeExtras')[],
  migratedSingletonKeys:('household'|'waste')[] }
```

Validation: `status` is exactly `prepared` or `complete`; `preparationId` is a non-empty string; `sourceDigest` is exactly 64 lowercase hex characters; `preparedAt` is a strict calendar-valid ISO timestamp; `generatedIds.sharedPlaces` and `migratedCalendarIds` are arrays of unique non-empty strings in legacy order; `migratedMetaKeys` contains only the two extras keys and `migratedSingletonKeys` only `household`/`waste`, each unique. The marker's own key is never in `migratedMetaKeys`. `preparedAt` is the only marker timestamp (no `completedAt`); it is the single preparation timestamp, equals every prepared record's `updatedAt`, and Task 4 validates it itself before any marker write, including a clean install with zero domain records. An existing `legacyMigrationV1` that fails this validation, or a prepared marker whose saved shared-place IDs cannot be reused for its same-digest source, returns `replica-not-empty` with no source parsing, migration writes, cleanup or repair.

**B. Flow.** Read the approved raw sources; unreadable returns `unreadable-source`. Otherwise compute `sourceDigest`, then read and validate the marker. Legacy-domain parsing and validation happen only where a branch below requires them.

- Complete marker: same digest returns `already-complete`; a different digest returns `source-changed-after-complete` before parsing or validating the changed source, even if it is malformed (for example calendar `{oops`). Neither parses, validates, generates IDs, writes or cleans up; marker, IndexedDB records, legacy storage and outbox are unchanged.
- No marker: validate (`invalid-source` on failure); prepare with fresh `newPreparationId()`, fresh `now()` and `newId` where Task 3 requires IDs; run transaction A.
- Transaction A (one readwrite transaction): re-read the marker, which returns `concurrent-migration` if it now exists; any record in `householdProfile`, `calendarEvents`, `sharedPlaces` or `wasteState`, or an existing `calendarLegacyEnvelopeExtras` / `householdLegacyEnvelopeExtras`, returns `replica-not-empty` with no cleanup. `meta/outboxSequence`, other non-migration meta, `auth` and `syncState` are allowed and preserved. Otherwise write all prepared domain records, extras records and the prepared marker together, with zero outbox mutations.
- Verify after A reads only marker-owned records: singletons named by `migratedSingletonKeys`, calendar IDs from `migratedCalendarIds`, shared places from `generatedIds.sharedPlaces`, meta from `migratedMetaKeys`. Never whole-store equality; unrelated records do not fail verification. Compare with the expected Task 3 replica via `verifyReplica`; a mismatch returns `verification-failed` and leaves the marker prepared. An IndexedDB read, request or transaction failure returns `write-failed`.
- Transaction B re-reads the marker and requires `status === 'prepared'` and exact equality of `preparationId`, `sourceDigest`, `generatedIds.sharedPlaces`, `migratedCalendarIds`, `migratedMetaKeys` and `migratedSingletonKeys`; otherwise it returns `concurrent-migration` with no write. On match it changes only `status` to `complete`.
- Prepared marker, same digest: rebuild the expected preparation from the current source with `marker.preparationId`, `marker.preparedAt` and `marker.generatedIds.sharedPlaces`, without calling `newId`, `newPreparationId` or `now`. A source that no longer validates returns `invalid-source` with no cleanup. If marker-owned data verifies, run B and return `prepared-recovered`; on mismatch, run C+A reusing the same `preparationId`, `preparedAt` and shared-place IDs, then verify and B, returning `prepared-recovered`. No replacement place IDs are minted.
- Prepared marker, changed digest: first validate and prepare the current source with fresh `newPreparationId()`, fresh `now()` and fresh `newId` place IDs. Old shared-place IDs are never reused across a changed source, because legacy array positions may now describe different places. An invalid current source returns `invalid-source` and leaves the old preparation untouched. Only a valid new preparation runs C+A, verify and B, returning `reprepared`.
- C+A (one readwrite transaction; cleanup is never committed separately): re-read the marker and require `status === 'prepared'` with the observed old `preparationId` and `sourceDigest`, otherwise abort with `concurrent-migration`. Delete only the records named by the old marker (`generatedIds.sharedPlaces`, `migratedCalendarIds`, `migratedMetaKeys`, `migratedSingletonKeys`); never `clear()`, broad-delete or touch unrelated records. Still in that transaction, apply the transaction-A target-space rule: any remaining entity record or extras-key collision aborts the whole transaction with `replica-not-empty`, leaving the old preparation, old marker and unrelated records intact. Otherwise write the new prepared state and replace the marker in the same transaction.

Status mapping: fresh success `completed`; complete plus same digest `already-complete`; complete plus changed digest `source-changed-after-complete`; prepared same digest recovered with or without C+A `prepared-recovered`; prepared changed digest rebuilt `reprepared`; invalid current source `invalid-source`; unreadable current source `unreadable-source`; unsafe target space or unusable marker `replica-not-empty`; marker changed by another execution `concurrent-migration`; expected replica differs from marker-owned data `verification-failed`; IndexedDB open, request, transaction or read failure `write-failed`. Every result is exactly `{status, legacyMutated:false}` with no other public fields. Unexpected non-IndexedDB exceptions (contract or invariant violations) are thrown, never mapped to a status.

**C. Locks.** `locks` is optional, shaped `{request(name, callback)}` (Web Locks subset). When provided, `locks.request('majandus:legacy-migration', callback)` wraps the whole run; when omitted, the run executes directly. Task 4 production code never accesses `navigator.locks`. Correctness never depends on the lock: it comes from the marker re-checks in A, B and C+A; the lock is supplemental serialization only. The concurrency test omits `locks` or passes a pass-through, mechanically holds both executions just before transaction A, then releases both; exactly one returns `completed` and the other `concurrent-migration`, without random sleeps. A separate small test proves a supplied `locks.request` wraps a run.

**D. Unrelated records and failure injection.** An unrelated entity record inserted after an old preparation makes C+A return `replica-not-empty` and preserves the old preparation, old marker, unrelated record and legacy source. Unrelated non-migration meta, `auth` and `syncState` records, and `meta/outboxSequence`, survive a successful migration and a successful C+A. Failure injection (A, B, C+A or write failures) uses test-only replica/transaction wrappers; production code has no failure flags.

- [ ] **Step 1: RED cases and command**

```js
const [one,two]=await forcedOverlapBeforeTransactionA(pageRunMigration);
assert.deepEqual([one.status,two.status].sort(),['completed','concurrent-migration']);
assert.deepEqual((await pageList('sharedPlaces')).map(x=>x.id),(await pageMeta('legacyMigrationV1')).generatedIds.sharedPlaces);
assert.equal((await pageRunMigration({storage:null})).status,'unreadable-source');
```

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Expected: FAIL because migration executor is absent.

- [ ] **Step 2: Implement A, verify, B, C+A**

Implement exactly the Task 4 migration contracts above. Tests prove: complete marker plus calendar mutated to `{oops` returns `source-changed-after-complete` with marker, stores, outbox and localStorage snapshot unchanged; a matching prepared marker recovers with original IDs, using atomic C+A on mismatch; a changed prepared source validates and prepares before C+A and does no cleanup when invalid; `reprepared` means the new C+A, verify and B succeeded; B-fails-once leaves prepared and a retry returns `prepared-recovered` with original IDs.

- [ ] **Step 3: GREEN and checkpoint**

Run: `node --test scripts/storage/storage.test.mjs`

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Commit: `feat: harden IndexedDB migration recovery`

**STOP:** Each corrupt browser source case seeds other shared sources valid and proves zero records/marker; outbox count is zero after success.

## Task 5: Integration breadth only

**Files:** Modify both storage tests.

Task 5 uses Task 1 harness and Task 4 helpers unchanged; it introduces no harness, helper, alternative API, or duplicate atomicity test.

- [ ] **Step 1: Write new integration RED test**

```js
await pageSeedValidCalendarHouseholdPlacesAndPrivateSentinels();
const before=await pageCompleteLocalStorageSnapshot();
assert.equal((await pageRunMigration()).status,'completed');
await pageCloseReloadReopen();
assert.deepEqual(await pageCompleteLocalStorageSnapshot(),before);
assert.equal(await pageCount('outbox'),0);
assert.deepEqual((await pageList('sharedPlaces')).map(x=>x.order),[0,1,2]);
```

- [ ] **Step 2: RED command**

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Expected: FAIL until the complete integration assertion exists.

- [ ] **Step 3: GREEN and checkpoint**

Run: `node --test scripts/storage/storage.test.mjs`

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Commit: `test: cover IndexedDB migration safety`

**STOP:** Private sentinels occur in no record, marker, extras, or digest input.

## Task 6: Dormant guard and fail-fast regression

**Files:** Modify storage tests; storage modules only after proven contract failure.

Guard all `src/` outside storage against static default/named imports, side-effect imports, and `import('./storage/...')`; bundle metafile uses the same entry/build shape as `scripts/shell/app-shell.test.mjs` and must exclude `src/storage/`.

- [ ] **Step 1: Guard test**

```js
assert.doesNotMatch(source,/from\s+['"][^'"]*storage\//);
assert.doesNotMatch(source,/import\s*['"][^'"]*storage\//);
assert.doesNotMatch(source,/import\s*\(\s*['"][^'"]*storage\//);
```

- [ ] **Step 2: Run fail-fast verification**

```powershell
node --test scripts/calendar/events.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/calendar/calendar-ui.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/shell/app-shell.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/reminders/reminders.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/reminders/reminder-ui.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/reminders/native-notification.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/waste/waste.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/waste/waste-ui.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/storage/storage.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test scripts/storage/indexeddb-browser.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

- [ ] **Step 3: Checkpoint**

Run: `git diff -- src/App.jsx src/main.jsx src/calendar/eventRepository.js src/calendar/useHouseholdEvents.js src/waste/householdRepository.js src/waste/useHousehold.js src/hooks/useSavedPlaces.js`

Expected: no runtime diff; only `src/storage/*` and `scripts/storage/*` implementation files.

Commit: `feat: add IndexedDB migration foundation`

**STOP:** Human review of Phase-A diff and Chromium evidence is required before any runtime cutover, UI outbox, backend, or sync work.

## Execution Boundary

The next safe implementation pass is Task 1 only. No later task opens automatically.
