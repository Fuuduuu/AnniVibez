import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShoppingDbHarness } from './db-test-helpers.mjs';

test('shopping v2 upgrade preserves every populated v1 store, pending calendar mutation, conflict and index across reload', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { openMajandusDb } = window.shoppingStorageApi;
      const { reset, createV1, snapshot } = window.shoppingDbFixtures;
      await reset();
      const oldDb = await createV1();
      const before = await snapshot(oldDb);
      oldDb.close();
      const db = await openMajandusDb();
      const after = await snapshot(db);
      db.close();
      return { before, after };
    })()`);
    assert.equal(result.before.version, 1, 'fixture is genuinely v1');
    assert.equal(result.after.version, 2, 'accepted database advances to v2');
    assert.equal(Object.keys(result.before.stores).length, 9);
    assert.deepEqual(Object.keys(result.after.stores).sort(), [...Object.keys(result.before.stores), 'shoppingItems'].sort());
    for (const [name, original] of Object.entries(result.before.stores)) {
      assert.ok(original.records.length > 0, `${name} preservation fixture must be populated`);
      assert.deepEqual(result.after.stores[name], original, `${name} records and index definitions are unchanged`);
    }
    assert.deepEqual(result.after.stores.outbox.indexes, { bySequence: { keyPath: 'sequence', unique: true, multiEntry: false } });
    assert.equal(result.after.stores.outbox.records[0].entityType, 'calendar_event');
    assert.equal(result.after.stores.calendarEvents.records.find(record => record.id === 'calendar-pending').syncStatus, 'pending');
    assert.equal(result.after.stores.conflicts.records[0].id, 'calendar-conflict');
    assert.deepEqual(result.after.stores.shoppingItems, { keyPath: 'id', autoIncrement: false, indexes: {}, records: [] });
    await harness.reload();
    const reloaded = await harness.evaluate(`(async () => {
      const db = await window.shoppingStorageApi.openMajandusDb();
      const snapshot = await window.shoppingDbFixtures.snapshot(db);
      db.close();
      return snapshot;
    })()`);
    assert.deepEqual(reloaded, result.after, 'reload preserves all upgraded stores');
  } finally {
    await harness.cleanup();
  }
});

test('fresh shopping v2 database has the ten exact stores and keeps the unique outbox sequence constraint', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, DB_VERSION, STORE_NAMES, openMajandusDb, runTransaction, requestResult } = window.shoppingStorageApi;
      const { reset, snapshot, records } = window.shoppingDbFixtures;
      await reset();
      const db = await openMajandusDb();
      const fresh = await snapshot(db);
      await runTransaction(db, 'outbox', 'readwrite', ({ stores }) => requestResult(stores.outbox.add(records.outbox[0])));
      let duplicateError;
      try {
        await runTransaction(db, 'outbox', 'readwrite', ({ stores }) => requestResult(stores.outbox.add({ ...records.outbox[0], mutationId: 'duplicate-sequence' })));
      } catch (error) { duplicateError = error.name; }
      const after = await snapshot(db);
      db.close();
      return { DB_NAME, DB_VERSION, STORE_NAMES, fresh, duplicateError, outbox: after.stores.outbox.records };
    })()`);
    const keyPaths = {
      meta: 'key', auth: 'key', householdProfile: 'key', calendarEvents: 'id', sharedPlaces: 'id',
      wasteState: 'key', outbox: 'mutationId', syncState: 'key', conflicts: 'id', shoppingItems: 'id',
    };
    assert.equal(result.DB_NAME, 'majandus_local_v1');
    assert.equal(result.DB_VERSION, 2);
    assert.deepEqual(result.STORE_NAMES, Object.keys(keyPaths));
    assert.equal(result.fresh.version, 2);
    assert.deepEqual(Object.keys(result.fresh.stores).sort(), Object.keys(keyPaths).sort());
    for (const [name, keyPath] of Object.entries(keyPaths)) {
      assert.deepEqual(result.fresh.stores[name], {
        keyPath, autoIncrement: false, records: [],
        indexes: name === 'outbox' ? { bySequence: { keyPath: 'sequence', unique: true, multiEntry: false } } : {},
      }, `${name} fresh schema`);
    }
    assert.equal(result.duplicateError, 'ConstraintError');
    assert.equal(result.outbox.length, 1, 'duplicate insertion did not alter the original pending mutation');
    assert.equal(result.outbox[0].mutationId, 'pending-calendar-mutation');
  } finally {
    await harness.cleanup();
  }
});

test('a v1 connection blocks shopping upgrade, rejects the caller and closes the eventual v2 handle', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, openMajandusDb } = window.shoppingStorageApi;
      const { reset, createV1, snapshot, request } = window.shoppingDbFixtures;
      await reset();
      const oldDb = await createV1();
      const before = await snapshot(oldDb);
      const events = [];
      oldDb.onversionchange = event => events.push({ oldVersion: event.oldVersion, newVersion: event.newVersion });
      let lateDb;
      let finishLate;
      const late = new Promise(resolve => { finishLate = resolve; });
      const observedFactory = { open(name, version) {
        const operation = indexedDB.open(name, version);
        operation.addEventListener('success', () => { lateDb = operation.result; finishLate(); });
        return operation;
      } };
      let errorName;
      let callerResolved = false;
      try { await openMajandusDb(observedFactory); callerResolved = true; }
      catch (error) { errorName = error.name; }
      const whileBlocked = await snapshot(oldDb);
      oldDb.close();
      await late;
      await new Promise(resolve => setTimeout(resolve, 0));
      let lateHandleError;
      try { lateDb.transaction('shoppingItems', 'readonly'); }
      catch (error) { lateHandleError = error.name; }
      const db = await openMajandusDb();
      const after = await snapshot(db);
      db.close();
      const future = await request(indexedDB.open(DB_NAME, 3));
      future.close();
      return { before, whileBlocked, after, events, errorName, callerResolved, lateHandleError };
    })()`);
    assert.equal(result.errorName, 'IndexedDbBlockedError');
    assert.equal(result.callerResolved, false);
    assert.deepEqual(result.events, [{ oldVersion: 1, newVersion: 2 }]);
    assert.deepEqual(result.whileBlocked, result.before, 'blocked upgrade has not changed v1');
    assert.equal(result.lateHandleError, 'InvalidStateError', 'late successful handle was closed');
    assert.equal(result.after.version, 2);
    for (const [name, original] of Object.entries(result.before.stores)) assert.deepEqual(result.after.stores[name], original);
    assert.deepEqual(result.after.stores.shoppingItems.records, []);
  } finally {
    await harness.cleanup();
  }
});

test('aborting the real shopping upgrade preserves the v1 version, every record and every index for retry', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, openMajandusDb } = window.shoppingStorageApi;
      const { reset, createV1, snapshot, request } = window.shoppingDbFixtures;
      await reset();
      const original = await createV1();
      const before = await snapshot(original);
      original.close();
      let createdBeforeAbort = false;
      let newVersion;
      const abortingFactory = { open(name, version) {
        const operation = indexedDB.open(name, version);
        // Abort after the production upgrade handler, in that handler's real active transaction.
        Object.defineProperty(operation, 'onupgradeneeded', {
          set(handler) {
            operation.addEventListener('upgradeneeded', event => {
              handler(event);
              newVersion = event.newVersion;
              createdBeforeAbort = operation.result.objectStoreNames.contains('shoppingItems');
              operation.transaction.abort();
            });
          },
        });
        return operation;
      } };
      let errorName;
      let callerResolved = false;
      try { await openMajandusDb(abortingFactory); callerResolved = true; }
      catch (error) { errorName = error.name; }
      const oldDb = await request(indexedDB.open(DB_NAME, 1));
      const afterAbort = await snapshot(oldDb);
      oldDb.close();
      const db = await openMajandusDb();
      const afterRetry = await snapshot(db);
      db.close();
      return { before, afterAbort, afterRetry, createdBeforeAbort, newVersion, errorName, callerResolved };
    })()`);
    assert.equal(result.newVersion, 2);
    assert.equal(result.createdBeforeAbort, true, 'abort occurs after the production upgrade created shoppingItems');
    assert.equal(result.errorName, 'AbortError');
    assert.equal(result.callerResolved, false);
    assert.deepEqual(result.afterAbort, result.before, 'aborted upgrade restores exactly v1 data and indexes');
    assert.equal(result.afterRetry.version, 2);
    for (const [name, original] of Object.entries(result.before.stores)) assert.deepEqual(result.afterRetry.stores[name], original);
    assert.deepEqual(result.afterRetry.stores.shoppingItems.records, []);
  } finally {
    await harness.cleanup();
  }
});

test('an already newer database fails closed without deletion, downgrade or schema repair', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, openMajandusDb } = window.shoppingStorageApi;
      const { reset, createV1, snapshot, request, completed } = window.shoppingDbFixtures;
      await reset();
      const oldDb = await createV1();
      oldDb.close();
      const operation = indexedDB.open(DB_NAME, 3);
      operation.onupgradeneeded = () => operation.result.createObjectStore('futureOnly', { keyPath: 'key' });
      const futureDb = await request(operation);
      const transaction = futureDb.transaction('futureOnly', 'readwrite');
      const done = completed(transaction);
      transaction.objectStore('futureOnly').put({ key: 'future-sentinel', nested: { keep: ['newer format'] } });
      await done;
      const before = await snapshot(futureDb);
      futureDb.close();
      let errorName;
      let callerResolved = false;
      try { await openMajandusDb(); callerResolved = true; }
      catch (error) { errorName = error.name; }
      const verified = await request(indexedDB.open(DB_NAME, 3));
      const after = await snapshot(verified);
      verified.close();
      return { before, after, errorName, callerResolved };
    })()`);
    assert.equal(result.errorName, 'VersionError');
    assert.equal(result.callerResolved, false);
    assert.equal(result.after.version, 3);
    assert.deepEqual(result.after, result.before);
  } finally {
    await harness.cleanup();
  }
});

test('shopping replica access persists complete envelopes in canonical id order while keeping every previous domain unchanged', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { createLocalReplica } = window.shoppingStorageApi;
      const { reset, createV1, snapshot, envelope, stamp } = window.shoppingDbFixtures;
      await reset();
      const original = await createV1();
      const before = await snapshot(original);
      original.close();
      const replica = createLocalReplica();
      const db = await replica.open();
      const empty = await replica.listShoppingItems();
      const missing = await replica.getShoppingItem('missing');
      const items = [
        envelope({ id: 'item-a' }, { name: 'Piim', quantityText: '2 l', completed: false, nested: { keep: [null, 'õ'] } }, 0, 'local'),
        envelope({ id: 'item-Z' }, { name: 'Leib', quantityText: '', completed: true }, 4, 'synced'),
        envelope({ id: 'item-b' }, { name: 'Juust', quantityText: '1 pakk', completed: false }, 2, 'pending', stamp),
      ];
      const saved = [];
      for (const item of items) saved.push(await replica.putShoppingItem(item));
      const listed = await replica.listShoppingItems();
      const single = await replica.getShoppingItem('item-a');
      const after = await snapshot(db);
      await replica.close();
      return { before, after, empty, missing: missing ?? null, saved, listed, single };
    })()`);
    assert.deepEqual(result.empty, []);
    assert.equal(result.missing, null);
    assert.deepEqual(result.listed.map(record => record.id), ['item-Z', 'item-a', 'item-b']);
    assert.deepEqual(result.single, result.saved[0]);
    assert.deepEqual(result.listed, [result.saved[1], result.saved[0], result.saved[2]], 'all envelope fields and tombstones are returned');
    for (const [name, original] of Object.entries(result.before.stores)) assert.deepEqual(result.after.stores[name], original, `${name} stayed unchanged`);
    await harness.reload();
    const persisted = await harness.evaluate(`(async () => {
      const replica = window.shoppingStorageApi.createLocalReplica();
      const listed = await replica.listShoppingItems();
      await replica.close();
      return listed;
    })()`);
    assert.deepEqual(persisted, result.listed);
  } finally {
    await harness.cleanup();
  }
});

test('shopping replica rejects malformed envelopes and preserves the previous acknowledged record and all other stores', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { createLocalReplica, validateShoppingItemRecord } = window.shoppingStorageApi;
      const { reset, createV1, snapshot, envelope, stamp } = window.shoppingDbFixtures;
      await reset();
      const original = await createV1();
      original.close();
      const replica = createLocalReplica();
      const valid = envelope({ id: 'item-kept' }, { name: 'Alles jääv ost', quantityText: '', completed: false }, 0, 'local');
      const returnedSame = validateShoppingItemRecord(valid) === valid;
      await replica.putShoppingItem(valid);
      const db = await replica.open();
      const before = await snapshot(db);
      const invalid = [
        ['null record', null], ['array record', []],
        ['absent id', { ...valid, id: undefined }], ['empty id', { ...valid, id: '' }], ['numeric id', { ...valid, id: 1 }],
        ['null payload', { ...valid, payload: null }], ['array payload', { ...valid, payload: [] }],
        ['negative revision', { ...valid, revision: -1 }], ['fractional revision', { ...valid, revision: 1.5 }],
        ['local server revision', { ...valid, revision: 1 }], ['synced without server revision', { ...valid, syncStatus: 'synced' }],
        ['unknown sync status', { ...valid, syncStatus: 'queued' }],
        ['invalid updatedAt', { ...valid, updatedAt: '2026-02-30T10:00:00Z' }],
        ['absent deletedAt', { ...valid, deletedAt: undefined }], ['invalid deletedAt', { ...valid, deletedAt: 'yesterday' }],
      ];
      const rejected = [];
      for (const [name, candidate] of invalid) {
        try { await replica.putShoppingItem(candidate); rejected.push({ name, error: null }); }
        catch (error) { rejected.push({ name, error: error.name }); }
      }
      const after = await snapshot(db);
      const stillSaved = await replica.getShoppingItem(valid.id);
      const acceptedStates = [
        envelope({ id: 'local' }, {}, 0, 'local'), envelope({ id: 'pending' }, {}, 0, 'pending'),
        envelope({ id: 'conflict' }, {}, 4, 'conflict'), envelope({ id: 'synced' }, {}, 7, 'synced', stamp),
      ].map(record => validateShoppingItemRecord(record) === record);
      await replica.close();
      return { returnedSame, before, after, rejected, valid, stillSaved, acceptedStates };
    })()`);
    assert.equal(result.returnedSame, true);
    assert.equal(result.rejected.length, 15);
    for (const entry of result.rejected) assert.equal(entry.error, 'TypeError', entry.name);
    assert.deepEqual(result.acceptedStates, [true, true, true, true]);
    assert.deepEqual(result.after, result.before, 'validation failures do not issue durable writes');
    assert.deepEqual(result.stillSaved, result.valid);
  } finally {
    await harness.cleanup();
  }
});

test('shopping versionchange closes the v2 handle before notification and stops reads and writes after connection loss', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createShoppingDbHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, createLocalReplica } = window.shoppingStorageApi;
      const { reset, snapshot, envelope, request } = window.shoppingDbFixtures;
      await reset();
      const replica = createLocalReplica();
      const kept = envelope({ id: 'item-kept' }, { name: 'Alles jääv ost', completed: false }, 0, 'local');
      await replica.putShoppingItem(kept);
      const db = await replica.open();
      const before = await snapshot(db);
      const events = [];
      let listenerHandleError;
      replica.subscribe(event => {
        events.push(event);
        try { db.transaction('shoppingItems', 'readonly'); }
        catch (error) { listenerHandleError = error.name; }
      });
      const future = await request(indexedDB.open(DB_NAME, 3));
      let readError;
      let writeError;
      try { await replica.listShoppingItems(); } catch (error) { readError = error.name; }
      try { await replica.putShoppingItem({ ...kept, payload: { name: 'Must not persist' } }); }
      catch (error) { writeError = error.name; }
      const after = await snapshot(future);
      future.close();
      await replica.close();
      let reopenError;
      try { await replica.open(); } catch (error) { reopenError = error.name; }
      await replica.close();
      const replacement = createLocalReplica();
      let replacementError;
      try { await replacement.open(); } catch (error) { replacementError = error.name; }
      await replacement.close();
      return { before, after, events, listenerHandleError, readError, writeError, reopenError, replacementError };
    })()`);
    assert.deepEqual(result.events, [{ type: 'versionchange', oldVersion: 2, newVersion: 3 }]);
    assert.equal(result.listenerHandleError, 'InvalidStateError', 'handle is already closed when subscriber is notified');
    assert.equal(result.readError, 'ReplicaConnectionLostError');
    assert.equal(result.writeError, 'ReplicaConnectionLostError');
    assert.equal(result.reopenError, 'ReplicaConnectionLostError', 'close does not recover a terminally lost replica');
    assert.equal(result.replacementError, 'VersionError', 'a new replica also fails closed against the newer schema');
    assert.equal(result.after.version, 3);
    assert.deepEqual(result.after.stores, result.before.stores, 'connection loss preserved every acknowledged record');
  } finally {
    await harness.cleanup();
  }
});
