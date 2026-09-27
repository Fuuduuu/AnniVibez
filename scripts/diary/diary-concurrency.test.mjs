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
const PIN_BYTES = 'MTIzNA=='; // 1234
const DB_NAME = 'majandus_diary_v1';
const BASE_A = {
  id: 'base-a', date: '2026-09-20', createdAt: '2026-09-20T09:00:00.000Z',
  emoji: '😊', title: 'BASE-A', good: '', hard: '', free: 'Base A',
};
const BASE_B = {
  id: 'base-b', date: '2026-09-20', createdAt: '2026-09-20T10:00:00.000Z',
  emoji: '😊', title: 'BASE-B', good: '', hard: '', free: 'Base B',
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function createHarness({ processPerTab = false } = {}) {
  assert.ok(browser, 'Chromium is required for the R2 shared-storage checks');
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    outfile: 'diary-concurrency-fixture.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    stdin: {
      resolveDir: root,
      loader: 'jsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { useDiary } from './src/hooks/useDiary.js';
        import { PaeviikTab } from './src/components/PaeviikTab.jsx';

        window.__db = {
          reset() {
            return new Promise((resolve, reject) => {
              const request = indexedDB.deleteDatabase('majandus_diary_v1');
              request.onsuccess = () => resolve(true);
              request.onerror = () => reject(request.error);
              request.onblocked = () => reject(new Error('diary database blocked'));
            });
          },
          state() {
            return new Promise((resolve, reject) => {
              const request = indexedDB.open('majandus_diary_v1', 1);
              request.onupgradeneeded = () => request.result.createObjectStore('diary', { keyPath: 'key' });
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('diary', 'readonly');
                const get = tx.objectStore('diary').get('state');
                get.onsuccess = () => { const state = get.result ?? null; db.close(); resolve(state); };
                get.onerror = () => { db.close(); reject(get.error); };
              };
            });
          },
          writeState(state) {
            return new Promise((resolve, reject) => {
              const request = indexedDB.open('majandus_diary_v1', 1);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('diary', 'readwrite');
                tx.objectStore('diary').put(state);
                tx.oncomplete = () => { db.close(); resolve(true); };
                tx.onabort = () => { db.close(); reject(tx.error); };
              };
            });
          },
          hold() {
            window.__txHeld = false;
            window.__txReleaseRequested = false;
            return new Promise((resolve, reject) => {
              const request = indexedDB.open('majandus_diary_v1', 1);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('diary', 'readwrite');
                const store = tx.objectStore('diary');
                tx.oncomplete = () => db.close();
                tx.onabort = () => { db.close(); reject(tx.error); };
                window.__releaseTx = () => { window.__txReleaseRequested = true; };
                const keepAlive = () => {
                  store.get('state').onsuccess = () => {
                    if (!window.__txReleaseRequested) keepAlive();
                  };
                };
                keepAlive();
                window.__txHeld = true;
                resolve(true);
              };
            });
          },
        };

        function HookProbe() {
          window.__hook = useDiary();
          return <div>Hook ready</div>;
        }
        window.__app = {
          mount(view) {
            createRoot(document.getElementById('root')).render(view === 'diary' ? <PaeviikTab /> : <HookProbe />);
          },
        };
      `,
    },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  assert.ok(script, 'the production useDiary hook must bundle');
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(script);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-r2-diary-'));
  const child = spawn(browser, [
    '--headless=new', '--no-first-run', '--disable-background-networking',
    ...(processPerTab ? ['--process-per-tab'] : []),
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const sockets = [];
  let browserSend;
  const cleanup = async () => {
    try {
      if (browserSend) await browserSend('Browser.close').catch(() => child.kill());
      else child.kill();
      for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
      if (child.exitCode === null) child.kill();
      for (const socket of sockets) socket.close();
      await new Promise(resolveClose => server.close(resolveClose));
    } finally {
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
      assert.match(basename(profile), /^annivibe-r2-diary-/);
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
      const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectSend(new Error(`${method} timed out`));
        }, 15000);
        pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
      return send;
    };
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
    browserSend = await connect(version.webSocketDebuggerUrl);
    const processInfo = async () => (await browserSend('SystemInfo.getProcessInfo')).processInfo;
    const openTab = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`, { method: 'PUT' });
      assert.equal(response.ok, true, `Chrome could not create a tab: ${response.status}`);
      const target = await response.json();
      assert.equal(target.type, 'page');
      const send = await connect(target.webSocketDebuggerUrl);
      const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitFor = async (expression, attempts = 100) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (await evaluate(expression)) return;
          await pause(30);
        }
        assert.fail(`Condition not met: ${expression}`);
      };
      await send('Runtime.enable');
      await send('Page.enable');
      await waitFor('Boolean(window.__app)');
      assert.equal(await evaluate('location.origin'), origin);
      assert.equal(await evaluate('localStorage instanceof Storage'), true);
      return { evaluate, waitFor, targetId: target.id,
        close: () => browserSend('Target.closeTarget', { targetId: target.id }) };
    };
    return { origin, openTab, processInfo, browserPid: child.pid, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness?.cleanup(); });

async function seed(tab, entries) {
  await tab.evaluate('window.__db.reset()');
  await tab.evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem(${JSON.stringify(PIN_KEY)}, ${JSON.stringify(PIN_BYTES)});
    localStorage.setItem(${JSON.stringify(ENTRIES_KEY)}, ${JSON.stringify(JSON.stringify(entries))});
    return true;
  })()`);
}

async function mountAndUnlock(tab, expectedTitles) {
  await tab.evaluate('window.__app.mount(); true');
  await tab.waitFor('window.__hook?.status === "ready"');
  assert.equal(await tab.evaluate('window.__hook.tryUnlock("1234")'), true);
  await tab.waitFor('window.__hook.unlocked === true');
  assert.deepEqual(await tab.evaluate('window.__hook.entries.map(entry => entry.title)'), expectedTitles);
}

async function durableTitles(tab) {
  return tab.evaluate('window.__db.state().then(state => state?.entries.map(entry => entry.title) ?? [])');
}

async function freshTitles() {
  const tab = await harness.openTab();
  await tab.evaluate('window.__app.mount(); true');
  await tab.waitFor('window.__hook?.status === "ready"');
  assert.equal(await tab.evaluate('window.__hook.tryUnlock("1234")'), true);
  await tab.waitFor('window.__hook.unlocked === true');
  return tab.evaluate('window.__hook.entries.map(entry => entry.title)');
}

async function mutate(tab, expression) {
  return tab.evaluate(`(async () => {
    try {
      const result = await (${expression});
      return {
        ok: result?.ok === true,
        explicitFailure: result?.ok === false,
        code: result?.code ?? null,
        removed: result?.removed ?? null,
        entryId: result?.entry?.id ?? null,
      };
    } catch (error) {
      return { ok: false, explicitFailure: true, thrown: error?.name || 'Error', entryId: null };
    }
  })()`);
}

async function add(tab, title) {
  return mutate(tab, `window.__hook.addEntry({ title: ${JSON.stringify(title)}, free: ${JSON.stringify(title)} })`);
}

async function remove(tab, id) {
  return mutate(tab, `window.__hook.deleteEntry(${JSON.stringify(id)})`);
}

async function stateSnapshot(tab) {
  return tab.evaluate('window.__db.state()');
}

async function countDiaryWrites(tab) {
  await tab.evaluate(`(() => {
    const original = IDBObjectStore.prototype.put;
    window.__diaryWriteCount = 0;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'diary') window.__diaryWriteCount += 1;
      return original.apply(this, args);
    };
    window.__restorePut = () => { IDBObjectStore.prototype.put = original; };
    return true;
  })()`);
}

async function clickButton(tab, label) {
  return tab.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find(element => element.textContent.trim().includes(${JSON.stringify(label)}));
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)});
    button.click();
    return true;
  })()`);
}

async function typeField(tab, selector, value) {
  await tab.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing field: ' + ${JSON.stringify(selector)});
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await tab.evaluate('new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))');
}

async function openAuthoredDiaryForm(tab, title, draft) {
  await tab.evaluate("window.__app.mount('diary'); true");
  await tab.waitFor("document.body.innerText.includes('Sinu salapäevik')");
  await typeField(tab, 'input[type=password]', '1234');
  await clickButton(tab, 'Ava →');
  await tab.waitFor("document.body.innerText.includes('Minu salapäevik')");
  await clickButton(tab, 'Kirjuta tänane rida');
  await typeField(tab, 'input[placeholder="Pealkiri (soovi korral)"]', title);
  await clickButton(tab, 'Edasi →');
  await typeField(tab, 'textarea[placeholder="See on sinu privaatne koht."]', draft);
  assert.equal(await tab.evaluate('document.querySelector("textarea[placeholder=\\"See on sinu privaatne koht.\\"]").value'), draft);
}

test('single-context append persists to a fresh context', { timeout: 60000 }, async t => {
  t.diagnostic(`shared native IndexedDB origin: ${harness.origin}`);
  const a = await harness.openTab();
  await seed(a, []);
  await mountAndUnlock(a, []);
  const result = await add(a, 'POSITIVE-APPEND');
  assert.equal(result.ok, true);
  assert.deepEqual(await freshTitles(), ['POSITIVE-APPEND']);
});

test('single-context delete persists to a fresh context', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A, BASE_B]);
  await mountAndUnlock(a, ['BASE-A', 'BASE-B']);
  const result = await remove(a, BASE_A.id);
  assert.equal(result.ok, true);
  assert.deepEqual(await freshTitles(), ['BASE-B']);
});

test('two independent stale contexts cannot silently overwrite each other\'s append', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, []);
  const b = await harness.openTab();
  await mountAndUnlock(a, []);
  await mountAndUnlock(b, []);

  const aResult = await add(a, 'TAB-A-APPEND');
  assert.equal(aResult.ok, true);
  assert.deepEqual(await durableTitles(b), ['TAB-A-APPEND'], 'A commit must be directly visible in B native IndexedDB');
  const bResult = await add(b, 'TAB-B-APPEND');
  assert.ok(bResult.ok || bResult.explicitFailure, 'B must explicitly report success or failure');
  if (bResult.ok) assert.notEqual(bResult.entryId, aResult.entryId, 'ID collision would invalidate this RED race');
  const titles = await freshTitles();
  const safe = titles.includes('TAB-A-APPEND') &&
    (bResult.ok ? titles.includes('TAB-B-APPEND') : bResult.explicitFailure);
  assert.ok(safe, `B result=${JSON.stringify(bResult)}; fresh durable titles=${JSON.stringify(titles)}`);
});

test('stale delete cannot lose another context\'s committed append', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A']);
  await mountAndUnlock(b, ['BASE-A']);

  const aResult = await add(a, 'TAB-A-APPEND');
  assert.equal(aResult.ok, true);
  assert.deepEqual(await durableTitles(b), ['TAB-A-APPEND', 'BASE-A'], 'A commit must be directly visible in B native IndexedDB');
  const bResult = await remove(b, BASE_A.id);
  assert.ok(bResult.ok || bResult.explicitFailure, 'B must explicitly report success or failure');
  const titles = await freshTitles();
  const safe = titles.includes('TAB-A-APPEND') &&
    (bResult.ok ? !titles.includes('BASE-A') : bResult.explicitFailure);
  assert.ok(safe, `B result=${JSON.stringify(bResult)}; fresh durable titles=${JSON.stringify(titles)}`);
});

test('stale delete cannot resurrect another context\'s deleted entry', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A, BASE_B]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A', 'BASE-B']);
  await mountAndUnlock(b, ['BASE-A', 'BASE-B']);

  const aResult = await remove(a, BASE_A.id);
  assert.equal(aResult.ok, true);
  assert.deepEqual(await durableTitles(b), ['BASE-B'], 'A commit must be directly visible in B native IndexedDB');
  const bResult = await remove(b, BASE_B.id);
  assert.ok(bResult.ok || bResult.explicitFailure, 'B must explicitly report success or failure');
  const titles = await freshTitles();
  const safe = !titles.includes('BASE-A') &&
    (bResult.ok ? !titles.includes('BASE-B') : titles.includes('BASE-B'));
  assert.ok(safe, `B result=${JSON.stringify(bResult)}; fresh durable titles=${JSON.stringify(titles)}`);
});

test('a held IndexedDB transaction serializes a stale append behind a fresh durable read', { timeout: 60000 }, async () => {
  const h = await harness.openTab();
  await seed(h, []);
  const b = await harness.openTab();
  await mountAndUnlock(h, []);
  await mountAndUnlock(b, []);
  await h.evaluate('window.__db.hold()');
  try {
    await b.evaluate(`(() => {
      window.__mutationSettled = false;
      window.__mutationResult = null;
      Promise.resolve(window.__hook.addEntry({ title: 'TAB-B-APPEND', free: 'TAB-B-APPEND' }))
        .then(result => { window.__mutationResult = { ok: result?.ok === true, entryId: result?.entry?.id ?? null }; })
        .catch(error => { window.__mutationResult = { ok: false, error: error?.name || 'Error' }; })
        .finally(() => { window.__mutationSettled = true; });
      return true;
    })()`);
    await pause(60);
    assert.equal(await b.evaluate('window.__mutationSettled'), false, 'B must remain pending behind the readwrite transaction');
  } finally {
    await h.evaluate('window.__releaseTx?.(); true');
  }

  await b.waitFor('window.__mutationSettled === true');
  assert.equal(await b.evaluate('window.__mutationResult.ok'), true);
  assert.deepEqual(await freshTitles(), ['TAB-B-APPEND']);
});

test('without Web Locks, IndexedDB add and delete still commit safely', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  await mountAndUnlock(a, ['BASE-A']);
  await a.evaluate(`(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    return navigator.locks === undefined;
  })()`);
  const addResult = await add(a, 'BLOCKED-APPEND');
  const deleteResult = await remove(a, BASE_A.id);
  assert.deepEqual([addResult.ok, deleteResult.ok], [true, true]);
  assert.deepEqual(await freshTitles(), ['BLOCKED-APPEND']);
});

test('a rejected Web Lock request cannot affect IndexedDB authority', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  await mountAndUnlock(a, ['BASE-A']);
  await a.evaluate(`(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: () => Promise.reject(new DOMException('denied', 'SecurityError')) },
    });
    return true;
  })()`);
  const result = await add(a, 'REJECTED-APPEND');
  assert.equal(result.ok, true);
  assert.deepEqual(await freshTitles(), ['REJECTED-APPEND', 'BASE-A']);
});

test('deleting an already-absent entry succeeds without writing and refreshes stale hook state', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A, BASE_B]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A', 'BASE-B']);
  await mountAndUnlock(b, ['BASE-A', 'BASE-B']);
  assert.equal((await remove(a, BASE_A.id)).ok, true);
  const beforeState = await stateSnapshot(b);
  await countDiaryWrites(b);
  const result = await remove(b, BASE_A.id);
  await b.waitFor('window.__hook.entries.length === 1');
  assert.deepEqual({ ok: result.ok, removed: result.removed }, { ok: true, removed: false });
  assert.equal(await b.evaluate('window.__diaryWriteCount'), 0);
  assert.deepEqual(await stateSnapshot(b), beforeState);
  assert.deepEqual(await b.evaluate('window.__hook.entries.map(entry => entry.title)'), ['BASE-B']);
});

test('a reset prevents a stale tab from recreating orphaned diary entries', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A']);
  await mountAndUnlock(b, ['BASE-A']);
  const resetResult = await mutate(a, 'window.__hook.resetPin()');
  assert.equal(resetResult.ok, true);
  const afterResetA = await stateSnapshot(a);
  assert.deepEqual({ pin: afterResetA.pin, entries: afterResetA.entries }, { pin: null, entries: [] });
  await countDiaryWrites(b);
  const bResult = await add(b, 'STALE-ORPHAN');
  assert.deepEqual({ ok: bResult.ok, code: bResult.code }, { ok: false, code: 'DIARY_RESET_ELSEWHERE' });
  assert.equal(await b.evaluate('window.__diaryWriteCount'), 0);
  const c = await harness.openTab();
  const durable = await stateSnapshot(c);
  assert.deepEqual({ pin: durable.pin, entries: durable.entries }, { pin: null, entries: [] });
});

test('malformed authoritative entries fail closed for add and delete without rewriting state', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  await mountAndUnlock(a, ['BASE-A']);
  const original = await stateSnapshot(a);
  await a.evaluate(`window.__db.writeState({ ...${JSON.stringify(original)}, entries: 'not-array' })`);
  const malformed = await stateSnapshot(a);
  await countDiaryWrites(a);
  const addResult = await add(a, 'MUST-NOT-APPEND');
  assert.deepEqual({ ok: addResult.ok, code: addResult.code }, { ok: false, code: 'DIARY_STORAGE_UNAVAILABLE' });
  assert.equal(await a.evaluate('window.__diaryWriteCount'), 0);
  assert.deepEqual(await stateSnapshot(a), malformed);
  assert.deepEqual(await a.evaluate('window.__hook.entries.map(entry => entry.title)'), ['BASE-A']);

  await a.evaluate(`window.__db.writeState({ ...${JSON.stringify(original)}, entries: { unexpected: 'object' } })`);
  const nonArray = await stateSnapshot(a);
  await a.evaluate('window.__diaryWriteCount = 0; true');
  const deleteResult = await remove(a, BASE_A.id);
  assert.deepEqual({ ok: deleteResult.ok, code: deleteResult.code }, { ok: false, code: 'DIARY_STORAGE_UNAVAILABLE' });
  assert.equal(await a.evaluate('window.__diaryWriteCount'), 0);
  assert.deepEqual(await stateSnapshot(a), nonArray);
  assert.deepEqual(await a.evaluate('window.__hook.entries.map(entry => entry.title)'), ['BASE-A']);
});

test('quota write failure preserves authority and permits a later save', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  await mountAndUnlock(a, ['BASE-A']);
  const beforeState = await stateSnapshot(a);
  await a.evaluate(`(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'diary') throw new DOMException('quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
    window.__restorePut = () => { IDBObjectStore.prototype.put = original; };
    return true;
  })()`);
  const failed = await add(a, 'QUOTA-FAILED');
  assert.equal(failed.ok, false);
  assert.deepEqual(await stateSnapshot(a), beforeState);
  assert.deepEqual(await a.evaluate('window.__hook.entries.map(entry => entry.title)'), ['BASE-A']);

  await a.evaluate('window.__restorePut(); true');
  const retry = await add(a, 'AFTER-FAILURE');
  assert.equal(retry.ok, true, 'a failed write must not poison the next transaction');
  assert.deepEqual(await freshTitles(), ['AFTER-FAILURE', 'BASE-A']);
});

test('pending diary Save prevents a double submit and persists exactly one entry', { timeout: 60000 }, async () => {
  const h = await harness.openTab();
  await seed(h, []);
  await mountAndUnlock(h, []);
  const ui = await harness.openTab();
  await openAuthoredDiaryForm(ui, 'ONE-PENDING-SAVE', 'Authored once');
  await h.evaluate('window.__db.hold()');
  let disabledWhilePending;
  try {
    await clickButton(ui, 'Salvesta ✓');
    await ui.evaluate('new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))');
    disabledWhilePending = await ui.evaluate(`[...document.querySelectorAll('button')]
      .find(button => button.textContent.includes('Salvesta ✓'))?.disabled === true`);
    assert.equal(await ui.evaluate(`document.querySelector('textarea[placeholder="See on sinu privaatne koht."]')?.value`), 'Authored once');
    await clickButton(ui, 'Salvesta ✓');
  } finally {
    await h.evaluate('window.__releaseTx?.(); true');
  }
  await ui.waitFor("document.body.innerText.includes('Minu salapäevik')");
  await pause(100);
  assert.equal(disabledWhilePending, true, 'Save must be disabled while its first persistence is pending');
  assert.deepEqual(await freshTitles(), ['ONE-PENDING-SAVE']);
});

test('diary Save without Web Locks commits authored content through IndexedDB', { timeout: 60000 }, async () => {
  const ui = await harness.openTab();
  await seed(ui, []);
  await openAuthoredDiaryForm(ui, 'LOCK-UNAVAILABLE-DRAFT', 'Still authored');
  await ui.evaluate(`Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); true`);
  await clickButton(ui, 'Salvesta ✓');
  await ui.waitFor("document.body.innerText.includes('Minu salapäevik')");
  assert.deepEqual(await freshTitles(), ['LOCK-UNAVAILABLE-DRAFT']);
});

test('concurrent acknowledged saves are all durable across renderer processes', { timeout: 120000 }, async t => {
  const soak = await createHarness({ processPerTab: true });
  t.after(() => soak.cleanup());
  const rendererIds = async () => (await soak.processInfo())
    .filter(process => process.type === 'renderer').map(process => process.id);
  const before = await rendererIds();
  const a = await soak.openTab();
  await seed(a, []); // Seed legacy bytes, then initialize the dedicated IndexedDB authority.
  await mountAndUnlock(a, []);
  const afterA = await rendererIds();
  const b = await soak.openTab();
  await mountAndUnlock(b, []);
  const afterB = await rendererIds();
  assert.notEqual(a.targetId, b.targetId, 'A and B must be distinct browser tabs');
  assert.deepEqual([await a.evaluate('location.origin'), await b.evaluate('location.origin')], [soak.origin, soak.origin]);
  const aRenderer = afterA.filter(id => !before.includes(id));
  const bRenderer = afterB.filter(id => !afterA.includes(id));
  t.diagnostic(`browser PID=${soak.browserPid}; renderer PIDs before=${JSON.stringify(before)}, after A=${JSON.stringify(afterA)}, after B=${JSON.stringify(afterB)}; new A=${JSON.stringify(aRenderer)}, new B=${JSON.stringify(bRenderer)}; targets A=${a.targetId}, B=${b.targetId}`);
  assert.ok(aRenderer.length > 0 && bRenderer.length > 0 && afterB.length >= 2,
    'Chromium must expose distinct newly created renderer processes for A and B');

  const channelName = `annivibe-r2-soak-${soak.browserPid}`;
  const installWorker = (tab, label) => tab.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const channel = new BroadcastChannel(${JSON.stringify(channelName)});
    const state = { seenPeer: false, started: false, done: false, results: [], error: null };
    window.__soakState = state;
    window.__soakChannel = channel;
    channel.onmessage = event => {
      if (event.data?.type === 'READY' && event.data?.participant !== label) {
        state.seenPeer = true;
        return;
      }
      if (event.data?.type !== 'START' || state.started) return;
      state.started = true;
      (async () => {
        for (let index = 0; index < 60; index += 1) {
          const marker = label + '-' + String(index).padStart(3, '0');
          const result = await window.__hook.addEntry({ title: marker, free: marker });
          state.results.push({ marker, ok: result?.ok === true,
            explicitFailure: result?.ok === false, code: result?.code ?? null,
            entryId: result?.entry?.id ?? null });
        }
      })().catch(error => { state.error = error?.stack || String(error); })
        .finally(() => { state.done = true; });
    };
    return true;
  })()`);
  await installWorker(a, 'A');
  await installWorker(b, 'B');
  await a.evaluate('window.__soakChannel.postMessage({ type: "READY", participant: "A" }); true');
  await b.evaluate('window.__soakChannel.postMessage({ type: "READY", participant: "B" }); true');
  await a.waitFor('window.__soakState.seenPeer === true');
  await b.waitFor('window.__soakState.seenPeer === true');
  await a.evaluate(`(() => {
    window.__soakController = new BroadcastChannel(${JSON.stringify(channelName)});
    window.__soakController.postMessage({ type: 'START' });
    return true;
  })()`);
  await a.waitFor('window.__soakState.done === true', 1000);
  await b.waitFor('window.__soakState.done === true', 1000);
  const aState = await a.evaluate('window.__soakState');
  const bState = await b.evaluate('window.__soakState');
  assert.equal(aState.error, null, `A workload failed: ${aState.error}`);
  assert.equal(bState.error, null, `B workload failed: ${bState.error}`);
  assert.equal(aState.started && bState.started, true, 'both workers must receive START');
  assert.deepEqual([aState.results.length, bState.results.length], [60, 60]);
  const attempts = [...aState.results, ...bState.results];
  assert.ok(attempts.every(result => result.ok || result.explicitFailure), 'every attempt must be an acknowledged success or explicit failure');
  assert.ok(attempts.every(result => result.code !== 'DIARY_CONFLICT'), 'an ID collision invalidates this RED probe');
  const successes = attempts.filter(result => result.ok);
  const failures = attempts.filter(result => result.explicitFailure);
  assert.ok(aState.results.some(result => result.ok) && bState.results.some(result => result.ok),
    'both renderer processes must acknowledge at least one save');
  assert.ok(successes.every(result => typeof result.entryId === 'string' && result.entryId.length > 0),
    'production success must expose the created entry ID');

  const c = await soak.openTab();
  await c.evaluate('window.__app.mount(); true');
  await c.waitFor('window.__hook?.status === "ready"');
  assert.equal(await c.evaluate('window.__hook.tryUnlock("1234")'), true);
  await c.waitFor('window.__hook.unlocked === true');
  const durable = await c.evaluate('window.__hook.entries.map(entry => ({ id: entry.id, title: entry.title }))');
  const missing = successes.filter(result =>
    durable.filter(entry => entry.id === result.entryId && entry.title === result.marker).length === 0);
  const duplicate = successes.filter(result =>
    durable.filter(entry => entry.id === result.entryId && entry.title === result.marker).length > 1);
  t.diagnostic(`R2_SOAK attemptedA=60 attemptedB=60 success=${successes.length} explicitFailures=${failures.length} durable=${durable.length} missing=${missing.length} duplicate=${duplicate.length}; missingMarkers=${JSON.stringify(missing.map(result => result.marker))}`);
  assert.equal(missing.length, 0, `${missing.length} acknowledged saves absent from fresh context C: ${JSON.stringify(missing.map(result => result.marker))}`);
  assert.equal(duplicate.length, 0, 'no acknowledged entry may appear twice');
  assert.equal(durable.length, successes.length, 'an initially empty diary must contain exactly the acknowledged saves');
});

test('four tabs concurrently acknowledge 30 appends each and a fresh product read finds every ID once', { timeout: 120000 }, async t => {
  const soak = await createHarness({ processPerTab: true });
  t.after(() => soak.cleanup());
  const tabs = [];
  const first = await soak.openTab();
  tabs.push(first);
  await seed(first, []);
  await mountAndUnlock(first, []);
  for (let index = 1; index < 4; index += 1) {
    const tab = await soak.openTab();
    tabs.push(tab);
    await mountAndUnlock(tab, []);
  }
  assert.equal(new Set(tabs.map(tab => tab.targetId)).size, 4);
  const channelName = `annivibe-r2-four-${soak.browserPid}`;
  for (let index = 0; index < 4; index += 1) {
    await tabs[index].evaluate(`(() => {
      const label = ${JSON.stringify(String(index))};
      const channel = new BroadcastChannel(${JSON.stringify(channelName)});
      const state = { ready: [], started: false, done: false, results: [], error: null };
      window.__four = state;
      window.__fourChannel = channel;
      channel.onmessage = event => {
        if (event.data?.type === 'READY' && event.data?.label !== label) {
          state.ready.push(event.data.label);
          return;
        }
        if (event.data?.type !== 'START' || state.started) return;
        state.started = true;
        (async () => {
          for (let number = 0; number < 30; number += 1) {
            const marker = label + '-' + String(number).padStart(3, '0');
            const result = await window.__hook.addEntry({ title: marker, free: marker });
            state.results.push({ marker, ok: result?.ok === true,
              explicitFailure: result?.ok === false, code: result?.code ?? null,
              entryId: result?.entry?.id ?? null });
          }
        })().catch(error => { state.error = error?.stack || String(error); })
          .finally(() => { state.done = true; });
      };
      return true;
    })()`);
  }
  for (let index = 0; index < 4; index += 1) {
    await tabs[index].evaluate(`window.__fourChannel.postMessage({ type: 'READY', label: ${JSON.stringify(String(index))} }); true`);
  }
  for (const tab of tabs) await tab.waitFor('window.__four.ready.length === 3');
  await tabs[0].evaluate(`(() => {
    window.__fourController = new BroadcastChannel(${JSON.stringify(channelName)});
    window.__fourController.postMessage({ type: 'START' });
    return true;
  })()`);
  for (const tab of tabs) await tab.waitFor('window.__four.done === true', 1000);
  const states = await Promise.all(tabs.map(tab => tab.evaluate('window.__four')));
  for (const state of states) {
    assert.equal(state.error, null);
    assert.equal(state.started, true);
    assert.equal(state.results.length, 30);
  }
  const attempts = states.flatMap(state => state.results);
  assert.ok(attempts.every(result => result.ok || result.explicitFailure));
  assert.ok(attempts.every(result => result.code !== 'DIARY_CONFLICT'));
  const successes = attempts.filter(result => result.ok);
  const failures = attempts.filter(result => result.explicitFailure);
  const c = await soak.openTab();
  await c.evaluate('window.__app.mount(); true');
  await c.waitFor('window.__hook?.status === "ready"');
  assert.equal(await c.evaluate('window.__hook.tryUnlock("1234")'), true);
  await c.waitFor('window.__hook.unlocked === true');
  const durable = await c.evaluate('window.__hook.entries.map(entry => ({ id: entry.id, title: entry.title }))');
  const missing = successes.filter(result =>
    durable.filter(entry => entry.id === result.entryId && entry.title === result.marker).length === 0);
  const duplicate = successes.filter(result =>
    durable.filter(entry => entry.id === result.entryId && entry.title === result.marker).length > 1);
  t.diagnostic(`R2_FOUR_TAB attempted=120 success=${successes.length} explicitFailures=${failures.length} durable=${durable.length} missing=${missing.length} duplicate=${duplicate.length}`);
  assert.equal(missing.length, 0);
  assert.equal(duplicate.length, 0);
  assert.equal(durable.length, successes.length);
});

test('concurrent append and delete preserve the acknowledged append and remove the target', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A']);
  await mountAndUnlock(b, ['BASE-A']);
  const [append, deletion] = await Promise.all([add(a, 'MIXED-APPEND'), remove(b, BASE_A.id)]);
  assert.deepEqual([append.ok, deletion.ok, deletion.removed], [true, true, true]);
  assert.deepEqual(await freshTitles(), ['MIXED-APPEND']);
});

test('concurrent disjoint deletes commit without resurrecting either entry', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A, BASE_B]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A', 'BASE-B']);
  await mountAndUnlock(b, ['BASE-A', 'BASE-B']);
  const [first, second] = await Promise.all([remove(a, BASE_A.id), remove(b, BASE_B.id)]);
  assert.deepEqual([first.ok, first.removed, second.ok, second.removed], [true, true, true, true]);
  assert.deepEqual(await freshTitles(), []);
});

test('concurrent overlapping deletes remove once and do not write for the absent second delete', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A, BASE_B]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A', 'BASE-B']);
  await mountAndUnlock(b, ['BASE-A', 'BASE-B']);
  const [first, second] = await Promise.all([remove(a, BASE_A.id), remove(b, BASE_A.id)]);
  assert.deepEqual([first.ok, second.ok], [true, true]);
  assert.deepEqual([first.removed, second.removed].sort(), [false, true]);
  assert.deepEqual(await freshTitles(), ['BASE-B']);
});

test('concurrent reset and append never leave orphaned entries or an untruthful save', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A']);
  await mountAndUnlock(b, ['BASE-A']);
  const [reset, append] = await Promise.all([mutate(a, 'window.__hook.resetPin()'), add(b, 'RACE-APPEND')]);
  assert.equal(reset.ok, true);
  assert.ok(append.ok || append.explicitFailure);
  const state = await stateSnapshot(a);
  assert.deepEqual({ pin: state.pin, entries: state.entries }, { pin: null, entries: [] });
  if (!append.ok) assert.equal(append.code, 'DIARY_RESET_ELSEWHERE');
});

test('concurrent reset and delete never leave a PIN/entries split', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A']);
  await mountAndUnlock(b, ['BASE-A']);
  const [reset, deletion] = await Promise.all([mutate(a, 'window.__hook.resetPin()'), remove(b, BASE_A.id)]);
  assert.equal(reset.ok, true);
  assert.ok(deletion.ok || deletion.explicitFailure);
  const state = await stateSnapshot(a);
  assert.deepEqual({ pin: state.pin, entries: state.entries }, { pin: null, entries: [] });
  if (!deletion.ok) assert.equal(deletion.code, 'DIARY_RESET_ELSEWHERE');
});

test('an acknowledged save survives immediate tab close and fresh-context unlock', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, []);
  await mountAndUnlock(a, []);
  const result = await add(a, 'CLOSE-AFTER-ACK');
  assert.equal(result.ok, true);
  await a.close();
  assert.deepEqual(await freshTitles(), ['CLOSE-AFTER-ACK']);
});

test('aborted readwrite transaction cannot publish a save and does not block another tab', { timeout: 60000 }, async () => {
  const a = await harness.openTab();
  await seed(a, [BASE_A]);
  const b = await harness.openTab();
  await mountAndUnlock(a, ['BASE-A']);
  await mountAndUnlock(b, ['BASE-A']);
  await a.evaluate(`(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = original.apply(this, args);
      if (this.name === 'diary') this.transaction.abort();
      return request;
    };
    return true;
  })()`);
  const [aborted, committed] = await Promise.all([add(a, 'ABORTED-APPEND'), add(b, 'COMMITTED-APPEND')]);
  assert.deepEqual([aborted.ok, aborted.explicitFailure, committed.ok], [false, true, true]);
  assert.deepEqual(await a.evaluate('window.__hook.entries.map(entry => entry.title)'), ['BASE-A']);
  assert.deepEqual(await freshTitles(), ['COMMITTED-APPEND', 'BASE-A']);
});
