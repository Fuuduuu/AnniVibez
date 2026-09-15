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
        window.storageApi = { DB_NAME, DB_VERSION, STORE_NAMES, upgradeSchema, openMajandusDb, closeDb, requestResult, runTransaction };
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
      if (await evaluate('Boolean(window.storageApi)')) return;
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
