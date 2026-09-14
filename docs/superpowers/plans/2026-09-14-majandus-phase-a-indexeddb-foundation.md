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

Marker has saved generated IDs, migrated calendar IDs, migrated meta keys, and `migratedSingletonKeys`. A checks entity stores only and meta migration keys only; existing outboxSequence is valid. B rechecks matching prepared marker before complete. C rechecks prepared status, preparationId, and sourceDigest before deleting only marker-named records.

- [ ] **Step 1: RED cases and command**

```js
const [one,two]=await forcedOverlapBeforeTransactionA(pageRunMigration);
assert.equal(one.status,'completed');assert.equal(two.status,'concurrent-migration');
assert.deepEqual((await pageList('sharedPlaces')).map(x=>x.id),(await pageMeta('legacyMigrationV1')).generatedIds.sharedPlaces);
assert.equal((await pageRunMigration({storage:null})).status,'unreadable-source');
```

Run: `node --test scripts/storage/indexeddb-browser.test.mjs`

Expected: FAIL because migration executor is absent.

- [ ] **Step 2: Implement A, verify, B, C**

Read raw values, digest, inspect marker. Complete + changed digest returns source-changed-after-complete without parsing/writing; test mutates calendar to `{oops` after complete and snapshots marker/stores/localStorage unchanged. No marker validates/prepares then A. Matching prepared verifies, and on mismatch C cleans then rebuilds with saved IDs. Changed prepared validates/prepares current data before guarded C; invalid/unreadable does no cleanup. `reprepared` means new A/verify/B succeeded. B-fails-once leaves prepared and retry returns prepared-recovered with original IDs.

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
