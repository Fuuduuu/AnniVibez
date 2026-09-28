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
const BEFORE = 'Before cutover';
const SAVED = 'Acknowledged before cutover';
const RETRY_FIRST = 'First fenced value';
const RETRY_REPLICA = 'Retry replica value';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Real Chromium, localStorage, Web Crypto, and native IndexedDB. The injected Crypto boundary
// holds delivery of the completed post-migration digest; it does not replace hashing or a DB write.
// Until R4 exists, direct save is diagnostic: it reproduces the present lost-write hazard.
// Once runLegacyWrite exists, the write scenarios use that R4+ fenced writer instead.
const PAGE_HELPERS = String.raw`
window.__r4 = (() => {
  const api = window.storageApi;
  const householdKey = api.LEGACY_SHARED_KEYS[1];
  const fenceKey = 'legacyWriteFenceV1';
  const authorityKey = 'storageAuthorityV1';
  const markerKey = 'legacyMigrationV1';
  const beforeName = 'Before cutover';
  const savedName = 'Acknowledged before cutover';
  const retryFirstName = 'First fenced value';
  const retryReplicaName = 'Retry replica value';
  const stamp = '2026-09-16T10:00:00.000Z';
  let scenario;
  let retryScenario;
  let crossTabScenario;

  function controller({ mode = 'forward', storage = localStorage, cryptoApi = crypto, ids = [] } = {}) {
    let next = 0;
    return api.createStorageAuthorityController({
      indexedDb: indexedDB, storage, cryptoApi, clock: () => stamp,
      newId: () => {
        if (next >= ids.length) throw new Error('unexpected newId call');
        return ids[next++];
      },
      mode,
    });
  }

  async function reset() {
    localStorage.clear();
    const removal = indexedDB.deleteDatabase(api.DB_NAME);
    await new Promise((resolve, reject) => {
      removal.onsuccess = resolve;
      removal.onerror = () => reject(removal.error);
      removal.onblocked = () => reject(new Error('database reset blocked'));
    });
    localStorage.setItem(householdKey, JSON.stringify({
      version: 1, profile: { name: beforeName, address: '' },
    }));
  }

  async function durable() {
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    try {
      const [authority, fence, marker, household] = await Promise.all([
        replica.getMeta(authorityKey), replica.getMeta(fenceKey),
        replica.getMeta(markerKey), replica.getHouseholdProfile(),
      ]);
      return {
        authority: authority ?? null,
        fence: fence ?? null,
        markerStatus: marker?.status ?? null,
        replicaName: household?.payload?.name ?? null,
      };
    } finally {
      await replica.close();
    }
  }

  function legacyName(storage = localStorage) {
    return api.createHouseholdRepository(storage).load().profile.name;
  }

  function staleViewStorage() {
    const old = Object.fromEntries(api.LEGACY_SHARED_KEYS.map(key => [key, localStorage.getItem(key)]));
    return {
      getItem(key) { return Object.hasOwn(old, key) ? old[key] : localStorage.getItem(key); },
      setItem(key, value) { localStorage.setItem(key, value); },
      removeItem(key) { localStorage.removeItem(key); },
    };
  }

  function holdPostMigrationDigest() {
    let calls = 0;
    let signalHeld;
    let releaseDigest;
    const held = new Promise(resolve => { signalHeld = resolve; });
    const released = new Promise(resolve => { releaseDigest = resolve; });
    return {
      held,
      release: () => releaseDigest(),
      cryptoApi: { subtle: { async digest(algorithm, bytes) {
        const hash = await crypto.subtle.digest(algorithm, bytes);
        calls += 1;
        if (calls === 2) {
          signalHeld({ nativeDigestCompleted: true, digestCalls: calls });
          await released;
        }
        return hash;
      } } },
    };
  }

  function holdFirstTwoMigrationDigests() {
    let calls = 0;
    const gates = [0, 1].map(() => {
      let signal;
      let release;
      return {
        held: new Promise(resolve => { signal = resolve; }),
        released: new Promise(resolve => { release = resolve; }),
        signal: () => signal(), release: () => release(),
      };
    });
    return {
      firstHeld: gates[0].held, secondHeld: gates[1].held,
      releaseFirst: gates[0].release, releaseSecond: gates[1].release,
      cryptoApi: { subtle: { async digest(algorithm, bytes) {
        const hash = await crypto.subtle.digest(algorithm, bytes);
        calls += 1;
        if (calls <= 2) {
          gates[calls - 1].signal();
          await gates[calls - 1].released;
        }
        return hash;
      } } },
    };
  }

  function holdThirdMigrationDigest() {
    let calls = 0;
    let signalHeld;
    let releaseDigest;
    const held = new Promise(resolve => { signalHeld = resolve; });
    const released = new Promise(resolve => { releaseDigest = resolve; });
    return {
      held,
      release: () => releaseDigest(),
      cryptoApi: { subtle: { async digest(algorithm, bytes) {
        const hash = await crypto.subtle.digest(algorithm, bytes);
        calls += 1;
        if (calls === 3) {
          signalHeld({ nativeDigestCompleted: true, digestCalls: calls });
          await released;
        }
        return hash;
      } } },
    };
  }

  async function startCrossTabSwitchRace() {
    await reset();
    const initialRaw = localStorage.getItem(householdKey);
    const writer = controller({ mode: 'revert' });
    const writerResult = await writer.boot();
    const s1Barrier = holdFirstTwoMigrationDigests();
    const s1 = controller({
      cryptoApi: s1Barrier.cryptoApi, ids: ['switch-s1', 'preparation-s1'],
    });
    const s1Promise = s1.boot();
    crossTabScenario = { writer, s1, s1Promise, s1Barrier, initialRaw };
    await s1Barrier.firstHeld;
    return { writerState: writerResult.state, initialRaw, durableWhileS1Held: await durable() };
  }

  async function advanceCrossTabSwitchRace() {
    const current = crossTabScenario;
    const first = await current.writer.runLegacyWrite(adapter =>
      api.createHouseholdRepository(adapter).save({ name: savedName }));
    const firstRaw = localStorage.getItem(householdKey);
    current.s1Barrier.releaseFirst();
    await current.s1Barrier.secondHeld;
    const s1Replica = await durable();

    const s2Barrier = holdThirdMigrationDigest();
    const s2 = controller({
      cryptoApi: s2Barrier.cryptoApi, ids: ['switch-s2', 'preparation-s2'],
    });
    const s2Promise = s2.boot();
    Object.assign(current, { s2, s2Promise, s2Barrier });
    const s2Held = await s2Barrier.held;
    const s2Replica = await durable();

    const last = await current.writer.runLegacyWrite(adapter =>
      api.createHouseholdRepository(adapter).save({ name: beforeName }));
    const lastRaw = localStorage.getItem(householdKey);
    const lastFence = (await durable()).fence;
    s2Barrier.release();
    const s2Result = await s2Promise;
    return { firstAcknowledged: first.writable, firstRaw, s1Replica, s2Held,
      s2Replica, lastAcknowledged: last.writable, lastRaw, lastFence,
      s2Result, afterS2: await durable(), legacyName: legacyName() };
  }

  async function resumeCrossTabSwitchRace() {
    const current = crossTabScenario;
    current.s1Barrier.releaseSecond();
    try {
      const s1Result = await current.s1Promise;
      return { s1Result, durable: await durable(), legacyName: legacyName() };
    } finally {
      await current.writer.close();
      await current.s1.close();
      await current.s2.close();
      crossTabScenario = undefined;
    }
  }

  async function startRetrySnapshotRace() {
    await reset();
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    try {
      const migration = await api.runLegacyMigration({
        replica, storage: localStorage, cryptoApi: crypto,
        newId: () => { throw new Error('unexpected seed id'); },
        newPreparationId: () => 'preparation-seed', now: () => stamp,
      });
      if (migration.status !== 'completed') throw new Error('seed migration did not complete');
    } finally { await replica.close(); }

    const writer = controller({ mode: 'revert' });
    const writerResult = await writer.boot();
    const first = await writer.runLegacyWrite(adapter =>
      api.createHouseholdRepository(adapter).save({ name: retryFirstName }));
    const firstRaw = localStorage.getItem(householdKey);
    let viewRaw = firstRaw;
    const switchStorage = {
      getItem(key) { return key === householdKey ? viewRaw : localStorage.getItem(key); },
      setItem(key, value) { localStorage.setItem(key, value); },
      removeItem(key) { localStorage.removeItem(key); },
    };
    const barrier = holdFirstTwoMigrationDigests();
    const switcher = controller({
      storage: switchStorage, cryptoApi: barrier.cryptoApi,
      ids: ['switch-retry', 'preparation-retry'],
    });
    const switchPromise = switcher.boot();
    retryScenario = { writer, switcher, switchPromise, barrier, switchStorage, firstRaw,
      setViewRaw: raw => { viewRaw = raw; } };
    await barrier.firstHeld;
    return { writerState: writerResult.state, firstAcknowledged: first.writable,
      firstRaw, durableWhileFirstHeld: await durable() };
  }

  async function advanceRetrySnapshotRace() {
    const current = retryScenario;
    const retryRaw = JSON.stringify({ version: 1, profile: { name: retryReplicaName, address: '' } });
    localStorage.setItem(householdKey, retryRaw);
    current.setViewRaw(retryRaw);
    current.barrier.releaseFirst();
    await current.barrier.secondHeld;
    const durableWhileRetryHeld = await durable();
    const last = await current.writer.runLegacyWrite(adapter =>
      api.createHouseholdRepository(adapter).save({ name: retryFirstName }));
    return { lastAcknowledged: last.writable, retryRaw,
      durableWhileRetryHeld, legacyName: legacyName(),
      switchingViewName: legacyName(current.switchStorage),
      fence: (await durable()).fence };
  }

  async function resumeRetrySnapshotRace() {
    const current = retryScenario;
    current.barrier.releaseSecond();
    try {
      const result = await current.switchPromise;
      return { result, durable: await durable(), legacyName: legacyName(),
        switchingViewName: legacyName(current.switchStorage) };
    } finally {
      await current.writer.close();
      await current.switcher.close();
      retryScenario = undefined;
    }
  }

  async function acknowledgedWrite(writer) {
    const repository = api.createHouseholdRepository(localStorage);
    const hasFencePrimitive = typeof writer.runLegacyWrite === 'function';
    let callbackCompleted = false;
    const run = () => {
      const saved = repository.save({ name: savedName });
      callbackCompleted = saved.writable === true;
      return saved;
    };
    if (hasFencePrimitive) await writer.runLegacyWrite(run);
    else run(); // RED-only diagnostic path; no old-build safety is claimed.
    return {
      hasFencePrimitive, acknowledged: callbackCompleted,
      legacyName: repository.load().profile.name,
      fence: (await durable()).fence,
    };
  }

  async function start({ staleView = false } = {}) {
    await reset();
    const writer = controller({ mode: 'revert' });
    const writerResult = await writer.boot();
    const switchStorage = staleView ? staleViewStorage() : localStorage;
    const barrier = holdPostMigrationDigest();
    const switcher = controller({
      storage: switchStorage, cryptoApi: barrier.cryptoApi,
      ids: ['switch-r4', 'preparation-r4'],
    });
    const switchPromise = switcher.boot();
    scenario = { writer, switcher, switchStorage, switchPromise, barrier };
    const held = await barrier.held;
    return {
      writerState: writerResult.state, held,
      durableWhileHeld: await durable(), legacyNameWhileHeld: legacyName(),
    };
  }

  async function writeWhileHeld() {
    const saved = await acknowledgedWrite(scenario.writer);
    return { ...saved, switchingViewName: legacyName(scenario.switchStorage) };
  }

  async function resume() {
    const current = scenario;
    current.barrier.release();
    try {
      const result = await current.switchPromise;
      return {
        result, durable: await durable(), legacyName: legacyName(),
        switchingViewName: legacyName(current.switchStorage),
      };
    } finally {
      await current.writer.close();
      await current.switcher.close();
      scenario = undefined;
    }
  }

  async function malformedFence() {
    await reset();
    const malformed = { key: fenceKey, malformed: true };
    const replica = api.createLocalReplica({ indexedDb: indexedDB });
    try {
      await replica.transact(['meta'], 'readwrite', ({ stores }) => stores.meta.put(malformed));
    } finally {
      await replica.close();
    }
    const switcher = controller({ ids: ['switch-malformed', 'preparation-malformed'] });
    try {
      const result = await switcher.boot();
      return { result, durable: await durable(), legacyName: legacyName(), malformed };
    } finally {
      await switcher.close();
    }
  }

  async function cleanFencedSwitch() {
    await reset();
    const writer = controller({ mode: 'revert' });
    const writerResult = await writer.boot();
    const saved = await acknowledgedWrite(writer);
    await writer.close();
    const switcher = controller({ ids: ['switch-clean', 'preparation-clean'] });
    try {
      const result = await switcher.boot();
      return {
        writerResult, saved, result, durable: await durable(),
        legacyName: legacyName(), dbVersion: api.DB_VERSION,
      };
    } finally {
      await switcher.close();
    }
  }

  return { start, writeWhileHeld, resume, malformedFence, cleanFencedSwitch,
    startRetrySnapshotRace, advanceRetrySnapshotRace, resumeRetrySnapshotRace,
    startCrossTabSwitchRace, advanceCrossTabSwitchRace, resumeCrossTabSwitchRace };
})();
'ready';`;

async function createBrowserHarness() {
  assert.ok(browser, 'Chromium is required; R4 RED must not silently skip');
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false,
    outfile: 'pre-switch-adoption-fixture.js', format: 'iife', platform: 'browser',
    stdin: {
      resolveDir: root,
      contents: `
        import { DB_NAME, DB_VERSION } from './src/storage/schema.js';
        import { createLocalReplica } from './src/storage/localReplica.js';
        import { LEGACY_SHARED_KEYS, runLegacyMigration } from './src/storage/legacyMigration.js';
        import { createStorageAuthorityController } from './src/storage/storageAuthority.js';
        import { createHouseholdRepository } from './src/waste/householdRepository.js';
        window.storageApi = { DB_NAME, DB_VERSION, createLocalReplica, LEGACY_SHARED_KEYS, runLegacyMigration,
          createStorageAuthorityController, createHouseholdRepository };
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
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-r4-red-'));
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
    pending.set(id, { resolve: resolveSend, rejectSend, timer });
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
  return { evaluate, cleanup };
}

function assertHeldSnapshot(held) {
  assert.equal(held.writerState, 'LEGACY');
  assert.deepEqual(held.held, { nativeDigestCompleted: true, digestCalls: 2 });
  assert.equal(held.durableWhileHeld.markerStatus, 'complete');
  assert.equal(held.durableWhileHeld.authority, null);
  assert.equal(held.durableWhileHeld.replicaName, BEFORE);
  assert.equal(held.legacyNameWhileHeld, BEFORE);
}

test('fresh-view pre-switch save blocks cutover from the older snapshot', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate('window.__r4.start()');
    assertHeldSnapshot(held);
    const saved = await harness.evaluate('window.__r4.writeWhileHeld()');
    assert.equal(saved.acknowledged, true);
    assert.equal(saved.legacyName, SAVED);
    const outcome = await harness.evaluate('window.__r4.resume()');
    t.diagnostic(JSON.stringify({ saved, outcome }));
    assert.deepEqual(
      { state: outcome.result.state, reason: outcome.result.reason, authority: outcome.durable.authority,
        legacyName: outcome.legacyName, replicaName: outcome.durable.replicaName },
      { state: 'LEGACY', reason: 'legacy-fence-mismatch', authority: null,
        legacyName: SAVED, replicaName: BEFORE },
      'an acknowledged pre-switch save must remain authoritative instead of exposing the older replica',
    );
    assert.equal(saved.hasFencePrimitive, true);
  } finally {
    await harness.cleanup();
  }
});

test('stale switching view cannot make a localStorage reread sufficient', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate('window.__r4.start({ staleView: true })');
    assertHeldSnapshot(held);
    const saved = await harness.evaluate('window.__r4.writeWhileHeld()');
    assert.equal(saved.acknowledged, true);
    assert.equal(saved.legacyName, SAVED);
    assert.equal(saved.switchingViewName, BEFORE, 'the switching view still sees old shared bytes');
    const outcome = await harness.evaluate('window.__r4.resume()');
    t.diagnostic(JSON.stringify({ saved, outcome }));
    assert.deepEqual(
      { state: outcome.result.state, reason: outcome.result.reason, authority: outcome.durable.authority,
        legacyName: outcome.legacyName, switchingViewName: outcome.switchingViewName },
      { state: 'LEGACY', reason: 'legacy-fence-mismatch', authority: null,
        legacyName: SAVED, switchingViewName: BEFORE },
      'the durable fence must protect a view whose localStorage reads stay stale',
    );
    assert.equal(saved.hasFencePrimitive, true);
  } finally {
    await harness.cleanup();
  }
});

test('fence mismatch retains LEGACY authority and malformed fence fails closed', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate('window.__r4.start()');
    assertHeldSnapshot(held);
    const saved = await harness.evaluate('window.__r4.writeWhileHeld()');
    assert.equal(saved.acknowledged, true);
    const mismatch = await harness.evaluate('window.__r4.resume()');
    const malformed = await harness.evaluate('window.__r4.malformedFence()');
    t.diagnostic(JSON.stringify({ saved, mismatch, malformed }));
    assert.deepEqual(
      { state: mismatch.result.state, reason: mismatch.result.reason, authority: mismatch.durable.authority,
        fence: mismatch.durable.fence, legacyName: mismatch.legacyName },
      { state: 'LEGACY', reason: 'legacy-fence-mismatch', authority: null,
        fence: saved.fence, legacyName: SAVED },
      'mismatch must leave acknowledged bytes and the fence intact without authority creation',
    );
    assert.notEqual(saved.fence, null, 'the R4+ writer must have advanced the durable fence');
    assert.notDeepEqual(saved.fence, held.durableWhileHeld.fence,
      'the acknowledged write must change the fence after the cutover snapshot');
    assert.deepEqual(
      { state: malformed.result.state, reason: malformed.result.reason, authority: malformed.durable.authority,
        fence: malformed.durable.fence },
      { state: 'STORAGE_UNAVAILABLE', reason: 'legacy-fence-malformed', authority: null,
        fence: malformed.malformed },
      'a malformed fence cannot be treated as an absent fence',
    );
  } finally {
    await harness.cleanup();
  }
});

test('mismatch neither merges nor re-adopts; a clean fenced switch removes its fence', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const held = await harness.evaluate('window.__r4.start()');
    assertHeldSnapshot(held);
    const saved = await harness.evaluate('window.__r4.writeWhileHeld()');
    assert.equal(saved.acknowledged, true);
    const mismatch = await harness.evaluate('window.__r4.resume()');
    const clean = await harness.evaluate('window.__r4.cleanFencedSwitch()');
    t.diagnostic(JSON.stringify({ saved, mismatch, clean }));
    assert.deepEqual(
      { state: mismatch.result.state, reason: mismatch.result.reason,
        authority: mismatch.durable.authority, replicaName: mismatch.durable.replicaName,
        legacyName: mismatch.legacyName, fence: mismatch.durable.fence },
      { state: 'LEGACY', reason: 'legacy-fence-mismatch',
        authority: null, replicaName: BEFORE,
        legacyName: SAVED, fence: saved.fence },
      'one mismatched attempt must not silently merge or adopt either side',
    );
    assert.notEqual(clean.saved.fence, null, 'a valid fenced write precedes the clean switch');
    assert.deepEqual(
      { writerState: clean.writerResult.state, state: clean.result.state,
        authorityStatus: clean.durable.authority?.status ?? null,
        fence: clean.durable.fence, replicaName: clean.durable.replicaName,
        dbVersion: clean.dbVersion },
      { writerState: 'LEGACY', state: 'READY', authorityStatus: 'active',
        fence: null, replicaName: SAVED, dbVersion: 1 },
      'successful authority creation must leave no fence and use the acknowledged legacy value',
    );
  } finally {
    await harness.cleanup();
  }
});

test('retry compares its own replica snapshot with the last acknowledged fence', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const first = await harness.evaluate('window.__r4.startRetrySnapshotRace()');
    assert.equal(first.writerState, 'LEGACY');
    assert.equal(first.firstAcknowledged, true);
    assert.equal(JSON.parse(first.firstRaw).profile.name, RETRY_FIRST);
    assert.equal(first.durableWhileFirstHeld.markerStatus, 'complete');
    assert.equal(first.durableWhileFirstHeld.replicaName, BEFORE);

    const retry = await harness.evaluate('window.__r4.advanceRetrySnapshotRace()');
    assert.equal(retry.lastAcknowledged, true);
    assert.notEqual(retry.retryRaw, first.firstRaw);
    assert.equal(retry.durableWhileRetryHeld.markerStatus, null, 'the stale marker was reset before retry');
    assert.equal(retry.durableWhileRetryHeld.replicaName, null);
    assert.equal(retry.legacyName, RETRY_FIRST);
    assert.equal(retry.switchingViewName, RETRY_REPLICA);
    assert.equal(retry.fence.writes.majamajandus_household_profile_v1, first.firstRaw);

    const outcome = await harness.evaluate('window.__r4.resumeRetrySnapshotRace()');
    t.diagnostic(JSON.stringify({ first, retry, outcome }));
    assert.deepEqual(
      { state: outcome.result.state, reason: outcome.result.reason,
        authority: outcome.durable.authority, replicaName: outcome.durable.replicaName,
        legacyName: outcome.legacyName, switchingViewName: outcome.switchingViewName },
      { state: 'LEGACY', reason: 'legacy-fence-mismatch', authority: null,
        replicaName: RETRY_REPLICA, legacyName: RETRY_FIRST, switchingViewName: RETRY_REPLICA },
      'a retry replica built from different bytes cannot become authority over the last fenced write',
    );
    assert.deepEqual(outcome.durable.fence, retry.fence, 'a refused switch retains the acknowledged fence');
  } finally {
    await harness.cleanup();
  }
});

test('a three-tab switch cannot authorize another attempt replica after acknowledged A-Y-A writes', { concurrency: false, timeout: 120000 }, async t => {
  const harness = await createBrowserHarness();
  try {
    const start = await harness.evaluate('window.__r4.startCrossTabSwitchRace()');
    assert.equal(start.writerState, 'LEGACY');
    assert.equal(start.durableWhileS1Held.authority, null);
    assert.equal(start.durableWhileS1Held.replicaName, null);

    const race = await harness.evaluate('window.__r4.advanceCrossTabSwitchRace()');
    assert.equal(race.firstAcknowledged, true);
    assert.notEqual(race.firstRaw, start.initialRaw);
    assert.equal(race.s1Replica.markerStatus, 'complete');
    assert.equal(race.s1Replica.replicaName, BEFORE, 'S1 built its replica from A');
    assert.deepEqual(race.s2Held, { nativeDigestCompleted: true, digestCalls: 3 });
    assert.equal(race.s2Replica.markerStatus, 'complete');
    assert.equal(race.s2Replica.replicaName, SAVED, 'S2 rebuilt the replica from Y');
    assert.equal(race.lastAcknowledged, true);
    assert.equal(race.lastRaw, start.initialRaw, 'the last fenced save restored the exact A bytes');
    assert.equal(race.lastFence.writes.majamajandus_household_profile_v1, start.initialRaw);
    assert.equal(race.s2Result.state, 'LEGACY');
    assert.equal(race.s2Result.reason, 'legacy-fence-mismatch');
    assert.equal(race.afterS2.authority, null);
    assert.deepEqual(race.afterS2.fence, race.lastFence);
    assert.equal(race.legacyName, BEFORE);

    const outcome = await harness.evaluate('window.__r4.resumeCrossTabSwitchRace()');
    t.diagnostic(JSON.stringify({ race, outcome }));
    assert.equal(outcome.s1Result.state, 'LEGACY',
      'S1 must not authorize the Y replica built by S2 using its own old A snapshot');
    assert.equal(outcome.durable.authority, null, 'unsafe interleaving must create no authority');
    assert.equal(outcome.legacyName, BEFORE, 'the last acknowledged LEGACY A survives');
    assert.deepEqual(outcome.durable.fence, race.lastFence, 'failed switches retain the fence');
    assert.equal(outcome.durable.replicaName, SAVED, 'failed switches do not merge or re-adopt');
  } finally {
    await harness.cleanup();
  }
});
