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
const USER_SAVE = 'User save after successful revert';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Same real Chromium/native-IDB seam as indexeddb-browser.test.mjs. Only the callback delivery
// for A's completed authority read is held; no IndexedDB operation or controller is faked.
const PAGE_HELPERS = String.raw`
window.__r3 = (() => {
  const api = window.storageApi;
  const keys = api.LEGACY_SHARED_KEYS;
  const authorityKey = 'storageAuthorityV1';
  const attemptKey = 'storageRevertAttemptV1';
  const hintKey = 'majandus_storage_authority_v1';
  const stamp = '2026-09-16T10:00:00.000Z';
  const userSave = 'User save after successful revert';
  let scenario;

  function controller(options = {}) {
    const ids = options.ids || [];
    let next = 0;
    return api.createStorageAuthorityController({
      indexedDb: options.indexedDb || indexedDB,
      storage: options.storage || localStorage,
      locks: options.withLocks ? navigator.locks : undefined,
      cryptoApi: crypto,
      clock: () => stamp,
      newId: () => {
        if (next >= ids.length) throw new Error('unexpected newId call');
        return ids[next++];
      },
      mode: options.mode || 'revert',
    });
  }

  function spyStorage({ failOnceOnSet } = {}) {
    const calls = [];
    let failed = false;
    return {
      calls,
      getItem(key) { return localStorage.getItem(key); },
      setItem(key, value) {
        calls.push(['set', key]);
        if (key === failOnceOnSet && !failed) {
          failed = true;
          throw new Error('one-shot export write failure');
        }
        localStorage.setItem(key, value);
      },
      removeItem(key) { calls.push(['remove', key]); localStorage.removeItem(key); },
    };
  }

  function sharedSets(storage) {
    return storage.calls.filter(([operation, key]) => operation === 'set' && keys.includes(key)).length;
  }

  async function durable() {
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    try {
      return {
        authority: (await replica.getMeta(authorityKey)) ?? null,
        attempt: (await replica.getMeta(attemptKey)) ?? null,
        household: (await replica.getHouseholdProfile()) ?? null,
      };
    } finally {
      await replica.close();
    }
  }

  async function seed(phase) {
    localStorage.clear();
    const removal = indexedDB.deleteDatabase(api.DB_NAME);
    await new Promise((resolve, reject) => {
      removal.onsuccess = resolve;
      removal.onerror = () => reject(removal.error);
      removal.onblocked = () => reject(new Error('database reset blocked'));
    });
    localStorage.setItem(keys[1], JSON.stringify({ version: 1, profile: { name: 'Before', address: '' } }));
    const forward = controller({ mode: 'forward', ids: ['switch-1', 'prep-1'] });
    const forwardResult = await forward.boot();
    await forward.close();
    if (forwardResult.state !== 'READY') throw new Error('forward setup failed: ' + JSON.stringify(forwardResult));

    const before = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    let authority;
    const attemptId = 'race-attempt-1';
    const attempt = { key: attemptKey, switchId: 'switch-1', attemptId, commitCountAtStart: 0, phase };
    try {
      authority = await replica.getMeta(authorityKey);
      attempt.switchId = authority.switchId;
      attempt.commitCountAtStart = authority.commitCount;
      await replica.transact(['meta'], 'readwrite', ({ stores }) => {
        stores.meta.put({ ...authority, status: 'reverting' });
        stores.meta.put(attempt);
      });
    } finally {
      await replica.close();
    }
    if (phase === 'backups-verified') {
      for (const [index, domain] of ['calendar', 'household', 'places'].entries()) {
        localStorage.setItem(
          'majandus_legacy_backup_v1_' + authority.switchId + '_' + attemptId + '_' + domain,
          JSON.stringify({ version: 1, legacyKey: keys[index], raw: before[keys[index]] }),
        );
      }
      localStorage.setItem(
        'majandus_legacy_backup_v1_' + authority.switchId + '_current',
        JSON.stringify({ version: 1, switchId: authority.switchId, attemptId }),
      );
    }
    return {
      forwardResult,
      authorityValid: api.isWellFormedAuthorityRecord({ ...authority, status: 'reverting' }),
      attemptValid: api.isWellFormedRevertAttemptRecord(attempt),
      hintPresent: localStorage.getItem(hintKey) !== null,
    };
  }

  function holdCompletedAuthorityRead() {
    let resolveHeld;
    const held = new Promise(resolve => { resolveHeld = resolve; });
    let continuation;
    let released = false;
    let intercepted = false;
    const nativeGet = (target, property) => {
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    };
    const nativeSet = (target, property, value) => Reflect.set(target, property, value, target);
    const wrapTransaction = transaction => new Proxy(transaction, {
      get: nativeGet,
      set(target, property, value) {
        if (property !== 'oncomplete') return nativeSet(target, property, value);
        target.oncomplete = event => {
          intercepted = true;
          const deliver = () => value.call(target, event);
          if (released) deliver();
          else continuation = deliver;
          resolveHeld({ nativeTransactionCompleted: true, stores: [...target.objectStoreNames] });
        };
        return true;
      },
    });
    const wrapDatabase = database => new Proxy(database, {
      get(target, property) {
        if (property !== 'transaction') return nativeGet(target, property);
        return (names, mode, ...rest) => {
          const transaction = target.transaction(names, mode, ...rest);
          const stores = Array.isArray(names) ? names : [names];
          const authorityRead = mode === 'readonly' && stores.length === 1 && stores[0] === 'meta';
          return authorityRead && !intercepted ? wrapTransaction(transaction) : transaction;
        };
      },
      set: nativeSet,
    });
    const indexedDb = {
      open(...args) {
        const request = indexedDB.open(...args);
        let wrappedDatabase;
        return new Proxy(request, {
          get(target, property) {
            if (property === 'result') return wrappedDatabase ||= wrapDatabase(target.result);
            return nativeGet(target, property);
          },
          set: nativeSet,
        });
      },
    };
    return {
      indexedDb,
      held,
      release() {
        if (!intercepted || !continuation) throw new Error('snapshot continuation is not held');
        released = true;
        continuation();
        continuation = null;
      },
    };
  }

  async function startA({ phase = 'backups-verified', withLocks = false, bMode = 'revert' } = {}) {
    const seeded = await seed(phase);
    const barrier = holdCompletedAuthorityRead();
    const aStorage = spyStorage();
    const bStorage = spyStorage();
    const a = controller({ indexedDb: barrier.indexedDb, storage: aStorage, withLocks });
    const b = controller({ storage: bStorage, withLocks, mode: bMode });
    const aPromise = a.boot();
    scenario = { a, b, aStorage, bStorage, aPromise, barrier, withLocks };
    const held = await barrier.held;
    return {
      seeded,
      held,
      aSharedWritesWhileHeld: sharedSets(aStorage),
      durableHouseholdWhileHeld: (await durable()).household?.payload.name,
    };
  }

  async function startB() {
    scenario.bPromise = scenario.b.boot();
    if (!scenario.withLocks) return { queuedBehindWebLock: false };
    const lock = await navigator.locks.query();
    return { queuedBehindWebLock: lock.pending.some(entry => entry.name === 'majandus:storage-authority') };
  }

  async function finishBAndSave() {
    const bResult = await scenario.bPromise;
    const afterB = await durable();
    const hintAfterB = localStorage.getItem(hintKey);
    const canWrite = api.canWriteLegacy(localStorage);
    const saved = canWrite ? api.createHouseholdRepository(localStorage).save({ name: userSave }) : null;
    return {
      bResult,
      authorityAfterB: afterB.authority?.status ?? null,
      attemptAfterB: afterB.attempt,
      hintAfterB,
      canWrite,
      saveAcknowledged: saved?.writable === true && saved.profile.name === userSave,
      nameBeforeAResumes: api.createHouseholdRepository(localStorage).load().profile.name,
      bSharedWrites: sharedSets(scenario.bStorage),
    };
  }

  async function finishBWithoutSave() {
    const bResult = await scenario.bPromise;
    const afterB = await durable();
    return {
      bResult,
      authorityAfterB: afterB.authority?.status ?? null,
      attemptAfterB: afterB.attempt,
      hintAfterB: localStorage.getItem(hintKey),
      bSharedWrites: sharedSets(scenario.bStorage),
    };
  }

  async function releaseA() {
    scenario.barrier.release();
    const aResult = await scenario.aPromise;
    const aSharedWrites = sharedSets(scenario.aStorage);
    await scenario.a.close();
    await scenario.bPromise;
    await scenario.b.close();
    return { aResult, aSharedWrites };
  }

  async function fresh() {
    const verifier = controller({ mode: 'revert' });
    try {
      const result = await verifier.boot();
      const state = await durable();
      return {
        result,
        householdName: api.createHouseholdRepository(localStorage).load().profile.name,
        authority: state.authority?.status ?? null,
        attempt: state.attempt,
        hint: localStorage.getItem(hintKey),
      };
    } finally {
      await verifier.close();
    }
  }

  async function freshForward() {
    const verifier = controller({ mode: 'forward' });
    try {
      const result = await verifier.boot();
      const state = await durable();
      return {
        result,
        householdName: api.createHouseholdRepository(localStorage).load().profile.name,
        authority: state.authority?.status ?? null,
        attempt: state.attempt,
        hint: localStorage.getItem(hintKey),
      };
    } finally {
      await verifier.close();
    }
  }

  async function failExportAndInspect() {
    await seed('backups-verified');
    const before = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
    const failingStorage = spyStorage({ failOnceOnSet: keys[1] });
    const revert = controller({ storage: failingStorage });
    const result = await revert.boot();
    await revert.close();
    const after = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
    const state = await durable();
    return {
      before,
      after,
      result,
      authority: state.authority,
      attempt: state.attempt,
      backupRetained: localStorage.getItem('majandus_legacy_backup_v1_switch-1_race-attempt-1_household') !== null,
      calendarExportAttempted: failingStorage.calls.some(([operation, key]) => operation === 'set' && key === keys[0]),
      householdExportFailed: failingStorage.calls.some(([operation, key]) => operation === 'set' && key === keys[1]),
      calendarRestoredByCompensation: failingStorage.calls.some(([operation, key]) => operation === 'remove' && key === keys[0]),
    };
  }

  return { startA, startB, finishBAndSave, finishBWithoutSave, releaseA, fresh, freshForward, failExportAndInspect };
})();
'ready';`;

async function createBrowserHarness() {
  assert.ok(browser, 'Chromium is required; the R3 race must not silently skip');
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    outfile: 'revert-race-fixture.js',
    format: 'iife',
    platform: 'browser',
    stdin: {
      resolveDir: root,
      contents: `
        import { DB_NAME } from './src/storage/schema.js';
        import { createLocalReplica } from './src/storage/localReplica.js';
        import { LEGACY_SHARED_KEYS } from './src/storage/legacyMigration.js';
        import { createStorageAuthorityController, isWellFormedAuthorityRecord, isWellFormedRevertAttemptRecord, canWriteLegacy } from './src/storage/storageAuthority.js';
        import { createHouseholdRepository } from './src/waste/householdRepository.js';
        window.storageApi = { DB_NAME, createLocalReplica, LEGACY_SHARED_KEYS, createStorageAuthorityController, isWellFormedAuthorityRecord, isWellFormedRevertAttemptRecord, canWriteLegacy, createHouseholdRepository };
      `,
    },
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  assert.ok(script, 'browser fixture must contain JavaScript');
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
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-r3-red-'));
  const child = spawn(browser, [
    '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const port = new URL(await waitForBrowserEndpoint(child)).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
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
      rejectSend(new Error(method + ' timed out'));
    }, 30000);
    pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitReady = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate('Boolean(window.storageApi)')) {
        await evaluate(PAGE_HELPERS);
        return;
      }
      await pause(30); // Browser startup only; never used to order the race.
    }
    assert.fail('storage fixture did not become ready');
  };
  const pageReload = async () => {
    await send('Page.reload');
    await waitReady();
  };
  const cleanup = async () => {
    try {
      await send('Browser.close').catch(() => child.kill());
      for (let attempt = 0; child.exitCode === null && attempt < 50; attempt += 1) await pause(20);
      if (child.exitCode === null) child.kill();
      socket.close();
      await new Promise(resolveClose => server.close(resolveClose));
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()), 'temporary browser profile parent must match');
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } finally {
      for (const request of pending.values()) clearTimeout(request.timer);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  await waitReady();
  return { evaluate, pageReload, cleanup };
}

test('a stale resumed revert exporter cannot overwrite a post-revert legacy save without Web Locks', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate('window.__r3.startA()');
    assert.equal(held.seeded.authorityValid, true);
    assert.equal(held.seeded.attemptValid, true);
    assert.equal(held.seeded.hintPresent, true);
    assert.equal(held.held.nativeTransactionCompleted, true);
    assert.equal(held.aSharedWritesWhileHeld, 0);
    assert.deepEqual(held.held.stores, ['meta']);
    assert.equal(held.durableHouseholdWhileHeld, 'Before');

    await harness.evaluate('window.__r3.startB()');
    const b = await harness.evaluate('window.__r3.finishBAndSave()');
    assert.equal(b.bResult.state, 'LEGACY');
    assert.equal(b.authorityAfterB, 'reverted');
    assert.equal(b.attemptAfterB, null);
    assert.equal(b.hintAfterB, null);
    assert.equal(b.canWrite, true);
    assert.equal(b.saveAcknowledged, true);
    assert.equal(b.nameBeforeAResumes, USER_SAVE);

    const a = await harness.evaluate('window.__r3.releaseA()');
    await harness.pageReload();
    const fresh = await harness.evaluate('window.__r3.fresh()');
    const evidence = {
      bState: b.bResult.state,
      saveAcknowledged: b.saveAcknowledged,
      aSharedWrites: a.aSharedWrites,
      aResult: a.aResult,
      nameBeforeAResumes: b.nameBeforeAResumes,
      finalHouseholdName: fresh.householdName,
      finalAuthority: fresh.authority,
      finalAttempt: fresh.attempt,
      freshControllerState: fresh.result.state,
    };
    t.diagnostic(JSON.stringify(evidence));
    assert.equal(fresh.authority, 'reverted');
    assert.equal(fresh.attempt, null);
    assert.equal(fresh.hint, null);
    assert.deepEqual(
      { finalHouseholdName: fresh.householdName, aSharedWrites: a.aSharedWrites },
      { finalHouseholdName: USER_SAVE, aSharedWrites: 0 },
      'a stale exporter must issue zero shared-key writes and preserve the acknowledged save',
    );
  } finally {
    await harness.cleanup();
  }
});

test('real Web Locks serialize two resumed revert controllers before a legacy save', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate('window.__r3.startA({ withLocks: true })');
    assert.equal(held.held.nativeTransactionCompleted, true);
    assert.equal(held.aSharedWritesWhileHeld, 0);
    const queued = await harness.evaluate('window.__r3.startB()');
    assert.equal(queued.queuedBehindWebLock, true, 'B queues behind A on the real browser lock');

    const a = await harness.evaluate('window.__r3.releaseA()');
    const b = await harness.evaluate('window.__r3.finishBAndSave()');
    assert.equal(a.aResult.state, 'LEGACY');
    assert.equal(a.aSharedWrites, 3);
    assert.equal(b.bResult.state, 'LEGACY');
    assert.equal(b.bSharedWrites, 0, 'B sees the completed revert and does not export');
    assert.equal(b.canWrite, true);
    assert.equal(b.saveAcknowledged, true);
    assert.equal(b.authorityAfterB, 'reverted');
    assert.equal(b.attemptAfterB, null);
    assert.equal(b.hintAfterB, null);

    await harness.pageReload();
    const fresh = await harness.evaluate('window.__r3.fresh()');
    assert.equal(fresh.result.state, 'LEGACY');
    assert.equal(fresh.householdName, USER_SAVE);
    assert.equal(fresh.authority, 'reverted');
    assert.equal(fresh.attempt, null);
    assert.equal(fresh.hint, null);
  } finally {
    await harness.cleanup();
  }
});

test('a started-attempt loser without Web Locks makes zero shared writes after the winner completes', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate("window.__r3.startA({ phase: 'started' })");
    assert.equal(held.seeded.authorityValid, true);
    assert.equal(held.seeded.attemptValid, true);
    assert.equal(held.held.nativeTransactionCompleted, true);
    assert.equal(held.aSharedWritesWhileHeld, 0);
    assert.deepEqual(held.held.stores, ['meta']);
    assert.equal(held.durableHouseholdWhileHeld, 'Before');

    await harness.evaluate('window.__r3.startB()');
    const b = await harness.evaluate('window.__r3.finishBAndSave()');
    assert.equal(b.bResult.state, 'LEGACY');
    assert.equal(b.saveAcknowledged, true);
    assert.equal(b.nameBeforeAResumes, USER_SAVE);
    const a = await harness.evaluate('window.__r3.releaseA()');
    assert.equal(a.aSharedWrites, 0);
    assert.deepEqual(a.aResult, { state: 'REVERT_FAILED', reason: 'revert-attempt-id-collision' });

    await harness.pageReload();
    const fresh = await harness.evaluate('window.__r3.fresh()');
    assert.equal(fresh.result.state, 'LEGACY');
    assert.equal(fresh.householdName, USER_SAVE);
    assert.equal(fresh.authority, 'reverted');
    assert.equal(fresh.attempt, null);
    assert.equal(fresh.hint, null);
  } finally {
    await harness.cleanup();
  }
});

test('a competing forward boot supersedes a paused revert before it writes shared keys', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate("window.__r3.startA({ bMode: 'forward' })");
    assert.equal(held.held.nativeTransactionCompleted, true);
    assert.equal(held.aSharedWritesWhileHeld, 0);
    await harness.evaluate('window.__r3.startB()');
    const b = await harness.evaluate('window.__r3.finishBWithoutSave()');
    assert.equal(b.bResult.state, 'READY');
    assert.equal(b.authorityAfterB, 'active');
    assert.equal(b.attemptAfterB, null);
    assert.notEqual(b.hintAfterB, null);

    const a = await harness.evaluate('window.__r3.releaseA()');
    await harness.pageReload();
    const fresh = await harness.evaluate('window.__r3.freshForward()');
    t.diagnostic(JSON.stringify({
      bState: b.bResult.state,
      aSharedWrites: a.aSharedWrites,
      aResult: a.aResult,
      finalAuthority: fresh.authority,
      finalAttempt: fresh.attempt,
      freshControllerState: fresh.result.state,
    }));
    assert.equal(fresh.authority, 'active');
    assert.equal(fresh.attempt, null);
    assert.equal(a.aSharedWrites, 0, 'superseded A must not export after B converges authority to active');
  } finally {
    await harness.cleanup();
  }
});

test('a guarded export write failure compensates exact legacy bytes and never reports LEGACY', { concurrency: false, timeout: 120000 }, async () => {
  const harness = await createBrowserHarness();
  try {
    const result = await harness.evaluate('window.__r3.failExportAndInspect()');
    assert.equal(result.calendarExportAttempted, true);
    assert.equal(result.householdExportFailed, true);
    assert.equal(result.calendarRestoredByCompensation, true);
    assert.deepEqual(result.after, result.before, 'compensation preserves the three original legacy values byte-for-byte');
    assert.deepEqual(result.result, { state: 'REVERT_FAILED', reason: 'revert-compensation-verified' });
    assert.equal(result.authority.status, 'active');
    assert.equal(result.authority.legacyUntrusted, false);
    assert.equal(result.attempt, null);
    assert.equal(result.backupRetained, true);
  } finally {
    await harness.cleanup();
  }
});
