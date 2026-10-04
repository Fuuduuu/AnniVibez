import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
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
let harnessTail = Promise.resolve();

function installDbFixtures() {
  const stamp = '2026-10-04T10:00:00.000Z';
  const v1KeyPaths = {
    meta: 'key', auth: 'key', householdProfile: 'key', calendarEvents: 'id',
    sharedPlaces: 'id', wasteState: 'key', outbox: 'mutationId', syncState: 'key', conflicts: 'id',
  };
  const envelope = (fields, payload, revision, syncStatus, deletedAt = null) => ({
    ...fields, payload, revision, updatedAt: stamp, deletedAt, syncStatus,
  });
  const records = {
    meta: [
      { key: 'outboxSequence', value: 41 },
      { key: 'storageAuthorityV1', value: { status: 'active', switchId: 'kept-switch', commitCount: 9 } },
      { key: 'unrelated', value: { nested: [null, false, 'Õie 58', 0] } },
    ],
    auth: [{ key: 'device', deviceToken: 'm1s_fixture', householdId: 'hld_fixture', userId: 'usr_fixture', sessionId: 'ses_fixture' }],
    householdProfile: [envelope({ key: 'household' }, { name: 'Meie kodu', address: 'Õie 58' }, 0, 'local')],
    calendarEvents: [
      envelope({ id: 'calendar-pending' }, { title: 'Alles jääv sündmus', date: '2026-10-05', notes: 'Pooleliolev sünkroonimine' }, 7, 'pending'),
      envelope({ id: 'calendar-tombstone' }, { title: 'Kustutatud sündmus' }, 8, 'synced', stamp),
    ],
    sharedPlaces: [envelope({ id: 'place-kept', order: 2 }, { name: 'Vanaema', address: 'Kaevu 10', lat: 59.3, lon: 26.3 }, 0, 'local')],
    wasteState: [envelope({ key: 'waste' }, { wasteImports: [{ sourceId: 'kept-provider', entries: ['kept'] }] }, 0, 'local')],
    outbox: [{
      mutationId: 'pending-calendar-mutation', sequence: 41, entityType: 'calendar_event', entityId: 'calendar-pending',
      operation: 'UPDATE', baseRevision: 7, patch: { title: 'Alles jääv sündmus' },
      createdAt: stamp, attemptCount: 2, lastAttemptAt: stamp,
    }],
    syncState: [{ key: 'calendar', serverCursor: 12, bootstrapCompleted: true, lastSuccessfulSyncAt: stamp, lastAttemptAt: stamp }],
    conflicts: [{ id: 'calendar-conflict', entityType: 'calendar_event', entityId: 'calendar-pending', local: { title: 'Kohalik' }, server: { title: 'Server' }, revision: 7 }],
  };
  const request = operation => new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
    operation.onblocked = () => reject(new Error('fixture database operation blocked'));
  });
  const completed = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new DOMException('Fixture transaction aborted', 'AbortError'));
  });
  const reset = () => request(indexedDB.deleteDatabase(window.shoppingStorageApi.DB_NAME));
  const createV1 = async () => {
    const operation = indexedDB.open(window.shoppingStorageApi.DB_NAME, 1);
    operation.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(v1KeyPaths)) {
        const store = operation.result.createObjectStore(name, { keyPath });
        if (name === 'outbox') store.createIndex('bySequence', 'sequence', { unique: true });
      }
    };
    const db = await request(operation);
    const transaction = db.transaction(Object.keys(v1KeyPaths), 'readwrite');
    const done = completed(transaction);
    for (const [name, fixtures] of Object.entries(records)) {
      for (const record of fixtures) transaction.objectStore(name).put(record);
    }
    await done;
    return db;
  };
  const snapshot = async db => {
    const names = [...db.objectStoreNames];
    const transaction = db.transaction(names, 'readonly');
    const done = completed(transaction);
    const entries = await Promise.all(names.map(async name => {
      const store = transaction.objectStore(name);
      const indexes = Object.fromEntries([...store.indexNames].map(indexName => {
        const index = store.index(indexName);
        return [indexName, { keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }];
      }));
      return [name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records: await request(store.getAll()) }];
    }));
    await done;
    return { version: db.version, stores: Object.fromEntries(entries) };
  };
  window.shoppingDbFixtures = { stamp, envelope, v1KeyPaths, records, request, completed, reset, createV1, snapshot };
}

export async function createShoppingDbHarness() {
  const previous = harnessTail;
  let release;
  harnessTail = new Promise(resolve => { release = resolve; });
  await previous;
  let server;
  let profile;
  let child;
  let socket;
  let send;
  const cleanup = async () => {
    try {
      if (child) {
        if (send) await send('Browser.close').catch(() => child.kill());
        else child.kill();
        for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
        if (child.exitCode === null) {
          child.kill();
          for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
        }
      }
      socket?.close();
      if (server) await new Promise(resolve => server.close(resolve));
      if (profile) {
        assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
        rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
    } finally {
      release();
    }
  };
  try {
    assert.ok(browser, 'Chromium is required; shopping IndexedDB tests must not silently skip');
    const bundle = await build({
      absWorkingDir: root, bundle: true, write: false, outfile: 'shopping-db-fixture.js', format: 'iife', platform: 'browser',
      stdin: {
        resolveDir: root,
        contents: `
          import * as schema from './src/storage/schema.js';
          import * as indexedDb from './src/storage/indexedDb.js';
          import * as replica from './src/storage/localReplica.js';
          window.shoppingStorageApi = { ...schema, ...indexedDb, ...replica };
          (${installDbFixtures.toString()})();
        `,
      },
    });
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
    assert.ok(script, 'shopping database fixture bundle must contain JavaScript');
    server = createServer((incoming, response) => {
      response.setHeader('Content-Type', incoming.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8');
      response.end(incoming.url === '/fixture.js' ? script : '<!doctype html><meta charset="utf-8"><script src="/fixture.js"></script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    profile = mkdtempSync(resolve(tmpdir(), 'majandus-shopping-db-'));
    child = spawn(browser, [
      '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const port = new URL(await waitForBrowserEndpoint(child)).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const operation = pending.get(message.id);
      if (!operation) return;
      pending.delete(message.id);
      clearTimeout(operation.timer);
      if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
      else operation.resolve(message.result);
    });
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const ready = async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate('Boolean(window.shoppingStorageApi && window.shoppingDbFixtures)')) return;
        await pause(30);
      }
      assert.fail('shopping database fixture did not become ready');
    };
    const reload = async () => { await send('Page.reload'); await ready(); };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await ready();
    return { evaluate, reload, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
