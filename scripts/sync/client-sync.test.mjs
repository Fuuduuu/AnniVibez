import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';
import * as createHousehold from '../../functions/api/auth/create-household.js';
import * as bootstrap from '../../functions/api/sync/bootstrap.js';
import * as pull from '../../functions/api/sync/pull.js';
import * as push from '../../functions/api/sync/push.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = [process.env.STORAGE_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(path => path && existsSync(path));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function migrationStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) { if (char === quote && sql[index - 1] !== '\\') quote = null; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char !== ';') continue;
    const statement = sql.slice(start, index + 1);
    if (/^\s*CREATE\s+TRIGGER\b/i.test(statement) && !/\bEND\s*;\s*$/i.test(statement)) continue;
    if (statement.trim()) statements.push(statement.replace(/\s+/g, ' ').trim());
    start = index + 1;
  }
  assert.equal(sql.slice(start).trim(), '');
  return statements;
}

const fixture = `
import { createStorageAuthorityController } from './src/storage/storageAuthority.js';
import { createReplicaRepositories } from './src/storage/replicaRepositories.js';
import { createCalendarSync } from './src/sync/calendarSync.js';
import { createEvent } from './src/calendar/eventModel.js';
import { EVENT_STORAGE_KEY } from './src/calendar/eventRepository.js';
const clock = () => '2026-09-30T08:00:00.000Z';
const newId = () => crypto.randomUUID();
const nativeFetch = window.fetch.bind(window);
let controller;
let sync;
let repositories;
window.controls = { offlinePush: false, offline: false, push500: false, loseCreateReply: false, losePushReply: false, calls: [], pushes: [] };
const fetchImpl = async (url, options = {}) => {
  const path = String(url);
  const controls = window.controls;
  controls.calls.push(path);
  if (path === '/api/sync/push') controls.pushes.push(JSON.parse(options.body));
  if (controls.offline || (controls.offlinePush && path === '/api/sync/push')) throw new TypeError('Offline fixture');
  if (controls.push500 && path === '/api/sync/push') return new Response(JSON.stringify({error:{code:'INTERNAL_ERROR'}}), { status: 500 });
  if (controls.rejectNextPush && path === '/api/sync/push') {
    controls.rejectNextPush = false;
    return new Response(JSON.stringify({results:JSON.parse(options.body).mutations.map(item =>
      ({mutationId:item.mutationId,status:'REJECTED',code:'INVALID_MUTATION'}))}), {status:200});
  }
  const response = await nativeFetch(url, options);
  if (controls.loseCreateReply && path === '/api/auth/create-household') throw new TypeError('Lost create reply');
  if (controls.losePushReply && path === '/api/sync/push') throw new TypeError('Lost push reply');
  if (controls.holdPull && path.startsWith('/api/sync/pull')) {
    controls.holdPull = false;
    controls.pullHeldResolve();
    await controls.pullRelease;
  }
  if (controls.abortPullApply && path.startsWith('/api/sync/pull')) {
    controls.abortPullApply = false;
    controls.abortNextSyncCommit = true;
  }
  return response;
};
async function mount() {
  controller = createStorageAuthorityController({ indexedDb: indexedDB, storage: localStorage,
    cryptoApi: crypto, newId, clock, mode: 'forward' });
  const result = await controller.boot();
  if (result.state !== 'READY') throw Error('Fixture must be READY: ' + result.state);
  const authority = controller.getReadyAuthorityIdentity();
  const transact = controller.replica.transact.bind(controller.replica);
  controller.replica.transact = (names, mode, body) => transact(names, mode, async context => {
    const result = await body(context);
    if (window.controls.abortNextSyncCommit && mode === 'readwrite' && names.includes('syncState')) {
      window.controls.abortNextSyncCommit = false;
      window.controls.pullApplyAbortCount = (window.controls.pullApplyAbortCount ?? 0) + 1;
      context.transaction.abort();
    }
    return result;
  });
  repositories = createReplicaRepositories({ replica: controller.replica, authority, newId, clock });
  sync = createCalendarSync({ replica: controller.replica, authority, newId, clock, fetchImpl,
    isReady: () => controller.getState() === 'READY' });
  window.client = { controller, sync, repositories, replica: controller.replica,
    enable: () => sync.enable({ userName: 'Client owner', householdName: 'Client household', householdAddress: '', deviceName: 'Client test device' }),
    async remote(mutation) {
      const auth = await controller.replica.getAuth();
      const response = await nativeFetch('/api/sync/push', {method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer ' + auth.deviceToken},
        body:JSON.stringify({mutations:[mutation]})});
      if (!response.ok) throw Error('Remote fixture write failed');
      return response.json();
    },
    holdPull() {
      window.controls.pullHeld = new Promise(resolve => { window.controls.pullHeldResolve = resolve; });
      window.controls.pullRelease = new Promise(resolve => { window.controls.releasePull = resolve; });
      window.controls.holdPull = true;
    },
    async snapshot() {
      const auth = await controller.replica.getAuth();
      const calendar = await controller.replica.listCalendarEvents();
      const outbox = await controller.replica.listOutboxBySequence();
      const conflicts = await controller.replica.transact(['conflicts'], 'readonly', ({stores}) =>
        new Promise((resolve,reject) => { const request = stores.conflicts.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }));
      return { hasAuth: !!auth, householdId: auth?.householdId ?? null,
        household: await controller.replica.getHouseholdProfile(), calendar, outbox, conflicts,
        state: await controller.replica.getSyncState(), view: await repositories.calendar.load(),
        tokenLeaked: !!auth && JSON.stringify({calendar,outbox}).includes(auth.deviceToken) };
    },
  };
}
if (!localStorage.getItem('client-fixture-seeded')) {
  const event = createEvent({ title: 'Existing owner event', category: 'general', date: '2026-10-05' }, 'existing-owner-event');
  localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify({version:1,events:[event]}));
  localStorage.setItem('client-fixture-seeded', 'yes');
}
await mount();
window.clientReady = true;
`;

async function harness({ ui = false } = {}) {
  assert.ok(browser, 'Chromium is required; client sync must not silently skip');
  const contents = ui ? fixture.replace('await mount();\nwindow.clientReady = true;', `
    window.fetch = fetchImpl;
    await import('./src/main.jsx');
    window.clientReady = true;
  `) : fixture;
  const shimPlugin = { name: 'runtime-observer', setup(b) {
    b.onResolve({filter:/^\.\/App$/}, args => args.importer.split(String.fromCharCode(92)).join('/').endsWith('src/main.jsx')
      ? {path:'runtime-observer',namespace:'runtime-observer'} : undefined);
    b.onLoad({filter:/.*/,namespace:'runtime-observer'}, () => ({resolveDir:root,loader:'jsx',contents:`
      import App, {createStorageRuntime as createRuntime} from './src/App.jsx';
      export function createStorageRuntime(options) {
        window.uiReplica = options.controller.replica;
        window.uiController = options.controller;
        window.uiRuntime = createRuntime(options);
        return window.uiRuntime;
      }
      export default App;
    `}));
  } };
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, format: 'esm',
    outfile:'fixture.js', jsx:'automatic',loader:{'.png':'dataurl'},define:{'import.meta.env':'{}'},
    plugins:ui ? [shimPlugin] : [],
    platform: 'browser', target: 'es2022', stdin: { contents, resolveDir: root } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const miniflare = new Miniflare({ modules: true,
    script: "export default {fetch(){return new Response('ok')}}", d1Databases: ['DB'] });
  const db = await miniflare.getD1Database('DB');
  for (const sql of migrationStatements(readFileSync(resolve(root, 'migrations/0001_majandus_backend.sql'), 'utf8'))) await db.exec(sql);
  const routes = new Map([
    ['/api/auth/create-household', createHousehold.onRequestPost],
    ['/api/sync/bootstrap', bootstrap.onRequestGet],
    ['/api/sync/pull', pull.onRequestGet],
    ['/api/sync/push', push.onRequestPost],
  ]);
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (routes.has(path)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await routes.get(path)({ env: { DB: db }, request: new Request(`http://127.0.0.1${req.url}`, {
          method: req.method, headers: req.headers,
          ...(['GET','HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        }) });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`);
    } catch { res.writeHead(500); res.end('Local test bridge failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-client-sync-'));
  const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore','ignore','pipe'], windowsHide: true });
  const port = new URL(await waitForBrowserEndpoint(child)).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
  const pending = new Map();
  let next = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, {resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  async function ready() {
    for (let index = 0; index < 100; index++) {
      if (await evaluate(ui ? 'Boolean(window.clientReady && document.querySelector("nav"))' : 'Boolean(window.clientReady)')) return;
      await pause(30);
    }
    assert.fail('Client fixture failed to mount');
  }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}`});
  await ready();
  return { db, evaluate,
    async waitFor(expression) {
      for (let index=0; index<200; index++) { if (await evaluate(expression)) return; await pause(25); }
      assert.fail('Timed out waiting for: ' + expression);
    },
    reload: async () => { await evaluate('window.clientReady = false'); await send('Page.reload'); await ready(); },
    async close() {
      await send('Browser.close').catch(() => child.kill());
      for (let index = 0; child.exitCode === null && index < 50; index++) await pause(20);
      if (child.exitCode === null) child.kill();
      socket.close();
      await new Promise(resolve => server.close(resolve));
      await miniflare.dispose();
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
      rmSync(profile, {recursive:true,force:true,maxRetries:20,retryDelay:100});
    },
  };
}

test('enable preserves the OWNER calendar and durably queues initial CREATE when push is offline', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const result = await h.evaluate(`(async () => {
      window.controls.offlinePush = true;
      await window.client.enable();
      return window.client.snapshot();
    })()`);
    assert.equal(result.hasAuth, true);
    assert.equal(result.household.payload.serverHouseholdId, result.householdId);
    assert.deepEqual(result.view.events.map(event => event.id), ['existing-owner-event']);
    assert.equal(result.calendar[0].syncStatus, 'pending');
    assert.equal(result.outbox.length, 1);
    assert.equal(result.outbox[0].operation, 'CREATE');
    assert.equal(result.outbox[0].baseRevision, 0);
    assert.equal(result.outbox[0].patch.id, 'existing-owner-event');
    assert.equal(result.tokenLeaked, false);
    assert.equal(result.state.bootstrapCompleted, false);
    await h.reload();
    const persisted = await h.evaluate('window.client.snapshot()');
    assert.equal(persisted.hasAuth, true);
    assert.deepEqual(persisted.outbox, result.outbox);
    assert.deepEqual(persisted.view.events, result.view.events);
  } finally { await h.close(); }
});

test('successful initial push acknowledges server revision, removes outbox, and bootstraps without losing the event', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const result = await h.evaluate(`(async () => { await window.client.enable(); return window.client.snapshot(); })()`);
    assert.equal(result.hasAuth, true);
    assert.equal(result.calendar.length, 1);
    assert.equal(result.calendar[0].revision, 1);
    assert.equal(result.calendar[0].syncStatus, 'synced');
    assert.equal(result.calendar[0].payload.title, 'Existing owner event');
    assert.deepEqual(result.outbox, []);
    assert.equal(result.state.serverCursor, 1);
    assert.equal(result.state.bootstrapCompleted, true);
    assert.equal(result.tokenLeaked, false);
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'synced');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM calendar_events').first()).n, 1);
    const calls = await h.evaluate('window.controls.calls');
    assert.ok(calls.indexOf('/api/sync/push') < calls.indexOf('/api/sync/bootstrap'), 'the OWNER baseline must upload before bootstrap');
  } finally { await h.close(); }
});

test('offline CREATE UPDATE DELETE remain visible or tombstoned with durable ordered outbox across reload and later push', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const before = await h.evaluate(`(async () => {
      await window.client.enable();
      window.controls.offline = true;
      await window.client.repositories.calendar.create({title:'Offline new event',category:'general',date:'2026-10-06'});
      await window.client.repositories.calendar.update('existing-owner-event', {title:'Offline owner update'});
      await window.client.repositories.calendar.remove('existing-owner-event');
      return window.client.snapshot();
    })()`);
    assert.deepEqual(before.outbox.map(item => [item.operation,item.baseRevision]), [['CREATE',0],['UPDATE',1],['DELETE',2]]);
    assert.deepEqual(before.view.events.map(event => event.title), ['Offline new event']);
    assert.equal(before.calendar.find(event => event.id === 'existing-owner-event').syncStatus, 'pending');
    assert.notEqual(before.calendar.find(event => event.id === 'existing-owner-event').deletedAt, null);
    assert.equal(before.tokenLeaked, false);
    await h.reload();
    const persisted = await h.evaluate('window.client.snapshot()');
    assert.deepEqual(persisted.outbox, before.outbox);
    assert.deepEqual(persisted.view.events, before.view.events);
    const after = await h.evaluate(`(async () => { await window.client.sync.run(); return window.client.snapshot(); })()`);
    assert.deepEqual(after.outbox, []);
    assert.deepEqual(after.view.events.map(event => event.title), ['Offline new event']);
    assert.equal(after.calendar.find(event => event.id === 'existing-owner-event').revision, 3);
    assert.equal(after.calendar.find(event => event.id === 'existing-owner-event').syncStatus, 'synced');
    assert.equal(after.state.serverCursor, 4);
    assert.deepEqual(await h.evaluate('window.controls.pushes.flatMap(body => body.mutations.map(item => item.mutationId))'), before.outbox.map(item => item.mutationId));
    const server = await h.db.prepare('SELECT revision, deleted_at FROM calendar_events WHERE id = ?').bind('existing-owner-event').first();
    assert.equal(server.revision, 3);
    assert.notEqual(server.deleted_at, null);
  } finally { await h.close(); }
});

test('pull applies remote CREATE UPDATE and DELETE while ordinary calendar UI hides the tombstone', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const created = await h.evaluate(`(async () => {
      await window.client.enable();
      const patch = {...(await window.client.snapshot()).calendar[0].payload,id:'remote-event',title:'Remote created'};
      await window.client.remote({mutationId:'remote-create',entityType:'calendar_event',entityId:'remote-event',operation:'CREATE',baseRevision:0,patch});
      await window.client.sync.run();
      return window.client.snapshot();
    })()`);
    assert.equal(created.calendar.find(event => event.id === 'remote-event').revision, 1);
    assert.ok(created.view.events.some(event => event.title === 'Remote created'));
    const updated = await h.evaluate(`(async () => {
      await window.client.remote({mutationId:'remote-update',entityType:'calendar_event',entityId:'remote-event',operation:'UPDATE',baseRevision:1,patch:{title:'Remote updated'}});
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(updated.calendar.find(event => event.id === 'remote-event').revision, 2);
    assert.ok(updated.view.events.some(event => event.title === 'Remote updated'));
    const deleted = await h.evaluate(`(async () => {
      await window.client.remote({mutationId:'remote-delete',entityType:'calendar_event',entityId:'remote-event',operation:'DELETE',baseRevision:2,patch:{}});
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(deleted.calendar.find(event => event.id === 'remote-event').revision, 3);
    assert.notEqual(deleted.calendar.find(event => event.id === 'remote-event').deletedAt, null);
    assert.ok(deleted.view.events.every(event => event.id !== 'remote-event'));
    assert.equal(deleted.state.serverCursor, 4);
  } finally { await h.close(); }
});

test('a local edit during a held pull is retained as conflict with durable remote evidence', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const result = await h.evaluate(`(async () => {
      await window.client.enable();
      await window.client.remote({mutationId:'remote-racing-update',entityType:'calendar_event',entityId:'existing-owner-event',operation:'UPDATE',baseRevision:1,patch:{title:'Remote changed'}});
      window.client.holdPull();
      const syncing = window.client.sync.run();
      await window.controls.pullHeld;
      await window.client.repositories.calendar.update('existing-owner-event', {title:'Local pending title'});
      window.controls.releasePull();
      await syncing;
      return window.client.snapshot();
    })()`);
    assert.equal(result.calendar[0].payload.title, 'Local pending title');
    assert.equal(result.calendar[0].revision, 1);
    assert.equal(result.calendar[0].syncStatus, 'conflict');
    assert.equal(result.outbox.length, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].remoteRecord.revision, 2);
    assert.equal(result.conflicts[0].remoteRecord.payload.title, 'Remote changed');
    assert.equal(result.state.serverCursor, 2);
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'attention');
    await h.reload();
    const persisted = await h.evaluate('window.client.snapshot()');
    assert.deepEqual(persisted.conflicts, result.conflicts);
    assert.deepEqual(persisted.outbox, result.outbox);
    assert.equal(persisted.calendar[0].payload.title, 'Local pending title');
    await h.evaluate('window.client.sync.run()');
    assert.deepEqual(await h.evaluate('window.controls.pushes'), [], 'conflicted work must not be repeatedly sent');
  } finally { await h.close(); }
});

test('the pull cursor and calendar apply roll back together if the native transaction aborts', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const failed = await h.evaluate(`(async () => {
      await window.client.enable();
      const patch = {...(await window.client.snapshot()).calendar[0].payload,id:'atomic-remote',title:'Durable remote'};
      await window.client.remote({mutationId:'atomic-remote-create',entityType:'calendar_event',entityId:'atomic-remote',operation:'CREATE',baseRevision:0,patch});
      window.controls.abortPullApply = true;
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(failed.state.serverCursor, 1);
    assert.ok(failed.calendar.every(event => event.id !== 'atomic-remote'));
    assert.equal(await h.evaluate('window.controls.pullApplyAbortCount'), 1);
    assert.ok(await h.evaluate("window.controls.calls.includes('/api/sync/pull?after=1')"));
    const retried = await h.evaluate(`(async () => { await window.client.sync.run(); return window.client.snapshot(); })()`);
    assert.equal(retried.state.serverCursor, 2);
    assert.equal(retried.calendar.find(event => event.id === 'atomic-remote').payload.title, 'Durable remote');
  } finally { await h.close(); }
});

test('RESYNC_REQUIRED recovers with bootstrap and a durable replacement cursor', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const result = await h.evaluate(`(async () => {
      await window.client.enable();
      const state = await window.client.replica.getSyncState();
      await window.client.replica.transact(['syncState'], 'readwrite', ({stores}) => { stores.syncState.put({...state,serverCursor:999}); });
      window.controls.calls = [];
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(result.state.serverCursor, 1);
    assert.equal(result.state.bootstrapCompleted, true);
    assert.equal(result.calendar[0].payload.title, 'Existing owner event');
    assert.deepEqual(await h.evaluate('window.controls.calls'), ['/api/sync/pull?after=999','/api/sync/bootstrap']);
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'synced');
  } finally { await h.close(); }
});

test('500 and a lost push reply retain data, then reload retries the same mutationId using REPLAYED', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const failed = await h.evaluate(`(async () => {
      await window.client.enable();
      await window.client.repositories.calendar.update('existing-owner-event', {title:'Keep this offline edit'});
      window.controls.push500 = true;
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(failed.calendar[0].payload.title, 'Keep this offline edit');
    assert.equal(failed.outbox.length, 1);
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'waiting');
    const lost = await h.evaluate(`(async () => {
      window.controls.push500 = false;
      window.controls.losePushReply = true;
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(lost.outbox[0].mutationId, failed.outbox[0].mutationId);
    assert.equal(lost.calendar[0].revision, 1);
    assert.equal((await h.db.prepare('SELECT revision FROM calendar_events WHERE id = ?').bind('existing-owner-event').first()).revision, 2);
    await h.reload();
    const retried = await h.evaluate(`(async () => { await window.client.sync.run(); return window.client.snapshot(); })()`);
    assert.deepEqual(retried.outbox, []);
    assert.equal(retried.calendar[0].revision, 2);
    assert.equal(retried.calendar[0].payload.title, 'Keep this offline edit');
    assert.equal(retried.tokenLeaked, false);
    assert.equal((await h.db.prepare('SELECT revision FROM calendar_events WHERE id = ?').bind('existing-owner-event').first()).revision, 2);
    assert.equal(await h.evaluate('window.controls.pushes[0].mutations[0].mutationId'), failed.outbox[0].mutationId);
  } finally { await h.close(); }
});

test('an ambiguous household creation is never automatically repeated, including after reload', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const failed = await h.evaluate(`(async () => {
      window.controls.loseCreateReply = true;
      await window.client.enable(); return window.client.snapshot();
    })()`);
    assert.equal(failed.hasAuth, false);
    assert.equal(failed.state.setupStatus, 'unknown');
    assert.equal(failed.calendar[0].payload.title, 'Existing owner event');
    assert.deepEqual(failed.outbox, []);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM households').first()).n, 1);
    await h.reload();
    await h.evaluate(`(async () => { await window.client.sync.run(); await window.client.enable(); })()`);
    assert.equal(await h.evaluate("window.controls.calls.filter(path => path === '/api/auth/create-household').length"), 0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM households').first()).n, 1);
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'attention');
  } finally { await h.close(); }
});

test('MERGED uses the actual server revision, while CONFLICT and REJECTED retain local work and evidence', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const merged = await h.evaluate(`(async () => {
      await window.client.enable();
      await window.client.remote({mutationId:'remote-disjoint',entityType:'calendar_event',entityId:'existing-owner-event',operation:'UPDATE',baseRevision:1,patch:{title:'Remote title'}});
      await window.client.repositories.calendar.update('existing-owner-event', {notes:'Local notes'});
      await window.client.repositories.calendar.update('existing-owner-event', {time:'12:30'});
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(merged.calendar[0].revision, 4);
    assert.equal(merged.calendar[0].payload.title, 'Remote title');
    assert.equal(merged.calendar[0].payload.notes, 'Local notes');
    assert.equal(merged.calendar[0].payload.time, '12:30');
    assert.deepEqual(merged.outbox, []);
    const bases = await h.evaluate('window.controls.pushes.slice(1).map(body => body.mutations[0].baseRevision)');
    assert.deepEqual(bases, [1,3], 'the dependent edit must use the actual MERGED revision before its first attempt');
    const conflicts = await h.evaluate(`(async () => {
      await window.client.remote({mutationId:'remote-overlap',entityType:'calendar_event',entityId:'existing-owner-event',operation:'UPDATE',baseRevision:4,patch:{title:'Changed remotely again'}});
      await window.client.repositories.calendar.update('existing-owner-event', {title:'Keep my conflicting title'});
      await window.client.sync.run();
      await window.client.repositories.calendar.create({title:'Keep my rejected event',category:'general',date:'2026-10-08'});
      window.controls.rejectNextPush = true;
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    assert.equal(conflicts.outbox.length, 2);
    assert.equal(conflicts.conflicts.length, 2);
    const owner = conflicts.calendar.find(event => event.id === 'existing-owner-event');
    assert.equal(owner.payload.title, 'Keep my conflicting title');
    assert.equal(owner.syncStatus, 'conflict');
    assert.equal(conflicts.conflicts.find(item => item.entityId === owner.id).result.status, 'CONFLICT');
    const rejected = conflicts.calendar.find(event => event.id !== owner.id);
    assert.equal(rejected.payload.title, 'Keep my rejected event');
    assert.equal(rejected.syncStatus, 'conflict');
    assert.equal(conflicts.conflicts.find(item => item.entityId === rejected.id).result.status, 'REJECTED');
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'attention');
  } finally { await h.close(); }
});

test('the real Settings flow enables calendar sync, keeps credentials private, and runtime retries offline edits on online and startup', {timeout:60000}, async () => {
  const h = await harness({ui:true});
  try {
    await h.evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === 'Seaded').click()");
    await h.waitFor("document.querySelector('h1')?.textContent === 'Seaded'");
    assert.equal(await h.evaluate("!![...document.querySelectorAll('h2')].find(node => node.textContent === 'Pilvesünk')"), true);
    await h.evaluate(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for (const [id,value] of [['calendar-sync-user','UI owner'],['calendar-sync-household','UI household'],['calendar-sync-device','UI device']]) {
        const input = document.getElementById(id); set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    })()`);
    await h.evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Lülita sünk sisse').click()");
    await h.waitFor("window.uiRuntime.getSnapshot().session.sync.getSnapshot().status === 'synced'");
    const enabled = await h.evaluate(`(async () => {
      const auth = await window.uiReplica.getAuth();
      return {tokenInUI:document.body.textContent.includes(auth.deviceToken),
        visibleState:document.body.textContent.includes('Sünkroonitud'),
        calendar:await window.uiReplica.listCalendarEvents(),outbox:await window.uiReplica.listOutboxBySequence(),
        codeShown:!!window.uiRuntime.getSnapshot().session.sync.getSnapshot().recoveryCode};
    })()`);
    assert.equal(enabled.tokenInUI, false);
    assert.equal(enabled.visibleState, true);
    assert.equal(enabled.codeShown, true);
    assert.equal(enabled.calendar[0].payload.title, 'Existing owner event');
    assert.equal(enabled.calendar[0].revision, 1);
    assert.deepEqual(enabled.outbox, []);
    await h.evaluate(`(async () => {
      window.controls.offline = true;
      const store = window.uiRuntime.getSnapshot().session.stores.calendar;
      await store.mutate(repository => repository.update('existing-owner-event',{title:'UI offline save'}),'Failed');
    })()`);
    await h.waitFor("window.uiRuntime.getSnapshot().session.sync.getSnapshot().status === 'waiting'");
    assert.equal(await h.evaluate('(async () => (await window.uiReplica.listOutboxBySequence()).length)()'), 1);
    await h.evaluate("window.controls.offline=false; window.dispatchEvent(new Event('online'))");
    await h.waitFor("window.uiRuntime.getSnapshot().session.sync.getSnapshot().status === 'synced'");
    assert.equal((await h.db.prepare('SELECT revision FROM calendar_events WHERE id = ?').bind('existing-owner-event').first()).revision, 2);
    await h.reload();
    await h.waitFor("window.uiRuntime.getSnapshot().session.sync.getSnapshot().status === 'synced'");
    assert.equal(await h.evaluate('(async () => (await window.uiReplica.listCalendarEvents())[0].payload.title)()'), 'UI offline save');
    assert.equal(await h.evaluate('window.uiRuntime.getSnapshot().session.sync.getSnapshot().recoveryCode'), null);
    assert.ok(await h.evaluate("window.controls.calls.some(path => path.startsWith('/api/sync/pull'))"), 'authenticated startup triggers sync');
  } finally { await h.close(); }
});
