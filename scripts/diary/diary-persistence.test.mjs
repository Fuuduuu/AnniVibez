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
const OLD_PIN_BYTES = 'MTIzNA=='; // 1234
const NEW_PIN_BYTES = 'NTY3OA=='; // 5678
const PRIOR_ENTRIES_BYTES = '[{"id":"prior","date":"2026-09-20","createdAt":"2026-09-20T09:00:00.000Z","emoji":"😊","title":"Prior durable entry","good":"","hard":"","free":"Prior text"}]';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function createHarness() {
  assert.ok(browser, 'Chromium is required for the visible R1 contract checks');
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    outfile: 'diary-fixture.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.png': 'dataurl' },
    stdin: {
      resolveDir: root,
      loader: 'jsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { useDiary } from './src/hooks/useDiary.js';
        import { PaeviikTab } from './src/components/PaeviikTab.jsx';
        import { SeadedTab } from './src/components/SeadedTab.jsx';

        const household = {
          profile: { name: 'Synthetic home', address: '' },
          error: null, writable: true, save: async () => {},
        };
        const calendar = { events: [], wasteImports: [], error: null, importWaste: async () => {} };
        const reminders = {
          service: { getNotificationCapability: () => ({ supported: false, permission: 'unsupported', activeDelivery: false }) },
          preferences: { error: null, systemEnabled: false, defaultDaysBefore: 0, writable: true },
          delivery: { load: () => ({ writable: true }) },
          save: () => {},
        };
        function HookProbe() {
          window.__hook = useDiary();
          return <div>Hook ready</div>;
        }
        let activeRoot;
        window.__app = {
          unmount() {
            activeRoot?.unmount();
            activeRoot = null;
            window.__hook = null;
          },
          mount(view) {
            this.unmount();
            activeRoot = createRoot(document.getElementById('root'));
            activeRoot.render(view === 'diary' ? <PaeviikTab /> :
              view === 'settings' ? <SeadedTab household={household} calendar={calendar} reminders={reminders} /> :
              <HookProbe />);
          },
        };
      `,
    },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  assert.ok(script, 'the real diary and Settings components must bundle');
  const html = `<!doctype html><meta charset="utf-8"><script>
    (() => {
      const originalPut = IDBObjectStore.prototype.put;
      let fault = null;
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (fault && value?.key === 'state') {
          if (fault.mode === 'abort') {
            const request = originalPut.call(this, value, ...args);
            this.transaction.abort();
            return request;
          }
          throw new DOMException('synthetic IndexedDB failure', fault.name);
        }
        return originalPut.call(this, value, ...args);
      };
      window.__faults = {
        set(name = 'QuotaExceededError') { fault = { mode: 'throw', name }; },
        abort() { fault = { mode: 'abort' }; },
        clear() { fault = null; },
      };
      window.__state = () => new Promise((resolveState, rejectState) => {
        const open = indexedDB.open('majandus_diary_v1', 1);
        open.onerror = () => rejectState(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('diary')) { db.close(); resolveState(null); return; }
          const request = db.transaction('diary', 'readonly').objectStore('diary').get('state');
          request.onsuccess = () => { resolveState(request.result ?? null); db.close(); };
          request.onerror = () => { rejectState(request.error); db.close(); };
        };
      });
      window.__resetDb = () => new Promise((resolveReset, rejectReset) => {
        const request = indexedDB.deleteDatabase('majandus_diary_v1');
        request.onsuccess = () => resolveReset(true);
        request.onerror = () => rejectReset(request.error);
        request.onblocked = () => rejectReset(new Error('diary test DB remained open'));
      });
    })();
  </script><div id="root"></div><script src="/fixture.js"></script>`;
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(script);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-r1-diary-'));
  const child = spawn(browser, [
    '--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let socket;
  let send;
  const cleanup = async () => {
    try {
      if (send) await send('Browser.close').catch(() => child.kill());
      else child.kill();
      for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
      if (child.exitCode === null) child.kill();
      socket?.close();
      await new Promise(resolve => server.close(resolve));
    } finally {
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
      assert.match(basename(profile), /^annivibe-r1-diary-/);
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  };
  try {
    const port = new URL(await waitForBrowserEndpoint(child)).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
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
    send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`${method} timed out`));
      }, 15000);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate(expression)) return;
        await pause(30);
      }
      assert.fail(`Condition not met: ${expression}`);
    };
    const flush = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    const click = async label => {
      await evaluate(`(() => {
        const target = [...document.querySelectorAll('button,summary')]
          .find(element => element.textContent.trim().includes(${JSON.stringify(label)}));
        if (!target) throw new Error('Missing visible control: ' + ${JSON.stringify(label)});
        target.click();
        return true;
      })()`);
      await flush();
    };
    const type = async (selector, value) => {
      await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await flush();
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await waitFor('Boolean(window.__app && window.__faults && window.__state)');
    return { evaluate, waitFor, flush, click, type, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness?.cleanup(); });

async function prepare(view) {
  await harness.evaluate(`(async () => {
    window.__app.unmount();
    window.__faults.clear();
    localStorage.clear();
    await window.__resetDb();
    localStorage.setItem('sade_diary_pin', ${JSON.stringify(OLD_PIN_BYTES)});
    localStorage.setItem('sade_diary_entries', ${JSON.stringify(PRIOR_ENTRIES_BYTES)});
    window.__app.mount(${JSON.stringify(view)});
    return true;
  })()`);
  await harness.waitFor(`document.body.innerText.includes(${JSON.stringify(
    view === 'diary' ? 'Sinu salapäevik' : view === 'settings' ? 'Päeviku PIN ja andmed' : 'Hook ready'
  )})`);
}

async function unlockDiary(pin = '1234') {
  await harness.type('input[type=password]', pin);
  await harness.click('Ava →');
  await harness.waitFor("document.body.innerText.includes('Prior durable entry')");
}

async function fillDiary(title, draft) {
  await harness.click('Kirjuta tänane rida');
  await harness.type('input[placeholder="Pealkiri (soovi korral)"]', title);
  await harness.click('Edasi →');
  await harness.type('textarea[placeholder="See on sinu privaatne koht."]', draft);
  assert.equal(await harness.evaluate("document.querySelector('textarea[placeholder=\"See on sinu privaatne koht.\"]').value"), draft, 'the authored draft reached the real form');
}

async function diaryFailureSnapshot(title) {
  return harness.evaluate(`(async () => {
    const text = document.body.innerText;
    const draft = document.querySelector('textarea[placeholder="See on sinu privaatne koht."]');
    return {
      editorOpen: Boolean(draft),
      draft: draft?.value ?? null,
      failureVisible: [...document.querySelectorAll('[role=alert],.mm-field-error')]
        .some(element => Boolean(element.textContent.trim())) ||
        /ei õnnestunud|ebaõnnest|salvestamata|viga|proovi uuesti/i.test(text),
      newEntryVisible: text.includes(${JSON.stringify(title)}),
      storedEntries: (await window.__state()).entries,
    };
  })()`);
}

async function openPinSettings() {
  await harness.click('Päeviku PIN ja andmed');
  await harness.waitFor("document.body.innerText.includes('Muuda PIN-i')");
}

async function enterPinChange() {
  await openPinSettings();
  await harness.click('Muuda PIN-i');
  await harness.type('.mm-pin-input', '1234');
  await harness.click('Edasi →');
  await harness.type('.mm-pin-input', '5678');
  await harness.click('Edasi →');
  await harness.type('.mm-pin-input', '5678');
  await harness.waitFor("document.body.innerText.includes('Salvesta PIN-i')");
}

async function enterResetConfirmation() {
  await openPinSettings();
  await harness.click('Kustuta PIN ja päevik');
  await harness.waitFor("document.body.innerText.includes('Kustuta kõik')");
}

async function pinFailureSnapshot() {
  return harness.evaluate(`(async () => {
    const text = document.body.innerText;
    return {
      pinBytes: (await window.__state()).pin,
      successVisible: text.includes('PIN uuendatud'),
      failureVisible: [...document.querySelectorAll('[role=alert],.mm-field-error')]
        .some(element => Boolean(element.textContent.trim())) ||
        /ei õnnestunud|ebaõnnest|salvestamata|viga|proovi uuesti/i.test(text),
    };
  })()`);
}

async function resetFailureSnapshot() {
  return harness.evaluate(`(async () => {
    const text = document.body.innerText;
    const state = await window.__state();
    return {
      pinBytes: state.pin,
      entries: state.entries,
      successVisible: text.includes('PIN ja päevik on kustutatud'),
      claimsNoPin: text.includes('PIN pole veel peal'),
      failureVisible: [...document.querySelectorAll('[role=alert],.mm-field-error')]
        .some(element => Boolean(element.textContent.trim())) ||
        /ei õnnestunud|ebaõnnest|kustutamata|viga|proovi uuesti/i.test(text),
    };
  })()`);
}

test('successful diary save persists and survives a fresh diary mount', { timeout: 60000 }, async () => {
  await prepare('diary');
  await unlockDiary();
  await fillDiary('Durable new entry', 'Durable authored text');
  await harness.click('Salvesta ✓');
  await harness.waitFor("document.body.innerText.includes('Durable new entry')");
  const state = await harness.evaluate('window.__state()');
  assert.deepEqual(state?.entries?.map(entry => entry.title), ['Durable new entry', 'Prior durable entry']);
  await harness.evaluate("window.__app.mount('diary'); true");
  await harness.waitFor("document.body.innerText.includes('Sinu salapäevik')");
  await unlockDiary();
  assert.match(await harness.evaluate('document.body.innerText'), /Durable new entry/);
});

test('successful PIN change makes the new PIN authoritative on a fresh diary mount', { timeout: 60000 }, async () => {
  await prepare('settings');
  await enterPinChange();
  await harness.click('Salvesta PIN-i');
  assert.equal(await harness.evaluate('window.__state().then(state => state.pin)'), NEW_PIN_BYTES);
  await harness.evaluate("window.__app.mount('diary'); true");
  await harness.waitFor("document.body.innerText.includes('Sinu salapäevik')");
  await harness.type('input[type=password]', '1234');
  await harness.click('Ava →');
  assert.match(await harness.evaluate('document.body.innerText'), /See PIN ei klapi/);
  await unlockDiary('5678');
});

test('successful reset removes both the PIN and diary entries', { timeout: 60000 }, async () => {
  await prepare('settings');
  await enterResetConfirmation();
  await harness.click('Kustuta kõik');
  assert.deepEqual(await harness.evaluate('window.__state().then(state => ({ pin: state.pin, entries: state.entries }))'),
    { pin: null, entries: [] });
});

test('QuotaExceededError keeps the diary draft and editor instead of showing an uncommitted save', { timeout: 60000 }, async () => {
  await prepare('diary');
  await unlockDiary();
  await fillDiary('Quota uncommitted entry', 'Quota-authored draft');
  await harness.evaluate("window.__faults.set('QuotaExceededError'); true");
  await harness.click('Salvesta ✓');
  assert.deepEqual(await diaryFailureSnapshot('Quota uncommitted entry'), {
    editorOpen: true, draft: 'Quota-authored draft', failureVisible: true,
    newEntryVisible: false, storedEntries: JSON.parse(PRIOR_ENTRIES_BYTES),
  });
});

test('SecurityError keeps the diary draft and editor instead of showing an uncommitted save', { timeout: 60000 }, async () => {
  await prepare('diary');
  await unlockDiary();
  await fillDiary('Denied uncommitted entry', 'Denied-storage draft');
  await harness.evaluate("window.__faults.set('SecurityError'); true");
  await harness.click('Salvesta ✓');
  assert.deepEqual(await diaryFailureSnapshot('Denied uncommitted entry'), {
    editorOpen: true, draft: 'Denied-storage draft', failureVisible: true,
    newEntryVisible: false, storedEntries: JSON.parse(PRIOR_ENTRIES_BYTES),
  });
});

test('failed diary persistence does not publish the new entry in hook memory', { timeout: 60000 }, async () => {
  await prepare('hook');
  await harness.evaluate("window.__hook.tryUnlock('1234')");
  await harness.waitFor('window.__hook.unlocked === true');
  await harness.evaluate("window.__faults.set('SecurityError'); true");
  const result = await harness.evaluate("window.__hook.addEntry({ title: 'Memory-only entry', free: 'not durable' })");
  assert.equal(result.ok, false);
  await harness.flush();
  assert.deepEqual(await harness.evaluate("window.__state().then(state => ({ titles: window.__hook.entries.map(entry => entry.title), entries: state.entries }))"),
    { titles: ['Prior durable entry'], entries: JSON.parse(PRIOR_ENTRIES_BYTES) });
});

test('failed entry deletion keeps the authored entry visible and reports the storage failure', { timeout: 60000 }, async () => {
  await prepare('diary');
  await unlockDiary();
  await harness.click('Prior durable entry');
  await harness.click('Kustuta see kirje');
  await harness.evaluate("window.__faults.set('QuotaExceededError'); true");
  await harness.click('Jah, kustuta');
  assert.deepEqual(await harness.evaluate(`(async () => {
    const text = document.body.innerText;
    return {
      detailOpen: text.includes('Kustuta see kirje') || text.includes('Kas kustutame selle kirje jäädavalt?'),
      entryVisible: text.includes('Prior durable entry'),
      failureVisible: [...document.querySelectorAll('[role=alert],.mm-field-error')]
        .some(element => Boolean(element.textContent.trim())) ||
        /ei õnnestunud|ebaõnnest|kustutamata|viga|proovi uuesti/i.test(text),
      storedEntries: (await window.__state()).entries,
    };
  })()`), {
    detailOpen: true, entryVisible: true, failureVisible: true,
    storedEntries: JSON.parse(PRIOR_ENTRIES_BYTES),
  });
});

test('failed PIN persistence cannot show success while the old PIN remains authoritative', { timeout: 60000 }, async () => {
  await prepare('settings');
  await enterPinChange();
  await harness.evaluate("window.__faults.set('QuotaExceededError'); true");
  await harness.click('Salvesta PIN-i');
  assert.deepEqual(await pinFailureSnapshot(), {
    pinBytes: OLD_PIN_BYTES, successVisible: false, failureVisible: true,
  });
});

test('reset put failure cannot claim diary deletion', { timeout: 60000 }, async () => {
  await prepare('settings');
  await enterResetConfirmation();
  await harness.evaluate("window.__faults.set('SecurityError'); true");
  await harness.click('Kustuta kõik');
  assert.deepEqual(await resetFailureSnapshot(), {
    pinBytes: OLD_PIN_BYTES, entries: JSON.parse(PRIOR_ENTRIES_BYTES),
    successVisible: false, claimsNoPin: false, failureVisible: true,
  });
});

test('reset transaction abort cannot leave a partially deleted diary', { timeout: 60000 }, async () => {
  await prepare('settings');
  await enterResetConfirmation();
  await harness.evaluate("window.__faults.abort(); true");
  await harness.click('Kustuta kõik');
  assert.deepEqual(await resetFailureSnapshot(), {
    pinBytes: OLD_PIN_BYTES, entries: JSON.parse(PRIOR_ENTRIES_BYTES),
    successVisible: false, claimsNoPin: false, failureVisible: true,
  });
});

test('initial diary PIN setup failure stays recoverable and succeeds on retry', { timeout: 60000 }, async () => {
  await harness.evaluate("(async () => { window.__app.unmount(); window.__faults.clear(); localStorage.clear(); await window.__resetDb(); window.__app.mount('diary'); return true; })()");
  await harness.waitFor("document.body.innerText.includes('Pane päevikule PIN')");
  assert.equal(await harness.evaluate('window.__state().then(state => state.pin)'), null);

  await harness.type('input[type=password]', '4321');
  await harness.click('Edasi →');
  await harness.waitFor("document.body.innerText.includes('Korda PIN-i')");
  await harness.type('input[type=password]', '4321');
  await harness.evaluate("window.__faults.set('QuotaExceededError'); true");
  await harness.click('Valmis ✨');

  assert.deepEqual(await harness.evaluate(`(async () => {
    const text = document.body.innerText;
    return {
      pinBytes: (await window.__state()).pin,
      setupVisible: text.includes('Korda PIN-i'),
      confirmation: document.querySelector('input[type=password]')?.value ?? null,
      failureVisible: text.includes('PIN-i salvestamine ei õnnestunud. Proovi uuesti.'),
      diaryListVisible: text.includes('Minu salapäevik'),
    };
  })()`), {
    pinBytes: null, setupVisible: true, confirmation: '4321',
    failureVisible: true, diaryListVisible: false,
  });

  await harness.evaluate('window.__faults.clear(); true');
  await harness.click('Valmis ✨');
  await harness.waitFor("document.body.innerText.includes('Minu salapäevik')");
  assert.deepEqual(await harness.evaluate(`(async () => ({
    pinBytes: (await window.__state()).pin,
    setupVisible: document.body.innerText.includes('Korda PIN-i'),
    diaryListVisible: document.body.innerText.includes('Minu salapäevik'),
  }))()`), {
    pinBytes: 'NDMyMQ==', setupVisible: false, diaryListVisible: true,
  });
});

test('diary ForgotPin reset abort stays visible and preserves exact authoritative state', { timeout: 60000 }, async () => {
  await prepare('diary');
  const before = await harness.evaluate('window.__state()');
  assert.equal(before.pin, OLD_PIN_BYTES);
  assert.deepEqual(before.entries, JSON.parse(PRIOR_ENTRIES_BYTES));

  await harness.click('Unustasin PIN-i');
  await harness.waitFor("document.body.innerText.includes('Kas kustutame päeviku?')");
  await harness.evaluate("window.__faults.abort(); true");
  await harness.click('Kustuta kõik ja alusta uuesti');

  assert.deepEqual(await harness.evaluate(`(async () => {
    const text = document.body.innerText;
    return {
      state: await window.__state(),
      forgotVisible: text.includes('Kas kustutame päeviku?'),
      retryAvailable: [...document.querySelectorAll('button')]
        .some(button => button.textContent.includes('Kustuta kõik ja alusta uuesti')),
      failureVisible: text.includes('Kustutamine ei õnnestunud. Proovi uuesti.'),
      successVisible: text.includes('PIN ja päevik on kustutatud'),
      setupVisible: text.includes('Pane päevikule PIN'),
      diaryListVisible: text.includes('Minu salapäevik'),
    };
  })()`), {
    state: before, forgotVisible: true, retryAvailable: true, failureVisible: true,
    successVisible: false, setupVisible: false, diaryListVisible: false,
  });
});

test('unavailable IndexedDB open keeps the authored draft and the previous durable entry', { timeout: 60000 }, async () => {
  await prepare('diary');
  await unlockDiary();
  await fillDiary('UNAVAILABLE-DRAFT', 'Still here');
  const before = await harness.evaluate('window.__state()');
  await harness.evaluate(`(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function() { throw new DOMException('synthetic denial', 'SecurityError'); };
    window.__restoreOpen = () => { IDBFactory.prototype.open = original; };
    return true;
  })()`);
  try {
    await harness.click('Salvesta ✓');
    await harness.waitFor("document.body.innerText.includes('Salvestamine ei õnnestunud')");
    assert.deepEqual(await harness.evaluate(`({
      draft: document.querySelector('textarea[placeholder="See on sinu privaatne koht."]')?.value,
      editorOpen: Boolean(document.querySelector('textarea[placeholder="See on sinu privaatne koht."]')),
      falseSuccess: document.body.innerText.includes('UNAVAILABLE-DRAFT') &&
        document.body.innerText.includes('Minu salapäevik'),
    })`), { draft: 'Still here', editorOpen: true, falseSuccess: false });
  } finally {
    await harness.evaluate('window.__restoreOpen(); true');
  }
  assert.deepEqual(await harness.evaluate('window.__state()'), before);
});

test('old-tab legacy changes show a notice without replacing authoritative diary entries', { timeout: 60000 }, async () => {
  await prepare('diary');
  const before = await harness.evaluate('window.__state()');
  await harness.evaluate("localStorage.setItem('sade_diary_entries', '[]'); window.__app.unmount(); window.__app.mount('diary'); true");
  await harness.waitFor("document.body.innerText.includes('Vana päevikukoopia')");
  assert.deepEqual(await harness.evaluate('window.__state()'), before);
  await unlockDiary();
  assert.equal(await harness.evaluate("document.body.innerText.includes('Prior durable entry')"), true);
});

test('failed legacy cleanup warns visibly but does not deny an already committed reset', { timeout: 60000 }, async () => {
  await prepare('settings');
  await enterResetConfirmation();
  await harness.evaluate(`(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
      if (key === 'sade_diary_entries') throw new DOMException('synthetic denial', 'SecurityError');
      return original.call(this, key);
    };
    window.__restoreRemove = () => { Storage.prototype.removeItem = original; };
    return true;
  })()`);
  try {
    await harness.click('Kustuta kõik');
    await harness.waitFor("document.body.innerText.includes('vana päevikukoopia')");
    assert.deepEqual(await harness.evaluate(`(async () => ({
      pin: (await window.__state()).pin,
      entries: (await window.__state()).entries,
      legacyEntries: localStorage.getItem('sade_diary_entries'),
      warning: document.body.innerText.includes('vana päevikukoopia'),
      falseFullCleanup: document.body.innerText.includes('PIN ja päevik on kustutatud'),
    }))()`), { pin: null, entries: [], legacyEntries: PRIOR_ENTRIES_BYTES,
      warning: true, falseFullCleanup: false });
  } finally {
    await harness.evaluate('window.__restoreRemove(); true');
  }
});

test('invalid legacy diary shows a migration failure without replacing it with empty setup', { timeout: 60000 }, async () => {
  await harness.evaluate(`(async () => {
    window.__app.unmount();
    window.__faults.clear();
    localStorage.clear();
    await window.__resetDb();
    localStorage.setItem('sade_diary_pin', ${JSON.stringify(OLD_PIN_BYTES)});
    localStorage.setItem('sade_diary_entries', '{not-json');
    window.__app.mount('diary');
    return true;
  })()`);
  await harness.waitFor("document.body.innerText.includes('Vana päeviku andmeid ei õnnestunud')");
  assert.deepEqual(await harness.evaluate(`(async () => ({
    state: await window.__state(),
    legacy: localStorage.getItem('sade_diary_entries'),
    setupVisible: document.body.innerText.includes('Pane päevikule PIN'),
  }))()`), { state: null, legacy: '{not-json', setupVisible: false });
});

test('unavailable IndexedDB on diary opening shows a storage error instead of empty setup', { timeout: 60000 }, async () => {
  await harness.evaluate(`(async () => {
    window.__app.unmount();
    window.__faults.clear();
    localStorage.clear();
    await window.__resetDb();
    localStorage.setItem('sade_diary_pin', ${JSON.stringify(OLD_PIN_BYTES)});
    localStorage.setItem('sade_diary_entries', ${JSON.stringify(PRIOR_ENTRIES_BYTES)});
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function() { throw new DOMException('synthetic denial', 'SecurityError'); };
    window.__restoreOpen = () => { IDBFactory.prototype.open = original; };
    window.__app.mount('diary');
    return true;
  })()`);
  try {
    await harness.waitFor("document.body.innerText.includes('Päeviku salvestusruum pole saadaval')");
    assert.equal(await harness.evaluate("document.body.innerText.includes('Pane päevikule PIN')"), false);
  } finally {
    await harness.evaluate('window.__restoreOpen(); true');
  }
  assert.equal(await harness.evaluate('window.__state()'), null);
});
