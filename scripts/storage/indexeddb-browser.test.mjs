import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = [
  process.env.STORAGE_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find(path => path && existsSync(path));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Page-side Task 4 helpers, reinstalled after every load/reload.
const PAGE_HELPERS = "window.__t = (() => {\n  const api = window.storageApi;\n  const legacy = api.legacy;\n  const KEYS = legacy.LEGACY_SHARED_KEYS;\n  const STAMP = '2026-09-16T10:00:00.000Z';\n  const MARKER_KEY = 'legacyMigrationV1';\n  const ALL_STORES = api.STORE_NAMES;\n  const counter = values => {\n    const fn = () => {\n      fn.calls += 1;\n      if (fn.calls > values.length) throw new Error('unexpected extra generator call');\n      return values[fn.calls - 1];\n    };\n    fn.calls = 0;\n    return fn;\n  };\n  const reset = async () => {\n    localStorage.clear();\n    const remove = indexedDB.deleteDatabase(api.DB_NAME);\n    await new Promise((resolve, reject) => {\n      remove.onsuccess = resolve;\n      remove.onerror = () => reject(remove.error);\n      remove.onblocked = () => reject(new Error('reset blocked'));\n    });\n  };\n  const seed = (sources = {}) => {\n    const values = [sources.calendar, sources.household, sources.places];\n    KEYS.forEach((key, index) => {\n      const value = values[index];\n      if (value === undefined || value === null) localStorage.removeItem(key);\n      else localStorage.setItem(key, value);\n    });\n  };\n  const snapshot = () => Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]);\n  const makeReplica = () => api.createLocalReplica({ indexedDb: indexedDB });\n  const withReplica = async body => {\n    const replica = makeReplica();\n    try { return await body(replica); } finally { await replica.close(); }\n  };\n  const dump = () => withReplica(replica => replica.transact(ALL_STORES, 'readonly', async ({ stores }) => {\n    const out = {};\n    for (const name of ALL_STORES) out[name] = await api.requestResult(stores[name].getAll());\n    return out;\n  }));\n  const put = (store, record) => withReplica(replica => replica.transact([store], 'readwrite', ({ stores }) => stores[store].put(record)));\n  const marker = async () => (await dump()).meta.find(record => record.key === MARKER_KEY) || null;\n  const owned = async () => {\n    const data = await dump();\n    return {\n      household: data.householdProfile.map(record => record.key),\n      calendar: data.calendarEvents.map(record => record.id).sort(),\n      places: data.sharedPlaces.slice().sort((left, right) => left.order - right.order).map(record => record.id),\n      waste: data.wasteState.map(record => record.key),\n      meta: data.meta.map(record => record.key).sort(),\n      outbox: data.outbox.length,\n    };\n  };\n  const run = async (options = {}) => {\n    const replica = options.replica || makeReplica();\n    const newId = options.newId || counter(options.ids || ['place-1', 'place-2', 'place-3', 'place-4']);\n    const newPreparationId = options.newPreparationId || counter(options.preparationIds || ['prep-1', 'prep-2']);\n    const now = options.now || (() => options.stamp || STAMP);\n    const storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : localStorage;\n    let result;\n    let thrown = null;\n    try {\n      result = await legacy.runLegacyMigration({\n        replica, storage, cryptoApi: crypto, newId, newPreparationId, now, locks: options.locks,\n      });\n    } catch (error) {\n      thrown = { name: error && error.name, message: error && error.message };\n    }\n    await replica.close();\n    return { result, thrown, newIdCalls: newId.calls, preparationIdCalls: newPreparationId.calls };\n  };\n  // Test-only wrapper: intercepts replica.transact so tests can fail or hold a specific phase.\n  const wrapReplica = (base, hook) => {\n    const wrapped = Object.create(null);\n    for (const key of Object.keys(base)) wrapped[key] = base[key];\n    let call = 0;\n    wrapped.transact = (names, mode, body) => {\n      call += 1;\n      return hook({ call, names: Array.isArray(names) ? names : [names], mode, proceed: () => base.transact(names, mode, body) });\n    };\n    return wrapped;\n  };\n  return { STAMP, MARKER_KEY, ALL_STORES, counter, reset, seed, snapshot, makeReplica, withReplica, dump, put, marker, owned, run, wrapReplica, legacy, api };\n})();\n'ready';\n";
let browserHarnessTail = Promise.resolve();

async function createBrowserHarness() {
  const previousHarness = browserHarnessTail;
  let releaseHarness;
  browserHarnessTail = new Promise(resolve => { releaseHarness = resolve; });
  await previousHarness;
  try {
  assert.ok(browser, 'Chromium is required; IndexedDB checks must not silently skip');
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    outfile: 'indexeddb-fixture.js',
    format: 'iife',
    platform: 'browser',
    stdin: {
      resolveDir: root,
      contents: `
        import { DB_NAME, DB_VERSION, STORE_NAMES, upgradeSchema } from './src/storage/schema.js';
        import { openMajandusDb, closeDb, requestResult, runTransaction } from './src/storage/indexedDb.js';
        import { validateHouseholdProfileRecord, validateCalendarEventRecord, validateSharedPlaceRecord, validateWasteStateRecord, validateOutboxRecord, createLocalReplica } from './src/storage/localReplica.js';
        import * as legacy from './src/storage/legacyMigration.js';
        window.storageApi = { DB_NAME, DB_VERSION, STORE_NAMES, upgradeSchema, openMajandusDb, closeDb, requestResult, runTransaction, validateHouseholdProfileRecord, validateCalendarEventRecord, validateSharedPlaceRecord, validateWasteStateRecord, validateOutboxRecord, createLocalReplica, legacy };
      `,
    },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  assert.ok(script, 'fixture bundle must contain JavaScript');
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(script);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'majamajandus-indexeddb-'));
  const child = spawn(browser, [
    '--headless=new',
    '--no-first-run',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const port = new URL(await waitForBrowserEndpoint(child)).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitForStorageApi = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate('Boolean(window.storageApi)')) {
        await evaluate(PAGE_HELPERS);
        return;
      }
      await pause(30);
    }
    assert.fail('storage fixture did not become ready');
  };
  const pageReload = async () => {
    await send('Page.reload');
    await waitForStorageApi();
  };
  const cleanup = async () => {
    try {
      await send('Browser.close').catch(() => child.kill());
      for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
      if (child.exitCode === null) {
        child.kill();
        for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
      }
      socket.close();
      await new Promise(resolve => server.close(resolve));
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } finally {
      releaseHarness();
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  await waitForStorageApi();
  return { evaluate, pageReload, cleanup };
  } catch (error) {
    releaseHarness();
    throw error;
  }
}

test('native IndexedDB schema and primitives preserve transaction atomicity across reloads', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const schema = await harness.evaluate(`(async () => {
      const { DB_NAME, DB_VERSION, STORE_NAMES, openMajandusDb, closeDb, requestResult, runTransaction } = window.storageApi;
      const remove = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); remove.onblocked = () => reject(new Error('reset blocked')); });
      const db = await openMajandusDb();
      const transaction = db.transaction(STORE_NAMES, 'readonly');
      const stores = Object.fromEntries(STORE_NAMES.map(name => [name, transaction.objectStore(name).keyPath]));
      const outbox = transaction.objectStore('outbox').index('bySequence');
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      await runTransaction(db, ['meta', 'auth'], 'readwrite', ({ stores }) => {
        stores.meta.put({ key: 'a', value: 1 });
        stores.auth.put({ key: 'b', value: 2 });
      });
      closeDb(db);
      return { DB_NAME, DB_VERSION, STORE_NAMES, stores, outbox: { keyPath: outbox.keyPath, unique: outbox.unique } };
    })()`);
    assert.equal(schema.DB_NAME, 'majandus_local_v1');
    assert.equal(schema.DB_VERSION, 1);
    assert.deepEqual(schema.STORE_NAMES, ['meta', 'auth', 'householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState', 'outbox', 'syncState', 'conflicts']);
    assert.deepEqual(schema.stores, {
      meta: 'key', auth: 'key', householdProfile: 'key', calendarEvents: 'id', sharedPlaces: 'id',
      wasteState: 'key', outbox: 'mutationId', syncState: 'key', conflicts: 'id',
    });
    assert.deepEqual(schema.outbox, { keyPath: 'sequence', unique: true });
    await harness.pageReload();
    const persisted = await harness.evaluate(`(async () => {
      const { openMajandusDb, closeDb, requestResult } = window.storageApi;
      const db = await openMajandusDb();
      const transaction = db.transaction(['meta', 'auth'], 'readonly');
      const meta = await requestResult(transaction.objectStore('meta').get('a'));
      const auth = await requestResult(transaction.objectStore('auth').get('b'));
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      closeDb(db);
      return { meta, auth };
    })()`);
    assert.deepEqual(persisted, { meta: { key: 'a', value: 1 }, auth: { key: 'b', value: 2 } });
  } finally {
    await harness.cleanup();
  }
});

test('native IndexedDB rolls back successful requests after a manual abort', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, openMajandusDb, closeDb, requestResult, runTransaction } = window.storageApi;
      const remove = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); remove.onblocked = () => reject(new Error('reset blocked')); });
      const db = await openMajandusDb();
      let aSucceeded = false;
      let bSucceeded = false;
      let errorName = null;
      try {
        await runTransaction(db, ['meta', 'auth'], 'readwrite', async ({ transaction, stores }) => {
          await requestResult(stores.meta.put({ key: 'abort-a', value: 1 }));
          aSucceeded = true;
          await requestResult(stores.auth.put({ key: 'abort-b', value: 2 }));
          bSucceeded = true;
          transaction.abort();
        });
      } catch (error) {
        errorName = error.name;
      }
      closeDb(db);
      return { aSucceeded, bSucceeded, errorName };
    })()`);
    assert.deepEqual(result, { aSucceeded: true, bSucceeded: true, errorName: 'AbortError' });
    await harness.pageReload();
    const persisted = await harness.evaluate(`(async () => {
      const { openMajandusDb, closeDb, requestResult } = window.storageApi;
      const db = await openMajandusDb();
      const transaction = db.transaction(['meta', 'auth'], 'readonly');
      const a = await requestResult(transaction.objectStore('meta').get('abort-a'));
      const b = await requestResult(transaction.objectStore('auth').get('abort-b'));
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      closeDb(db);
      return { a: a ?? null, b: b ?? null };
    })()`);
    assert.deepEqual(persisted, { a: null, b: null });
  } finally {
    await harness.cleanup();
  }
});

test('native IndexedDB rolls back earlier writes when a later request errors', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, openMajandusDb, closeDb, requestResult, runTransaction } = window.storageApi;
      const remove = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); remove.onblocked = () => reject(new Error('reset blocked')); });
      const db = await openMajandusDb();
      await runTransaction(db, ['meta'], 'readwrite', ({ stores }) => stores.meta.add({ key: 'duplicate', value: 0 }));
      let errorName = null;
      try {
        await runTransaction(db, ['meta'], 'readwrite', async ({ stores }) => {
          await requestResult(stores.meta.put({ key: 'rolled-back', value: 1 }));
          await requestResult(stores.meta.add({ key: 'duplicate', value: 2 }));
        });
      } catch (error) {
        errorName = error.name;
      }
      closeDb(db);
      return { errorName };
    })()`);
    assert.equal(result.errorName, 'ConstraintError');
    await harness.pageReload();
    const persisted = await harness.evaluate(`(async () => {
      const { openMajandusDb, closeDb, requestResult } = window.storageApi;
      const db = await openMajandusDb();
      const transaction = db.transaction(['meta'], 'readonly');
      const value = await requestResult(transaction.objectStore('meta').get('rolled-back'));
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      closeDb(db);
      return value ?? null;
    })()`);
    assert.equal(persisted, null);
  } finally {
    await harness.cleanup();
  }
});

test('blocked open rejects and closes a late successful database handle', async () => {
  const missing = await import('../../src/storage/indexedDb.js');
  const fakeDb = { closed: false, close() { this.closed = true; } };
  let request;
  const indexedDb = { open() { request = {}; return request; } };
  const opening = missing.openMajandusDb(indexedDb);
  request.onblocked();
  await assert.rejects(opening, error => error?.name === 'IndexedDbBlockedError');
  request.result = fakeDb;
  request.onsuccess();
  assert.equal(fakeDb.closed, true);
});

test('native versionchange closes the handle so database deletion completes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, openMajandusDb } = window.storageApi;
      const clear = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { clear.onsuccess = resolve; clear.onerror = () => reject(clear.error); clear.onblocked = () => reject(new Error('reset blocked')); });
      await openMajandusDb();
      const remove = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); remove.onblocked = () => reject(new Error('versionchange did not close the connection')); });
      return 'deleted';
    })()`);
    assert.equal(result, 'deleted');
  } finally {
    await harness.cleanup();
  }
});

test('local replica validates contracts, persists records, and keeps outbox sequence atomic', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, createLocalReplica, validateHouseholdProfileRecord, validateCalendarEventRecord, validateSharedPlaceRecord, validateWasteStateRecord, validateOutboxRecord } = window.storageApi;
      const remove = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); remove.onblocked = () => reject(new Error('reset blocked')); });
      const stamp = '2026-09-15T12:00:00.000Z';
      const envelope = (extra = {}) => ({ payload: { ok: true }, revision: 0, updatedAt: stamp, deletedAt: null, syncStatus: 'local', ...extra });
      const item = (mutationId, operation, baseRevision) => ({ mutationId, entityType: 'calendarEvent', entityId: mutationId, operation, baseRevision, patch: { title: mutationId }, createdAt: stamp, attemptCount: 0, lastAttemptAt: null });
      const throws = fn => { try { fn(); return false; } catch { return true; } };
      const validatorChecks = {
        statuses: [
          !throws(() => validateCalendarEventRecord(envelope({ id: 'local-0' }))),
          !throws(() => validateCalendarEventRecord(envelope({ id: 'synced-1', revision: 1, syncStatus: 'synced' }))),
          !throws(() => validateCalendarEventRecord(envelope({ id: 'pending-0', syncStatus: 'pending' }))),
          !throws(() => validateCalendarEventRecord(envelope({ id: 'conflict-0', syncStatus: 'conflict' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'bad-local', revision: 1 }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'bad-synced', revision: 0, syncStatus: 'synced' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'negative', revision: -1, syncStatus: 'pending' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'float', revision: 1.5, syncStatus: 'pending' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'string', revision: '1', syncStatus: 'pending' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'unknown', syncStatus: 'mystery' }))),
        ].every(Boolean),
        timestamps: [
          throws(() => validateCalendarEventRecord(envelope({ id: 'bad-updated', updatedAt: 'not-a-date' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'bad-deleted', deletedAt: 'not-a-date' }))),
          throws(() => validateOutboxRecord({ ...item('bad-created', 'CREATE', 0), createdAt: 'bad' })),
          throws(() => validateOutboxRecord({ ...item('bad-last', 'CREATE', 0), lastAttemptAt: 'bad' })),
          !throws(() => validateCalendarEventRecord(envelope({ id: 'null-deleted', deletedAt: null }))),
          !throws(() => validateOutboxRecord(item('null-last', 'CREATE', 0))),
        ].every(Boolean),
        strictCalendarDates: [
          throws(() => validateCalendarEventRecord(envelope({ id: 'february-29', updatedAt: '2026-02-29T12:00:00.000Z' }))),
          throws(() => validateHouseholdProfileRecord(envelope({ key: 'household', updatedAt: '2026-02-30T12:00:00.000Z' }))),
          throws(() => validateSharedPlaceRecord(envelope({ id: 'february-31', order: 0, updatedAt: '2026-02-31T12:00:00.000Z' }))),
          throws(() => validateWasteStateRecord(envelope({ key: 'waste', updatedAt: '2026-04-31T12:00:00.000Z' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'month-13', updatedAt: '2026-13-01T12:00:00.000Z' }))),
          throws(() => validateCalendarEventRecord(envelope({ id: 'month-00', updatedAt: '2026-00-01T12:00:00.000Z' }))),
          throws(() => validateOutboxRecord({ ...item('empty-created', 'CREATE', 0), createdAt: '' })),
          !throws(() => validateHouseholdProfileRecord(envelope({ key: 'household', updatedAt: '2024-02-29T12:00:00.000Z' }))),
          !throws(() => validateCalendarEventRecord(envelope({ id: 'february-28', updatedAt: '2026-02-28T12:00:00.000Z' }))),
          !throws(() => validateSharedPlaceRecord(envelope({ id: 'april-30', order: 0, updatedAt: '2026-04-30T12:00:00.000Z' }))),
          !throws(() => validateWasteStateRecord(envelope({ key: 'waste', updatedAt: '2026-12-31T23:59:59.999Z' }))),
          !throws(() => validateOutboxRecord({ ...item('canonical-created', 'CREATE', 0), createdAt: new Date('2026-12-31T23:59:59.999Z').toISOString() })),
        ].every(Boolean),
        singletonKeys: throws(() => validateHouseholdProfileRecord(envelope({ key: 'other' }))) && throws(() => validateWasteStateRecord(envelope({ key: 'other' }))),
        outboxRules: !throws(() => validateOutboxRecord(item('create-ok', 'CREATE', 0))) && throws(() => validateOutboxRecord(item('create-bad', 'CREATE', 1))) && !throws(() => validateOutboxRecord(item('update-ok', 'UPDATE', 1))) && throws(() => validateOutboxRecord(item('update-bad', 'UPDATE', 0))) && !throws(() => validateOutboxRecord(item('delete-ok', 'DELETE', 1))) && throws(() => validateOutboxRecord(item('delete-bad', 'DELETE', 0))),
      };
      const replica = createLocalReplica({ indexedDb: indexedDB, clock: () => stamp });
      await replica.open();
      await replica.putHouseholdProfile(envelope({ key: 'household', payload: { serverHouseholdId: null } }));
      await replica.putWasteState(envelope({ key: 'waste' }));
      await replica.putCalendarEvent(envelope({ id: 'event-1' }));
      await replica.putSharedPlace(envelope({ id: 'b', order: 1 }));
      await replica.putSharedPlace(envelope({ id: 'a', order: 1 }));
      await replica.putSharedPlace(envelope({ id: 'z', order: 0 }));
      await replica.putMeta({ key: 'custom', value: { saved: true } });
      await replica.enqueueOutbox(item('z-create', 'CREATE', 0));
      await replica.enqueueOutbox(item('a-update', 'UPDATE', 1));
      let duplicateError = null;
      try { await replica.enqueueOutbox(item('z-create', 'UPDATE', 1)); } catch (error) { duplicateError = error.name; }
      const beforeReload = { places: (await replica.listSharedPlaces()).map(record => record.id), outbox: (await replica.listOutboxBySequence()).map(record => [record.mutationId, record.sequence]), sequence: await replica.getMeta('outboxSequence'), duplicateError };
      await replica.close();
      return { validatorChecks, beforeReload };
    })()`);
    assert.deepEqual(result.validatorChecks, { statuses: true, timestamps: true, strictCalendarDates: true, singletonKeys: true, outboxRules: true });
    assert.deepEqual(result.beforeReload.places, ['z', 'a', 'b']);
    assert.deepEqual(result.beforeReload.outbox, [['z-create', 1], ['a-update', 2]]);
    assert.equal(result.beforeReload.sequence.value, 2);
    assert.equal(result.beforeReload.duplicateError, 'ConstraintError');
    await harness.pageReload();
    const persistence = await harness.evaluate(`(async () => {
      const { createLocalReplica } = window.storageApi;
      const stamp = '2026-09-15T12:00:00.000Z';
      const replica = createLocalReplica({ indexedDb: indexedDB, clock: () => stamp });
      await replica.open();
      const persisted = {
        household: await replica.getHouseholdProfile(), waste: await replica.getWasteState(), event: await replica.getCalendarEvent('event-1'), place: (await replica.listSharedPlaces()).find(record => record.id === 'z'), meta: await replica.getMeta('custom'), sequence: await replica.getMeta('outboxSequence'), outbox: (await replica.listOutboxBySequence()).map(record => [record.mutationId, record.sequence]),
      };
      await replica.enqueueOutbox({ mutationId: 'm-third', entityType: 'calendarEvent', entityId: 'event-1', operation: 'UPDATE', baseRevision: 1, patch: {}, createdAt: stamp, attemptCount: 0, lastAttemptAt: null });
      const afterThird = (await replica.listOutboxBySequence()).map(record => [record.mutationId, record.sequence]);
      await replica.close();
      return { persisted, afterThird };
    })()`);
    assert.equal(persistence.persisted.household.key, 'household');
    assert.equal(persistence.persisted.waste.key, 'waste');
    assert.equal(persistence.persisted.event.id, 'event-1');
    assert.equal(persistence.persisted.place.id, 'z');
    assert.deepEqual(persistence.persisted.meta, { key: 'custom', value: { saved: true } });
    assert.equal(persistence.persisted.sequence.value, 2);
    assert.deepEqual(persistence.persisted.outbox, [['z-create', 1], ['a-update', 2]]);
    assert.deepEqual(persistence.afterThird, [['z-create', 1], ['a-update', 2], ['m-third', 3]]);
  } finally {
    await harness.cleanup();
  }
});

const LEGACY_EVENT = "{ id:'event-1', title:'Prügivedu', category:'waste', subtype:'bio', date:'2026-09-20', time:null, recurrence:{frequency:'none',interval:1}, reminder:{daysBefore:0}, source:'manual', householdId:null, notes:'', seriesId:null, excludedDates:[], overrides:{} }";
const LEGACY_SOURCES = `{
  calendar: JSON.stringify({ version: 1, events: [${LEGACY_EVENT}], wasteImports: [], theme: 'dark' }),
  household: JSON.stringify({ version: 1, profile: { name: ' Kodu ', address: 'Tamme 5' }, note: 'raw' }),
  places: JSON.stringify([{ name: 'Kodu', address: 'Tamme 5', lat: 59.35, lon: 26.36 }, null]),
}`;

test('legacy migration completes fresh sources, stays idempotent and detects changed sources after completion', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      await __t.reset();
      __t.seed(sources);
      const legacyBefore = __t.snapshot();
      const fresh = await __t.run({ ids: ['place-1', 'place-2'] });
      const freshOwned = await __t.owned();
      const freshMarker = await __t.marker();
      const legacyAfter = __t.snapshot();
      const again = await __t.run();
      __t.seed({ calendar: '{oops', household: sources.household, places: sources.places });
      const changed = await __t.run();
      const changedMarker = await __t.marker();
      const changedOwned = await __t.owned();
      await __t.reset();
      __t.seed({});
      const clean = await __t.run();
      const cleanOwned = await __t.owned();
      const cleanMarker = await __t.marker();
      return {
        fresh: fresh.result, freshOwned, freshMarker, again: again.result,
        changed: changed.result, changedMarker, changedOwned,
        clean: clean.result, cleanOwned, cleanMarker,
        legacyUnchanged: JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter),
      };
    })()`);
    assert.deepEqual(result.fresh, { status: 'completed', legacyMutated: false });
    assert.equal(result.legacyUnchanged, true);
    assert.deepEqual(result.freshOwned.places, ['place-1', 'place-2']);
    assert.deepEqual(result.freshOwned.calendar, ['event-1']);
    assert.equal(result.freshOwned.outbox, 0);
    assert.equal(result.freshMarker.status, 'complete');
    assert.equal(result.freshMarker.preparationId, 'prep-1');
    assert.match(result.freshMarker.sourceDigest, /^[0-9a-f]{64}$/);
    assert.equal(result.freshMarker.preparedAt, '2026-09-16T10:00:00.000Z');
    assert.deepEqual(result.freshMarker.generatedIds.sharedPlaces, ['place-1', 'place-2']);
    assert.deepEqual(result.freshMarker.migratedCalendarIds, ['event-1']);
    assert.deepEqual([...result.freshMarker.migratedMetaKeys].sort(), ['calendarLegacyEnvelopeExtras', 'householdLegacyEnvelopeExtras']);
    assert.deepEqual([...result.freshMarker.migratedSingletonKeys].sort(), ['household', 'waste']);
    assert.deepEqual(result.again, { status: 'already-complete', legacyMutated: false });
    assert.deepEqual(result.changed, { status: 'source-changed-after-complete', legacyMutated: false });
    assert.deepEqual(result.changedMarker, result.freshMarker);
    assert.deepEqual(result.changedOwned, result.freshOwned);
    assert.deepEqual(result.clean, { status: 'completed', legacyMutated: false });
    assert.deepEqual(result.cleanOwned, { household: [], calendar: [], places: [], waste: [], meta: ['legacyMigrationV1'], outbox: 0 });
    assert.equal(result.cleanMarker.status, 'complete');
    assert.deepEqual(result.cleanMarker.generatedIds.sharedPlaces, []);
    assert.deepEqual(result.cleanMarker.migratedCalendarIds, []);
    assert.deepEqual(result.cleanMarker.migratedMetaKeys, []);
    assert.deepEqual(result.cleanMarker.migratedSingletonKeys, []);
  } finally {
    await harness.cleanup();
  }
});

test('legacy migration recovers a prepared marker after a forced completion failure without minting IDs', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      await __t.reset();
      __t.seed(sources);
      const failing = __t.wrapReplica(__t.makeReplica(), ({ names, mode, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') throw new Error('forced completion failure');
        return proceed();
      });
      const failed = await __t.run({ replica: failing, ids: ['place-1', 'place-2'] });
      const preparedMarker = await __t.marker();
      const preparedOwned = await __t.owned();
      const legacyAfterFailure = __t.snapshot();
      const retry = await __t.run({ newId: () => { throw new Error('recovery must not mint IDs'); } });
      const recoveredMarker = await __t.marker();
      const recoveredOwned = await __t.owned();
      return {
        failed: failed.result, preparedMarker, preparedOwned,
        retry: retry.result, recoveredMarker, recoveredOwned,
        legacyUnchanged: JSON.stringify(legacyAfterFailure) === JSON.stringify(__t.snapshot()),
      };
    })()`);
    assert.deepEqual(result.failed, { status: 'write-failed', legacyMutated: false });
    assert.equal(result.preparedMarker.status, 'prepared');
    assert.deepEqual(result.preparedOwned.places, ['place-1', 'place-2']);
    assert.deepEqual(result.retry, { status: 'prepared-recovered', legacyMutated: false });
    assert.equal(result.recoveredMarker.status, 'complete');
    assert.equal(result.recoveredMarker.preparationId, result.preparedMarker.preparationId);
    assert.equal(result.recoveredMarker.preparedAt, result.preparedMarker.preparedAt);
    assert.deepEqual(result.recoveredMarker.generatedIds.sharedPlaces, ['place-1', 'place-2']);
    assert.deepEqual(result.recoveredOwned, result.preparedOwned);
    assert.equal(result.legacyUnchanged, true);
  } finally {
    await harness.cleanup();
  }
});

test('overlapping legacy migrations produce exactly one completion and one concurrent-migration', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      await __t.reset();
      __t.seed(sources);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let holding = 0;
      const barrier = () => __t.wrapReplica(__t.makeReplica(), async ({ mode, names, proceed }) => {
        if (mode === 'readwrite' && names.includes('calendarEvents')) {
          holding += 1;
          if (holding === 2) release();
          await gate;
        }
        return proceed();
      });
      const [one, two] = await Promise.all([
        __t.run({ replica: barrier(), ids: ['a-1', 'a-2'] }),
        __t.run({ replica: barrier(), ids: ['b-1', 'b-2'] }),
      ]);
      const finalMarker = await __t.marker();
      const finalOwned = await __t.owned();
      const lockNames = [];
      const locks = { request: (name, callback) => { lockNames.push(name); return callback(); } };
      const locked = await __t.run({ locks, storage: null });
      return {
        statuses: [one.result.status, two.result.status].sort(),
        results: [one.result, two.result],
        finalMarker, finalOwned, lockNames, locked: locked.result,
      };
    })()`);
    assert.deepEqual(result.statuses, ['completed', 'concurrent-migration']);
    for (const single of result.results) assert.deepEqual(Object.keys(single).sort(), ['legacyMutated', 'status']);
    assert.equal(result.finalMarker.status, 'complete');
    assert.deepEqual(result.finalOwned.places, result.finalMarker.generatedIds.sharedPlaces);
    assert.equal(result.finalOwned.places.length, 2);
    assert.equal(result.finalOwned.outbox, 0);
    assert.deepEqual(result.lockNames, ['majandus:legacy-migration']);
    assert.deepEqual(result.locked, { status: 'unreadable-source', legacyMutated: false });
  } finally {
    await harness.cleanup();
  }
});

test('prepared migration survives verification mismatch, reprepares a changed source and keeps unrelated records', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      await __t.reset();
      __t.seed(sources);
      await __t.put('meta', { key: 'outboxSequence', value: 7 });
      await __t.put('meta', { key: 'custom', value: { keep: true } });
      await __t.put('auth', { key: 'device', value: 'private' });
      await __t.put('syncState', { key: 'cursor', value: 3 });

      // Corrupt a marker-owned record between transaction A and verification.
      const corrupting = __t.wrapReplica(__t.makeReplica(), async ({ call, mode, proceed }) => {
        if (mode === 'readonly' && call === 3) {
          const current = (await __t.dump()).calendarEvents[0];
          await __t.put('calendarEvents', { ...current, payload: { ...current.payload, title: 'tampered' } });
        }
        return proceed();
      });
      const mismatch = await __t.run({ replica: corrupting, ids: ['place-1', 'place-2'] });
      const mismatchMarker = await __t.marker();

      const recovered = await __t.run({ newId: () => { throw new Error('recovery must not mint IDs'); } });
      const recoveredMarker = await __t.marker();
      const recoveredDump = await __t.dump();

      // Reprepare applies to a prepared marker, so build one before changing the source.
      await __t.reset();
      __t.seed(sources);
      await __t.put('meta', { key: 'outboxSequence', value: 7 });
      await __t.put('meta', { key: 'custom', value: { keep: true } });
      await __t.put('auth', { key: 'device', value: 'private' });
      await __t.put('syncState', { key: 'cursor', value: 3 });
      const failingBeforeReprepare = __t.wrapReplica(__t.makeReplica(), ({ names, mode, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') throw new Error('forced completion failure');
        return proceed();
      });
      await __t.run({ replica: failingBeforeReprepare, ids: ['stale-1', 'stale-2'] });
      const staleMarker = await __t.marker();
      __t.seed({ ...sources, places: JSON.stringify([{ name: 'Uus' }, { name: 'Teine' }, { name: 'Kolmas' }]) });
      const reprepared = await __t.run({ ids: ['place-9', 'place-10', 'place-11'], preparationIds: ['prep-2'] });
      const repreparedMarker = await __t.marker();
      const repreparedOwned = await __t.owned();
      const repreparedDump = await __t.dump();

      // Prepared state plus an invalid current source must not clean anything up.
      await __t.reset();
      __t.seed(sources);
      const failing = __t.wrapReplica(__t.makeReplica(), ({ names, mode, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') throw new Error('forced completion failure');
        return proceed();
      });
      await __t.run({ replica: failing, ids: ['keep-1', 'keep-2'] });
      const preparedBefore = await __t.marker();
      const ownedBefore = await __t.owned();
      __t.seed({ ...sources, calendar: '{oops' });
      const invalidChanged = await __t.run();
      const preparedAfter = await __t.marker();
      const ownedAfter = await __t.owned();

      return {
        mismatch: mismatch.result, mismatchMarkerStatus: mismatchMarker.status,
        recovered: recovered.result, recoveredMarker,
        recoveredTitle: recoveredDump.calendarEvents[0].payload.title,
        reprepared: reprepared.result, repreparedMarker, repreparedOwned, stalePlaces: staleMarker.generatedIds.sharedPlaces,
        keptMeta: repreparedDump.meta.map(record => record.key).sort(),
        keptAuth: repreparedDump.auth.map(record => record.key),
        keptSyncState: repreparedDump.syncState.map(record => record.key),
        outboxSequence: repreparedDump.meta.find(record => record.key === 'outboxSequence'),
        invalidChanged: invalidChanged.result,
        preparedIntact: JSON.stringify(preparedBefore) === JSON.stringify(preparedAfter),
        ownedIntact: JSON.stringify(ownedBefore) === JSON.stringify(ownedAfter),
      };
    })()`);
    assert.deepEqual(result.mismatch, { status: 'verification-failed', legacyMutated: false });
    assert.equal(result.mismatchMarkerStatus, 'prepared');
    assert.deepEqual(result.recovered, { status: 'prepared-recovered', legacyMutated: false });
    assert.equal(result.recoveredMarker.status, 'complete');
    assert.deepEqual(result.recoveredMarker.generatedIds.sharedPlaces, ['place-1', 'place-2']);
    assert.equal(result.recoveredTitle, 'Prügivedu', 'C+A rebuild restores the tampered record');
    assert.deepEqual(result.reprepared, { status: 'reprepared', legacyMutated: false });
    assert.equal(result.repreparedMarker.status, 'complete');
    assert.equal(result.repreparedMarker.preparationId, 'prep-2');
    assert.deepEqual(result.repreparedMarker.generatedIds.sharedPlaces, ['place-9', 'place-10', 'place-11']);
    assert.deepEqual(result.repreparedOwned.places, ['place-9', 'place-10', 'place-11']);
    assert.deepEqual(result.stalePlaces, ['stale-1', 'stale-2'], 'the replaced preparation owned different identities');
    assert.equal(result.repreparedOwned.outbox, 0);
    assert.deepEqual(result.keptMeta, ['calendarLegacyEnvelopeExtras', 'custom', 'householdLegacyEnvelopeExtras', 'legacyMigrationV1', 'outboxSequence']);
    assert.deepEqual(result.keptAuth, ['device']);
    assert.deepEqual(result.keptSyncState, ['cursor']);
    assert.deepEqual(result.outboxSequence, { key: 'outboxSequence', value: 7 });
    assert.deepEqual(result.invalidChanged, { status: 'invalid-source', legacyMutated: false });
    assert.equal(result.preparedIntact, true);
    assert.equal(result.ownedIntact, true);
  } finally {
    await harness.cleanup();
  }
});

test('legacy migration refuses unsafe replica state, corrupt sources and storage failures without writing', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      const stamp = __t.STAMP;
      const envelope = extra => ({ payload: { existing: true }, revision: 0, updatedAt: stamp, deletedAt: null, syncStatus: 'local', ...extra });
      const blockers = [
        ['calendarEvents', envelope({ id: 'pre-existing' })],
        ['sharedPlaces', envelope({ id: 'pre-existing', order: 0 })],
        ['householdProfile', envelope({ key: 'household' })],
        ['wasteState', envelope({ key: 'waste' })],
        ['meta', { key: 'calendarLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: {} } }],
      ];
      const blocked = [];
      for (const [store, record] of blockers) {
        await __t.reset();
        __t.seed(sources);
        await __t.put(store, record);
        const run = await __t.run();
        blocked.push({ store, status: run.result.status, marker: await __t.marker(), owned: await __t.owned() });
      }

      await __t.reset();
      __t.seed(sources);
      await __t.put('meta', { key: 'legacyMigrationV1', status: 'unknown-state', junk: true });
      const malformed = await __t.run();
      const malformedMarker = await __t.marker();

      await __t.reset();
      __t.seed(sources);
      await __t.put('meta', { key: 'outboxSequence', value: 2 });
      const allowed = await __t.run({ ids: ['ok-1', 'ok-2'] });

      const corrupt = [];
      for (const [name, override] of [['calendar', { calendar: '{oops' }], ['household', { household: 'null' }], ['places', { places: '{}' }]]) {
        await __t.reset();
        __t.seed({ ...sources, ...override });
        const before = __t.snapshot();
        const run = await __t.run();
        corrupt.push({ name, status: run.result.status, owned: await __t.owned(), marker: await __t.marker(), legacyUnchanged: JSON.stringify(before) === JSON.stringify(__t.snapshot()) });
      }

      await __t.reset();
      __t.seed(sources);
      const throwingStorage = { getItem: key => { if (key === 'sade_saved_places') throw new Error('blocked'); return localStorage.getItem(key); } };
      const unreadable = await __t.run({ storage: throwingStorage });
      const unreadableOwned = await __t.owned();

      await __t.reset();
      __t.seed(sources);
      const failingWrite = __t.wrapReplica(__t.makeReplica(), ({ mode, names, proceed }) => {
        if (mode === 'readwrite' && names.includes('calendarEvents')) throw new Error('forced transaction A failure');
        return proceed();
      });
      const writeFailed = await __t.run({ replica: failingWrite });
      const writeFailedOwned = await __t.owned();

      await __t.reset();
      __t.seed(sources);
      const completed = await __t.run({ ids: ['keep-1', 'keep-2'] });
      return { blocked, malformed: malformed.result, malformedMarker, allowed: allowed.result, corrupt, unreadable: unreadable.result, unreadableOwned, writeFailed: writeFailed.result, writeFailedOwned, completed: completed.result };
    })()`);
    for (const entry of result.blocked) {
      assert.equal(entry.status, 'replica-not-empty', entry.store);
      assert.equal(entry.marker, null, entry.store);
      assert.equal(entry.owned.outbox, 0, entry.store);
    }
    assert.deepEqual(result.blocked.map(entry => [entry.owned.calendar, entry.owned.places, entry.owned.household, entry.owned.waste, entry.owned.meta]), [
      [['pre-existing'], [], [], [], []],
      [[], ['pre-existing'], [], [], []],
      [[], [], ['household'], [], []],
      [[], [], [], ['waste'], []],
      [[], [], [], [], ['calendarLegacyEnvelopeExtras']],
    ], 'only the pre-seeded blocker remains; migration wrote nothing');
    assert.deepEqual(result.malformed, { status: 'replica-not-empty', legacyMutated: false });
    assert.deepEqual(result.malformedMarker, { key: 'legacyMigrationV1', status: 'unknown-state', junk: true });
    assert.deepEqual(result.allowed, { status: 'completed', legacyMutated: false });
    for (const entry of result.corrupt) {
      assert.equal(entry.status, 'invalid-source', entry.name);
      assert.equal(entry.marker, null, entry.name);
      assert.deepEqual(entry.owned, { household: [], calendar: [], places: [], waste: [], meta: [], outbox: 0 }, entry.name);
      assert.equal(entry.legacyUnchanged, true, entry.name);
    }
    assert.deepEqual(result.unreadable, { status: 'unreadable-source', legacyMutated: false });
    assert.deepEqual(result.unreadableOwned, { household: [], calendar: [], places: [], waste: [], meta: [], outbox: 0 });
    assert.deepEqual(result.writeFailed, { status: 'write-failed', legacyMutated: false });
    assert.deepEqual(result.writeFailedOwned, { household: [], calendar: [], places: [], waste: [], meta: [], outbox: 0 });
    assert.deepEqual(result.completed, { status: 'completed', legacyMutated: false });

    await harness.pageReload();
    const afterReload = await harness.evaluate(`(async () => {
      const again = await __t.run();
      return { again: again.result, owned: await __t.owned(), marker: await __t.marker() };
    })()`);
    assert.deepEqual(afterReload.again, { status: 'already-complete', legacyMutated: false });
    assert.deepEqual(afterReload.owned.places, ['keep-1', 'keep-2']);
    assert.equal(afterReload.marker.status, 'complete');
    assert.equal(afterReload.owned.outbox, 0);
  } finally {
    await harness.cleanup();
  }
});

test('cleanup and rebuild abort together when an unrelated entity record appears', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      await __t.reset();
      __t.seed(sources);
      const failing = __t.wrapReplica(__t.makeReplica(), ({ names, mode, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') throw new Error('forced completion failure');
        return proceed();
      });
      await __t.run({ replica: failing, ids: ['old-1', 'old-2'] });
      const preparedMarker = await __t.marker();
      const preparedDump = await __t.dump();
      await __t.put('calendarEvents', { id: 'unrelated', payload: { keep: true }, revision: 0, updatedAt: __t.STAMP, deletedAt: null, syncStatus: 'local' });
      __t.seed({ ...sources, places: JSON.stringify([{ name: 'Muudetud' }]) });
      const blocked = await __t.run({ ids: ['new-1'], preparationIds: ['prep-2'] });
      const afterMarker = await __t.marker();
      const afterDump = await __t.dump();
      return {
        blocked: blocked.result,
        markerIntact: JSON.stringify(preparedMarker) === JSON.stringify(afterMarker),
        oldPlaces: afterDump.sharedPlaces.map(record => record.id).sort(),
        oldCalendar: afterDump.calendarEvents.map(record => record.id).sort(),
        preparedPlaces: preparedDump.sharedPlaces.map(record => record.id).sort(),
        extras: afterDump.meta.map(record => record.key).sort(),
      };
    })()`);
    assert.deepEqual(result.blocked, { status: 'replica-not-empty', legacyMutated: false });
    assert.equal(result.markerIntact, true, 'old prepared marker survives the aborted rebuild');
    assert.deepEqual(result.preparedPlaces, ['old-1', 'old-2']);
    assert.deepEqual(result.oldPlaces, ['old-1', 'old-2'], 'old owned places survive the aborted rebuild');
    assert.deepEqual(result.oldCalendar, ['event-1', 'unrelated'], 'unrelated record and old owned record both survive');
    assert.deepEqual(result.extras, ['calendarLegacyEnvelopeExtras', 'householdLegacyEnvelopeExtras', 'legacyMigrationV1']);
  } finally {
    await harness.cleanup();
  }
});

test('legacy migration migrates each single present source without inventing the others', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      const runs = {};
      for (const [name, only] of [
        ['calendar', { calendar: sources.calendar }],
        ['calendarWithoutWaste', { calendar: JSON.stringify({ version: 1, events: [] }) }],
        ['household', { household: sources.household }],
        ['places', { places: sources.places }],
      ]) {
        await __t.reset();
        __t.seed(only);
        const before = __t.snapshot();
        const run = await __t.run({ ids: ['only-1', 'only-2'] });
        runs[name] = {
          result: run.result,
          owned: await __t.owned(),
          marker: await __t.marker(),
          legacyUnchanged: JSON.stringify(before) === JSON.stringify(__t.snapshot()),
        };
      }
      return runs;
    })()`);
    for (const [name, run] of Object.entries(result)) {
      assert.deepEqual(run.result, { status: 'completed', legacyMutated: false }, name);
      assert.equal(run.marker.status, 'complete', name);
      assert.equal(run.owned.outbox, 0, name);
      assert.equal(run.legacyUnchanged, true, name);
    }
    assert.deepEqual(result.calendar.owned.calendar, ['event-1']);
    assert.deepEqual(result.calendar.owned.waste, ['waste']);
    assert.deepEqual(result.calendar.owned.household, []);
    assert.deepEqual(result.calendar.owned.places, []);
    assert.deepEqual(result.calendar.marker.migratedSingletonKeys, ['waste']);
    assert.deepEqual(result.calendar.marker.migratedMetaKeys, ['calendarLegacyEnvelopeExtras']);
    assert.deepEqual(result.calendarWithoutWaste.owned.waste, [], 'absent wasteImports creates no waste singleton');
    assert.deepEqual(result.calendarWithoutWaste.marker.migratedSingletonKeys, []);
    assert.deepEqual(result.household.owned.household, ['household']);
    assert.deepEqual(result.household.owned.waste, []);
    assert.deepEqual(result.household.marker.migratedSingletonKeys, ['household']);
    assert.deepEqual(result.household.marker.migratedMetaKeys, ['householdLegacyEnvelopeExtras']);
    assert.deepEqual(result.places.owned.places, ['only-1', 'only-2']);
    assert.deepEqual(result.places.owned.household, []);
    assert.deepEqual(result.places.marker.migratedMetaKeys, [], 'places carry no envelope extras');
    assert.deepEqual(result.places.marker.migratedCalendarIds, []);
  } finally {
    await harness.cleanup();
  }
});

test('migration refuses to complete or clean up a marker another execution replaced', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      const forceCompletionFailure = () => __t.wrapReplica(__t.makeReplica(), ({ names, mode, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') throw new Error('forced completion failure');
        return proceed();
      });
      const stealMarker = async () => {
        const current = await __t.marker();
        await __t.put('meta', { ...current, preparationId: 'other-execution' });
      };

      // A rival execution replaces the marker just before guarded cleanup and rebuild.
      await __t.reset();
      __t.seed(sources);
      await __t.run({ replica: forceCompletionFailure(), ids: ['old-1', 'old-2'] });
      __t.seed({ ...sources, places: JSON.stringify([{ name: 'Muudetud' }]) });
      const stealBeforeCleanup = __t.wrapReplica(__t.makeReplica(), async ({ mode, names, proceed }) => {
        if (mode === 'readwrite' && names.includes('calendarEvents')) await stealMarker();
        return proceed();
      });
      const cleanupBlocked = await __t.run({ replica: stealBeforeCleanup, ids: ['new-1'], preparationIds: ['prep-2'] });
      const afterCleanup = await __t.owned();
      const cleanupMarker = await __t.marker();

      // A rival execution replaces the marker just before completion.
      await __t.reset();
      __t.seed(sources);
      const stealBeforeCompletion = __t.wrapReplica(__t.makeReplica(), async ({ mode, names, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') await stealMarker();
        return proceed();
      });
      const completionBlocked = await __t.run({ replica: stealBeforeCompletion, ids: ['keep-1', 'keep-2'] });
      const completionMarker = await __t.marker();

      // A clean install must reject an invalid marker timestamp instead of persisting it.
      await __t.reset();
      __t.seed({});
      const badStamp = await __t.run({ now: () => 'not-a-timestamp' });
      const badStampMarker = await __t.marker();
      const badStampOwned = await __t.owned();

      return {
        cleanupBlocked: cleanupBlocked.result, afterCleanup, cleanupMarkerId: cleanupMarker.preparationId, cleanupMarkerStatus: cleanupMarker.status,
        completionBlocked: completionBlocked.result, completionMarkerId: completionMarker.preparationId, completionMarkerStatus: completionMarker.status,
        badStamp, badStampMarker, badStampOwned,
      };
    })()`);
    assert.deepEqual(result.cleanupBlocked, { status: 'concurrent-migration', legacyMutated: false });
    assert.deepEqual(result.afterCleanup.places, ['old-1', 'old-2'], 'a stale cleanup deletes nothing');
    assert.deepEqual(result.afterCleanup.calendar, ['event-1']);
    assert.equal(result.cleanupMarkerId, 'other-execution');
    assert.equal(result.cleanupMarkerStatus, 'prepared');
    assert.deepEqual(result.completionBlocked, { status: 'concurrent-migration', legacyMutated: false });
    assert.equal(result.completionMarkerId, 'other-execution');
    assert.equal(result.completionMarkerStatus, 'prepared', 'a stale marker is never completed');
    assert.equal(result.badStamp.result, undefined);
    assert.equal(result.badStamp.thrown.name, 'TypeError');
    assert.equal(result.badStampMarker, null, 'no marker is written for an invalid timestamp');
    assert.deepEqual(result.badStampOwned, { household: [], calendar: [], places: [], waste: [], meta: [], outbox: 0 });
  } finally {
    await harness.cleanup();
  }
});

test('verification ignores records outside marker ownership', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const sources = ${LEGACY_SOURCES};
      await __t.reset();
      __t.seed(sources);
      const failing = __t.wrapReplica(__t.makeReplica(), ({ names, mode, proceed }) => {
        if (mode === 'readwrite' && names.length === 1 && names[0] === 'meta') throw new Error('forced completion failure');
        return proceed();
      });
      await __t.run({ replica: failing, ids: ['own-1', 'own-2'] });
      // An unrelated record appears next to the prepared migration data.
      await __t.put('calendarEvents', { id: 'unrelated', payload: { keep: true }, revision: 0, updatedAt: __t.STAMP, deletedAt: null, syncStatus: 'local' });
      await __t.put('meta', { key: 'custom', value: { keep: true } });
      const recovered = await __t.run({ newId: () => { throw new Error('recovery must not mint IDs'); } });
      const dump = await __t.dump();
      return {
        recovered: recovered.result,
        marker: await __t.marker(),
        calendar: dump.calendarEvents.map(record => record.id).sort(),
        places: dump.sharedPlaces.map(record => record.id).sort(),
        meta: dump.meta.map(record => record.key).sort(),
        unrelated: dump.calendarEvents.find(record => record.id === 'unrelated'),
      };
    })()`);
    assert.deepEqual(result.recovered, { status: 'prepared-recovered', legacyMutated: false });
    assert.equal(result.marker.status, 'complete');
    assert.deepEqual(result.marker.migratedCalendarIds, ['event-1'], 'the unrelated record never joins marker ownership');
    assert.deepEqual(result.places, ['own-1', 'own-2']);
    assert.deepEqual(result.calendar, ['event-1', 'unrelated']);
    assert.deepEqual(result.meta, ['calendarLegacyEnvelopeExtras', 'custom', 'householdLegacyEnvelopeExtras', 'legacyMigrationV1']);
    assert.deepEqual(result.unrelated.payload, { keep: true });
  } finally {
    await harness.cleanup();
  }
});
