import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = [
  process.env.DIARY_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find(path => path && existsSync(path));
const PIN_KEY = 'sade_diary_pin';
const ENTRIES_KEY = 'sade_diary_entries';
const PIN = 'MTIzNA==';
const ENTRY = { id: 'legacy-1', date: '2026-09-20', createdAt: '2026-09-20T09:00:00.000Z',
  emoji: '😊', title: 'Legacy entry', good: '', hard: '', free: 'Original text', extra: { preserved: true } };
const ENTRY_BYTES = JSON.stringify([ENTRY]);
const RECORD_KEYS = ['entries', 'key', 'legacyDigest', 'migratedAt', 'origin', 'pin', 'updatedAt', 'version'];
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function createHarness() {
  assert.ok(browser, 'real Chromium is required for diary IndexedDB migration tests');
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, outfile: 'diary-migration-fixture.js',
    format: 'iife', platform: 'browser',
    stdin: { resolveDir: root, loader: 'js', contents: `
      import * as diary from './src/diary/diaryStore.js';
      window.__diary = diary;
    ` },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  assert.ok(script);
  const servers = [];
  const newOrigin = async () => {
    const server = createServer((request, response) => {
      if (request.url === '/fixture.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(script);
      } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><meta charset="utf-8"><script src="/fixture.js"></script>');
      }
    });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  };
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-r2-migration-'));
  const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const sockets = [];
  let browserSend;
  const cleanup = async () => {
    try {
      if (browserSend) await browserSend('Browser.close').catch(() => child.kill());
      else child.kill();
      for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
      if (child.exitCode === null) child.kill();
      for (const socket of sockets) socket.close();
      await Promise.all(servers.map(server => new Promise(resolveClose => server.close(resolveClose))));
    } finally {
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
      assert.match(basename(profile), /^annivibe-r2-migration-/);
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  };
  try {
    const port = new URL(await waitForBrowserEndpoint(child)).port;
    const connect = async endpoint => {
      const socket = new WebSocket(endpoint);
      sockets.push(socket);
      await new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener('open', resolveOpen, { once: true });
        socket.addEventListener('error', rejectOpen, { once: true });
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
      return (method, params = {}) => new Promise((resolveSend, rejectSend) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); rejectSend(new Error(`${method} timed out`)); }, 15000);
        pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    };
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
    browserSend = await connect(version.webSocketDebuggerUrl);
    const openTab = async origin => {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`, { method: 'PUT' });
      assert.equal(response.ok, true);
      const target = await response.json();
      const send = await connect(target.webSocketDebuggerUrl);
      const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitFor = async expression => {
        for (let attempt = 0; attempt < 150; attempt += 1) {
          if (await evaluate(expression)) return;
          await pause(30);
        }
        assert.fail(`Condition not met: ${expression}`);
      };
      await send('Runtime.enable');
      await waitFor('Boolean(window.__diary)');
      assert.equal(await evaluate('location.origin'), origin);
      return { evaluate, waitFor, send };
    };
    return { newOrigin, openTab, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness?.cleanup(); });

async function isolatedTab() {
  const origin = await harness.newOrigin();
  return harness.openTab(origin);
}
async function seed(tab, pin = PIN, entries = ENTRY_BYTES) {
  await tab.evaluate(`(() => {
    if (${JSON.stringify(pin)} !== null) localStorage.setItem(${JSON.stringify(PIN_KEY)}, ${JSON.stringify(pin)});
    if (${JSON.stringify(entries)} !== null) localStorage.setItem(${JSON.stringify(ENTRIES_KEY)}, ${JSON.stringify(entries)});
    return true;
  })()`);
}
async function raw(tab) {
  return tab.evaluate(`({ pin: localStorage.getItem(${JSON.stringify(PIN_KEY)}),
    entries: localStorage.getItem(${JSON.stringify(ENTRIES_KEY)}) })`);
}
async function authoritativeRecord(tab) {
  return tab.evaluate(`new Promise((resolveRecord, rejectRecord) => {
    const open = indexedDB.open('majandus_diary_v1', 1);
    open.onerror = () => rejectRecord(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('diary', 'readonly').objectStore('diary').get('state');
      request.onsuccess = () => { resolveRecord(request.result ?? null); db.close(); };
      request.onerror = () => { rejectRecord(request.error); db.close(); };
    };
  })`);
}
const load = tab => tab.evaluate('window.__diary.loadDiary()');

test('diary module import does not open IndexedDB', async () => {
  const tab = await isolatedTab();
  assert.equal(await tab.evaluate(`indexedDB.databases().then(items => items.some(item => item.name === 'majandus_diary_v1'))`), false);
});

test('valid legacy PIN and entries import once into the exact authoritative record', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  const result = await load(tab);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.entries, [ENTRY]);
  assert.deepEqual(Object.keys(result.state).sort(), RECORD_KEYS);
  assert.deepEqual({ key: result.state.key, version: result.state.version, pin: result.state.pin,
    origin: result.state.origin }, { key: 'state', version: 1, pin: PIN, origin: 'legacy-migration' });
  assert.match(result.state.legacyDigest, /^[a-f0-9]{64}$/);
  assert.match(result.state.migratedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(await authoritativeRecord(tab), result.state);
});

test('migration leaves legacy PIN and entry bytes exactly unchanged', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  const before = await raw(tab);
  assert.equal((await load(tab)).ok, true);
  assert.deepEqual(await raw(tab), before);
});

test('no legacy diary creates one valid fresh empty state', async () => {
  const tab = await isolatedTab();
  const result = await load(tab);
  assert.equal(result.ok, true);
  assert.deepEqual({ pin: result.state.pin, entries: result.state.entries, origin: result.state.origin },
    { pin: null, entries: [], origin: 'fresh' });
  assert.deepEqual(Object.keys(result.state).sort(), RECORD_KEYS);
});

test('invalid encoded legacy PIN fails closed without writing state', async () => {
  const tab = await isolatedTab();
  await seed(tab, '!!!');
  assert.deepEqual({ ok: (await load(tab)).ok, code: (await load(tab)).code },
    { ok: false, code: 'MIGRATION_FAILED' });
  assert.equal(await authoritativeRecord(tab), null);
  assert.equal((await raw(tab)).pin, '!!!');
});

test('invalid legacy entries JSON fails closed without writing state', async () => {
  const tab = await isolatedTab();
  await seed(tab, PIN, '{not-json');
  const result = await load(tab);
  assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'MIGRATION_FAILED' });
  assert.equal(await authoritativeRecord(tab), null);
  assert.equal((await raw(tab)).entries, '{not-json');
});

test('non-array legacy entries fail closed without writing state', async () => {
  const tab = await isolatedTab();
  await seed(tab, PIN, '{"unexpected":true}');
  const result = await load(tab);
  assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'MIGRATION_FAILED' });
  assert.equal(await authoritativeRecord(tab), null);
});

test('duplicate IDs and malformed identity or dates fail closed', async () => {
  for (const entries of [[ENTRY, ENTRY], [{ ...ENTRY, id: '' }], [{ ...ENTRY, date: '2026-02-30' }]]) {
    const tab = await isolatedTab();
    const bytes = JSON.stringify(entries);
    await seed(tab, PIN, bytes);
    assert.equal((await load(tab)).code, 'MIGRATION_FAILED');
    assert.equal(await authoritativeRecord(tab), null);
    assert.equal((await raw(tab)).entries, bytes);
  }
});

test('migration put failure leaves legacy intact and no authoritative state', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  await tab.evaluate(`(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (value?.key === 'state') throw new DOMException('synthetic quota', 'QuotaExceededError');
      return original.call(this, value, ...args);
    };
    return true;
  })()`);
  const result = await load(tab);
  assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: 'MIGRATION_FAILED' });
  assert.equal(await authoritativeRecord(tab), null);
  assert.deepEqual(await raw(tab), { pin: PIN, entries: ENTRY_BYTES });
});

test('aborted migration transaction leaves no state and a fresh tab can retry safely', async () => {
  const origin = await harness.newOrigin();
  const a = await harness.openTab(origin);
  await seed(a);
  await a.evaluate(`(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = original.apply(this, args);
      if (args[0]?.key === 'state') this.transaction.abort();
      return request;
    };
    return true;
  })()`);
  const failed = await load(a);
  assert.equal(failed.code, 'MIGRATION_FAILED');
  assert.equal(await authoritativeRecord(a), null);
  assert.deepEqual(await raw(a), { pin: PIN, entries: ENTRY_BYTES });
  const b = await harness.openTab(origin);
  const retried = await load(b);
  assert.equal(retried.ok, true);
  assert.deepEqual(retried.state.entries, [ENTRY]);
  assert.deepEqual(await authoritativeRecord(b), retried.state);
});

test('denied legacy reads fail closed without fabricating an empty diary', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  await tab.evaluate(`(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (key === ${JSON.stringify(PIN_KEY)} || key === ${JSON.stringify(ENTRIES_KEY)})
        throw new DOMException('synthetic denial', 'SecurityError');
      return original.call(this, key);
    };
    return true;
  })()`);
  assert.equal((await load(tab)).code, 'MIGRATION_FAILED');
  assert.equal(await authoritativeRecord(tab), null);
});

test('restart after migration never re-imports changed legacy bytes', async () => {
  const origin = await harness.newOrigin();
  const a = await harness.openTab(origin);
  await seed(a);
  assert.equal((await load(a)).ok, true);
  await a.evaluate(`localStorage.setItem(${JSON.stringify(ENTRIES_KEY)}, '[]'); true`);
  const b = await harness.openTab(origin);
  const result = await load(b);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.entries, [ENTRY]);
});

test('old-tab legacy writes produce a notice but cannot overwrite IndexedDB', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  const first = await load(tab);
  assert.equal(first.legacyChanged, false);
  await tab.evaluate(`localStorage.setItem(${JSON.stringify(ENTRIES_KEY)}, '[]'); true`);
  const second = await load(tab);
  assert.equal(second.legacyChanged, true);
  assert.deepEqual(second.state.entries, [ENTRY]);
  assert.deepEqual(await authoritativeRecord(tab), first.state);
});

test('reset keeps an authoritative state record with null PIN and empty entries', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  assert.equal((await load(tab)).ok, true);
  const result = await tab.evaluate('window.__diary.resetDiary()');
  assert.equal(result.ok, true);
  const record = await authoritativeRecord(tab);
  assert.equal(record.key, 'state');
  assert.deepEqual({ pin: record.pin, entries: record.entries }, { pin: null, entries: [] });
});

test('successful authoritative reset removes both legacy keys after commit', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  assert.equal((await load(tab)).ok, true);
  const result = await tab.evaluate('window.__diary.resetDiary()');
  assert.deepEqual({ ok: result.ok, legacyCleanupFailed: result.legacyCleanupFailed },
    { ok: true, legacyCleanupFailed: false });
  assert.deepEqual(await raw(tab), { pin: null, entries: null });
});

test('legacy cleanup failure reports warning while preserving committed reset', async () => {
  const tab = await isolatedTab();
  await seed(tab);
  assert.equal((await load(tab)).ok, true);
  await tab.evaluate(`(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
      if (key === ${JSON.stringify(ENTRIES_KEY)}) throw new DOMException('synthetic denial', 'SecurityError');
      return original.call(this, key);
    };
    return true;
  })()`);
  const result = await tab.evaluate('window.__diary.resetDiary()');
  assert.deepEqual({ ok: result.ok, legacyCleanupFailed: result.legacyCleanupFailed },
    { ok: true, legacyCleanupFailed: true });
  assert.deepEqual({ pin: (await authoritativeRecord(tab)).pin,
    entries: (await authoritativeRecord(tab)).entries }, { pin: null, entries: [] });
  assert.equal((await raw(tab)).entries, ENTRY_BYTES);
});

test('already orphaned legacy entries remain recoverable and cannot gain a new PIN silently', async () => {
  const tab = await isolatedTab();
  await seed(tab, null, ENTRY_BYTES);
  const result = await load(tab);
  assert.equal(result.ok, true);
  assert.deepEqual({ pin: result.state.pin, entries: result.state.entries }, { pin: null, entries: [ENTRY] });
  assert.equal((await tab.evaluate('window.__diary.setupDiaryPin("4321")')).code, 'DIARY_ORPHANED_LEGACY');
  assert.deepEqual((await authoritativeRecord(tab)).entries, [ENTRY]);
});

test('two tabs migrating the same legacy profile converge on one state', async () => {
  const origin = await harness.newOrigin();
  const a = await harness.openTab(origin);
  await seed(a);
  const b = await harness.openTab(origin);
  const [left, right] = await Promise.all([load(a), load(b)]);
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.deepEqual(left.state, right.state);
  assert.deepEqual(await authoritativeRecord(a), left.state);
});
