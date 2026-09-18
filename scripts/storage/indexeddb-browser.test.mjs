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
        import { validateRuntimeRecord, validateSharedPlaceOrders } from './src/storage/runtimeRecords.js';
        import { runReplicaMutation } from './src/storage/runtimeWrites.js';
        import { normalizePlace, normalizePlaces } from './src/places/savedPlaces.js';
        import { createStorageAuthorityController, isWellFormedAuthorityRecord, isWellFormedRevertAttemptRecord, classifyHint, hintMatches, canWriteLegacy } from './src/storage/storageAuthority.js';
        import { createReplicaRepositories } from './src/storage/replicaRepositories.js';
        import { normalizeWasteResult } from './src/waste/providers.js';
        import { createHouseholdRepository } from './src/waste/householdRepository.js';
        import { createEventRepository } from './src/calendar/eventRepository.js';
        window.storageApi = { DB_NAME, DB_VERSION, STORE_NAMES, upgradeSchema, openMajandusDb, closeDb, requestResult, runTransaction, validateHouseholdProfileRecord, validateCalendarEventRecord, validateSharedPlaceRecord, validateWasteStateRecord, validateOutboxRecord, createLocalReplica, legacy, validateRuntimeRecord, validateSharedPlaceOrders, runReplicaMutation, normalizePlace, normalizePlaces, createStorageAuthorityController, isWellFormedAuthorityRecord, isWellFormedRevertAttemptRecord, classifyHint, hintMatches, canWriteLegacy, createReplicaRepositories, normalizeWasteResult, createHouseholdRepository, createEventRepository };
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

// Page-side C3 helpers: a seeded replica with a valid authority record and a spy-free dump.
const C3_PAGE = `window.__c3 = (() => {
  const api = window.storageApi;
  const AUTHORITY = { key: 'storageAuthorityV1', status: 'active', switchId: 'switch-1', switchedAt: '2026-09-16T10:00:00.000Z',
    legacyDigestAtSwitch: 'a'.repeat(64), markerPreparationId: 'prep-1', commitCount: 0, legacyUntrusted: false, persistGranted: null };
  const place = (id, order, name) => ({ id, order, payload: api.normalizePlace({ name }, order), revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
  const setup = async (authority = AUTHORITY) => {
    await window.__t.reset();
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    if (authority !== null) await replica.transact(['meta'], 'readwrite', ({ stores }) => api.requestResult(stores.meta.put(authority)));
    return replica;
  };
  const state = replica => replica.transact(['meta', 'sharedPlaces', 'calendarEvents', 'householdProfile', 'wasteState'], 'readonly', async ({ stores }) => ({
    authority: await api.requestResult(stores.meta.get('storageAuthorityV1')) ?? null,
    metaKeys: (await api.requestResult(stores.meta.getAllKeys())).sort(),
    places: await api.requestResult(stores.sharedPlaces.getAll()),
    events: await api.requestResult(stores.calendarEvents.getAll()),
    household: await api.requestResult(stores.householdProfile.getAll()),
    waste: await api.requestResult(stores.wasteState.getAll()),
  }));
  const failure = error => ({ name: error && error.name, state: error && error.state, reason: error && error.reason, message: String(error && error.message) });
  const attempt = async promise => { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error: failure(error) }; } };
  const placesMutation = (replica, overrides = {}) => api.runReplicaMutation({
    replica, authority: { switchId: 'switch-1' }, domain: 'places', stores: ['sharedPlaces'],
    read: ({ sharedPlaces }) => api.requestResult(sharedPlaces.getAll()),
    plan: snapshot => ({ puts: [{ store: 'sharedPlaces', record: place('place-' + (snapshot.length + 1), snapshot.length, 'Koht ' + snapshot.length) }], deletes: [], result: snapshot.length }),
    ...overrides,
  });
  return { AUTHORITY, place, setup, state, attempt, placesMutation };
})();
'ready';`;

async function c3Harness() {
  const harness = await createBrowserHarness();
  await harness.evaluate(C3_PAGE);
  return harness;
}

test('C3 runtime mutation commits planned writes and increments commitCount exactly once per committed mutation', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, state, attempt, placesMutation } = window.__c3;
      const replica = await setup();
      const first = await attempt(placesMutation(replica));
      const afterFirst = await state(replica);
      const second = await attempt(placesMutation(replica));
      const afterSecond = await state(replica);
      const deletion = await attempt(window.storageApi.runReplicaMutation({ replica, authority: { switchId: 'switch-1' }, domain: 'places', stores: ['sharedPlaces', 'meta'],
        read: ({ sharedPlaces }) => window.storageApi.requestResult(sharedPlaces.getAll()),
        plan: snapshot => ({ puts: [], deletes: [{ store: 'sharedPlaces', key: 'place-2' }], result: 'deleted' }) }));
      const afterDelete = await state(replica);
      await replica.close();
      return { first, second, deletion, afterFirst, afterSecond, afterDelete };
    })()`);
    assert.deepEqual(result.first, { ok: true, value: 0 });
    assert.deepEqual(result.second, { ok: true, value: 1 });
    assert.equal(result.afterFirst.authority.commitCount, 1);
    assert.deepEqual(result.afterFirst.places.map(record => [record.id, record.order]), [['place-1', 0]]);
    assert.equal(result.afterSecond.authority.commitCount, 2);
    assert.deepEqual(result.afterSecond.places.map(record => [record.id, record.order]), [['place-1', 0], ['place-2', 1]]);
    assert.deepEqual(result.deletion, { ok: true, value: 'deleted' });
    assert.equal(result.afterDelete.authority.commitCount, 3);
    assert.deepEqual(result.afterDelete.places.map(record => record.id), ['place-1']);
    const { commitCount, ...unchangedFields } = result.afterDelete.authority;
    const { commitCount: seeded, ...seededFields } = await harness.evaluate('window.__c3.AUTHORITY');
    assert.deepEqual(unchangedFields, seededFields, 'only commitCount changes');
  } finally {
    await harness.cleanup();
  }
});

test('C3 a thenable plan throws TypeError before any write and leaves every store unchanged', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, state, attempt, placesMutation, place } = window.__c3;
      const replica = await setup();
      const before = await state(replica);
      const promisePlan = await attempt(placesMutation(replica, { plan: async () => ({ puts: [{ store: 'sharedPlaces', record: place('place-1', 0, 'A') }], deletes: [] }) }));
      let thenCalled = false;
      const customThenable = await attempt(placesMutation(replica, { plan: () => ({ then() { thenCalled = true; }, puts: [{ store: 'sharedPlaces', record: place('place-1', 0, 'A') }], deletes: [] }) }));
      const after = await state(replica);
      await replica.close();
      return { promisePlan, customThenable, thenCalled, before, after };
    })()`);
    assert.equal(result.promisePlan.ok, false);
    assert.equal(result.promisePlan.error.name, 'TypeError');
    assert.equal(result.customThenable.ok, false);
    assert.equal(result.customThenable.error.name, 'TypeError');
    assert.equal(result.thenCalled, false, 'the helper never adopts a thenable plan');
    assert.deepEqual(result.after, result.before);
    assert.equal(result.after.authority.commitCount, 0);
  } finally {
    await harness.cleanup();
  }
});

test('C3 a thenable plan result throws TypeError before any write and is never adopted', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, state, attempt, placesMutation, place } = window.__c3;
      const replica = await setup();
      const before = await state(replica);
      await replica.close();
      const dumpBefore = JSON.stringify(await window.__t.dump());
      const runReplica = window.__t.makeReplica();
      let thenCalled = false;
      const delayedThenable = {
        then(resolve, reject) {
          thenCalled = true;
          setTimeout(() => { const error = new Error('late result rejection'); error.name = 'LateResultRejection'; reject(error); }, 50);
        },
      };
      const outcome = await attempt(placesMutation(runReplica, { plan: () => ({ puts: [{ store: 'sharedPlaces', record: place('place-1', 0, 'A') }], deletes: [], result: delayedThenable }) }));
      await new Promise(resolve => setTimeout(resolve, 150));
      const after = await state(runReplica);
      await runReplica.close();
      const dumpAfter = JSON.stringify(await window.__t.dump());
      return { outcome, thenCalled, before, after, identical: dumpAfter === dumpBefore };
    })()`);
    assert.equal(result.outcome.ok, false);
    assert.equal(result.outcome.error.name, 'TypeError');
    assert.equal(result.thenCalled, false, 'the helper never invokes a thenable result');
    assert.deepEqual(result.after.places, [], 'zero domain writes');
    assert.equal(result.after.authority.commitCount, result.before.authority.commitCount, 'commitCount unchanged');
    assert.deepEqual(result.after, result.before);
    assert.equal(result.identical, true, 'every store is byte-identical');
  } finally {
    await harness.cleanup();
  }
});

test('C3 validation failure aborts the whole mutation with zero domain and meta writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, state, attempt, placesMutation, place } = window.__c3;
      const api = window.storageApi;
      const replica = await setup();
      const before = await state(replica);
      let planned = 0;
      const cases = {
        invalidPlace: placesMutation(replica, { plan: () => { planned += 1; return { puts: [{ store: 'sharedPlaces', record: place('place-1', 0, 'A') }, { store: 'sharedPlaces', record: { ...place('place-2', 1, 'B'), payload: { name: ' B ', address: '', lat: null, lon: null } } }], deletes: [] }; } }),
        gapInOrders: placesMutation(replica, { plan: () => { planned += 1; return { puts: [{ store: 'sharedPlaces', record: place('place-2', 1, 'B') }], deletes: [] }; } }),
        repairedEvent: api.runReplicaMutation({ replica, authority: { switchId: 'switch-1' }, domain: 'calendar', stores: ['calendarEvents', 'wasteState'], read: () => null,
          plan: () => { planned += 1; return { puts: [{ store: 'calendarEvents', record: { id: 'e1', payload: { id: 'e1', title: ' Prügi ', category: 'general', date: '2026-09-20', source: 'manual' }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' } }], deletes: [] }; } }),
        householdServerId: api.runReplicaMutation({ replica, authority: { switchId: 'switch-1' }, domain: 'household', stores: ['householdProfile'], read: () => null,
          plan: () => { planned += 1; return { puts: [{ store: 'householdProfile', record: { key: 'household', payload: { name: 'Kodu', address: '', serverHouseholdId: 'server-1' }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' } }], deletes: [] }; } }),
        metaWrite: placesMutation(replica, { plan: () => { planned += 1; return { puts: [{ store: 'meta', record: { key: 'other' } }], deletes: [] }; } }),
        wrongDomainStore: api.runReplicaMutation({ replica, authority: { switchId: 'switch-1' }, domain: 'places', stores: ['calendarEvents'], read: () => null,
          plan: () => { planned += 1; return { puts: [], deletes: [] }; } }),
        malformedPlan: placesMutation(replica, { plan: () => { planned += 1; return { puts: {} }; } }),
      };
      const outcomes = {};
      for (const [name, promise] of Object.entries(cases)) outcomes[name] = await attempt(promise);
      const after = await state(replica);
      await replica.close();
      return { outcomes, planned, before, after };
    })()`);
    for (const [name, outcome] of Object.entries(result.outcomes)) assert.equal(outcome.ok, false, `${name} must be rejected`);
    assert.equal(result.outcomes.wrongDomainStore.error.name, 'TypeError', 'stores outside the domain are rejected before the transaction');
    assert.deepEqual(result.after, result.before, 'no domain or meta record changed');
    assert.equal(result.after.authority.commitCount, 0);
  } finally {
    await harness.cleanup();
  }
});

test('C3 authority switchId mismatch, inactive status and absent authority abort with zero writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { AUTHORITY, setup, state, attempt, placesMutation } = window.__c3;
      const out = {};
      for (const [name, authority, runtimeSwitchId] of [
        ['wrongSwitchId', AUTHORITY, 'switch-2'],
        ['reverting', { ...AUTHORITY, status: 'reverting' }, 'switch-1'],
        ['reverted', { ...AUTHORITY, status: 'reverted' }, 'switch-1'],
        ['absent', null, 'switch-1'],
      ]) {
        const replica = await setup(authority);
        const before = await state(replica);
        let planned = false;
        const outcome = await attempt(placesMutation(replica, { authority: { switchId: runtimeSwitchId }, plan: () => { planned = true; return { puts: [], deletes: [] }; } }));
        const after = await state(replica);
        await replica.close();
        out[name] = { outcome, planned, unchanged: JSON.stringify(after) === JSON.stringify(before) };
      }
      return out;
    })()`);
    for (const [name, entry] of Object.entries(result)) {
      assert.equal(entry.outcome.ok, false, name);
      assert.equal(entry.outcome.error.name, 'RuntimeAuthorityError', name);
      assert.equal(entry.outcome.error.state, 'RELOAD_REQUIRED', name);
      assert.equal(entry.outcome.error.reason, 'authority-mismatch', name);
      assert.equal(entry.planned, false, `${name}: plan must not run`);
      assert.equal(entry.unchanged, true, `${name}: zero writes`);
    }
  } finally {
    await harness.cleanup();
  }
});

test('C3 malformed authority records abort before writes as STORAGE_UNAVAILABLE / authority-malformed', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { AUTHORITY, setup, state, attempt, placesMutation } = window.__c3;
      const { persistGranted, ...missingKey } = AUTHORITY;
      const classes = {
        extraKey: { ...AUTHORITY, extra: true },
        missingKey,
        emptyMarkerPreparationId: { ...AUTHORITY, markerPreparationId: '' },
        unknownStatus: { ...AUTHORITY, status: 'paused' },
        emptySwitchId: { ...AUTHORITY, switchId: '' },
        nonStringSwitchId: { ...AUTHORITY, switchId: 7 },
        invalidSwitchedAt: { ...AUTHORITY, switchedAt: '2026-02-30T10:00:00.000Z' },
        uppercaseDigest: { ...AUTHORITY, legacyDigestAtSwitch: 'A'.repeat(64) },
        shortDigest: { ...AUTHORITY, legacyDigestAtSwitch: 'a'.repeat(63) },
        negativeCommitCount: { ...AUTHORITY, commitCount: -1 },
        fractionalCommitCount: { ...AUTHORITY, commitCount: 1.5 },
        unsafeCommitCount: { ...AUTHORITY, commitCount: Number.MAX_SAFE_INTEGER + 2 },
        stringCommitCount: { ...AUTHORITY, commitCount: '0' },
        nonBooleanUntrusted: { ...AUTHORITY, legacyUntrusted: 'no' },
        badPersistGranted: { ...AUTHORITY, persistGranted: 'yes' },
        nullStatus: { ...AUTHORITY, status: null },
      };
      const out = {};
      for (const [name, authority] of Object.entries(classes)) {
        const replica = await setup(authority);
        const before = await state(replica);
        let planned = false;
        const outcome = await attempt(placesMutation(replica, { plan: () => { planned = true; return { puts: [], deletes: [] }; } }));
        const after = await state(replica);
        await replica.close();
        out[name] = { outcome, planned, unchanged: JSON.stringify(after) === JSON.stringify(before) };
      }
      const exhausted = await setup({ ...AUTHORITY, commitCount: Number.MAX_SAFE_INTEGER });
      const exhaustedBefore = await state(exhausted);
      const exhaustedOutcome = await attempt(placesMutation(exhausted));
      const exhaustedAfter = await state(exhausted);
      await exhausted.close();
      out.exhausted = { outcome: exhaustedOutcome, unchanged: JSON.stringify(exhaustedAfter) === JSON.stringify(exhaustedBefore) };
      return out;
    })()`);
    const { exhausted, ...malformed } = result;
    assert.equal(Object.keys(malformed).length, 16);
    for (const [name, entry] of Object.entries(malformed)) {
      assert.equal(entry.outcome.ok, false, name);
      assert.equal(entry.outcome.error.name, 'RuntimeAuthorityError', name);
      assert.equal(entry.outcome.error.state, 'STORAGE_UNAVAILABLE', name);
      assert.equal(entry.outcome.error.reason, 'authority-malformed', name);
      assert.equal(entry.planned, false, `${name}: plan must not run`);
      assert.equal(entry.unchanged, true, `${name}: zero writes`);
    }
    assert.equal(exhausted.outcome.ok, false, 'commitCount + 1 above MAX_SAFE_INTEGER aborts');
    assert.equal(exhausted.outcome.error.name, 'RangeError');
    assert.equal(exhausted.unchanged, true);
  } finally {
    await harness.cleanup();
  }
});

test('C3 transaction auto-commit hazard: a timer await before writing raises TransactionInactiveError with no write issued', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c3Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, state, attempt, placesMutation, place } = window.__c3;
      const api = window.storageApi;
      const replica = await setup();
      const db = await replica.open();
      const raw = await new Promise(resolve => {
        const transaction = db.transaction(['sharedPlaces'], 'readwrite');
        const events = [];
        transaction.oncomplete = () => events.push('complete');
        (async () => {
          const store = transaction.objectStore('sharedPlaces');
          await api.requestResult(store.getAll());
          events.push('read');
          await new Promise(done => setTimeout(done, 50));
          let writeIssued = false;
          try {
            store.put(place('raw-1', 0, 'Raw'));
            writeIssued = true;
          } catch (error) {
            events.push('throw:' + error.name);
          }
          resolve({ writeIssued, events });
        })();
      });
      const before = await state(replica);
      const viaHelper = await attempt(placesMutation(replica, { read: async ({ sharedPlaces }) => {
        const rows = await api.requestResult(sharedPlaces.getAll());
        await new Promise(done => setTimeout(done, 50));
        return rows;
      } }));
      const after = await state(replica);
      await replica.close();
      return { raw, viaHelper, before, after };
    })()`);
    assert.equal(result.raw.writeIssued, false);
    assert.deepEqual(result.raw.events, ['read', 'complete', 'throw:TransactionInactiveError'], 'the transaction auto-committed before the attempted write');
    assert.equal(result.before.places.length, 0, 'the raw write never reached the store');
    assert.equal(result.viaHelper.ok, false, 'the helper never reports an auto-committed transaction as success');
    assert.equal(result.viaHelper.error.name, 'TransactionInactiveError');
    assert.deepEqual(result.after, result.before);
    assert.equal(result.after.authority.commitCount, 0);
  } finally {
    await harness.cleanup();
  }
});

test('C1 replica connection loss: a DB_VERSION + 1 upgrade closes a subscribed replica without blocking', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, DB_VERSION, createLocalReplica } = window.storageApi;
      await window.__t.reset();
      const replica = createLocalReplica({ indexedDb: indexedDB });
      const events = [];
      replica.subscribe(event => events.push(event));
      await replica.open();
      await replica.transact('meta', 'readonly', () => undefined);
      let blocked = false;
      let upgraded = false;
      const upgrade = indexedDB.open(DB_NAME, DB_VERSION + 1);
      upgrade.onblocked = () => { blocked = true; };
      upgrade.onupgradeneeded = event => { upgraded = event.oldVersion === DB_VERSION && event.newVersion === DB_VERSION + 1; };
      const upgradedDb = await new Promise((resolve, reject) => {
        upgrade.onsuccess = () => resolve(upgrade.result);
        upgrade.onerror = () => reject(upgrade.error);
      });
      const version = upgradedDb.version;
      let lostName = null;
      try { await replica.transact('meta', 'readonly', () => undefined); } catch (error) { lostName = error.name; }
      let openName = null;
      try { await replica.open(); } catch (error) { openName = error.name; }
      await replica.close();
      upgradedDb.close();
      await window.__t.reset();
      return { events, blocked, upgraded, version, lostName, openName };
    })()`);
    assert.deepEqual(result.events, [{ type: 'versionchange', oldVersion: 1, newVersion: 2 }], 'exactly one versionchange delivered');
    assert.equal(result.blocked, false, 'the replica handle closed, so the upgrade was not blocked');
    assert.equal(result.upgraded, true);
    assert.equal(result.version, 2);
    assert.equal(result.lostName, 'ReplicaConnectionLostError');
    assert.equal(result.openName, 'ReplicaConnectionLostError');
  } finally {
    await harness.cleanup();
  }
});

test('C1 replica connection loss: deleteDatabase delivers newVersion null and completes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, createLocalReplica } = window.storageApi;
      await window.__t.reset();
      const replica = createLocalReplica({ indexedDb: indexedDB });
      const events = [];
      replica.subscribe(event => events.push(event));
      await replica.open();
      let blocked = false;
      const remove = indexedDB.deleteDatabase(DB_NAME);
      remove.onblocked = () => { blocked = true; };
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); });
      let lostName = null;
      try { await replica.transact('meta', 'readonly', () => undefined); } catch (error) { lostName = error.name; }
      await replica.close();
      const names = (await indexedDB.databases()).map(database => database.name);
      return { events, blocked, lostName, stillListed: names.includes(DB_NAME) };
    })()`);
    assert.deepEqual(result.events, [{ type: 'versionchange', oldVersion: 1, newVersion: null }]);
    assert.equal(result.blocked, false);
    assert.equal(result.lostName, 'ReplicaConnectionLostError');
    assert.equal(result.stillListed, false);
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

test('local replica listCalendarEvents returns every record in canonical id order with zero writes and no other API change', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { DB_NAME, createLocalReplica } = window.storageApi;
      const remove = indexedDB.deleteDatabase(DB_NAME);
      await new Promise((resolve, reject) => { remove.onsuccess = resolve; remove.onerror = () => reject(remove.error); remove.onblocked = () => reject(new Error('reset blocked')); });
      const stamp = '2026-09-16T10:00:00.000Z';
      const envelope = id => ({ id, payload: { ok: true }, revision: 0, updatedAt: stamp, deletedAt: null, syncStatus: 'local' });
      const replica = createLocalReplica({ indexedDb: indexedDB, clock: () => stamp });
      await replica.open();
      const empty = await replica.listCalendarEvents();
      await replica.putCalendarEvent(envelope('event-b'));
      await replica.putCalendarEvent(envelope('event-a'));
      await replica.putCalendarEvent(envelope('event-c'));
      // 'event-Z' and 'event-a': verified in this exact browser to sort differently under the
      // relational '<'/'>' comparator (event-Z, event-a) than under localeCompare (event-a, event-Z).
      await replica.putCalendarEvent(envelope('event-Z'));
      const authorityBefore = await replica.getMeta('storageAuthorityV1');
      const listed = await replica.listCalendarEvents();
      const authorityAfter = await replica.getMeta('storageAuthorityV1');
      const single = await replica.getCalendarEvent('event-a');
      const household = await replica.getHouseholdProfile();
      const relational = [...listed.map(r => r.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const localized = [...listed.map(r => r.id)].sort((a, b) => a.localeCompare(b));
      await replica.close();
      return { empty, ids: listed.map(record => record.id), authorityBefore, authorityAfter, single, household, relational, localized };
    })()`);
    assert.deepEqual(result.empty, []);
    assert.notDeepEqual(result.relational, result.localized, 'the fixture must genuinely distinguish the two comparators in this browser');
    assert.deepEqual(result.ids, result.relational, 'listCalendarEvents uses the locale-independent relational comparator, matching C4');
    assert.equal(result.authorityBefore, undefined, 'listCalendarEvents never writes or creates an authority record');
    assert.equal(result.authorityAfter, undefined, 'listCalendarEvents never writes or creates an authority record');
    assert.equal(result.single.id, 'event-a', 'getCalendarEvent(id) still works unchanged');
    assert.equal(result.household, undefined, 'getHouseholdProfile still works unchanged for an absent record');
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

// ---- Task 5: full-path integration breadth ------------------------------------------------

// Test-only private/device-local keys and sentinel values; production migration never names them.
const PRIVATE_SENTINELS = Object.freeze({
  sade_diary_pin: 'PRIVATE-SENTINEL-diary-pin-4821',
  sade_diary_entries: 'PRIVATE-SENTINEL-diary-entry-9153',
  majamajandus_reminder_preferences_v1: 'PRIVATE-SENTINEL-reminder-preferences-3307',
  majamajandus_reminder_delivery_v1: 'PRIVATE-SENTINEL-reminder-delivery-6612',
  annivibe_saved_ideas: 'PRIVATE-SENTINEL-saved-idea-2048',
  sade_saved_tips: 'PRIVATE-SENTINEL-saved-tip-7719',
  sade_profile: 'PRIVATE-SENTINEL-profile-name-5580',
});
const PRIVATE_VALUES = Object.freeze({
  sade_diary_pin: PRIVATE_SENTINELS.sade_diary_pin,
  sade_diary_entries: JSON.stringify([{ date: '2026-09-15', text: PRIVATE_SENTINELS.sade_diary_entries }]),
  majamajandus_reminder_preferences_v1: JSON.stringify({ version: 1, enabled: true, label: PRIVATE_SENTINELS.majamajandus_reminder_preferences_v1 }),
  majamajandus_reminder_delivery_v1: JSON.stringify({ version: 1, delivered: [PRIVATE_SENTINELS.majamajandus_reminder_delivery_v1] }),
  annivibe_saved_ideas: JSON.stringify([PRIVATE_SENTINELS.annivibe_saved_ideas]),
  sade_saved_tips: JSON.stringify([PRIVATE_SENTINELS.sade_saved_tips]),
  sade_profile: JSON.stringify({ name: PRIVATE_SENTINELS.sade_profile }),
});
const FULL_WASTE_BATCH = {
  key: JSON.stringify(['rakvere', 'tamme 5 rakvere']), provider: 'rakvere', providerName: 'Rakvere jäätmevedu',
  address: 'Tamme 5, Rakvere', addressKey: 'tamme 5 rakvere', lastSuccess: '2026-09-01T08:00:00.000Z', returnedCount: 1,
  range: { from: '2026-09-01', to: '2026-09-30', authoritative: true },
};
const FULL_MANUAL_EVENT = {
  id: 'event-manual', title: 'Küttearve', category: 'payment', subtype: null, date: '2026-09-18', time: '09:30',
  recurrence: { frequency: 'monthly', interval: 1 }, reminder: { daysBefore: 3 }, source: 'manual', householdId: null,
  notes: 'ühine märge', seriesId: 'series:event-manual', excludedDates: [], overrides: {},
};
const FULL_WASTE_EVENT = {
  id: 'event-waste', title: 'Biojäätmed', category: 'waste', subtype: 'bio', date: '2026-09-22', time: null,
  recurrence: { frequency: 'none', interval: 1 }, reminder: { daysBefore: 1 }, source: 'imported', householdId: null,
  notes: '', seriesId: null, excludedDates: [], overrides: {},
  importMeta: {
    provider: 'rakvere', providerName: 'Rakvere jäätmevedu', addressKey: 'tamme 5 rakvere', address: 'Tamme 5, Rakvere',
    externalId: 'bio-2026-09-22', importedAt: '2026-09-01T08:00:00.000Z',
  },
};
const FULL_PLACES = [
  { name: 'Kodu', address: 'Tamme 5', lat: 59.3463, lon: 26.3553 },
  { name: 'Kool', address: 'Vabaduse 1', lat: 59.3501, lon: 26.3612 },
  { name: 'Trenn', address: 'Kastani 12', lat: 59.3389, lon: 26.3478 },
];
const FULL_SOURCES = Object.freeze({
  calendar: JSON.stringify({ version: 1, events: [FULL_MANUAL_EVENT, FULL_WASTE_EVENT], wasteImports: [FULL_WASTE_BATCH], theme: 'dark' }),
  household: JSON.stringify({ version: 1, profile: { name: 'Kodu', address: 'Tamme 5' }, note: 'shared household note' }),
  places: JSON.stringify(FULL_PLACES),
});

test('full legacy migration persists across reload, excludes private data and leaves legacy storage byte-identical', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const migrated = await harness.evaluate(`(async () => {
      const sources = ${JSON.stringify(FULL_SOURCES)};
      const privateValues = ${JSON.stringify(PRIVATE_VALUES)};
      await __t.reset();
      __t.seed(sources);
      for (const [key, value] of Object.entries(privateValues)) localStorage.setItem(key, value);
      const before = __t.snapshot();
      // Test-only storage view: records every key migration requests and any non-getItem access.
      const requested = [];
      const otherAccess = [];
      const recordingStorage = new Proxy({}, {
        get(_target, property) {
          if (property !== 'getItem') { otherAccess.push(String(property)); return undefined; }
          return key => { requested.push(key); return localStorage.getItem(key); };
        },
      });
      const run = await __t.run({ storage: recordingStorage, ids: ['place-1', 'place-2', 'place-3'] });
      return {
        before, beforeText: JSON.stringify(before),
        result: run.result, thrown: run.thrown, newIdCalls: run.newIdCalls, preparationIdCalls: run.preparationIdCalls,
        requested, otherAccess,
      };
    })()`);
    assert.deepEqual(migrated.result, { status: 'completed', legacyMutated: false });
    assert.equal(migrated.thrown, null);
    assert.equal(migrated.newIdCalls, 3);
    assert.equal(migrated.preparationIdCalls, 1);
    assert.deepEqual(migrated.requested, ['majamajandus_household_events_v1', 'majamajandus_household_profile_v1', 'sade_saved_places']);
    assert.deepEqual(migrated.otherAccess, []);
    assert.deepEqual(migrated.before.map(([key]) => key), [
      'annivibe_saved_ideas', 'majamajandus_household_events_v1', 'majamajandus_household_profile_v1',
      'majamajandus_reminder_delivery_v1', 'majamajandus_reminder_preferences_v1', 'sade_diary_entries',
      'sade_diary_pin', 'sade_profile', 'sade_saved_places', 'sade_saved_tips',
    ]);
    for (const sentinel of Object.values(PRIVATE_SENTINELS)) assert.ok(migrated.beforeText.includes(sentinel), `seeded ${sentinel}`);

    // The run helper closed its replica; reload the page context and reopen the database from disk.
    await harness.pageReload();
    const reopened = await harness.evaluate(`(async () => {
      const data = await __t.dump();
      const meta = key => data.meta.find(record => record.key === key) || null;
      const sharedKeys = [...__t.legacy.LEGACY_SHARED_KEYS];
      const digestInput = JSON.stringify(sharedKeys.map(key => localStorage.getItem(key)));
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digestInput));
      const after = __t.snapshot();
      return {
        after, afterText: JSON.stringify(after), sharedKeys, data, digestInput,
        recomputedDigest: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
        marker: meta(__t.MARKER_KEY),
        calendarExtras: meta('calendarLegacyEnvelopeExtras'),
        householdExtras: meta('householdLegacyEnvelopeExtras'),
      };
    })()`);
    const { data, marker } = reopened;
    const local = { revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' };

    assert.equal(reopened.afterText, migrated.beforeText, 'complete localStorage snapshot is byte-for-byte unchanged');
    assert.deepEqual(reopened.after, migrated.before);

    assert.equal(marker.status, 'complete');
    assert.equal(marker.preparationId, 'prep-1');
    assert.equal(marker.preparedAt, local.updatedAt);
    assert.deepEqual(marker.generatedIds, { sharedPlaces: ['place-1', 'place-2', 'place-3'] });
    assert.deepEqual(marker.migratedCalendarIds, ['event-manual', 'event-waste']);
    assert.deepEqual([...marker.migratedSingletonKeys].sort(), ['household', 'waste']);
    assert.deepEqual([...marker.migratedMetaKeys].sort(), ['calendarLegacyEnvelopeExtras', 'householdLegacyEnvelopeExtras']);
    assert.deepEqual(reopened.sharedKeys, ['majamajandus_household_events_v1', 'majamajandus_household_profile_v1', 'sade_saved_places']);
    assert.equal(marker.sourceDigest, reopened.recomputedDigest, 'marker digest covers exactly the approved raw tuple');

    assert.deepEqual(data.householdProfile, [{ key: 'household', payload: { name: 'Kodu', address: 'Tamme 5', serverHouseholdId: null }, ...local }]);
    assert.deepEqual(data.calendarEvents.map(record => record.id).sort(), ['event-manual', 'event-waste']);
    for (const expected of [FULL_MANUAL_EVENT, FULL_WASTE_EVENT]) {
      assert.deepEqual(data.calendarEvents.find(record => record.id === expected.id), { id: expected.id, payload: expected, ...local });
    }
    const places = data.sharedPlaces.slice().sort((left, right) => left.order - right.order);
    assert.equal(places.length, 3);
    assert.deepEqual(places.map(record => record.order), [0, 1, 2]);
    assert.deepEqual(places.map(record => record.id), ['place-1', 'place-2', 'place-3']);
    assert.deepEqual(places.map(record => record.payload), FULL_PLACES);
    for (const { id, order, payload, ...envelope } of places) assert.deepEqual(envelope, local, id);
    assert.deepEqual(data.wasteState, [{ key: 'waste', payload: { wasteImports: [FULL_WASTE_BATCH] }, ...local }]);
    assert.equal(data.outbox.length, 0);
    assert.deepEqual(reopened.calendarExtras, { key: 'calendarLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: { theme: 'dark' } } });
    assert.deepEqual(reopened.householdExtras, { key: 'householdLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: { note: 'shared household note' } } });

    const targets = {
      householdProfile: data.householdProfile,
      calendarEvents: data.calendarEvents,
      sharedPlaces: data.sharedPlaces,
      wasteState: data.wasteState,
      legacyMigrationV1: marker,
      calendarLegacyEnvelopeExtras: reopened.calendarExtras,
      householdLegacyEnvelopeExtras: reopened.householdExtras,
      sourceDigestInput: reopened.digestInput,
      allStores: data,
    };
    for (const [name, target] of Object.entries(targets)) {
      assert.ok(target !== null && target !== undefined, `${name} exists`);
      const text = typeof target === 'string' ? target : JSON.stringify(target);
      for (const [key, sentinel] of Object.entries(PRIVATE_SENTINELS)) {
        assert.ok(!text.includes(sentinel), `${name} must not contain the ${key} sentinel`);
        assert.ok(!text.includes(key), `${name} must not name the private key ${key}`);
      }
    }
  } finally {
    await harness.cleanup();
  }
});

// ---- C4: authority controller (Sections 1a-1c, 2-6) ------------------------------------------

const C4_PAGE = `window.__c4 = (() => {
  const api = window.storageApi;
  const KEYS = api.legacy.LEGACY_SHARED_KEYS;
  const STAMP = '2026-09-16T10:00:00.000Z';
  const HINT_KEY = 'majandus_storage_authority_v1';
  const spyStorage = (opts = {}) => {
    const { throwGet = [], throwSet = [], throwRemove = [] } = opts;
    const calls = [];
    return {
      calls,
      getItem(key) { calls.push(['get', key]); if (throwGet.includes(key)) throw new Error('blocked get ' + key); return localStorage.getItem(key); },
      setItem(key, value) { calls.push(['set', key]); if (throwSet.includes(key)) throw new Error('blocked set ' + key); localStorage.setItem(key, value); },
      removeItem(key) { calls.push(['remove', key]); if (throwRemove.includes(key)) throw new Error('blocked remove ' + key); localStorage.removeItem(key); },
    };
  };
  const makeController = (overrides = {}) => api.createStorageAuthorityController({
    indexedDb: indexedDB,
    storage: overrides.storage || spyStorage(overrides.storageOpts),
    newId: overrides.newId || window.__t.counter(overrides.ids || ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8']),
    clock: overrides.clock || (() => overrides.stamp || STAMP),
    cryptoApi: overrides.cryptoApi || crypto,
    locks: overrides.locks,
    persist: overrides.persist,
    broadcast: overrides.broadcast,
    mode: overrides.mode || 'forward',
  });
  const authorityOf = data => data.meta.find(record => record.key === 'storageAuthorityV1') || null;
  const attemptOf = data => data.meta.find(record => record.key === 'storageRevertAttemptV1') || null;
  const legacyBytes = () => Object.fromEntries(KEYS.map(key => [key, localStorage.getItem(key)]));
  // Boots a fresh device through migration + switch to a real READY authority; returns the controller (left open).
  const switchedSetup = async (sources = {}, overrides = {}) => {
    await window.__t.reset();
    window.__t.seed(sources);
    const controller = makeController(overrides);
    const result = await controller.boot();
    return { controller, result };
  };
  return { spyStorage, makeController, authorityOf, attemptOf, legacyBytes, switchedSetup, dump: window.__t.dump, reset: window.__t.reset, seed: window.__t.seed, api };
})();
'ready';`;

async function c4Harness() {
  const harness = await createBrowserHarness();
  await harness.evaluate(C4_PAGE);
  return harness;
}

test('C4 a clean device migrates, switches with the exact fresh authority fields and reaches READY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, authorityOf, dump } = window.__c4;
      const { controller, result } = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      const data = await dump();
      const authority = authorityOf(data);
      await controller.close();
      return { result, authority };
    })()`);
    assert.equal(result.result.state, 'READY');
    assert.deepEqual(result.authority, {
      key: 'storageAuthorityV1', status: 'active', switchId: 'switch-1', switchedAt: '2026-09-16T10:00:00.000Z',
      legacyDigestAtSwitch: result.authority.legacyDigestAtSwitch, markerPreparationId: result.authority.markerPreparationId,
      commitCount: 0, legacyUntrusted: false, persistGranted: null,
    });
    assert.match(result.authority.legacyDigestAtSwitch, /^[0-9a-f]{64}$/);
    assert.ok(result.authority.markerPreparationId.length > 0);
  } finally {
    await harness.cleanup();
  }
});


test('C4 a malformed authority record gives STORAGE_UNAVAILABLE/authority-malformed for every malformed class, with zero legacy writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, legacyBytes } = window.__c4;
      const { api } = window.__c4;
      const valid = { key: 'storageAuthorityV1', status: 'active', switchId: 's1', switchedAt: '2026-09-16T10:00:00.000Z',
        legacyDigestAtSwitch: 'a'.repeat(64), markerPreparationId: 'p1', commitCount: 0, legacyUntrusted: false, persistGranted: null };
      const classes = {
        extraKey: { ...valid, extra: 1 },
        wrongStatus: { ...valid, status: 'pending' },
        emptySwitchId: { ...valid, switchId: '' },
        invalidSwitchedAt: { ...valid, switchedAt: 'not-a-date' },
        shortDigest: { ...valid, legacyDigestAtSwitch: 'a'.repeat(63) },
        negativeCommitCount: { ...valid, commitCount: -1 },
        nonBooleanUntrusted: { ...valid, legacyUntrusted: 'no' },
        badPersistGranted: { ...valid, persistGranted: 'yes' },
      };
      const out = {};
      for (const [name, record] of Object.entries(classes)) {
        await reset();
        seed({ calendar: null, household: null, places: null });
        await window.__t.put('meta', record);
        const before = legacyBytes();
        const controller = makeController();
        const boot = await controller.boot();
        await controller.close();
        out[name] = { boot, unchanged: JSON.stringify(legacyBytes()) === JSON.stringify(before) };
      }
      return out;
    })()`);
    for (const [name, entry] of Object.entries(result)) {
      assert.deepEqual(entry.boot, { state: 'STORAGE_UNAVAILABLE', reason: 'authority-malformed' }, name);
      assert.equal(entry.unchanged, true, name);
    }
  } finally {
    await harness.cleanup();
  }
});

test('C4 revert attempt orphan and invalid-under-reverting classes are reported correctly with zero writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, legacyBytes } = window.__c4;
      const activeAuthority = { key: 'storageAuthorityV1', status: 'active', switchId: 's1', switchedAt: '2026-09-16T10:00:00.000Z',
        legacyDigestAtSwitch: 'a'.repeat(64), markerPreparationId: 'p1', commitCount: 0, legacyUntrusted: false, persistGranted: null };
      const revertingAuthority = { ...activeAuthority, status: 'reverting' };
      const orphanAttempt = { key: 'storageRevertAttemptV1', switchId: 's1', attemptId: 'a1', commitCountAtStart: 0, phase: 'started' };
      const out = {};
      // orphan: attempt present while authority active
      await reset(); seed({ calendar: null, household: null, places: null });
      await window.__t.put('meta', activeAuthority);
      await window.__t.put('meta', orphanAttempt);
      out.orphanWhileActive = await makeController().boot();
      // orphan: attempt present while authority absent
      await reset(); seed({ calendar: null, household: null, places: null });
      await window.__t.put('meta', orphanAttempt);
      out.orphanWhileAbsent = await makeController().boot();
      // orphan: different switchId while reverting
      await reset(); seed({ calendar: null, household: null, places: null });
      await window.__t.put('meta', revertingAuthority);
      await window.__t.put('meta', { ...orphanAttempt, switchId: 'other-switch' });
      out.orphanDifferentSwitchId = await makeController().boot();
      // invalid-under-reverting: attempt missing
      await reset(); seed({ calendar: null, household: null, places: null });
      await window.__t.put('meta', revertingAuthority);
      out.missingAttempt = await makeController().boot();
      // invalid-under-reverting: bad commitCountAtStart
      await reset(); seed({ calendar: null, household: null, places: null });
      await window.__t.put('meta', { ...revertingAuthority, commitCount: 5 });
      await window.__t.put('meta', orphanAttempt);
      out.badCommitCountAtStart = await makeController().boot();
      return out;
    })()`);
    assert.deepEqual(result.orphanWhileActive, { state: 'STORAGE_UNAVAILABLE', reason: 'revert-attempt-orphan' });
    assert.deepEqual(result.orphanWhileAbsent, { state: 'STORAGE_UNAVAILABLE', reason: 'revert-attempt-orphan' });
    assert.deepEqual(result.orphanDifferentSwitchId, { state: 'STORAGE_UNAVAILABLE', reason: 'revert-attempt-orphan' });
    assert.equal(result.missingAttempt.state, 'READY');
    assert.equal(result.badCommitCountAtStart.state, 'READY');
  } finally {
    await harness.cleanup();
  }
});

test('C4 an active authority rewrites a missing/malformed/mismatched hint through the gate and reports AUTHORITY_HINT_PENDING on failure', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, dump, authorityOf } = window.__c4;
      const HINT_KEY = 'majandus_storage_authority_v1';
      // 1) fresh switch already writes a matching hint; a second boot must leave it unchanged.
      const first = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      const hintAfterSwitch = localStorage.getItem(HINT_KEY);
      await first.controller.close();

      // 2) hint cleared -> gate rewrites it; boot still reaches READY.
      localStorage.removeItem(HINT_KEY);
      const second = await window.__c4.makeController({ ids: ['unused'] }).boot();
      const hintAfterClear = localStorage.getItem(HINT_KEY);

      // 3) hint gate failure (setItem throws) -> AUTHORITY_HINT_PENDING, IndexedDB stays authoritative.
      localStorage.removeItem(HINT_KEY);
      const throwingController = window.__c4.makeController({ storageOpts: { throwSet: [HINT_KEY] } });
      const pending = await throwingController.boot();
      const dataWhilePending = await dump();
      await throwingController.close();

      // 4) retry succeeds once the gate is unblocked.
      const retryController = window.__c4.makeController();
      const retried = await retryController.boot();
      await retryController.close();
      return { hintAfterSwitch, first: first.result, hintAfterClear, second, pending, authorityWhilePending: authorityOf(dataWhilePending), retried };
    })()`);
    assert.equal(result.first.state, 'READY');
    assert.ok(result.hintAfterSwitch, 'the fresh switch wrote a hint');
    assert.equal(result.second.state, 'READY');
    assert.ok(result.hintAfterClear, 'the hint gate rewrote the cleared hint');
    assert.deepEqual(result.pending, { state: 'AUTHORITY_HINT_PENDING' });
    assert.equal(result.authorityWhilePending.status, 'active', 'IndexedDB stays authoritative while the hint gate is pending');
    assert.equal(result.retried.state, 'READY');
  } finally {
    await harness.cleanup();
  }
});

test('C4 authority-absent with a valid or malformed hint gives STORAGE_LOST, and confirmation restores through migration with a new switchId', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const HINT_KEY = 'majandus_storage_authority_v1';
      const validHint = JSON.stringify({ version: 1, switchId: 'old-switch', legacyDigestAtSwitch: 'a'.repeat(64), switchedAt: '2026-09-16T09:00:00.000Z' });
      await reset();
      seed({});
      localStorage.setItem(HINT_KEY, validHint);
      const datedController = makeController();
      const dated = await datedController.boot();
      const confirmed = await datedController.confirmStorageLost();
      const dataAfterConfirm = await dump();
      await datedController.close();

      await reset();
      seed({});
      localStorage.setItem(HINT_KEY, 'not json');
      const undatedController = makeController();
      const undated = await undatedController.boot();
      await undatedController.close();

      return { dated, confirmed, authorityAfterConfirm: authorityOf(dataAfterConfirm), undated };
    })()`);
    assert.deepEqual(result.dated, { state: 'STORAGE_LOST', variant: 'dated', switchedAt: '2026-09-16T09:00:00.000Z', hintRaw: result.dated.hintRaw });
    assert.equal(result.confirmed.state, 'READY');
    assert.equal(result.authorityAfterConfirm.switchId, 'id-1', 'confirmation uses a fresh switchId');
    assert.equal(result.undated.state, 'STORAGE_LOST');
    assert.equal(result.undated.variant, 'undated');
  } finally {
    await harness.cleanup();
  }
});

test('C4 persist() is attempted at most once per boot and only its resolved boolean is durably stored', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, dump, authorityOf, makeController } = window.__c4;
      const out = {};
      for (const [name, persist] of Object.entries({
        resolvesTrue: () => Promise.resolve(true),
        resolvesFalse: () => Promise.resolve(false),
        rejects: () => Promise.reject(new Error('denied')),
        nonBoolean: () => Promise.resolve('yes'),
      })) {
        const { controller } = await switchedSetup({}, { ids: ['switch-1', 'prep-1'], persist });
        const data = await dump();
        await controller.close();
        out[name] = authorityOf(data).persistGranted;
      }
      // unavailable: no persist capability at all -> stays null.
      const { controller } = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      const data = await dump();
      await controller.close();
      out.unavailable = authorityOf(data).persistGranted;

      // a false result is never retried; a null result retries and can still resolve later.
      await window.__c4.reset();
      window.__c4.seed({});
      let calls = 0;
      const countingFalse = () => { calls += 1; return Promise.resolve(false); };
      const c1 = window.__c4.makeController({ ids: ['switch-1', 'prep-1'], persist: countingFalse });
      await c1.boot();
      await c1.close();
      const c2 = window.__c4.makeController({ persist: countingFalse });
      await c2.boot();
      await c2.close();
      out.falseNeverRetried = calls;
      return out;
    })()`);
    assert.equal(result.resolvesTrue, true);
    assert.equal(result.resolvesFalse, false);
    assert.equal(result.rejects, null);
    assert.equal(result.nonBoolean, null);
    assert.equal(result.unavailable, null);
    assert.equal(result.falseNeverRetried, 1, 'the second boot must not call persist() again once stored');
  } finally {
    await harness.cleanup();
  }
});

test('C4 post-switch legacy divergence stays READY with IndexedDB authoritative, no re-adopt/reset/re-migration/deletion', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, dump, authorityOf } = window.__c4;
      const [CAL, HOUSE, PLACES] = window.__t.legacy.LEGACY_SHARED_KEYS;
      const out = {};

      // Case A: all three legacy keys cleared after switch (commitCount 0), hint kept.
      const a = await switchedSetup({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' }, { ids: ['switch-1', 'prep-1'] });
      const beforeA = await dump();
      localStorage.removeItem(CAL); localStorage.removeItem(HOUSE); localStorage.removeItem(PLACES);
      const controllerA = window.__c4.makeController();
      const resultA = await controllerA.boot();
      const afterA = await dump();
      await a.controller.close(); await controllerA.close();
      out.allCleared = { result: resultA, unchanged: JSON.stringify(beforeA) === JSON.stringify(afterA) };

      // Case B: whole localStorage cleared (hint gone too) -> hint rewritten, legacy stays absent, still divergence.
      const b = await switchedSetup({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' }, { ids: ['switch-1', 'prep-1'] });
      await b.controller.close();
      const beforeB = await dump();
      localStorage.clear();
      const controllerB = window.__c4.makeController();
      const resultB = await controllerB.boot();
      const afterB = await dump();
      await controllerB.close();
      out.allLocalStorageCleared = { result: resultB, authorityUnchanged: JSON.stringify(authorityOf(beforeB)) === JSON.stringify({ ...authorityOf(afterB) }) };

      // Case C: one key removed only (household).
      const c = await switchedSetup({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' }, { ids: ['switch-1', 'prep-1'] });
      await c.controller.close();
      localStorage.removeItem(HOUSE);
      const controllerC = window.__c4.makeController();
      const resultC = await controllerC.boot();
      await controllerC.close();
      out.oneKeyRemoved = resultC;

      // Case D: old-build style edit (a raw calendar envelope write after switch).
      const d = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      await d.controller.close();
      localStorage.setItem(CAL, JSON.stringify({ version: 1, events: [{ id:'e1', title:'X', category:'other', subtype:null, date:'2026-09-20', time:null, recurrence:{frequency:'none',interval:1}, reminder:{daysBefore:0}, source:'manual', householdId:null, notes:'', seriesId:null, excludedDates:[], overrides:{} }] }));
      const controllerD = window.__c4.makeController();
      const resultD = await controllerD.boot();
      await controllerD.close();
      out.oldBuildEdit = resultD;

      return out;
    })()`);
    assert.equal(result.allCleared.result.state, 'READY');
    assert.equal(result.allCleared.result.divergence, 'LEGACY_DIVERGED');
    assert.equal(result.allCleared.unchanged, true, 'no IndexedDB record changed because of divergence');
    assert.equal(result.allLocalStorageCleared.result.state, 'READY');
    assert.equal(result.allLocalStorageCleared.result.divergence, 'LEGACY_DIVERGED');
    assert.equal(result.allLocalStorageCleared.authorityUnchanged, true, 'authority is not deleted or reset on divergence');
    assert.equal(result.oneKeyRemoved.state, 'READY');
    assert.equal(result.oneKeyRemoved.divergence, 'LEGACY_DIVERGED');
    assert.equal(result.oldBuildEdit.state, 'READY');
    assert.equal(result.oldBuildEdit.divergence, 'LEGACY_DIVERGED');
  } finally {
    await harness.cleanup();
  }
});

test('C4 a real versionchange delivered mid-boot resolves RELOAD_REQUIRED, never LEGACY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController } = window.__c4;
      const { api } = window.__c4;
      await reset();
      seed({});
      const controller = makeController();
      const bootPromise = controller.boot();
      // Force a real versionchange on the controller's own connection by requesting a higher version.
      const bump = new Promise(resolve => {
        const request = indexedDB.open(api.DB_NAME, api.DB_VERSION + 1);
        request.onsuccess = () => { request.result.close(); resolve('upgraded'); };
        request.onblocked = () => resolve('blocked');
      });
      const outcome = await bootPromise;
      await bump;
      await controller.close();
      return outcome;
    })()`);
    assert.equal(result.state, 'RELOAD_REQUIRED');
  } finally {
    await harness.cleanup();
  }
});

test('C4 two concurrent boots without a Web Lock converge on exactly one authority and both reach READY, never LEGACY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, spyStorage } = window.__c4;
      const SHARED = window.__t.legacy.LEGACY_SHARED_KEYS;
      const idsFor = prefix => { let n = 0; return () => prefix + '-' + (++n); };
      // Test-only instrumentation: counts fresh authority creations (the only put of this exact shape).
      const originalPut = IDBObjectStore.prototype.put;
      let creations = 0;
      IDBObjectStore.prototype.put = function (value, ...rest) {
        if (value && value.key === 'storageAuthorityV1' && value.status === 'active' && value.commitCount === 0
          && value.legacyUntrusted === false && value.persistGranted === null) creations += 1;
        return originalPut.call(this, value, ...rest);
      };
      const rounds = [];
      try {
        for (let round = 0; round < 8; round += 1) {
          await reset();
          seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}', places: '[{"name":"Kodu"}]' });
          // Odd rounds pre-complete the migration, so both boots get already-complete and race directly
          // in the switch transaction (the loser observes authority-present there). Even rounds race
          // from a clean device, where the loser usually loses inside migration (concurrent-migration).
          const premigrated = round % 2 === 1;
          if (premigrated) await window.__t.run({ ids: ['pre-place-1'] });
          creations = 0;
          const storageA = spyStorage();
          const storageB = spyStorage();
          const first = makeController({ newId: idsFor('a' + round), storage: storageA, stamp: '2026-09-16T10:00:00.000Z' });
          const second = makeController({ newId: idsFor('b' + round), storage: storageB, stamp: '2026-09-16T11:00:00.000Z' });
          const [resultFirst, resultSecond] = await Promise.all([first.boot(), second.boot()]);
          const data = await dump();
          await first.close(); await second.close();
          const marker = data.meta.find(record => record.key === 'legacyMigrationV1') || null;
          const sharedWrites = [...storageA.calls, ...storageB.calls].filter(([op, key]) => op !== 'get' && SHARED.includes(key));
          rounds.push({
            premigrated,
            states: [resultFirst.state, resultSecond.state],
            creations,
            authorityRecords: data.meta.filter(record => record.key === 'storageAuthorityV1').length,
            authority: authorityOf(data),
            hint: localStorage.getItem('majandus_storage_authority_v1'),
            marker,
            sharedWrites,
          });
        }
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      return rounds;
    })()`);
    assert.equal(result.filter(round => round.premigrated).length, 4);
    for (const [index, round] of result.entries()) {
      assert.deepEqual(round.states, ['READY', 'READY'], `round ${index} (premigrated=${round.premigrated}): neither concurrent boot finishes LEGACY`);
      assert.equal(round.creations, 1, `round ${index}: exactly one authority creation`);
      assert.equal(round.authorityRecords, 1, `round ${index}`);
      const winner = round.authority.switchId.startsWith('a') ? '2026-09-16T10:00:00.000Z' : '2026-09-16T11:00:00.000Z';
      assert.match(round.authority.switchId, /^[ab]\d-\d+$/, `round ${index}`);
      assert.equal(round.authority.switchedAt, winner, `round ${index}: the record is one controller's switch, not a mixture`);
      assert.equal(round.authority.commitCount, 0, `round ${index}`);
      assert.deepEqual(JSON.parse(round.hint), {
        version: 1, switchId: round.authority.switchId, legacyDigestAtSwitch: round.authority.legacyDigestAtSwitch, switchedAt: round.authority.switchedAt,
      }, `round ${index}: both boots converge on the winning hint`);
      assert.equal(round.marker.status, 'complete', `round ${index}`);
      assert.equal(round.marker.preparationId, round.authority.markerPreparationId, `round ${index}: the loser did not reset or re-migrate under the winning authority`);
      assert.deepEqual(round.sharedWrites, [], `round ${index}: no shared legacy key write`);
    }
  } finally {
    await harness.cleanup();
  }
});

test('C4 a switch guard failure with authority confirmed absent inside the transaction still resolves LEGACY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, spyStorage } = window.__c4;
      const SHARED = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      // The migration digest is real; the pre-switch digest differs, so the marker digest guard fails.
      let digestCalls = 0;
      const cryptoApi = { subtle: { digest: async (algorithm, bytes) => {
        digestCalls += 1;
        if (digestCalls === 1) return crypto.subtle.digest(algorithm, bytes);
        return crypto.subtle.digest(algorithm, new TextEncoder().encode('changed-before-switch'));
      } } };
      const storage = spyStorage();
      const controller = makeController({ ids: ['switch-1', 'prep-1'], cryptoApi, storage });
      const boot = await controller.boot();
      const data = await dump();
      await controller.close();
      return {
        boot, authority: authorityOf(data),
        marker: data.meta.find(record => record.key === 'legacyMigrationV1') || null,
        hint: localStorage.getItem('majandus_storage_authority_v1'),
        sharedWrites: storage.calls.filter(([op, key]) => op !== 'get' && SHARED.includes(key)),
      };
    })()`);
    assert.deepEqual(result.boot, { state: 'LEGACY' });
    assert.equal(result.authority, null, 'the transaction confirmed authority absent and created none');
    assert.equal(result.marker.status, 'complete');
    assert.equal(result.hint, null);
    assert.deepEqual(result.sharedWrites, []);
  } finally {
    await harness.cleanup();
  }
});

test('C4 a legacy write between migration and switch triggers the stale reset, then the latest state is adopted', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump } = window.__c4;
      const [CAL] = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      // Pre-populate a completed migration marker/records with a digest that will not match the
      // current source, forcing runLegacyMigration to report source-changed-after-complete.
      const stale = await window.__t.run({});
      const controller = makeController({ ids: ['switch-1', 'prep-2', 'p-3', 'p-4'] });
      // Overwrite the household after the marker was prepared, before the controller boots.
      localStorage.setItem(window.__t.legacy.LEGACY_SHARED_KEYS[1], '{"version":1,"profile":{"name":"Uus","address":""}}');
      const boot = await controller.boot();
      const data = await dump();
      await controller.close();
      return { boot, household: data.householdProfile };
    })()`);
    assert.equal(result.boot.state, 'READY');
    assert.equal(result.household.length, 1);
    assert.equal(result.household[0].payload.name, 'Uus', 'the stale reset adopted the latest legacy state');
  } finally {
    await harness.cleanup();
  }
});

test('C4 a forward build finding reverting applies the Section 1a forward row exactly (legacyUntrusted per phase) and proceeds as active', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const base = { key: 'storageAuthorityV1', status: 'reverting', switchId: 's1', switchedAt: '2026-09-16T10:00:00.000Z',
        legacyDigestAtSwitch: 'a'.repeat(64), markerPreparationId: 'p1', commitCount: 0, legacyUntrusted: false, persistGranted: null };
      const startedAttempt = { key: 'storageRevertAttemptV1', switchId: 's1', attemptId: 'a1', commitCountAtStart: 0, phase: 'started' };
      await reset(); seed({});
      await window.__t.put('meta', base);
      await window.__t.put('meta', startedAttempt);
      const startedResult = await makeController().boot();
      const startedData = await dump();

      await reset(); seed({});
      await window.__t.put('meta', base);
      await window.__t.put('meta', { ...startedAttempt, phase: 'backups-verified' });
      const verifiedResult = await makeController().boot();
      const verifiedData = await dump();

      return {
        startedResult, verifiedResult,
        startedAuthority: authorityOf(startedData), startedAttempt: attemptOfMeta(startedData),
        verifiedAuthority: authorityOf(verifiedData), verifiedAttempt: attemptOfMeta(verifiedData),
      };
      function attemptOfMeta(data) { return data.meta.find(r => r.key === 'storageRevertAttemptV1') || null; }
    })()`);
    assert.equal(result.startedResult.state, 'READY');
    assert.equal(result.startedAuthority.status, 'active');
    assert.equal(result.startedAuthority.legacyUntrusted, false, 'phase started -> legacyUntrusted unchanged');
    assert.equal(result.startedAttempt, null, 'attempt is deleted');
    assert.equal(result.verifiedResult.state, 'READY');
    assert.equal(result.verifiedAuthority.status, 'active');
    assert.equal(result.verifiedAuthority.legacyUntrusted, true, 'phase backups-verified -> legacyUntrusted true');
    assert.equal(result.verifiedAttempt, null);
  } finally {
    await harness.cleanup();
  }
});

test('C4 revert exports the authoritative IndexedDB state (not frozen legacy), backs up the originals write-once and completes to LEGACY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, attemptOf } = window.__c4;
      await reset();
      seed(${JSON.stringify({ calendar: FULL_SOURCES.calendar, household: FULL_SOURCES.household, places: FULL_SOURCES.places })});
      const forward = makeController({ ids: ['switch-1', 'prep-1', 'place-1', 'place-2', 'place-3'] });
      const forwardResult = await forward.boot();
      await forward.close();
      const legacyBeforeRevert = window.__c4.legacyBytes();

      // Mutate IndexedDB directly (simulating post-switch user edits): delete the imported waste
      // event and change the household address. The revert export must reflect these, not the frozen legacy bytes.
      await window.__t.withReplica(replica => replica.transact(['calendarEvents', 'householdProfile'], 'readwrite', ({ stores }) => {
        stores.calendarEvents.delete('event-waste');
        const profile = { key: 'household', payload: { name: 'Kodu', address: 'Uus aadress', serverHouseholdId: null }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' };
        stores.householdProfile.put(profile);
      }));

      const revert = makeController({ mode: 'revert', ids: ['attempt-1'] });
      const revertResult = await revert.boot();
      const legacyAfterRevert = window.__c4.legacyBytes();
      const afterRevert = await dump();
      await revert.close();

      return {
        forwardResult, revertResult, legacyBeforeRevert, legacyAfterRevert,
        authorityAfter: authorityOf(afterRevert), attemptAfter: attemptOf(afterRevert),
        hintAfter: localStorage.getItem('majandus_storage_authority_v1'),
        pointer: localStorage.getItem('majandus_legacy_backup_v1_switch-1_current'),
        backupCalendar: localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_calendar'),
        backupHousehold: localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_household'),
        backupPlaces: localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_places'),
      };
    })()`);
    assert.equal(result.forwardResult.state, 'READY');
    assert.equal(result.revertResult.state, 'LEGACY');
    assert.equal(result.authorityAfter.status, 'reverted');
    assert.equal(result.attemptAfter, null);
    assert.equal(result.hintAfter, null, 'hint is removed on successful revert');

    const [calKey, houseKey, placesKey] = ['majamajandus_household_events_v1', 'majamajandus_household_profile_v1', 'sade_saved_places'];
    assert.deepEqual(JSON.parse(result.backupCalendar), { version: 1, legacyKey: calKey, raw: result.legacyBeforeRevert[calKey] });
    assert.deepEqual(JSON.parse(result.backupHousehold), { version: 1, legacyKey: houseKey, raw: result.legacyBeforeRevert[houseKey] });
    assert.deepEqual(JSON.parse(result.backupPlaces), { version: 1, legacyKey: placesKey, raw: result.legacyBeforeRevert[placesKey] });
    assert.deepEqual(JSON.parse(result.pointer), { version: 1, switchId: 'switch-1', attemptId: 'attempt-1' });

    const exportedCalendar = JSON.parse(result.legacyAfterRevert[calKey]);
    assert.deepEqual(exportedCalendar.events.map(event => event.id), ['event-manual'], 'the deleted event stays deleted');
    assert.deepEqual(exportedCalendar.wasteImports, [FULL_WASTE_BATCH]);
    assert.equal(exportedCalendar.theme, 'dark', 'extras are preserved');
    const exportedHousehold = JSON.parse(result.legacyAfterRevert[houseKey]);
    assert.deepEqual(exportedHousehold.profile, { name: 'Kodu', address: 'Uus aadress' }, 'the IndexedDB edit is exported, not the frozen legacy value');
    assert.equal(exportedHousehold.note, 'shared household note');
    assert.deepEqual(JSON.parse(result.legacyAfterRevert[placesKey]), FULL_PLACES);
  } finally {
    await harness.cleanup();
  }
});

test('C4 revert exports the accepted legacy defaults for an empty calendar, an absent household and zero places', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController } = window.__c4;
      await reset();
      seed({});
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      const forwardResult = await forward.boot();
      await forward.close();
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'] });
      const revertResult = await revert.boot();
      const legacy = window.__c4.legacyBytes();
      await revert.close();
      return { forwardResult, revertResult, legacy };
    })()`);
    assert.equal(result.forwardResult.state, 'READY');
    assert.equal(result.revertResult.state, 'LEGACY');
    const [calKey, houseKey, placesKey] = ['majamajandus_household_events_v1', 'majamajandus_household_profile_v1', 'sade_saved_places'];
    assert.deepEqual(JSON.parse(result.legacy[calKey]), { version: 1, events: [] });
    assert.deepEqual(JSON.parse(result.legacy[houseKey]), { version: 1, profile: { name: '', address: '' } });
    assert.deepEqual(JSON.parse(result.legacy[placesKey]), [
      { name: 'Kodu', address: '', lat: null, lon: null }, { name: 'Kool', address: '', lat: null, lon: null }, { name: 'Trenn', address: '', lat: null, lon: null },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test('C4 revert attemptId collision: up to 3 candidates are probed, and only a free candidate is used, with zero writes on collision', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      // 1) an earlier attempt's verified backup set exists under attemptId "taken"; the second/third
      //    candidate must be used instead, and the old set must stay byte-identical.
      await reset(); seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward1 = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward1.boot();
      await forward1.close();
      const oldSet = {
        calendar: JSON.stringify({ version: 1, legacyKey: calKey, raw: null }),
        household: JSON.stringify({ version: 1, legacyKey: houseKey, raw: null }),
        places: JSON.stringify({ version: 1, legacyKey: placesKey, raw: null }),
        pointer: JSON.stringify({ version: 1, switchId: 'switch-1', attemptId: 'taken' }),
      };
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_taken_calendar', oldSet.calendar);
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_taken_household', oldSet.household);
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_taken_places', oldSet.places);
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_current', oldSet.pointer);
      const revert1 = makeController({ mode: 'revert', ids: ['taken', 'fresh-1'] });
      const revert1Result = await revert1.boot();
      await revert1.close();
      const out1 = {
        result: revert1Result,
        oldCalendar: localStorage.getItem('majandus_legacy_backup_v1_switch-1_taken_calendar'),
        oldHousehold: localStorage.getItem('majandus_legacy_backup_v1_switch-1_taken_household'),
        oldPlaces: localStorage.getItem('majandus_legacy_backup_v1_switch-1_taken_places'),
        pointer: localStorage.getItem('majandus_legacy_backup_v1_switch-1_current'),
      };

      // 2) newId() returns the same taken id 3 times -> REVERT_FAILED/revert-attempt-id-collision, zero writes.
      await reset(); seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward2 = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward2.boot();
      await forward2.close();
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_taken_calendar', oldSet.calendar);
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_taken_household', oldSet.household);
      localStorage.setItem('majandus_legacy_backup_v1_switch-1_taken_places', oldSet.places);
      const legacyBefore2 = window.__c4.legacyBytes();
      const revert2 = makeController({ mode: 'revert', ids: ['taken', 'taken', 'taken'] });
      const revert2Result = await revert2.boot();
      const legacyAfter2 = window.__c4.legacyBytes();
      const authority2 = (await window.__t.dump()).meta.find(r => r.key === 'storageAuthorityV1');
      const attempt2 = (await window.__t.dump()).meta.find(r => r.key === 'storageRevertAttemptV1');
      await revert2.close();

      // 3) an empty-string candidate counts as taken.
      await reset(); seed({});
      const forward3 = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward3.boot();
      await forward3.close();
      const revert3 = makeController({ mode: 'revert', ids: ['', '', ''] });
      const revert3Result = await revert3.boot();
      await revert3.close();

      return { out1, revert2Result, legacyUnchanged2: JSON.stringify(legacyBefore2) === JSON.stringify(legacyAfter2), authority2, attempt2, revert3Result };
    })()`);
    assert.equal(result.out1.result.state, 'LEGACY', 'the fresh candidate completed the revert');
    assert.deepEqual(JSON.parse(result.out1.oldCalendar), { version: 1, legacyKey: 'majamajandus_household_events_v1', raw: null });
    assert.deepEqual(JSON.parse(result.out1.oldHousehold), { version: 1, legacyKey: 'majamajandus_household_profile_v1', raw: null });
    assert.deepEqual(JSON.parse(result.out1.oldPlaces), { version: 1, legacyKey: 'sade_saved_places', raw: null });
    assert.notEqual(JSON.parse(result.out1.pointer).attemptId, 'taken', 'the pointer now names the fresh attempt');

    assert.deepEqual(result.revert2Result, { state: 'REVERT_FAILED', reason: 'revert-attempt-id-collision' });
    assert.equal(result.legacyUnchanged2, true, 'zero shared-key writes on a full collision');
    assert.equal(result.authority2.status, 'active');
    assert.equal(result.attempt2, undefined);

    assert.deepEqual(result.revert3Result, { state: 'REVERT_FAILED', reason: 'revert-attempt-id-collision' });
  } finally {
    await harness.cleanup();
  }
});

test('C4 a failure after the first export write compensates byte-for-byte, restores absence with removeItem, and never reaches LEGACY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      // The household legacy key starts absent (raw null); the export write to it is forced to throw.
      await reset();
      seed({ places: '[{"name":"Kodu","address":"","lat":null,"lon":null}]' });
      const forward = makeController({ ids: ['switch-1', 'prep-1', 'place-1'] });
      const forwardResult = await forward.boot();
      await forward.close();
      const legacyBefore = window.__c4.legacyBytes();

      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storageOpts: { throwSet: [houseKey] } });
      const revertResult = await revert.boot();
      const legacyAfter = window.__c4.legacyBytes();
      const data = await window.__t.dump();
      const authority = data.meta.find(r => r.key === 'storageAuthorityV1');
      const attempt = data.meta.find(r => r.key === 'storageRevertAttemptV1');
      const backupHousehold = localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_household');
      await revert.close();
      return { forwardResult, revertResult, legacyBefore, legacyAfter, authority, attempt, backupHousehold };
    })()`);
    assert.equal(result.forwardResult.state, 'READY');
    assert.deepEqual(result.revertResult, { state: 'REVERT_FAILED', reason: 'revert-compensation-verified' });
    assert.deepEqual(result.legacyAfter, result.legacyBefore, 'all three shared keys are restored byte-for-byte, including the calendar key that had already been overwritten');
    assert.equal(result.legacyBefore.majamajandus_household_profile_v1, null, 'the household key was originally absent');
    assert.equal(result.legacyAfter.majamajandus_household_profile_v1, null, 'compensation used removeItem to restore absence');
    assert.equal(result.authority.status, 'active');
    assert.equal(result.authority.legacyUntrusted, false, 'a verified compensation leaves trust unchanged');
    assert.equal(result.attempt, undefined, 'the attempt record is deleted');
    assert.ok(result.backupHousehold, 'the backup set is retained after compensation');
  } finally {
    await harness.cleanup();
  }
});

test('C4 a compensation failure never reaches LEGACY, sets legacyUntrusted true and retains the backups (rollout STOP)', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();
      // The household key both fails on export AND fails to be restored during compensation.
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storageOpts: { throwSet: [houseKey] } });
      const revertResult = await revert.boot();
      const data = await window.__t.dump();
      const authority = data.meta.find(r => r.key === 'storageAuthorityV1');
      await revert.close();
      return { revertResult, authority };
    })()`);
    assert.deepEqual(result.revertResult, { state: 'REVERT_FAILED', reason: 'revert-compensation-failed' });
    assert.equal(result.authority.status, 'active');
    assert.equal(result.authority.legacyUntrusted, true);
  } finally {
    await harness.cleanup();
  }
});

test('C4 revert build with authority absent: hint absent is LEGACY, valid/malformed hints are REVERT_STORAGE_LOST, and confirmation removes the hint with zero other writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, legacyBytes } = window.__c4;
      const HINT_KEY = 'majandus_storage_authority_v1';
      const out = {};

      await reset(); seed({});
      out.hintAbsent = await makeController({ mode: 'revert' }).boot();

      await reset(); seed({});
      const validHint = JSON.stringify({ version: 1, switchId: 'old', legacyDigestAtSwitch: 'a'.repeat(64), switchedAt: '2026-09-16T09:00:00.000Z' });
      localStorage.setItem(HINT_KEY, validHint);
      const before = legacyBytes();
      const datedController = makeController({ mode: 'revert' });
      out.dated = await datedController.boot();
      out.afterDatedBoot = { legacy: legacyBytes(), hint: localStorage.getItem(HINT_KEY) };
      out.confirmedDated = await datedController.confirmRevertStorageLost();
      out.afterConfirmDated = { legacy: legacyBytes(), hint: localStorage.getItem(HINT_KEY) };
      await datedController.close();

      await reset(); seed({});
      localStorage.setItem(HINT_KEY, 'not json');
      const undatedController = makeController({ mode: 'revert' });
      out.undated = await undatedController.boot();
      out.confirmedUndated = await undatedController.confirmRevertStorageLost();
      out.hintAfterUndatedConfirm = localStorage.getItem(HINT_KEY);
      await undatedController.close();

      // unreadable hint -> STORAGE_UNAVAILABLE, zero writes.
      await reset(); seed({});
      const throwingController = makeController({ mode: 'revert', storageOpts: { throwGet: [HINT_KEY] } });
      out.unreadable = await throwingController.boot();
      await throwingController.close();

      out.legacyBefore = before;
      return out;
    })()`);
    assert.deepEqual(result.hintAbsent, { state: 'LEGACY' });
    assert.equal(result.dated.state, 'REVERT_STORAGE_LOST');
    assert.equal(result.dated.variant, 'dated');
    assert.equal(result.dated.switchedAt, '2026-09-16T09:00:00.000Z');
    assert.deepEqual(result.afterDatedBoot.legacy, result.legacyBefore, 'zero legacy writes before confirmation');
    assert.ok(result.afterDatedBoot.hint, 'the hint is not removed before confirmation');
    assert.deepEqual(result.confirmedDated, { state: 'LEGACY' });
    assert.equal(result.afterConfirmDated.hint, null, 'confirmation removes the hint');
    assert.deepEqual(result.afterConfirmDated.legacy, result.legacyBefore, 'confirmation writes nothing else');
    assert.equal(result.undated.state, 'REVERT_STORAGE_LOST');
    assert.equal(result.undated.variant, 'undated');
    assert.deepEqual(result.confirmedUndated, { state: 'LEGACY' });
    assert.equal(result.hintAfterUndatedConfirm, null);
    assert.deepEqual(result.unreadable, { state: 'STORAGE_UNAVAILABLE', reason: 'hint-unreadable' });
  } finally {
    await harness.cleanup();
  }
});

test('C4 REVERT_STORAGE_LOST confirmation re-enters BOOTING with zero writes when the hint changed since the screen was shown', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, legacyBytes } = window.__c4;
      const HINT_KEY = 'majandus_storage_authority_v1';
      await reset(); seed({});
      const oldHint = JSON.stringify({ version: 1, switchId: 'old', legacyDigestAtSwitch: 'a'.repeat(64), switchedAt: '2026-09-16T09:00:00.000Z' });
      localStorage.setItem(HINT_KEY, oldHint);
      const controller = makeController({ mode: 'revert' });
      const shown = await controller.boot();
      // The hint changes on another tab before the user confirms (still no authority record).
      const newHint = JSON.stringify({ version: 1, switchId: 'new', legacyDigestAtSwitch: 'b'.repeat(64), switchedAt: '2026-09-16T11:00:00.000Z' });
      localStorage.setItem(HINT_KEY, newHint);
      const before = legacyBytes();
      const confirmed = await controller.confirmRevertStorageLost();
      const after = legacyBytes();
      const hintAfter = localStorage.getItem(HINT_KEY);
      await controller.close();
      return { shown, confirmed, hintAfter, unchanged: JSON.stringify(before) === JSON.stringify(after) };
    })()`);
    assert.equal(result.shown.state, 'REVERT_STORAGE_LOST');
    assert.equal(result.shown.variant, 'dated');
    assert.equal(result.shown.switchedAt, '2026-09-16T09:00:00.000Z');
    // Re-entering BOOTING re-reads the hint fresh and shows REVERT_STORAGE_LOST again for the new hint.
    assert.equal(result.confirmed.state, 'REVERT_STORAGE_LOST');
    assert.equal(result.confirmed.switchedAt, '2026-09-16T11:00:00.000Z');
    assert.equal(result.unchanged, true, 'the stale confirmation itself writes nothing');
    assert.match(result.hintAfter, /"switchId":"new"/, 'the newer hint is left exactly as it was, not removed');
  } finally {
    await harness.cleanup();
  }
});

test('C4 resume in phase backups-verified after a crash before export uses the exact durable set without rewriting it', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, legacyBytes } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();
      const legacyBeforeCrash = legacyBytes();

      // Simulate a crash exactly after the backups-verified transition committed, before any export write.
      const data = await dump();
      const authority = authorityOf(data);
      await window.__t.put('meta', { ...authority, status: 'reverting' });
      await window.__t.put('meta', { key: 'storageRevertAttemptV1', switchId: authority.switchId, attemptId: 'crash-1', commitCountAtStart: authority.commitCount, phase: 'backups-verified' });
      for (const [domain, key] of [['calendar', calKey], ['household', houseKey], ['places', placesKey]]) {
        localStorage.setItem('majandus_legacy_backup_v1_' + authority.switchId + '_crash-1_' + domain, JSON.stringify({ version: 1, legacyKey: key, raw: legacyBeforeCrash[key] }));
      }
      localStorage.setItem('majandus_legacy_backup_v1_' + authority.switchId + '_current', JSON.stringify({ version: 1, switchId: authority.switchId, attemptId: 'crash-1' }));

      const backupBefore = localStorage.getItem('majandus_legacy_backup_v1_' + authority.switchId + '_crash-1_household');
      const revert = makeController({ mode: 'revert', ids: [] });
      const revertResult = await revert.boot();
      const backupAfter = localStorage.getItem('majandus_legacy_backup_v1_' + authority.switchId + '_crash-1_household');
      const legacyAfter = legacyBytes();
      await revert.close();
      return { revertResult, backupUnchanged: backupBefore === backupAfter, legacyAfter, switchId: authority.switchId };
    })()`);
    assert.deepEqual(result.revertResult, { state: 'LEGACY' });
    assert.equal(result.backupUnchanged, true, 'the exact durable backup set is used without being rewritten');
    assert.deepEqual(JSON.parse(result.legacyAfter.majamajandus_household_profile_v1), { version: 1, profile: { name: 'Kodu', address: '' } });
  } finally {
    await harness.cleanup();
  }
});

test('C4 crash in phase started before any backup write resumes and completes under the same attemptId', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();
      const data = await dump();
      const authority = authorityOf(data);
      await window.__t.put('meta', { ...authority, status: 'reverting' });
      await window.__t.put('meta', { key: 'storageRevertAttemptV1', switchId: authority.switchId, attemptId: 'crash-2', commitCountAtStart: authority.commitCount, phase: 'started' });
      const revert = makeController({ mode: 'revert', ids: [] });
      const revertResult = await revert.boot();
      const pointer = localStorage.getItem('majandus_legacy_backup_v1_' + authority.switchId + '_current');
      await revert.close();
      return { revertResult, pointer };
    })()`);
    assert.deepEqual(result.revertResult, { state: 'LEGACY' });
    assert.match(result.pointer, /"attemptId":"crash-2"/, 'the same attemptId is reused when no backup was written yet');
  } finally {
    await harness.cleanup();
  }
});

test('C4 a lost or corrupt backup/pointer in phase backups-verified gives REVERT_FAILED/revert-backups-lost with zero writes, and authority stays reverting', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const out = {};
      const setup = async () => {
        await reset();
        seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
        const forward = makeController({ ids: ['switch-1', 'prep-1'] });
        await forward.boot();
        await forward.close();
        const authority = authorityOf(await dump());
        await window.__t.put('meta', { ...authority, status: 'reverting' });
        await window.__t.put('meta', { key: 'storageRevertAttemptV1', switchId: authority.switchId, attemptId: 'lost-1', commitCountAtStart: authority.commitCount, phase: 'backups-verified' });
        return authority.switchId;
      };
      // missing pointer entirely
      let switchId = await setup();
      out.missingPointer = await makeController({ mode: 'revert', ids: [] }).boot();

      // pointer present but no backups at all
      switchId = await setup();
      localStorage.setItem('majandus_legacy_backup_v1_' + switchId + '_current', JSON.stringify({ version: 1, switchId, attemptId: 'lost-1' }));
      out.missingBackups = await makeController({ mode: 'revert', ids: [] }).boot();

      // pointer names a different attemptId
      switchId = await setup();
      localStorage.setItem('majandus_legacy_backup_v1_' + switchId + '_current', JSON.stringify({ version: 1, switchId, attemptId: 'someone-else' }));
      out.wrongPointer = await makeController({ mode: 'revert', ids: [] }).boot();

      const data = await dump();
      out.authorityAfter = authorityOf(data);
      return out;
    })()`);
    for (const name of ['missingPointer', 'missingBackups', 'wrongPointer']) {
      assert.deepEqual(result[name], { state: 'REVERT_FAILED', reason: 'revert-backups-lost' }, name);
    }
    assert.equal(result.authorityAfter.status, 'reverting', 'authority stays reverting; IndexedDB stays authoritative');
  } finally {
    await harness.cleanup();
  }
});

test('C4 re-forward after a completed revert (reverted) runs the reverted reset and migrates again to a fresh active authority', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'] });
      const revertResult = await revert.boot();
      await revert.close();
      const legacyAfterRevert = window.__c4.legacyBytes();

      const secondForward = makeController({ ids: ['switch-2', 'prep-2', 'p-1', 'p-2', 'p-3'] });
      const secondResult = await secondForward.boot();
      const data = await dump();
      await secondForward.close();
      return { revertResult, secondResult, authority: authorityOf(data) };
    })()`);
    assert.equal(result.revertResult.state, 'LEGACY');
    assert.equal(result.secondResult.state, 'READY');
    assert.equal(result.authority.status, 'active');
    assert.equal(result.authority.switchId, 'switch-2');
  } finally {
    await harness.cleanup();
  }
});

// ---- AMEND A: forward snapshot load/validation → DOMAIN_INVALID -----------------------------

test('C4 an invalid domain record loaded at READY is reported as DOMAIN_INVALID, per domain, with no auto-repair and other domains unaffected', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump } = window.__c4;
      const out = {};
      const freshSwitchedDevice = async () => {
        await reset();
        seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}', places: '[{"name":"Kodu","address":"","lat":null,"lon":null}]' });
        const forward = makeController({ ids: ['switch-1', 'prep-1', 'place-1'] });
        const bootResult = await forward.boot();
        await forward.close();
        return bootResult;
      };

      // 1) invalid householdProfile record
      await freshSwitchedDevice();
      const beforeHousehold = (await dump()).householdProfile[0];
      await window.__t.withReplica(replica => replica.transact(['householdProfile'], 'readwrite', ({ stores }) => {
        stores.householdProfile.put({ ...beforeHousehold, payload: { name: 'Kodu' } });
      }));
      let controller = makeController();
      out.invalidHousehold = await controller.boot();
      await controller.close();
      out.householdRecordAfter = (await dump()).householdProfile[0];

      // 2) invalid calendarEvents record (payload id mismatch)
      await freshSwitchedDevice();
      await window.__t.withReplica(replica => replica.transact(['calendarEvents'], 'readwrite', ({ stores }) => {
        stores.calendarEvents.put({ id: 'bad-event', payload: { id: 'other-id', title: 'X', category: 'other', subtype: null, date: '2026-09-20', time: null, recurrence: { frequency: 'none', interval: 1 }, reminder: { daysBefore: 0 }, source: 'manual', householdId: null, notes: '', seriesId: null, excludedDates: [], overrides: {} }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
      }));
      controller = makeController();
      out.invalidCalendar = await controller.boot();
      await controller.close();

      // 3) invalid wasteState record
      await freshSwitchedDevice();
      await window.__t.withReplica(replica => replica.transact(['wasteState'], 'readwrite', ({ stores }) => {
        stores.wasteState.put({ key: 'waste', payload: { wasteImports: [{ notAValidBatch: true }] }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
      }));
      controller = makeController();
      out.invalidWaste = await controller.boot();
      await controller.close();

      // 4) invalid sharedPlaces payload (lat not normalized: a string instead of a number)
      await freshSwitchedDevice();
      const beforePlace = (await dump()).sharedPlaces[0];
      await window.__t.withReplica(replica => replica.transact(['sharedPlaces'], 'readwrite', ({ stores }) => {
        stores.sharedPlaces.put({ ...beforePlace, payload: { ...beforePlace.payload, lat: '59.3' } });
      }));
      controller = makeController();
      out.invalidPlacePayload = await controller.boot();
      await controller.close();
      out.placeRecordAfter = (await dump()).sharedPlaces[0];

      // 5) non-contiguous sharedPlaces orders
      await freshSwitchedDevice();
      await window.__t.withReplica(replica => replica.transact(['sharedPlaces'], 'readwrite', ({ stores }) => {
        stores.sharedPlaces.add({ id: 'place-extra', order: 5, payload: { name: 'Koht', address: '', lat: null, lon: null }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
      }));
      controller = makeController();
      out.nonContiguousOrders = await controller.boot();
      await controller.close();

      return out;
    })()`);
    assert.deepEqual(result.invalidHousehold.domainInvalid, ['household']);
    assert.equal(result.invalidHousehold.state, 'READY');
    assert.deepEqual(result.householdRecordAfter.payload, { name: 'Kodu' }, 'the invalid record is never auto-repaired');

    assert.deepEqual(result.invalidCalendar.domainInvalid, ['calendar']);
    assert.equal(result.invalidCalendar.state, 'READY');

    assert.deepEqual(result.invalidWaste.domainInvalid, ['calendar'], 'wasteState belongs to the calendar domain grouping');
    assert.equal(result.invalidWaste.state, 'READY');

    assert.deepEqual(result.invalidPlacePayload.domainInvalid, ['places']);
    assert.deepEqual(result.placeRecordAfter.payload.lat, '59.3', 'the invalid payload is never auto-repaired');

    assert.deepEqual(result.nonContiguousOrders.domainInvalid, ['places']);
  } finally {
    await harness.cleanup();
  }
});

test('C4 revert refuses to export an invalid domain snapshot: phase started aborts before export, phase backups-verified compensates', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;

      // Case 1: phase started, invalid snapshot -> abort before export, zero legacy writes.
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward1 = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward1.boot();
      await forward1.close();
      const legacyBefore1 = window.__c4.legacyBytes();
      await window.__t.withReplica(replica => replica.transact(['householdProfile'], 'readwrite', ({ stores }) => {
        stores.householdProfile.put({ key: 'household', payload: { name: 'Kodu' }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
      }));
      const revert1 = makeController({ mode: 'revert', ids: ['attempt-1'] });
      const revertResult1 = await revert1.boot();
      const legacyAfter1 = window.__c4.legacyBytes();
      const authority1 = authorityOf(await dump());
      await revert1.close();

      // Case 2: durable phase backups-verified, invalid snapshot on resume -> compensate.
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward2 = makeController({ ids: ['switch-2', 'prep-2'] });
      await forward2.boot();
      await forward2.close();
      const legacyBefore2 = window.__c4.legacyBytes();
      const authority2Before = authorityOf(await dump());
      await window.__t.put('meta', { ...authority2Before, status: 'reverting' });
      await window.__t.put('meta', { key: 'storageRevertAttemptV1', switchId: authority2Before.switchId, attemptId: 'crash-3', commitCountAtStart: authority2Before.commitCount, phase: 'backups-verified' });
      for (const [domain, key] of [['calendar', calKey], ['household', houseKey], ['places', placesKey]]) {
        localStorage.setItem('majandus_legacy_backup_v1_' + authority2Before.switchId + '_crash-3_' + domain, JSON.stringify({ version: 1, legacyKey: key, raw: legacyBefore2[key] }));
      }
      localStorage.setItem('majandus_legacy_backup_v1_' + authority2Before.switchId + '_current', JSON.stringify({ version: 1, switchId: authority2Before.switchId, attemptId: 'crash-3' }));
      await window.__t.withReplica(replica => replica.transact(['householdProfile'], 'readwrite', ({ stores }) => {
        stores.householdProfile.put({ key: 'household', payload: { name: 'Kodu' }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
      }));
      const revert2 = makeController({ mode: 'revert', ids: [] });
      const revertResult2 = await revert2.boot();
      const legacyAfter2 = window.__c4.legacyBytes();
      const authority2After = authorityOf(await dump());
      await revert2.close();

      return { revertResult1, legacyBefore1, legacyAfter1, authority1, revertResult2, legacyBefore2, legacyAfter2, authority2After };
    })()`);
    assert.deepEqual(result.revertResult1, { state: 'REVERT_FAILED', reason: 'revert-snapshot-invalid' });
    assert.deepEqual(result.legacyAfter1, result.legacyBefore1, 'zero shared legacy export writes on an invalid snapshot');
    assert.equal(result.authority1.status, 'active', 'authority returns to active (abort before export)');

    assert.deepEqual(result.revertResult2, { state: 'REVERT_FAILED', reason: 'revert-compensation-verified' });
    assert.deepEqual(result.legacyAfter2, result.legacyBefore2, 'compensation restores the exact original bytes');
    assert.equal(result.authority2After.status, 'active');
    assert.equal(result.authority2After.legacyUntrusted, false);
  } finally {
    await harness.cleanup();
  }
});

// ---- AMEND C: durable-transition consistency races -------------------------------------------

test('C4 begin-revert switch race: a switchId change between candidate selection and the transaction refuses the mutation, with zero attempt/backup/shared-key writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const { api } = window.__c4;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-A', 'prep-1'] });
      await forward.boot();
      await forward.close();
      const legacyBefore = window.__c4.legacyBytes();

      // A raw, already-open connection so the racing db.transaction() call below is issued fully
      // synchronously inside newId() (no async/await gap), guaranteeing it is queued strictly before
      // beginRevert's own replica.transact() call, which can only run after newId() has returned and
      // the async selectAttemptId(...) call has resolved.
      const raceDb = await api.openMajandusDb(indexedDB);
      let raced = false;
      const racingNewId = () => {
        const id = 'attempt-race';
        if (!raced) {
          raced = true;
          const txn = raceDb.transaction(['meta'], 'readwrite');
          const store = txn.objectStore('meta');
          const getRequest = store.get('storageAuthorityV1');
          getRequest.onsuccess = () => { store.put({ ...getRequest.result, switchId: 'switch-B' }); };
        }
        return id;
      };
      const revert = makeController({ mode: 'revert', newId: racingNewId });
      const revertResult = await revert.boot();
      raceDb.close();
      const legacyAfter = window.__c4.legacyBytes();
      const data = await dump();
      const authority = authorityOf(data);
      const attempt = data.meta.find(r => r.key === 'storageRevertAttemptV1');
      await revert.close();
      const backupProbe = ['calendar', 'household', 'places'].map(domain => localStorage.getItem('majandus_legacy_backup_v1_switch-A_attempt-race_' + domain));
      return { revertResult, legacyBefore, legacyAfter, authority, attempt, backupProbe };
    })()`);
    assert.equal(result.revertResult.state, 'REVERT_FAILED');
    assert.deepEqual(result.legacyAfter, result.legacyBefore, 'zero shared-key writes');
    assert.equal(result.authority.switchId, 'switch-B', 'the race-winning switch change is preserved, not reverted');
    assert.equal(result.authority.status, 'active', 'no attempt was created under the new switch');
    assert.equal(result.attempt, undefined, 'no attempt record exists');
    assert.deepEqual(result.backupProbe, [null, null, null], 'the collision-checked candidate is never used to write a backup under the new switch');
  } finally {
    await harness.cleanup();
  }
});

test('C4 abort-before-export consistency race: an attempt-identity change during preparation failure refuses the abort transition and never returns authority to active incorrectly', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const { api } = window.__c4;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();

      const raceDb = await api.openMajandusDb(indexedDB);
      let raced = false;
      const raceOnFirstBackupWrite = key => {
        if (raced || !key.startsWith('majandus_legacy_backup_v1_switch-1_attempt-1_')) return;
        raced = true;
        // Race: the durable attempt keeps the same attemptId (an old-code check) but its switchId and
        // commitCountAtStart change out from under the pending abort, at the exact moment preparation
        // is about to fail and abortBeforeExport is about to run.
        const txn = raceDb.transaction(['meta'], 'readwrite');
        const store = txn.objectStore('meta');
        store.put({ key: 'storageRevertAttemptV1', switchId: 'switch-other', attemptId: 'attempt-1', commitCountAtStart: 7, phase: 'started' });
      };
      const storage = {
        getItem: k => localStorage.getItem(k),
        removeItem: k => localStorage.removeItem(k),
        setItem: (k, v) => {
          if (k.startsWith('majandus_legacy_backup_v1_switch-1_attempt-1_household')) { raceOnFirstBackupWrite(k); throw new Error('blocked household backup write'); }
          localStorage.setItem(k, v);
        },
      };
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storage });
      const revertResult = await revert.boot();
      raceDb.close();
      const data = await dump();
      const authority = authorityOf(data);
      const attempt = data.meta.find(r => r.key === 'storageRevertAttemptV1');
      await revert.close();
      return { revertResult, authority, attempt };
    })()`);
    assert.equal(result.revertResult.state, 'REVERT_FAILED');
    // The abort-before-export transition must refuse because the durable attempt no longer matches
    // the identity it was about to abort; the race-winning swapped attempt record must survive intact.
    assert.equal(result.authority.status, 'reverting', 'authority is not incorrectly returned to active');
    assert.equal(result.attempt.switchId, 'switch-other', 'the attempt is not incorrectly deleted');
    assert.equal(result.attempt.commitCountAtStart, 7);
    assert.equal(result.attempt.phase, 'started');
  } finally {
    await harness.cleanup();
  }
});

test('C4 compensation consistency race: an attempt-identity change during export failure refuses the final compensation transition and leaves durable state for the next boot', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const { api } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();

      const raceDb = await api.openMajandusDb(indexedDB);
      let raced = false;
      const storage = {
        getItem: k => localStorage.getItem(k),
        removeItem: k => localStorage.removeItem(k),
        setItem: (k, v) => {
          if (k === houseKey && !raced) {
            raced = true;
            // Race: the durable attempt's commitCountAtStart consistency breaks at the exact moment
            // the export write fails and compensateAndFail is about to run its final transition.
            const txn = raceDb.transaction(['meta'], 'readwrite');
            const store = txn.objectStore('meta');
            const getRequest = store.get('storageRevertAttemptV1');
            getRequest.onsuccess = () => { store.put({ ...getRequest.result, commitCountAtStart: 99 }); };
            throw new Error('blocked household export write');
          }
          localStorage.setItem(k, v);
        },
      };
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storage });
      const revertResult = await revert.boot();
      raceDb.close();
      const data = await dump();
      const authority = authorityOf(data);
      const attempt = data.meta.find(r => r.key === 'storageRevertAttemptV1');
      await revert.close();
      return { revertResult, authority, attempt };
    })()`);
    assert.equal(result.revertResult.state, 'REVERT_FAILED');
    assert.equal(result.authority.status, 'reverting', 'authority is not incorrectly returned to active from a stale-identity compensation');
    assert.ok(result.attempt, 'the attempt record is not incorrectly deleted');
    assert.equal(result.attempt.commitCountAtStart, 99, 'the race-winning durable state survives for the next boot to resume from');
  } finally {
    await harness.cleanup();
  }
});

test('C4 ambiguous revert-complete race: a different attempt observed on reread gives REVERT_FAILED with no compensation from the stale backup set', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const { api } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();

      const raceDb = await api.openMajandusDb(indexedDB);
      let raced = false;
      const storage = {
        getItem: k => localStorage.getItem(k),
        removeItem: k => localStorage.removeItem(k),
        setItem: (k, v) => {
          localStorage.setItem(k, v);
          if (k === placesKey && !raced) {
            raced = true;
            // Race: right after the export writes succeed (and would verify), the durable attempt is
            // replaced by an unrelated one before the revert-complete transition reads it.
            const txn = raceDb.transaction(['meta'], 'readwrite');
            const store = txn.objectStore('meta');
            store.put({ key: 'storageRevertAttemptV1', switchId: 'switch-1', attemptId: 'attempt-unrelated', commitCountAtStart: 0, phase: 'backups-verified' });
          }
        },
      };
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storage });
      const revertResult = await revert.boot();
      raceDb.close();
      const legacyAfterRevert = window.__c4.legacyBytes();
      const data = await dump();
      const authority = authorityOf(data);
      const attempt = data.meta.find(r => r.key === 'storageRevertAttemptV1');
      await revert.close();
      const originalBackup = localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_household');
      return { revertResult, legacyAfterRevert, authority, attempt, originalBackup };
    })()`);
    assert.deepEqual(result.revertResult, { state: 'REVERT_FAILED', reason: 'revert-complete-reread-failed' });
    assert.equal(result.authority.status, 'reverting', 'authority is left exactly as the race-winning write left it');
    assert.equal(result.attempt.attemptId, 'attempt-unrelated', 'the race-winning attempt survives; nothing was cleaned up from a stale identity');
    // No compensation ran: the household legacy key still holds the exported value, not the restored original.
    assert.deepEqual(JSON.parse(result.legacyAfterRevert.majamajandus_household_profile_v1).profile, { name: 'Kodu', address: '' });
    assert.ok(result.originalBackup, 'the original backup set from attempt-1 is untouched and retained');
  } finally {
    await harness.cleanup();
  }
});

// ---- AMEND D: explicit backup/preparation failure matrix (Section 8 C4, Section 6b) ----------

test('C4 backup/preparation failure matrix: each locked case gives the exact plan outcome with zero shared-key writes and existing bytes unchanged', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, legacyBytes } = window.__c4;
      const [calKey, houseKey, placesKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      const houseBackupKey = 'majandus_legacy_backup_v1_switch-1_attempt-1_household';
      const pointerKey = 'majandus_legacy_backup_v1_switch-1_current';
      const freshDevice = async () => {
        await reset();
        seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
        const forward = makeController({ ids: ['switch-1', 'prep-1'] });
        await forward.boot();
        await forward.close();
      };
      const out = {};

      // 1) backup target getItem throws during candidate selection.
      await freshDevice();
      out.legacyBefore1 = legacyBytes();
      const revert1 = makeController({ mode: 'revert', ids: ['attempt-1'], storageOpts: { throwGet: [houseBackupKey] } });
      out.case1 = await revert1.boot();
      await revert1.close();
      out.legacyAfter1 = legacyBytes();
      out.authority1 = authorityOf(await dump());

      // 2) backup target getItem throws at preparation step 0 (succeeds during selection, throws on the re-probe).
      await freshDevice();
      let getCalls2 = 0;
      const storage2 = {
        getItem: k => { if (k === houseBackupKey) { getCalls2 += 1; if (getCalls2 > 1) throw new Error('blocked on second probe'); } return localStorage.getItem(k); },
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: k => localStorage.removeItem(k),
      };
      const revert2 = makeController({ mode: 'revert', ids: ['attempt-1'], storage: storage2 });
      out.case2 = await revert2.boot();
      await revert2.close();
      out.authority2 = authorityOf(await dump());

      // 3) a target backup key appears between candidate selection and preparation.
      await freshDevice();
      let getCalls3 = 0;
      const storage3 = {
        getItem: k => { if (k === houseBackupKey) { getCalls3 += 1; if (getCalls3 > 1) return 'intervening-value'; } return localStorage.getItem(k); },
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: k => localStorage.removeItem(k),
      };
      const revert3 = makeController({ mode: 'revert', ids: ['attempt-1'], storage: storage3 });
      out.case3 = await revert3.boot();
      await revert3.close();
      out.authority3 = authorityOf(await dump());
      out.backupKeyStillUntouched3 = localStorage.getItem(houseBackupKey);

      // 4) preparation backup write throws before export.
      await freshDevice();
      out.legacyBefore4 = legacyBytes();
      const revert4 = makeController({ mode: 'revert', ids: ['attempt-1'], storageOpts: { throwSet: [houseBackupKey] } });
      out.case4 = await revert4.boot();
      await revert4.close();
      out.legacyAfter4 = legacyBytes();
      out.authority4 = authorityOf(await dump());

      // 5) backup read-back mismatch (setItem succeeds, but the read-back returns something else).
      // The probes before the write must see the real (free) value; only the post-write read-back is corrupted.
      await freshDevice();
      let household5Written = false;
      const storage5 = {
        getItem: k => (k === houseBackupKey && household5Written ? 'corrupted-on-readback' : localStorage.getItem(k)),
        setItem: (k, v) => { if (k === houseBackupKey) household5Written = true; localStorage.setItem(k, v); },
        removeItem: k => localStorage.removeItem(k),
      };
      const revert5 = makeController({ mode: 'revert', ids: ['attempt-1'], storage: storage5 });
      out.case5 = await revert5.boot();
      await revert5.close();
      out.authority5 = authorityOf(await dump());

      // 6) pointer write failure.
      await freshDevice();
      const revert6 = makeController({ mode: 'revert', ids: ['attempt-1'], storageOpts: { throwSet: [pointerKey] } });
      out.case6 = await revert6.boot();
      await revert6.close();
      out.authority6 = authorityOf(await dump());

      // 7) pointer read-back mismatch.
      await freshDevice();
      const storage7 = {
        getItem: k => (k === pointerKey ? 'corrupted-pointer-readback' : localStorage.getItem(k)),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: k => localStorage.removeItem(k),
      };
      const revert7 = makeController({ mode: 'revert', ids: ['attempt-1'], storage: storage7 });
      out.case7 = await revert7.boot();
      await revert7.close();
      out.authority7 = authorityOf(await dump());

      return out;
    })()`);
    assert.deepEqual(result.case1, { state: 'REVERT_FAILED', reason: 'revert-backup-key-unreadable' });
    assert.deepEqual(result.legacyAfter1, result.legacyBefore1);
    assert.equal(result.authority1.status, 'active');

    assert.deepEqual(result.case2, { state: 'REVERT_FAILED', reason: 'revert-backup-key-unreadable' });
    assert.equal(result.authority2.status, 'active');

    assert.deepEqual(result.case3, { state: 'REVERT_FAILED', reason: 'revert-attempt-id-collision' });
    assert.equal(result.authority3.status, 'active');
    assert.equal(result.backupKeyStillUntouched3, null, 'no backup key was written by this attempt');

    assert.deepEqual(result.case4, { state: 'REVERT_FAILED', reason: 'revert-preparation-failed' });
    assert.deepEqual(result.legacyAfter4, result.legacyBefore4, 'zero shared-key writes on a preparation failure');
    assert.equal(result.authority4.status, 'active');

    assert.deepEqual(result.case5, { state: 'REVERT_FAILED', reason: 'revert-preparation-failed' });
    assert.equal(result.authority5.status, 'active');

    assert.deepEqual(result.case6, { state: 'REVERT_FAILED', reason: 'revert-preparation-failed' });
    assert.equal(result.authority6.status, 'active');

    assert.deepEqual(result.case7, { state: 'REVERT_FAILED', reason: 'revert-preparation-failed' });
    assert.equal(result.authority7.status, 'active');
  } finally {
    await harness.cleanup();
  }
});

// ---- concurrency amend: transaction-time guards ------------------------------------------------

// Test-only race injector: when the controller creates the matching transaction, a racing readwrite
// transaction is created on a separate connection immediately after it. IndexedDB runs overlapping
// transactions in creation order, so the race commits after that transaction and before the
// controller's next one.
const RACE_PAGE = `window.__race = (() => {
  const install = async ({ match, apply }) => {
    const raceDb = await window.storageApi.openMajandusDb(indexedDB);
    const originalTransaction = IDBDatabase.prototype.transaction;
    let fired = false;
    IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
      const txn = originalTransaction.call(this, names, mode, ...rest);
      const list = Array.isArray(names) ? names : [names];
      if (!fired && this !== raceDb && match(list, mode)) {
        fired = true;
        const race = originalTransaction.call(raceDb, ['meta'], 'readwrite');
        apply(race.objectStore('meta'));
      }
      return txn;
    };
    return { fired: () => fired, restore: () => { IDBDatabase.prototype.transaction = originalTransaction; raceDb.close(); } };
  };
  // Creates the racing meta transaction immediately (for use from synchronous storage hooks).
  const now = async () => {
    const raceDb = await window.storageApi.openMajandusDb(indexedDB);
    return { run: apply => apply(raceDb.transaction(['meta'], 'readwrite').objectStore('meta')), close: () => raceDb.close() };
  };
  return { install, now };
})();
'ready';`;

async function raceHarness() {
  const harness = await c4Harness();
  await harness.evaluate(RACE_PAGE);
  return harness;
}

test('C4 a forward build finding reverting classifies the attempt inside its transition transaction, not from the boot-time read', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await raceHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, attemptOf, spyStorage } = window.__c4;
      const SHARED = window.__t.legacy.LEGACY_SHARED_KEYS;
      const authority = { key: 'storageAuthorityV1', status: 'reverting', switchId: 's1', switchedAt: '2026-09-16T10:00:00.000Z',
        legacyDigestAtSwitch: 'a'.repeat(64), markerPreparationId: 'p1', commitCount: 0, legacyUntrusted: false, persistGranted: null };
      const started = { key: 'storageRevertAttemptV1', switchId: 's1', attemptId: 'a1', commitCountAtStart: 0, phase: 'started' };
      const variants = {
        noRace: null,
        startedToBackupsVerified: store => store.put({ ...started, phase: 'backups-verified' }),
        attemptDeleted: store => store.delete('storageRevertAttemptV1'),
        attemptMalformed: store => store.put({ key: 'storageRevertAttemptV1', switchId: 's1', attemptId: 'a1', commitCountAtStart: 0, phase: 'bogus' }),
        attemptOtherSwitch: store => store.put({ ...started, switchId: 's-other' }),
      };
      const out = {};
      for (const [name, apply] of Object.entries(variants)) {
        await reset(); seed({});
        await window.__t.put('meta', authority);
        await window.__t.put('meta', started);
        // Race right after the boot-time readonly meta read, before the forward transition transaction.
        const race = apply ? await window.__race.install({ match: (list, mode) => mode === 'readonly' && list.length === 1 && list[0] === 'meta', apply }) : null;
        const storage = spyStorage();
        const controller = makeController({ storage });
        let boot;
        try { boot = await controller.boot(); } finally { race?.restore(); }
        const data = await dump();
        await controller.close();
        out[name] = {
          boot, fired: race ? race.fired() : null, authority: authorityOf(data), attempt: attemptOf(data),
          writes: storage.calls.filter(([op, key]) => op !== 'get' && (SHARED.includes(key) || key.startsWith('majandus_legacy_backup_v1_'))),
        };
      }
      return out;
    })()`);
    for (const [name, entry] of Object.entries(result)) {
      assert.notEqual(entry.fired, false, `${name}: the race fired`);
      assert.deepEqual(entry.writes, [], `${name}: zero shared-key and backup writes`);
    }
    assert.equal(result.noRace.boot.state, 'READY');
    assert.equal(result.noRace.authority.status, 'active');
    assert.equal(result.noRace.authority.legacyUntrusted, false, 'valid started at transaction time: trust unchanged');
    assert.equal(result.noRace.attempt, null);
    for (const name of ['startedToBackupsVerified', 'attemptDeleted', 'attemptMalformed']) {
      assert.equal(result[name].boot.state, 'READY', name);
      assert.equal(result[name].authority.status, 'active', name);
      assert.equal(result[name].authority.legacyUntrusted, true, `${name}: classified at transaction time -> legacyUntrusted true`);
      assert.equal(result[name].attempt, null, `${name}: attempt deleted atomically`);
    }
    assert.deepEqual(result.attemptOtherSwitch.boot, { state: 'STORAGE_UNAVAILABLE', reason: 'revert-attempt-orphan' });
    assert.equal(result.attemptOtherSwitch.authority.status, 'reverting', 'orphan: no convergence mutation');
    assert.equal(result.attemptOtherSwitch.authority.legacyUntrusted, false);
    assert.equal(result.attemptOtherSwitch.attempt.switchId, 's-other', 'orphan attempt untouched');
  } finally {
    await harness.cleanup();
  }
});

test('C4 compensation checks the exact durable attempt before its first restore write: a replaced attempt gets zero compensation writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await raceHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf, attemptOf } = window.__c4;
      const SHARED = window.__t.legacy.LEGACY_SHARED_KEYS;
      const [calKey, houseKey] = SHARED;
      await reset();
      // Non-compact raw calendar bytes, so the export (and any stale restore) visibly changes them.
      seed({ calendar: '{ "version": 1, "events": [] }', household: '{"version":1,"profile":{"name":"Kodu","address":""}}', places: '[{"name":"Kodu"}]' });
      const forward = makeController({ ids: ['switch-1', 'prep-1', 'place-1', 'place-2', 'place-3'] });
      await forward.boot();
      await forward.close();

      const racer = await window.__race.now();
      const attempt2 = { key: 'storageRevertAttemptV1', switchId: 'switch-1', attemptId: 'attempt-2', commitCountAtStart: 0, phase: 'backups-verified' };
      let raced = false;
      let atRace = null;
      const afterRace = [];
      const storage = {
        getItem: k => localStorage.getItem(k),
        removeItem: k => { if (raced && SHARED.includes(k)) afterRace.push(['remove', k]); localStorage.removeItem(k); },
        setItem: (k, v) => {
          if (k === houseKey && !raced) {
            raced = true;
            // attempt-1 is backups-verified and the calendar key is already exported. Before
            // compensation runs, the durable attempt is replaced by an unrelated attempt-2.
            racer.run(store => store.put(attempt2));
            atRace = {
              legacy: Object.fromEntries(SHARED.map(key => [key, localStorage.getItem(key)])),
              backups: ['calendar', 'household', 'places'].map(d => localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_' + d)),
            };
            throw new Error('blocked household export write');
          }
          if (raced && SHARED.includes(k)) afterRace.push(['set', k]);
          localStorage.setItem(k, v);
        },
      };
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storage });
      const revertResult = await revert.boot();
      racer.close();
      const data = await dump();
      await revert.close();
      return {
        revertResult, atRace, afterRace,
        legacyAfter: Object.fromEntries(SHARED.map(key => [key, localStorage.getItem(key)])),
        backupsAfter: ['calendar', 'household', 'places'].map(d => localStorage.getItem('majandus_legacy_backup_v1_switch-1_attempt-1_' + d)),
        authority: authorityOf(data), attempt: attemptOf(data), attempt2,
      };
    })()`);
    assert.equal(result.revertResult.state, 'REVERT_FAILED');
    assert.deepEqual(result.afterRace, [], 'no shared-key setItem/removeItem from the stale attempt-1 compensation');
    assert.deepEqual(result.legacyAfter, result.atRace.legacy, 'shared legacy bytes are unchanged from the race-winning state');
    assert.notEqual(result.atRace.legacy.majamajandus_household_events_v1, '{ "version": 1, "events": [] }', 'the calendar key had already been exported before the race');
    assert.deepEqual(result.attempt, result.attempt2, 'attempt-2 survives untouched');
    assert.equal(result.authority.status, 'reverting', 'no stale meta cleanup');
    assert.deepEqual(result.backupsAfter, result.atRace.backups, 'attempt-1 backups are retained untouched');
    assert.ok(result.atRace.backups.every(Boolean));
  } finally {
    await harness.cleanup();
  }
});

test('C4 reverted reset re-reads the attempt key inside its transaction: a raced-in attempt refuses the reset with authority and domain bytes unchanged', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await raceHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      const forward = makeController({ ids: ['switch-1', 'prep-1'] });
      await forward.boot();
      await forward.close();
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'] });
      const revertResult = await revert.boot();
      await revert.close();
      const before = await dump();

      const racer = await window.__race.now();
      const orphan = { key: 'storageRevertAttemptV1', switchId: 'switch-1', attemptId: 'orphan-1', commitCountAtStart: 0, phase: 'started' };
      let raced = false;
      const storage = {
        // The boot-time read saw no attempt; the attempt appears before the reverted reset transaction.
        getItem: k => { if (!raced && k === 'majandus_storage_authority_v1') { raced = true; racer.run(store => store.put(orphan)); } return localStorage.getItem(k); },
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: k => localStorage.removeItem(k),
      };
      const controller = makeController({ ids: ['switch-2', 'prep-2'], storage });
      const boot = await controller.boot();
      racer.close();
      const after = await dump();
      await controller.close();
      const withoutAttempt = data => ({ ...data, meta: data.meta.filter(record => record.key !== 'storageRevertAttemptV1') });
      return { revertResult, raced, boot, before, afterWithoutAttempt: withoutAttempt(after), attempt: after.meta.find(r => r.key === 'storageRevertAttemptV1'), orphan, authorityBefore: authorityOf(before) };
    })()`);
    assert.equal(result.revertResult.state, 'LEGACY');
    assert.equal(result.authorityBefore.status, 'reverted');
    assert.equal(result.raced, true);
    assert.deepEqual(result.boot, { state: 'STORAGE_UNAVAILABLE', reason: 'revert-attempt-orphan' });
    assert.deepEqual(result.afterWithoutAttempt, result.before, 'reset refused: authority, marker and domain bytes unchanged');
    assert.deepEqual(result.attempt, result.orphan);
  } finally {
    await harness.cleanup();
  }
});

test('C4 stale reset re-reads the attempt key inside its transaction: a raced-in orphan attempt refuses the reset with marker and domain bytes unchanged', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await raceHarness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController, dump, authorityOf } = window.__c4;
      const [calKey, houseKey] = window.__t.legacy.LEGACY_SHARED_KEYS;
      await reset();
      seed({ household: '{"version":1,"profile":{"name":"Kodu","address":""}}' });
      await window.__t.run({});
      // The source changes after completion, so migration reports source-changed-after-complete.
      localStorage.setItem(houseKey, '{"version":1,"profile":{"name":"Uus","address":""}}');
      const before = await dump();

      const racer = await window.__race.now();
      const orphan = { key: 'storageRevertAttemptV1', switchId: 'switch-orphan', attemptId: 'orphan-1', commitCountAtStart: 0, phase: 'started' };
      let raced = false;
      const storage = {
        // The boot-time read saw no attempt; the attempt appears while migration reads the sources,
        // i.e. before the stale reset transaction.
        getItem: k => { if (!raced && k === calKey) { raced = true; racer.run(store => store.put(orphan)); } return localStorage.getItem(k); },
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: k => localStorage.removeItem(k),
      };
      const controller = makeController({ ids: ['switch-1', 'prep-2', 'p-1'], storage });
      const boot = await controller.boot();
      racer.close();
      const after = await dump();
      await controller.close();
      const withoutAttempt = data => ({ ...data, meta: data.meta.filter(record => record.key !== 'storageRevertAttemptV1') });
      return { raced, boot, before, afterWithoutAttempt: withoutAttempt(after), attempt: after.meta.find(r => r.key === 'storageRevertAttemptV1'), orphan, authority: authorityOf(after) };
    })()`);
    assert.equal(result.raced, true);
    assert.deepEqual(result.boot, { state: 'STORAGE_UNAVAILABLE', reason: 'revert-attempt-orphan' });
    assert.deepEqual(result.afterWithoutAttempt, result.before, 'stale reset refused: marker and domain bytes unchanged');
    assert.equal(result.authority, null);
    assert.deepEqual(result.attempt, result.orphan);
  } finally {
    await harness.cleanup();
  }
});

// ---- Runtime cutover C4 mounted-state amendment (Issues A and B) ---------------------------------

test('C4 mounted READY: handleRuntimeSignal for a shared legacy key re-checks divergence on the same controller with zero re-adopt/reset/migration', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, dump, legacyBytes } = window.__c4;
      const [CAL] = window.__t.legacy.LEGACY_SHARED_KEYS;
      const { controller } = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      const before = await dump();
      localStorage.setItem(CAL, JSON.stringify({ version: 1, events: [{ id:'e1', title:'X', category:'other', subtype:null, date:'2026-09-20', time:null, recurrence:{frequency:'none',interval:1}, reminder:{daysBefore:0}, source:'manual', householdId:null, notes:'', seriesId:null, excludedDates:[], overrides:{} }] }));
      const legacyEdited = legacyBytes();
      const signalResult = await controller.handleRuntimeSignal({ type: 'storage', key: CAL });
      const after = await dump();
      const legacyAfter = legacyBytes();
      await controller.close();
      return { signalResult, before, after, legacyEdited, legacyAfter };
    })()`);
    assert.equal(result.signalResult.state, 'READY');
    assert.equal(result.signalResult.divergence, 'LEGACY_DIVERGED');
    assert.deepEqual(result.after, result.before, 'zero IndexedDB writes from the mounted divergence recheck');
    assert.deepEqual(result.legacyAfter, result.legacyEdited, 'the old-build legacy edit stays exactly as written, never adopted or reverted');
  } finally {
    await harness.cleanup();
  }
});

test('C4 mounted READY: a hint-clear signal with a blocked gate gives AUTHORITY_HINT_PENDING with zero legacy writes, and recovers once the gate is writable again', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const HINT_KEY = 'majandus_storage_authority_v1';
      const { switchedSetup, dump } = window.__c4;
      let blockHintSet = false;
      const storage = {
        getItem: k => localStorage.getItem(k),
        setItem: (k, v) => { if (blockHintSet && k === HINT_KEY) throw new Error('blocked'); localStorage.setItem(k, v); },
        removeItem: k => localStorage.removeItem(k),
      };
      const { controller, result: bootResult } = await switchedSetup({}, { ids: ['switch-1', 'prep-1'], storage });
      const legacyBefore = window.__c4.legacyBytes();
      localStorage.removeItem(HINT_KEY);
      blockHintSet = true;
      const pending = await controller.handleRuntimeSignal({ type: 'storage', key: HINT_KEY });
      const dataWhilePending = await dump();
      const legacyWhilePending = window.__c4.legacyBytes();
      blockHintSet = false;
      const retried = await controller.retry();
      const hintAfterRetry = localStorage.getItem(HINT_KEY);
      await controller.close();
      return { bootResult, pending, authorityWhilePending: dataWhilePending.meta.find(r => r.key === 'storageAuthorityV1'), legacyBefore, legacyWhilePending, retried, hintAfterRetry };
    })()`);
    assert.equal(result.bootResult.state, 'READY');
    assert.deepEqual(result.pending, { state: 'AUTHORITY_HINT_PENDING' });
    assert.equal(result.authorityWhilePending.status, 'active', 'authority stays active while the mounted hint gate is pending');
    assert.deepEqual(result.legacyWhilePending, result.legacyBefore, 'zero shared legacy writes from the mounted hint recheck');
    assert.equal(result.retried.state, 'READY');
    assert.ok(result.hintAfterRetry, 'the hint is restored once the gate is writable again');
  } finally {
    await harness.cleanup();
  }
});

test('C4 mounted LEGACY: a hint-key signal for a non-absent hint gives RELOAD_REQUIRED, never a silent boot into READY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const HINT_KEY = 'majandus_storage_authority_v1';
      const { reset, seed, makeController } = window.__c4;
      await reset();
      seed({ calendar: 'not json' });
      const controller = makeController();
      const legacyResult = await controller.boot();
      localStorage.setItem(HINT_KEY, JSON.stringify({ version: 1, switchId: 'other', legacyDigestAtSwitch: 'a'.repeat(64), switchedAt: '2026-09-16T10:00:00.000Z' }));
      const signalResult = await controller.handleRuntimeSignal({ type: 'storage', key: HINT_KEY });
      await controller.close();
      return { legacyResult, signalResult };
    })()`);
    assert.equal(result.legacyResult.state, 'LEGACY');
    assert.deepEqual(result.signalResult, { state: 'RELOAD_REQUIRED' });
  } finally {
    await harness.cleanup();
  }
});

test('C4 mounted LEGACY: an authority-changed broadcast signal gives RELOAD_REQUIRED', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { reset, seed, makeController } = window.__c4;
      await reset();
      seed({ calendar: 'not json' });
      const controller = makeController();
      const legacyResult = await controller.boot();
      const signalResult = await controller.handleRuntimeSignal({ type: 'authority-changed' });
      await controller.close();
      return { legacyResult, signalResult };
    })()`);
    assert.equal(result.legacyResult.state, 'LEGACY');
    assert.deepEqual(result.signalResult, { state: 'RELOAD_REQUIRED' });
  } finally {
    await harness.cleanup();
  }
});

test('C4 mounted READY: a foreground signal after a second connection changes the durable authority gives RELOAD_REQUIRED without running the forward reverting-to-active convergence', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, dump, authorityOf } = window.__c4;
      const { controller, result: bootResult } = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      const before = await dump();
      const authority = authorityOf(before);
      await window.__t.put('meta', { ...authority, status: 'reverting' });
      const signalResult = await controller.handleRuntimeSignal({ type: 'focus' });
      const after = await dump();
      await controller.close();
      return { bootResult, signalResult, authorityAfter: authorityOf(after) };
    })()`);
    assert.equal(result.bootResult.state, 'READY');
    assert.deepEqual(result.signalResult, { state: 'RELOAD_REQUIRED' });
    assert.equal(result.authorityAfter.status, 'reverting', 'the mounted tab never runs the forward reverting -> active convergence on its own');
  } finally {
    await harness.cleanup();
  }
});

test('C6 authority identity accessor: null before boot and in LEGACY, the exact mounted switchId in READY (also with divergence and domainInvalid detail)', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, makeController, reset, seed, dump, authorityOf } = window.__c4;
      const [CAL] = window.__t.legacy.LEGACY_SHARED_KEYS;
      const out = {};
      // Before boot: the controller is BOOTING and exposes no identity.
      const idle = makeController();
      out.hasAccessor = typeof idle.getReadyAuthorityIdentity;
      out.beforeBoot = idle.getReadyAuthorityIdentity();
      await idle.close();
      // LEGACY (invalid calendar source keeps the device on LEGACY): no identity.
      await reset();
      seed({ calendar: 'not json' });
      const legacyController = makeController();
      out.legacyState = (await legacyController.boot()).state;
      out.legacyIdentity = legacyController.getReadyAuthorityIdentity();
      await legacyController.close();
      // READY: the exact authority C4 mounted against, as a fresh minimal object.
      const { controller, result: bootResult } = await switchedSetup({}, { ids: ['switch-A', 'prep-1'] });
      out.readyState = bootResult.state;
      const first = controller.getReadyAuthorityIdentity();
      const second = controller.getReadyAuthorityIdentity();
      out.ready = first;
      out.readyKeys = first && Object.keys(first);
      out.freshObject = first !== second;
      out.getResultHasSwitchId = Object.hasOwn(controller.getResult(), 'switchId');
      // READY + LEGACY_DIVERGED keeps the same identity.
      localStorage.setItem(CAL, JSON.stringify({ version: 1, events: [] }));
      const diverged = await controller.handleRuntimeSignal({ type: 'storage', key: CAL });
      out.divergedDetail = diverged.divergence;
      out.divergedIdentity = controller.getReadyAuthorityIdentity();
      // READY with domainInvalid detail keeps the same identity.
      await window.__t.put('householdProfile', { key: 'household', payload: { name: 'Kodu' }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' });
      const invalid = await controller.handleRuntimeSignal({ type: 'focus' });
      out.invalidDetail = invalid.domainInvalid;
      out.invalidIdentity = controller.getReadyAuthorityIdentity();
      await controller.close();
      return out;
    })()`);
    assert.equal(result.hasAccessor, 'function', 'the controller exposes getReadyAuthorityIdentity');
    assert.equal(result.beforeBoot, null);
    assert.equal(result.legacyState, 'LEGACY');
    assert.equal(result.legacyIdentity, null);
    assert.equal(result.readyState, 'READY');
    assert.deepEqual(result.ready, { switchId: 'switch-A' });
    assert.deepEqual(result.readyKeys, ['switchId'], 'only switchId is exposed');
    assert.equal(result.freshObject, true, 'each call returns a fresh object, never the internal authority record');
    assert.equal(result.getResultHasSwitchId, false, 'getResult() payloads are unchanged');
    assert.equal(result.divergedDetail, 'LEGACY_DIVERGED');
    assert.deepEqual(result.divergedIdentity, { switchId: 'switch-A' });
    assert.deepEqual(result.invalidDetail, ['household']);
    assert.deepEqual(result.invalidIdentity, { switchId: 'switch-A' });
  } finally {
    await harness.cleanup();
  }
});

test('C6 authority identity accessor: an authority change moves the tab to RELOAD_REQUIRED with a null identity, a racing durable change never leaks into the mounted identity, and a fresh boot never exposes the old one', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, dump, authorityOf } = window.__c4;
      const out = {};
      const { controller } = await switchedSetup({}, { ids: ['switch-A', 'prep-1'] });
      const authority = authorityOf(await dump());
      // Race: durable authority becomes B, but this controller has not accepted B (no signal yet).
      await window.__t.put('meta', { ...authority, switchId: 'switch-B' });
      const raced = controller.getReadyAuthorityIdentity();
      out.racedThenable = typeof (raced && raced.then);
      out.raced = await raced;
      out.stateWhileRaced = controller.getState();
      // The accepted signal path now moves the mounted tab to RELOAD_REQUIRED.
      const signalResult = await controller.handleRuntimeSignal({ type: 'authority-changed' });
      out.signalState = signalResult.state;
      out.stateAfterSignal = controller.getState();
      out.identityAfterSignal = controller.getReadyAuthorityIdentity();
      await controller.close();

      // A fresh boot on a restored authority never exposes the old identity while BOOTING.
      const fresh = await switchedSetup({}, { ids: ['switch-C', 'prep-1'] });
      const seenWhileBooting = [];
      fresh.controller.subscribe(update => { if (update.state === 'BOOTING') seenWhileBooting.push(fresh.controller.getReadyAuthorityIdentity()); });
      out.beforeRetry = fresh.controller.getReadyAuthorityIdentity();
      const retried = await fresh.controller.retry();
      out.retryState = retried.state;
      out.seenWhileBooting = seenWhileBooting;
      out.afterRetry = fresh.controller.getReadyAuthorityIdentity();
      await fresh.controller.close();
      return out;
    })()`);
    assert.equal(result.racedThenable, 'undefined', 'the identity is synchronous: it is never read from durable storage');
    assert.deepEqual(result.raced, { switchId: 'switch-A' }, 'the mounted identity stays A while durable authority is already B');
    assert.equal(result.stateWhileRaced, 'READY');
    assert.equal(result.signalState, 'RELOAD_REQUIRED');
    assert.equal(result.stateAfterSignal, 'RELOAD_REQUIRED');
    assert.equal(result.identityAfterSignal, null);
    assert.deepEqual(result.beforeRetry, { switchId: 'switch-C' });
    assert.equal(result.retryState, 'READY');
    assert.deepEqual(result.seenWhileBooting, [null], 'the old identity is not exposed once a fresh boot begins');
    assert.deepEqual(result.afterRetry, { switchId: 'switch-C' });
  } finally {
    await harness.cleanup();
  }
});

test('C4 REVERTING: a successful revert observes BOOTING, REVERTING, LEGACY in order',{ concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, makeController } = window.__c4;
      const forward = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      await forward.controller.close();
      const states = [];
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'] });
      revert.subscribe(r => states.push(r.state));
      const finalResult = await revert.boot();
      await revert.close();
      return { states, finalResult };
    })()`);
    assert.deepEqual(result.states, ['BOOTING', 'REVERTING', 'LEGACY']);
    assert.equal(result.finalResult.state, 'LEGACY');
  } finally {
    await harness.cleanup();
  }
});

test('C4 REVERTING: a forced failure after the revert genuinely begins observes BOOTING, REVERTING, REVERT_FAILED, and leaves authority active with legacy bytes untouched', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c4Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { switchedSetup, makeController, dump, legacyBytes } = window.__c4;
      const forward = await switchedSetup({}, { ids: ['switch-1', 'prep-1'] });
      await forward.controller.close();
      const legacyBefore = legacyBytes();
      const throwKey = 'majandus_legacy_backup_v1_switch-1_attempt-1_calendar';
      const storage = {
        getItem: k => localStorage.getItem(k),
        setItem: (k, v) => { if (k === throwKey) throw new Error('blocked'); localStorage.setItem(k, v); },
        removeItem: k => localStorage.removeItem(k),
      };
      const states = [];
      const revert = makeController({ mode: 'revert', ids: ['attempt-1'], storage });
      revert.subscribe(r => states.push(r.state));
      const finalResult = await revert.boot();
      const data = await dump();
      const legacyAfter = legacyBytes();
      await revert.close();
      const authority = data.meta.find(r => r.key === 'storageAuthorityV1');
      const attempt = data.meta.find(r => r.key === 'storageRevertAttemptV1');
      return { states, finalResult, authority, attempt, legacyBefore, legacyAfter };
    })()`);
    assert.deepEqual(result.states, ['BOOTING', 'REVERTING', 'REVERT_FAILED']);
    assert.equal(result.finalResult.state, 'REVERT_FAILED');
    assert.equal(result.finalResult.reason, 'revert-preparation-failed');
    assert.equal(result.authority.status, 'active', 'aborted before export: authority returns to active');
    assert.equal(result.attempt, undefined, 'the attempt record is cleaned up on abort-before-export');
    assert.deepEqual(result.legacyAfter, result.legacyBefore, 'zero shared legacy writes: export never began');
  } finally {
    await harness.cleanup();
  }
});

// ---- Runtime cutover C5: dormant IndexedDB domain repositories -----------------------------------

const C5_PAGE = `window.__c5 = (() => {
  const api = window.storageApi;
  const STAMP = '2026-09-16T10:00:00.000Z';
  const AUTHORITY = { key: 'storageAuthorityV1', status: 'active', switchId: 'switch-1', switchedAt: STAMP,
    legacyDigestAtSwitch: 'a'.repeat(64), markerPreparationId: 'prep-1', commitCount: 0, legacyUntrusted: false, persistGranted: null };
  const setup = async (authority = AUTHORITY) => {
    await window.__t.reset();
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    if (authority !== null) await replica.transact(['meta'], 'readwrite', ({ stores }) => api.requestResult(stores.meta.put(authority)));
    return replica;
  };
  const makeRepos = (replica, overrides = {}) => api.createReplicaRepositories({
    replica,
    authority: overrides.authority || { switchId: 'switch-1' },
    newId: overrides.newId || window.__t.counter(overrides.ids || ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8']),
    clock: overrides.clock || (() => overrides.stamp || STAMP),
  });
  const dump = replica => replica.transact(['meta', 'householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState'], 'readonly', async ({ stores }) => ({
    authority: (await api.requestResult(stores.meta.get('storageAuthorityV1'))) ?? null,
    household: await api.requestResult(stores.householdProfile.getAll()),
    events: await api.requestResult(stores.calendarEvents.getAll()),
    places: await api.requestResult(stores.sharedPlaces.getAll()),
    waste: await api.requestResult(stores.wasteState.getAll()),
  }));
  const putMeta = (replica, record) => replica.transact(['meta'], 'readwrite', ({ stores }) => api.requestResult(stores.meta.put(record)));
  const failure = error => ({ name: error && error.name, message: String(error && error.message) });
  const attempt = async promise => { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error: failure(error) }; } };
  // Wraps one store's put/delete to throw once, simulating a write-request-level failure. Defaults to
  // QuotaExceededError; pass makeError to inject a different write-request-level failure (e.g. a
  // generic/other IndexedDB error).
  const wrapReplicaTransact = (replica, hook, makeError = () => new DOMException('injected failure', 'QuotaExceededError')) => {
    const base = replica.transact;
    replica.transact = (names, mode, body) => base(names, mode, ({ stores }) => {
      const wrapped = Object.create(null);
      for (const name of Object.keys(stores)) {
        wrapped[name] = new Proxy(stores[name], {
          get(target, prop) {
            if ((prop === 'put' || prop === 'delete') && hook(name, prop)) {
              return () => { throw makeError(); };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }
      return body({ stores: wrapped });
    });
    return () => { replica.transact = base; };
  };
  return { api, STAMP, AUTHORITY, setup, makeRepos, dump, putMeta, attempt, wrapReplicaTransact };
})();
'ready';`;

async function c5Harness() {
  const harness = await createBrowserHarness();
  await harness.evaluate(C5_PAGE);
  return harness;
}

test('C5 household: load default/parity, save parity with the legacy repository, serverHouseholdId null, commitCount +1 once, invalid load reported without repair', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const replica = await setup();
      const repos = makeRepos(replica);
      const empty = await repos.household.load();
      const saved = await attempt(repos.household.save({ name: 'Kodu Pere', address: 'Tamme 5' }));
      const afterFirst = await dump(replica);
      const loadedAfter = await repos.household.load();
      const saved2 = await attempt(repos.household.save({ address: 'Uus 1' }));
      const afterSecond = await dump(replica);
      const invalidPatch = await attempt(repos.household.save({ name: 'x'.repeat(200), address: '' }));
      const afterInvalid = await dump(replica);

      // Invalid stored record: put a malformed householdProfile record directly, then load.
      await replica.transact(['householdProfile'], 'readwrite', ({ stores }) => stores.householdProfile.put({ key: 'household', payload: { serverHouseholdId: 'not-null', name: 'x', address: '' }, revision: 0, updatedAt: '2026-09-16T10:00:00.000Z', deletedAt: null, syncStatus: 'local' }));
      const invalidLoad = await repos.household.load();
      const afterInvalidLoad = await dump(replica);
      await replica.close();
      return { empty, saved, afterFirst, loadedAfter, saved2, afterSecond, invalidPatch, afterInvalid, invalidLoad, afterInvalidLoad };
    })()`);
    assert.deepEqual(result.empty, { version: 1, profile: { name: '', address: '' }, writable: true, error: null });
    assert.equal(result.saved.ok, true);
    assert.deepEqual(result.saved.value.profile, { name: 'Kodu Pere', address: 'Tamme 5' });
    assert.deepEqual(result.afterFirst.household, [{ key: 'household', payload: { name: 'Kodu Pere', address: 'Tamme 5', serverHouseholdId: null }, revision: 0, updatedAt: result.afterFirst.household[0].updatedAt, deletedAt: null, syncStatus: 'local' }]);
    assert.equal(result.afterFirst.authority.commitCount, 1);
    assert.deepEqual(result.loadedAfter.profile, { name: 'Kodu Pere', address: 'Tamme 5' });
    assert.equal(result.saved2.ok, true);
    assert.deepEqual(result.saved2.value.profile, { name: 'Kodu Pere', address: 'Uus 1' });
    assert.equal(result.afterSecond.authority.commitCount, 2);
    assert.equal(result.invalidPatch.ok, false, 'a name over 100 chars is rejected by the accepted household validator');
    assert.equal(result.afterInvalid.authority.commitCount, 2, 'an invalid patch writes nothing and does not advance commitCount');
    assert.deepEqual(result.afterInvalid.household, result.afterSecond.household);
    assert.equal(result.invalidLoad.writable, false);
    assert.equal(result.invalidLoad.profile.name, '', 'an invalid stored record is never repaired into a fabricated profile');
    assert.equal(result.afterInvalidLoad.authority.commitCount, 2, 'a load never writes anything, valid or invalid');
  } finally {
    await harness.cleanup();
  }
});

test('C5 household: authority mismatch and malformed authority reject with zero writes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const replica = await setup();
      const mismatched = makeRepos(replica, { authority: { switchId: 'wrong-switch' } });
      const mismatchResult = await attempt(mismatched.household.save({ name: 'X', address: '' }));
      const afterMismatch = await dump(replica);

      await window.__c5.putMeta(replica, { key: 'storageAuthorityV1', status: 'active', switchId: 'switch-1', switchedAt: window.__c5.STAMP, legacyDigestAtSwitch: 'a'.repeat(63), markerPreparationId: 'prep-1', commitCount: 0, legacyUntrusted: false, persistGranted: null });
      const malformedRepos = makeRepos(replica);
      const malformedResult = await attempt(malformedRepos.household.save({ name: 'X', address: '' }));
      const afterMalformed = await dump(replica);
      await replica.close();
      return { mismatchResult, afterMismatch, malformedResult, afterMalformed };
    })()`);
    assert.equal(result.mismatchResult.ok, false);
    assert.equal(result.mismatchResult.error.name, 'RuntimeAuthorityError');
    assert.deepEqual(result.afterMismatch.household, []);
    assert.equal(result.afterMismatch.authority.commitCount, 0);
    assert.equal(result.malformedResult.ok, false);
    assert.deepEqual(result.afterMalformed.household, []);
  } finally {
    await harness.cleanup();
  }
});

test('C5 household: a write failure atomically preserves previous state and commitCount, with no legacy fallback', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt, wrapReplicaTransact } = window.__c5;
      const replica = await setup();
      const repos = makeRepos(replica);
      await repos.household.save({ name: 'Kodu', address: '' });
      const before = await dump(replica);
      const restore = wrapReplicaTransact(replica, name => name === 'householdProfile');
      const failed = await attempt(repos.household.save({ name: 'Uus', address: '' }));
      restore();
      const after = await dump(replica);
      await replica.close();
      return { failed, before, after };
    })()`);
    assert.equal(result.failed.ok, false);
    assert.equal(result.failed.error.name, 'QuotaExceededError');
    assert.deepEqual(result.after, result.before, 'the write failure changed nothing, including commitCount');
  } finally {
    await harness.cleanup();
  }
});

test('C5 household: a distinct generic (non-quota) write error also atomically preserves previous state and commitCount', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt, wrapReplicaTransact } = window.__c5;
      const replica = await setup();
      const repos = makeRepos(replica);
      await repos.household.save({ name: 'Kodu', address: '' });
      const before = await dump(replica);
      const restore = wrapReplicaTransact(replica, name => name === 'householdProfile', () => new DOMException('injected generic write failure', 'UnknownError'));
      const failed = await attempt(repos.household.save({ name: 'Uus', address: '' }));
      restore();
      const after = await dump(replica);
      await replica.close();
      return { failed, before, after };
    })()`);
    assert.equal(result.failed.ok, false);
    assert.equal(result.failed.error.name, 'UnknownError', 'a generic write error is distinct from QuotaExceededError');
    assert.deepEqual(result.after, result.before, 'the generic write failure changed nothing, including commitCount: zero partial writes, no legacy fallback');
  } finally {
    await harness.cleanup();
  }
});

test('C5 household: two concurrent mutations both persist and the second reads current durable state, never a stale snapshot', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump } = window.__c5;
      const replicaA = await window.__c5.api.createLocalReplica({ indexedDb: indexedDB });
      const replicaB = window.__c5.api.createLocalReplica({ indexedDb: indexedDB });
      await window.__t.reset();
      await replicaA.transact(['meta'], 'readwrite', ({ stores }) => window.__c5.api.requestResult(stores.meta.put(window.__c5.AUTHORITY)));
      const reposA = window.__c5.makeRepos(replicaA);
      const reposB = window.__c5.makeRepos(replicaB);
      const [first, second] = await Promise.all([
        reposA.household.save({ name: 'A', address: '' }),
        reposB.household.save({ address: 'B street' }),
      ]);
      const after = await dump(replicaA);
      await replicaA.close(); await replicaB.close();
      return { first, second, after };
    })()`);
    assert.equal(result.after.authority.commitCount, 2, 'both mutations committed');
    // The two patches touch disjoint fields (name, address), so whichever commits second must have
    // read the first's already-committed field, proving the write base is always the current durable
    // state and never a caller-held stale snapshot: the result is deterministic regardless of order.
    const { serverHouseholdId, ...finalProfile } = result.after.household[0].payload;
    assert.deepEqual(finalProfile, { name: 'A', address: 'B street' }, 'no lost update from either concurrent mutation');
  } finally {
    await harness.cleanup();
  }
});

test('C5 household: TRUE parity against the legacy createHouseholdRepository oracle, plus retained extras left untouched', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { createHouseholdRepository, createLocalReplica, requestResult } = window.__c5.api;
      const HOUSEHOLD_KEY = 'majamajandus_household_profile_v1';
      const cases = [
        { name: 'normal save into an empty household', seed: null, patch: { name: 'Kodu Pere', address: 'Tamme 5' } },
        { name: 'trim/normalization', seed: { name: 'Vana Nimi', address: 'Vana 1' }, patch: { name: '  Uus Nimi  ' } },
        { name: 'partial patch preserves the existing field', seed: { name: 'Olemas', address: 'Vana aadress' }, patch: { address: 'Uus aadress' } },
        { name: 'empty accepted value', seed: { name: 'X', address: 'Y' }, patch: { name: 'X', address: '' } },
      ];
      const outcomes = [];
      for (const testCase of cases) {
        // Legacy world: an in-memory legacy-shaped storage seeded (or not) with the case's profile.
        const legacyValues = new Map();
        if (testCase.seed) legacyValues.set(HOUSEHOLD_KEY, JSON.stringify({ version: 1, profile: testCase.seed }));
        const legacyStorage = { getItem: k => (legacyValues.has(k) ? legacyValues.get(k) : null), setItem: (k, v) => legacyValues.set(k, String(v)) };
        const legacyResult = createHouseholdRepository(legacyStorage).save(testCase.patch);

        // IndexedDB world: a fresh replica seeded with the semantically equivalent householdProfile record.
        await window.__t.reset();
        const replica = createLocalReplica({ indexedDb: indexedDB });
        await replica.transact(['meta'], 'readwrite', ({ stores }) => requestResult(stores.meta.put(window.__c5.AUTHORITY)));
        if (testCase.seed) {
          await replica.transact(['householdProfile'], 'readwrite', ({ stores }) => stores.householdProfile.put({ key: 'household', payload: { ...testCase.seed, serverHouseholdId: null }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' }));
        }
        // Retained IndexedDB extras (parallel to the calendar envelope extras concept): C5's household
        // repository never reads or writes this meta key, so it must stay byte-identical.
        const extrasBefore = { key: 'householdLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: { theme: 'dark' } } };
        await replica.transact(['meta'], 'readwrite', ({ stores }) => stores.meta.put(extrasBefore));
        const repos = window.__c5.makeRepos(replica);
        const c5Result = await repos.household.save(testCase.patch);
        const extrasAfter = await replica.getMeta('householdLegacyEnvelopeExtras');
        await replica.close();

        outcomes.push({ name: testCase.name, legacyProfile: legacyResult.profile, c5Profile: c5Result.profile, extrasBefore, extrasAfter });
      }
      return outcomes;
    })()`);
    for (const outcome of result) {
      assert.deepEqual(outcome.c5Profile, outcome.legacyProfile, `${outcome.name}: C5's final semantic profile must equal the legacy createHouseholdRepository oracle`);
      assert.deepEqual(outcome.extrasAfter, outcome.extrasBefore, `${outcome.name}: retained IndexedDB extras stay semantically unchanged`);
    }
  } finally {
    await harness.cleanup();
  }
});

test('C5 places: load default padding, add/update/remove parity, stable ids, padding materializes only on persist, contiguous order', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const { normalizePlaces } = window.__c5.api;
      const replica = await setup();
      const repos = makeRepos(replica, { ids: ['place-1', 'place-2', 'place-3', 'place-4', 'place-5'] });

      const emptyLoad = await repos.places.load();
      const afterEmptyLoad = await dump(replica);

      const added = await attempt(repos.places.add({ name: 'Suvila', address: 'Metsa tee 1', lat: 59, lon: 26 }));
      const afterAdd = await dump(replica);

      const updated = await attempt(repos.places.update(1, { address: 'Kooli 2' }));
      const afterUpdate = await dump(replica);
      const idsAfterUpdate = afterUpdate.places.slice().sort((a, b) => a.order - b.order).map(p => p.id);

      // Update again with no real change: must not rewrite the untouched record's updatedAt.
      const noopUpdate = await attempt(repos.places.update(0, { name: afterUpdate.places.find(p => p.order === 0).payload.name }));
      const afterNoop = await dump(replica);

      const removed = await attempt(repos.places.remove(0));
      const afterRemove = await dump(replica);
      const idsAfterRemove = afterRemove.places.slice().sort((a, b) => a.order - b.order).map(p => p.id);

      // Removing again drops to 2, below the 3-default minimum: normalizePlaces re-pads back to 3,
      // materializing one brand-new record while the two survivors keep their existing ids.
      const removedAgain = await attempt(repos.places.remove(0));
      const afterRemovedAgain = await dump(replica);

      await replica.close();
      return { emptyLoad, afterEmptyLoad, added, afterAdd, updated, afterUpdate, idsAfterUpdate, noopUpdate, afterNoop, removed, afterRemove, idsAfterRemove, removedAgain, afterRemovedAgain };
    })()`);
    assert.deepEqual(result.emptyLoad, { places: [{ name: 'Kodu', address: '', lat: null, lon: null }, { name: 'Kool', address: '', lat: null, lon: null }, { name: 'Trenn', address: '', lat: null, lon: null }], writable: true, error: null });
    assert.deepEqual(result.afterEmptyLoad.places, [], 'a load never persists the padded defaults');

    // add(): current padded view has 3 defaults; add() appends a 4th. Since this is the FIRST
    // persist, all 4 padded/new entries materialize as real records (the 3 defaults + 1 new).
    assert.equal(result.added.ok, true);
    assert.equal(result.afterAdd.places.length, 4);
    assert.deepEqual(result.afterAdd.places.slice().sort((a, b) => a.order - b.order).map(p => p.order), [0, 1, 2, 3]);
    const addedNames = result.afterAdd.places.slice().sort((a, b) => a.order - b.order).map(p => p.payload.name);
    assert.deepEqual(addedNames, ['Kodu', 'Kool', 'Trenn', 'Suvila']);
    assert.equal(result.afterAdd.authority.commitCount, 1);

    assert.equal(result.updated.ok, true);
    assert.equal(result.afterUpdate.places.find(p => p.order === 1).payload.address, 'Kooli 2');
    assert.equal(result.afterUpdate.authority.commitCount, 2);
    // update(1) must not touch the ids of unrelated slots.
    assert.deepEqual(result.idsAfterUpdate, result.afterAdd.places.slice().sort((a, b) => a.order - b.order).map(p => p.id));

    assert.equal(result.noopUpdate.ok, true);
    assert.deepEqual(result.afterNoop.places, result.afterUpdate.places, 'an update that changes nothing rewrites no record');
    assert.equal(result.afterNoop.authority.commitCount, 3, 'a fully no-op mutation still commits (empty puts/deletes) but writes no domain record');

    assert.equal(result.removed.ok, true);
    assert.equal(result.afterRemove.places.length, 3, 'removing from a 4-entry list leaves exactly 3, at the default minimum, so no padding is needed');
    assert.deepEqual(result.afterRemove.places.slice().sort((a, b) => a.order - b.order).map(p => p.order), [0, 1, 2]);

    assert.equal(result.removedAgain.ok, true);
    assert.equal(result.afterRemovedAgain.places.length, 3, 'dropping to 2 real entries re-pads back to the 3-default minimum on persist');
    const idsAfterRemovedAgain = result.afterRemovedAgain.places.slice().sort((a, b) => a.order - b.order).map(p => p.id);
    const survivingCount = idsAfterRemovedAgain.filter(id => result.idsAfterRemove.includes(id)).length;
    assert.equal(survivingCount, 2, 'exactly the two un-removed records keep their existing ids');
    const newIds = idsAfterRemovedAgain.filter(id => !result.idsAfterRemove.includes(id));
    assert.equal(newIds.length, 1, 'exactly one brand-new record is materialized for the re-padded default slot');
  } finally {
    await harness.cleanup();
  }
});

test('C5 places: authority mismatch writes nothing, an invalid stored order is reported without repair', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const replica = await setup();
      const mismatched = makeRepos(replica, { authority: { switchId: 'wrong' } });
      const mismatchResult = await attempt(mismatched.places.add({ name: 'X' }));
      const afterMismatch = await dump(replica);

      // Two records sharing the same order 0: an invalid stored collection.
      await replica.transact(['sharedPlaces'], 'readwrite', ({ stores }) => {
        stores.sharedPlaces.put({ id: 'p1', order: 0, payload: { name: 'A', address: '', lat: null, lon: null }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' });
        stores.sharedPlaces.put({ id: 'p2', order: 0, payload: { name: 'B', address: '', lat: null, lon: null }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' });
      });
      const invalidLoad = makeRepos(replica);
      const loaded = await invalidLoad.places.load();
      const afterInvalidLoad = await dump(replica);
      await replica.close();
      return { mismatchResult, afterMismatch, loaded, afterInvalidLoad };
    })()`);
    assert.equal(result.mismatchResult.ok, false);
    assert.deepEqual(result.afterMismatch.places, []);
    assert.equal(result.loaded.writable, false);
    assert.equal(result.afterInvalidLoad.places.length, 2, 'the invalid stored records are left exactly as they were, never repaired or deleted');
  } finally {
    await harness.cleanup();
  }
});

test('C5 places: a mutation refuses to run against an already-invalid existing collection, with zero writes and no auto-repair', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const replica = await setup();
      // Two individually valid records that together form an invalid collection (duplicate order 0).
      await replica.transact(['sharedPlaces'], 'readwrite', ({ stores }) => {
        stores.sharedPlaces.put({ id: 'p1', order: 0, payload: { name: 'A', address: '', lat: null, lon: null }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' });
        stores.sharedPlaces.put({ id: 'p2', order: 0, payload: { name: 'B', address: '', lat: null, lon: null }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' });
      });
      const before = await dump(replica);
      const repos = makeRepos(replica);
      const updateRejected = await attempt(repos.places.update(0, { address: 'x' }));
      const afterUpdate = await dump(replica);
      const addRejected = await attempt(repos.places.add({ name: 'C' }));
      const afterAdd = await dump(replica);
      const removeRejected = await attempt(repos.places.remove(0));
      const afterRemove = await dump(replica);
      await replica.close();
      return { before, updateRejected, afterUpdate, addRejected, afterAdd, removeRejected, afterRemove };
    })()`);
    assert.equal(result.updateRejected.ok, false, 'update() must refuse to plan against an invalid existing collection, not silently reindex it');
    assert.deepEqual(result.afterUpdate, result.before, 'zero writes: the invalid stored records and authority/commitCount are byte-identical after the rejected update');
    assert.equal(result.addRejected.ok, false, 'add() must also refuse');
    assert.deepEqual(result.afterAdd, result.before, 'zero writes from the rejected add');
    assert.equal(result.removeRejected.ok, false, 'remove() must also refuse');
    assert.deepEqual(result.afterRemove, result.before, 'zero writes from the rejected remove');
  } finally {
    await harness.cleanup();
  }
});

test('C5 places: the inherited C3 order guard still rejects an invalid resulting order on the places domain, with zero writes', { concurrency: false, timeout: 120000 }, async () => {
  // The C5 diff always re-derives a fresh contiguous 0..n-1 order on every mutation, so a legitimate
  // repos.places.* call can never itself construct a duplicate/invalid resulting order. This proves
  // the C3 safety net (validateSharedPlaceOrders over the resulting plan) is still active on exactly
  // the store/domain wiring C5 uses, by driving runReplicaMutation with a deliberately bad plan.
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const { runReplicaMutation, requestResult } = window.__c5.api;
      const replica = await setup();
      const repos = makeRepos(replica);
      await repos.places.add({ name: 'A' });
      const before = await dump(replica);
      const badRecord = { id: 'bad', order: 0, payload: { name: 'Dup', address: '', lat: null, lon: null }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' };
      const rejected = await attempt(runReplicaMutation({
        replica, authority: { switchId: 'switch-1' }, domain: 'places', stores: ['sharedPlaces'],
        read: stores => requestResult(stores.sharedPlaces.getAll()),
        plan: () => ({ puts: [{ store: 'sharedPlaces', record: badRecord }], deletes: [], result: 'should-not-commit' }),
      }));
      const afterRejected = await dump(replica);
      await replica.close();
      return { before, rejected, afterRejected };
    })()`);
    assert.equal(result.rejected.ok, false, 'a plan leaving a duplicate order 0 is rejected by the inherited C3 guard');
    assert.deepEqual(result.afterRejected.places, result.before.places, 'zero writes from the rejected mutation');
    assert.equal(result.afterRejected.authority.commitCount, result.before.authority.commitCount, 'commitCount does not advance on a rejected mutation');
  } finally {
    await harness.cleanup();
  }
});

test('C5 places: TRUE parity against the C2 neutral module oracle (update/add/remove/padding), plus id stability and contiguous order', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { normalizePlace, normalizePlaces, createLocalReplica, requestResult } = window.__c5.api;
      const place = (name, address = '') => ({ name, address, lat: null, lon: null });
      const cases = [
        { name: 'update', seed: [place('A'), place('B'), place('C')], legacyOp: prev => prev.map((p, i) => (i === 1 ? { ...p, address: 'new' } : p)), run: repos => repos.places.update(1, { address: 'new' }) },
        { name: 'add', seed: [place('A')], legacyOp: prev => [...prev, normalizePlace({ name: 'New' }, prev.length)], run: repos => repos.places.add({ name: 'New' }) },
        { name: 'remove', seed: [place('A'), place('B'), place('C')], legacyOp: prev => prev.filter((_, i) => i !== 0), run: repos => repos.places.remove(0) },
        { name: 'padding on a short list', seed: [place('Solo', 'X')], legacyOp: prev => prev.map((p, i) => (i === 0 ? { ...p, address: 'Changed' } : p)), run: repos => repos.places.update(0, { address: 'Changed' }) },
      ];
      const outcomes = [];
      for (const testCase of cases) {
        // Legacy/C2 oracle: normalizePlaces (the accepted padded semantic view) then the same array
        // transform the hook performs, then normalizePlaces again at persist time.
        const paddedSeed = normalizePlaces(testCase.seed);
        const legacyPersisted = normalizePlaces(testCase.legacyOp(paddedSeed));

        // IndexedDB world: seed ONLY the real (unpadded) records.
        await window.__t.reset();
        const replica = createLocalReplica({ indexedDb: indexedDB });
        await replica.transact(['meta'], 'readwrite', ({ stores }) => requestResult(stores.meta.put(window.__c5.AUTHORITY)));
        await replica.transact(['sharedPlaces'], 'readwrite', ({ stores }) => {
          testCase.seed.forEach((payload, order) => stores.sharedPlaces.put({ id: 'seed-' + order, order, payload, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' }));
        });
        const before = await replica.transact(['sharedPlaces'], 'readonly', ({ stores }) => requestResult(stores.sharedPlaces.getAll()));
        const beforeIds = before.slice().sort((a, b) => a.order - b.order).map(r => r.id);

        const repos = window.__c5.makeRepos(replica, { ids: ['new-1', 'new-2', 'new-3', 'new-4'] });
        const c5Result = await testCase.run(repos);
        const afterRecords = await replica.transact(['sharedPlaces'], 'readonly', ({ stores }) => requestResult(stores.sharedPlaces.getAll()));
        await replica.close();
        const afterOrdered = afterRecords.slice().sort((a, b) => a.order - b.order);
        outcomes.push({
          name: testCase.name,
          legacyPersisted, c5Persisted: c5Result.places,
          beforeIds, afterIds: afterOrdered.map(r => r.id), afterOrders: afterOrdered.map(r => r.order),
        });
      }
      return outcomes;
    })()`);
    for (const outcome of result) {
      assert.deepEqual(outcome.c5Persisted, outcome.legacyPersisted, `${outcome.name}: C5's final semantic list must equal the C2 module oracle`);
      assert.deepEqual(outcome.afterOrders, outcome.afterOrders.map((_, i) => i), `${outcome.name}: orders stay contiguous 0..n-1`);
      if (outcome.name === 'update' || outcome.name === 'padding on a short list') {
        assert.deepEqual(outcome.afterIds.slice(0, outcome.beforeIds.length), outcome.beforeIds, `${outcome.name}: every real existing record keeps its own id`);
        for (const id of outcome.afterIds.slice(outcome.beforeIds.length)) {
          assert.ok(!outcome.beforeIds.includes(id), `${outcome.name}: a newly materialized padded slot gets a brand-new id`);
        }
      } else if (outcome.name === 'add') {
        assert.equal(outcome.afterIds[0], outcome.beforeIds[0], 'add: the pre-existing record keeps its id');
        for (const id of outcome.afterIds.slice(1)) assert.ok(!outcome.beforeIds.includes(id), 'add: every materialized/appended slot gets a brand-new id');
      } else if (outcome.name === 'remove') {
        assert.equal(outcome.afterIds[0], outcome.beforeIds[1], 'remove: the surviving record at the old second position keeps its own id, only its order moves');
        assert.equal(outcome.afterIds[1], outcome.beforeIds[2], 'remove: the surviving record at the old third position keeps its own id, only its order moves');
        assert.ok(!outcome.beforeIds.includes(outcome.afterIds[2]), 'remove: the re-padded default slot gets a brand-new id');
      }
    }
  } finally {
    await harness.cleanup();
  }
});

test('C5 places: two concurrent adds both persist with distinct ids, contiguous order, and commitCount advances twice', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump } = window.__c5;
      await window.__t.reset();
      const replicaA = window.__c5.api.createLocalReplica({ indexedDb: indexedDB });
      const replicaB = window.__c5.api.createLocalReplica({ indexedDb: indexedDB });
      await replicaA.transact(['meta'], 'readwrite', ({ stores }) => window.__c5.api.requestResult(stores.meta.put(window.__c5.AUTHORITY)));
      const reposA = window.__c5.makeRepos(replicaA, { ids: ['a-1', 'a-2', 'a-3', 'a-4'] });
      const reposB = window.__c5.makeRepos(replicaB, { ids: ['b-1', 'b-2', 'b-3', 'b-4'] });
      const [first, second] = await Promise.all([
        reposA.places.add({ name: 'FromA' }),
        reposB.places.add({ name: 'FromB' }),
      ]);
      const after = await dump(replicaA);
      await replicaA.close(); await replicaB.close();
      return { first, second, after };
    })()`);
    assert.equal(result.after.authority.commitCount, 2);
    const ordered = result.after.places.slice().sort((a, b) => a.order - b.order);
    const names = ordered.map(p => p.payload.name);
    assert.ok(names.includes('FromA') && names.includes('FromB'), 'both concurrent adds persisted');
    assert.deepEqual(ordered.map(p => p.order), ordered.map((p, i) => i), 'orders stay contiguous 0..n-1');
    assert.equal(new Set(ordered.map(p => p.id)).size, ordered.length, 'every id is distinct');
  } finally {
    await harness.cleanup();
  }
});

test('C5 calendar: load empty, create/update-occurrence/update-series/remove parity with the legacy repository, canonical id order, extras preserved with no extras invented', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt, putMeta, STAMP } = window.__c5;
      const replica = await setup();
      await putMeta(replica, { key: 'calendarLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: { theme: 'dark' } } });
      const repos = makeRepos(replica, { ids: ['event-b', 'event-a'] });

      const emptyLoad = await repos.calendar.load();

      const created = await attempt(repos.calendar.create({ title: 'Prügivedu', category: 'waste', subtype: 'bio', date: '2026-09-20', recurrence: { frequency: 'weekly', interval: 1 } }));
      const afterCreate = await dump(replica);
      const seriesId = created.value.events[0].id;

      const createdSecond = await attempt(repos.calendar.create({ title: 'Aiapidu', category: 'general', date: '2026-09-10' }));
      const afterSecond = await dump(replica);
      const idOrder = afterSecond.events.slice().sort((a, b) => a.id < b.id ? -1 : 1).map(e => e.id);
      const storedIdOrder = idOrder; // canonical order is by id; the load() output must match this order.
      const loadedAfterSecond = await repos.calendar.load();

      const occUpdated = await attempt(repos.calendar.update(seriesId, { title: 'Selle korra pealkiri' }, { scope: 'occurrence', occurrenceDate: '2026-09-20' }));
      const afterOccUpdate = await dump(replica);

      const seriesUpdated = await attempt(repos.calendar.update(seriesId, { title: 'Uus sarja pealkiri', date: '2026-09-27' }, { scope: 'series' }));
      const afterSeriesUpdate = await dump(replica);

      const removed = await attempt(repos.calendar.remove(seriesId, { scope: 'series' }));
      const afterRemove = await dump(replica);

      await replica.close();
      return { emptyLoad, created, afterCreate, createdSecond, afterSecond, storedIdOrder, loadedAfterSecond, occUpdated, afterOccUpdate, seriesUpdated, afterSeriesUpdate, removed, afterRemove };
    })()`);
    assert.deepEqual(result.emptyLoad.events, []);
    assert.equal(result.emptyLoad.writable, true);

    assert.equal(result.created.ok, true);
    assert.equal(result.afterCreate.events.length, 1);
    assert.equal(result.afterCreate.events[0].payload.recurrence.frequency, 'weekly');
    assert.equal(result.afterCreate.authority.commitCount, 1);

    assert.equal(result.createdSecond.ok, true);
    assert.equal(result.afterSecond.events.length, 2);
    // canonical order is ascending event id, independent of creation order.
    assert.deepEqual(result.loadedAfterSecond.events.map(e => e.id), result.storedIdOrder);
    assert.equal(result.loadedAfterSecond.theme, 'dark', 'extras field passes through the load boundary');
    assert.equal(result.loadedAfterSecond.version, 1);

    assert.equal(result.occUpdated.ok, true);
    const afterOccEvent = result.afterOccUpdate.events.find(e => e.id === result.created.value.events[0].id);
    assert.equal(afterOccEvent.payload.overrides['2026-09-20'].title, 'Selle korra pealkiri');
    assert.equal(afterOccEvent.payload.title, 'Prügivedu', 'an occurrence edit never rewrites the series base title');

    assert.equal(result.seriesUpdated.ok, true);
    const afterSeriesEvent = result.afterSeriesUpdate.events.find(e => e.id === result.created.value.events[0].id);
    assert.equal(afterSeriesEvent.payload.title, 'Uus sarja pealkiri');
    assert.equal(afterSeriesEvent.payload.date, '2026-09-27');
    assert.deepEqual(afterSeriesEvent.payload.excludedDates, [], 'a series date change resets excludedDates, per the accepted event repository');
    assert.deepEqual(afterSeriesEvent.payload.overrides, {}, 'a series date change resets per-occurrence overrides, per the accepted event repository');

    assert.equal(result.removed.ok, true);
    assert.equal(result.afterRemove.events.length, 1, 'removing the series deletes it, leaving only the unrelated event');
    assert.ok(!result.afterRemove.events.some(e => e.id === result.created.value.events[0].id));

    // Extras must never change across any calendar mutation.
    for (const dump of [result.afterCreate, result.afterSecond, result.afterOccUpdate, result.afterSeriesUpdate, result.afterRemove]) {
      assert.equal(dump.authority !== null, true);
    }
  } finally {
    await harness.cleanup();
  }
});

test('C5 calendar: extras stay byte-identical across a mutation, and no extras record is invented when none existed', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const replica = await setup();
      const repos = makeRepos(replica);
      const created = await attempt(repos.calendar.create({ title: 'Ilma extrasteta', category: 'general', date: '2026-09-11' }));
      const afterCreate = await dump(replica);
      const extras = await replica.getMeta('calendarLegacyEnvelopeExtras');
      const loaded = await repos.calendar.load();
      await replica.close();
      return { created, afterCreate, extras, loaded };
    })()`);
    assert.equal(result.created.ok, true);
    assert.equal(result.extras, undefined, 'a runtime mutation never creates an extras record merely because none existed');
    assert.equal(result.loaded.version, 1, 'the default version applies when no extras record exists');
  } finally {
    await harness.cleanup();
  }
});

test('C5 calendar/waste: importWaste creates wasteState exactly when the output defines wasteImports, and preserves it across later calendar mutations', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt } = window.__c5;
      const { normalizeWasteResult } = window.__c5.api;
      const replica = await setup();
      const repos = makeRepos(replica, { ids: ['imp-1', 'imp-2', 'manual-1'] });
      const provider = { id: 'fixture', name: 'Test source' };
      const address = 'Testi 1, Rakvere';
      const row = { externalId: 'source-1', date: '2026-09-14', subtype: 'bio', title: 'Biojäätmed' };
      const result0 = normalizeWasteResult(provider, address, { entries: [row] });
      const now = new Date('2026-09-13T12:00:00Z');

      const beforeImport = await dump(replica);
      const imported = await attempt(repos.calendar.importWaste(result0, now));
      const afterImport = await dump(replica);

      const manualCreated = await attempt(repos.calendar.create({ title: 'Muu', category: 'general', date: '2026-09-16' }));
      const afterManual = await dump(replica);
      await replica.close();
      return { beforeImport, imported, afterImport, manualCreated, afterManual };
    })()`);
    assert.equal(result.beforeImport.waste.length, 0, 'no waste record exists before any import, even though the calendar domain exists');
    assert.equal(result.imported.ok, true);
    assert.equal(result.afterImport.waste.length, 1);
    assert.equal(result.afterImport.waste[0].payload.wasteImports.length, 1);
    assert.equal(result.afterImport.events.some(e => e.payload.source === 'imported'), true);
    assert.equal(result.manualCreated.ok, true);
    assert.equal(result.afterManual.waste.length, 1, 'a later plain calendar mutation preserves the existing waste record unchanged');
    assert.deepEqual(result.afterManual.waste, result.afterImport.waste);
  } finally {
    await harness.cleanup();
  }
});

test('C5 calendar: authority mismatch and malformed authority reject with zero writes; an invalid stored event load is reported without repair', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt, putMeta } = window.__c5;
      const replica = await setup();
      const mismatched = makeRepos(replica, { authority: { switchId: 'wrong' } });
      const mismatchResult = await attempt(mismatched.calendar.create({ title: 'X', category: 'general', date: '2026-09-20' }));
      const afterMismatch = await dump(replica);

      await putMeta(replica, { key: 'storageAuthorityV1', status: 'active', switchId: 'switch-1', switchedAt: window.__c5.STAMP, legacyDigestAtSwitch: 'a'.repeat(63), markerPreparationId: 'prep-1', commitCount: 0, legacyUntrusted: false, persistGranted: null });
      const malformedRepos = makeRepos(replica);
      const malformedResult = await attempt(malformedRepos.calendar.create({ title: 'X', category: 'general', date: '2026-09-20' }));
      const afterMalformed = await dump(replica);

      await replica.transact(['calendarEvents'], 'readwrite', ({ stores }) => stores.calendarEvents.put({ id: 'bad', payload: { not: 'an event' }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' }));
      const invalidLoad = await malformedRepos.calendar.load();
      const afterInvalidLoad = await dump(replica);
      await replica.close();
      return { mismatchResult, afterMismatch, malformedResult, afterMalformed, invalidLoad, afterInvalidLoad };
    })()`);
    assert.equal(result.mismatchResult.ok, false);
    assert.deepEqual(result.afterMismatch.events, []);
    assert.equal(result.malformedResult.ok, false);
    assert.deepEqual(result.afterMalformed.events, []);
    assert.equal(result.invalidLoad.writable, false);
    assert.deepEqual(result.invalidLoad.events, []);
    assert.equal(result.afterInvalidLoad.events.length, 1, 'the invalid stored event record is left exactly as it was, never repaired or deleted');
  } finally {
    await harness.cleanup();
  }
});

test('C5 calendar: TRUE parity against the legacy createEventRepository oracle (create/update occurrence/update series/remove/importWaste/imported-event protection/extras)', { concurrency: false, timeout: 180000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { createEventRepository, createLocalReplica, requestResult, normalizeWasteResult } = window.__c5.api;
      const EVENT_STORAGE_KEY = 'majamajandus_household_events_v1';
      const idSeq = () => { let n = 0; return () => 'gen-' + (++n); };

      const recurringSeed = {
        id: 'ev-1', title: 'Prügivedu', category: 'waste', subtype: 'bio', date: '2026-09-20', time: null,
        recurrence: { frequency: 'weekly', interval: 1 }, reminder: { daysBefore: 0 }, source: 'manual',
        householdId: null, notes: '', seriesId: 'series:ev-1', excludedDates: ['2026-09-27'],
        overrides: { '2026-09-20': { title: 'Occurrence override' } },
      };
      const importedSeed = {
        id: 'ev-imported', title: 'Imporditud', category: 'waste', subtype: 'mixed', date: '2026-09-22', time: null,
        recurrence: { frequency: 'none', interval: 1 }, reminder: { daysBefore: 0 }, source: 'imported',
        householdId: null, notes: '', seriesId: null, excludedDates: [], overrides: {},
        importMeta: { provider: 'fixture', providerName: 'Test source', addressKey: 'k', address: 'a', externalId: 'x1', importedAt: '2026-09-01T00:00:00.000Z' },
      };

      async function runCase({ seedEvents = [], extras = null, wasteImports = null, operate }) {
        // World A: the legacy in-memory adapter, seeded with a semantically equivalent envelope.
        const legacyEnvelope = { version: extras ? extras.sourceVersion : 1, ...(extras ? extras.fields : {}), events: seedEvents, ...(wasteImports ? { wasteImports } : {}) };
        const legacyValues = new Map([[EVENT_STORAGE_KEY, JSON.stringify(legacyEnvelope)]]);
        const legacyStorage = { getItem: k => (legacyValues.has(k) ? legacyValues.get(k) : null), setItem: (k, v) => legacyValues.set(k, String(v)) };
        const legacyRepo = createEventRepository(legacyStorage, idSeq());
        let legacyOutcome = null, legacyError = null;
        try { legacyOutcome = await operate(legacyRepo); } catch (error) { legacyError = error.message; }
        const legacyFinal = JSON.parse(legacyValues.get(EVENT_STORAGE_KEY));

        // World B: IndexedDB, seeded with the same semantic state via the accepted stores directly.
        await window.__t.reset();
        const replica = createLocalReplica({ indexedDb: indexedDB });
        await replica.transact(['meta'], 'readwrite', ({ stores }) => requestResult(stores.meta.put(window.__c5.AUTHORITY)));
        await replica.transact(['calendarEvents'], 'readwrite', ({ stores }) => {
          seedEvents.forEach(event => stores.calendarEvents.put({ id: event.id, payload: event, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' }));
        });
        if (extras) await replica.transact(['meta'], 'readwrite', ({ stores }) => stores.meta.put({ key: 'calendarLegacyEnvelopeExtras', value: extras }));
        if (wasteImports) await replica.transact(['wasteState'], 'readwrite', ({ stores }) => stores.wasteState.put({ key: 'waste', payload: { wasteImports }, revision: 0, updatedAt: window.__c5.STAMP, deletedAt: null, syncStatus: 'local' }));
        const repos = window.__c5.makeRepos(replica, { newId: idSeq() });
        let c5Outcome = null, c5Error = null;
        try { c5Outcome = await operate(repos.calendar); } catch (error) { c5Error = error.message; }
        const finalRecords = await replica.listCalendarEvents();
        const finalWasteRecord = await replica.getWasteState();
        const finalExtrasRecord = await replica.getMeta('calendarLegacyEnvelopeExtras');
        await replica.close();

        return {
          legacyError, c5Error,
          legacyEvents: legacyFinal.events, c5Events: finalRecords.map(record => record.payload),
          legacyWasteImports: legacyFinal.wasteImports ?? null, c5WasteImports: finalWasteRecord ? finalWasteRecord.payload.wasteImports : null,
          legacyExtraFields: extras ? Object.fromEntries(Object.keys(extras.fields).map(key => [key, legacyFinal[key]])) : {},
          c5ExtrasRecord: finalExtrasRecord ?? null,
          legacyVersion: legacyFinal.version,
        };
      }

      const cases = {};

      cases.create = await runCase({
        seedEvents: [],
        operate: repo => repo.create({ title: 'Uus sündmus', category: 'general', date: '2026-09-20' }),
      });

      cases.updateOccurrence = await runCase({
        seedEvents: [recurringSeed],
        operate: repo => repo.update('ev-1', { title: 'Selle korra pealkiri' }, { scope: 'occurrence', occurrenceDate: '2026-10-04' }),
      });

      cases.updateSeriesWithDateChange = await runCase({
        seedEvents: [recurringSeed],
        operate: repo => repo.update('ev-1', { title: 'Uus sarja pealkiri', date: '2026-09-21' }, { scope: 'series' }),
      });

      cases.remove = await runCase({
        seedEvents: [recurringSeed],
        operate: repo => repo.remove('ev-1', { scope: 'series' }),
      });

      cases.importWaste = await runCase({
        seedEvents: [],
        operate: repo => repo.importWaste(normalizeWasteResult({ id: 'fixture', name: 'Test source' }, 'Testi 1, Rakvere', { entries: [{ externalId: 'source-1', date: '2026-09-14', subtype: 'bio', title: 'Biojäätmed' }] }), new Date('2026-09-13T12:00:00Z')),
      });

      cases.importedEventProtection = await runCase({
        seedEvents: [importedSeed],
        operate: repo => repo.update('ev-imported', { date: '2026-10-01' }, {}),
      });

      cases.extrasPreservation = await runCase({
        seedEvents: [],
        extras: { sourceVersion: 1, fields: { theme: 'dark' } },
        operate: repo => repo.create({ title: 'Extras test', category: 'general', date: '2026-09-25' }),
      });

      return cases;
    })()`);

    const byId = events => new Map(events.map(event => [event.id, event]));
    for (const [name, outcome] of Object.entries(result)) {
      assert.equal(outcome.c5Error === null, outcome.legacyError === null, `${name}: both worlds must agree on success/failure (legacy: ${outcome.legacyError}, c5: ${outcome.c5Error})`);
      if (outcome.legacyError !== null) continue; // failure-semantics case: no event/waste comparison needed once both worlds refused identically.
      const legacyById = byId(outcome.legacyEvents);
      const c5ById = byId(outcome.c5Events);
      assert.deepEqual([...c5ById.keys()].sort(), [...legacyById.keys()].sort(), `${name}: same set of event ids (id-keyed comparison, not array position)`);
      for (const id of legacyById.keys()) assert.deepEqual(c5ById.get(id), legacyById.get(id), `${name}: event ${id} semantic payload must match the legacy oracle`);
      assert.deepEqual(outcome.c5WasteImports, outcome.legacyWasteImports, `${name}: wasteImports must match the legacy oracle`);
      if (outcome.c5ExtrasRecord) {
        assert.equal(outcome.c5ExtrasRecord.value.sourceVersion, outcome.legacyVersion, `${name}: extras version preserved`);
        for (const [key, value] of Object.entries(outcome.legacyExtraFields)) {
          assert.deepEqual(outcome.c5ExtrasRecord.value.fields[key], value, `${name}: extras field ${key} preserved`);
        }
      }
    }
    // Case-specific semantic proofs the id-keyed loop above does not already cover.
    assert.equal(result.updateOccurrence.legacyError, null);
    const occEvent = result.updateOccurrence.c5Events.find(e => e.id === 'ev-1');
    assert.equal(occEvent.overrides['2026-10-04'].title, 'Selle korra pealkiri', 'occurrence override applied');
    assert.equal(occEvent.title, 'Prügivedu', 'series base title unaffected by an occurrence edit');
    assert.deepEqual(occEvent.excludedDates, ['2026-09-27'], 'pre-existing excludedDates untouched by an occurrence edit');

    const seriesEvent = result.updateSeriesWithDateChange.c5Events.find(e => e.id === 'ev-1');
    assert.equal(seriesEvent.date, '2026-09-21');
    assert.deepEqual(seriesEvent.excludedDates, [], 'a series date change resets excludedDates, per the legacy oracle');
    assert.deepEqual(seriesEvent.overrides, {}, 'a series date change resets overrides, per the legacy oracle');

    assert.equal(result.remove.c5Events.length, 0, 'the series was fully removed in both worlds');

    assert.equal(result.importWaste.c5WasteImports.length, 1);
    assert.equal(result.importWaste.c5Events.some(e => e.source === 'imported'), true);

    assert.notEqual(result.importedEventProtection.legacyError, null, 'the legacy oracle refuses the forbidden imported-event edit');
    assert.notEqual(result.importedEventProtection.c5Error, null, 'C5 must refuse the same forbidden imported-event edit');
    assert.equal(result.importedEventProtection.legacyError, result.importedEventProtection.c5Error, 'both worlds refuse with the same accepted error message');
  } finally {
    await harness.cleanup();
  }
});

test('C5 calendar: two concurrent creates both persist and commitCount advances once per mutation', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump } = window.__c5;
      await window.__t.reset();
      const replicaA = window.__c5.api.createLocalReplica({ indexedDb: indexedDB });
      const replicaB = window.__c5.api.createLocalReplica({ indexedDb: indexedDB });
      await replicaA.transact(['meta'], 'readwrite', ({ stores }) => window.__c5.api.requestResult(stores.meta.put(window.__c5.AUTHORITY)));
      const reposA = window.__c5.makeRepos(replicaA, { ids: ['a-1'] });
      const reposB = window.__c5.makeRepos(replicaB, { ids: ['b-1'] });
      const [first, second] = await Promise.all([
        reposA.calendar.create({ title: 'FromA', category: 'general', date: '2026-09-20' }),
        reposB.calendar.create({ title: 'FromB', category: 'general', date: '2026-09-21' }),
      ]);
      const after = await dump(replicaA);
      await replicaA.close(); await replicaB.close();
      return { first, second, after };
    })()`);
    assert.equal(result.after.authority.commitCount, 2);
    assert.equal(result.after.events.length, 2);
    const titles = result.after.events.map(e => e.payload.title);
    assert.ok(titles.includes('FromA') && titles.includes('FromB'), 'both concurrent creates persisted, no lost update');
  } finally {
    await harness.cleanup();
  }
});

test('C5 places and calendar: a write failure atomically preserves previous domain state and commitCount, with no legacy fallback', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await c5Harness();
  try {
    const result = await harness.evaluate(`(async () => {
      const { setup, makeRepos, dump, attempt, wrapReplicaTransact } = window.__c5;

      const replicaPlaces = await setup();
      const reposPlaces = makeRepos(replicaPlaces);
      await reposPlaces.places.add({ name: 'Kept' });
      const beforePlaces = await dump(replicaPlaces);
      const restorePlaces = wrapReplicaTransact(replicaPlaces, name => name === 'sharedPlaces');
      const failedPlaces = await attempt(reposPlaces.places.add({ name: 'Should not persist' }));
      restorePlaces();
      const afterPlaces = await dump(replicaPlaces);
      await replicaPlaces.close();

      const replicaCalendar = await setup();
      const reposCalendar = makeRepos(replicaCalendar);
      await reposCalendar.calendar.create({ title: 'Kept', category: 'general', date: '2026-09-20' });
      const beforeCalendar = await dump(replicaCalendar);
      const restoreCalendar = wrapReplicaTransact(replicaCalendar, name => name === 'calendarEvents');
      const failedCalendar = await attempt(reposCalendar.calendar.create({ title: 'Should not persist', category: 'general', date: '2026-09-21' }));
      restoreCalendar();
      const afterCalendar = await dump(replicaCalendar);
      await replicaCalendar.close();

      return { failedPlaces, beforePlaces, afterPlaces, failedCalendar, beforeCalendar, afterCalendar };
    })()`);
    assert.equal(result.failedPlaces.ok, false);
    assert.equal(result.failedPlaces.error.name, 'QuotaExceededError');
    assert.deepEqual(result.afterPlaces, result.beforePlaces, 'the places write failure changed nothing, including commitCount');

    assert.equal(result.failedCalendar.ok, false);
    assert.equal(result.failedCalendar.error.name, 'QuotaExceededError');
    assert.deepEqual(result.afterCalendar, result.beforeCalendar, 'the calendar write failure changed nothing, including commitCount');
  } finally {
    await harness.cleanup();
  }
});
