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
import { mergeCalendarCategories } from '../../src/calendar/categoryModel.js';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';
import * as createHousehold from '../../functions/api/auth/create-household.js';
import * as deviceLink from '../../functions/api/auth/device-link.js';
import * as claimDevice from '../../functions/api/auth/claim-device.js';
import * as bootstrap from '../../functions/api/sync/bootstrap.js';
import * as pull from '../../functions/api/sync/pull.js';
import * as push from '../../functions/api/sync/push.js';
import * as mutationStatus from '../../functions/api/sync/mutation-status.js';

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
import { createShoppingStore } from './src/shopping/shoppingStore.js';
import { MERGE_EVIDENCE_HEADERS } from './src/sync/clientCapabilities.js';
import { createEvent } from './src/calendar/eventModel.js';
import { EVENT_STORAGE_KEY } from './src/calendar/eventRepository.js';
const clock = () => '2026-09-30T08:00:00.000Z';
const newId = () => crypto.randomUUID();
const nativeFetch = window.fetch.bind(window);
let controller;
let sync;
let repositories;
window.controls = { offlinePush: false, offline: false, push500: false, loseCreateReply: false, losePushReply: false,
  calls: [], pushes: [], pushBodies: [], pushResponses: [] };
const fetchImpl = async (url, options = {}) => {
  const path = String(url);
  const controls = window.controls;
  controls.calls.push(path);
  if (path === '/api/sync/push') {
    controls.pushes.push(JSON.parse(options.body));
    controls.pushBodies.push(options.body);
  }
  if (controls.offline || (controls.offlinePush && path === '/api/sync/push')) throw new TypeError('Offline fixture');
  if (controls.unavailableMutationStatus && path.startsWith('/api/sync/mutation-status?')) return new Response(null, {status:503});
  if (controls.push500 && path === '/api/sync/push') return new Response(JSON.stringify({error:{code:'INTERNAL_ERROR'}}), { status: 500 });
  if (controls.rejectNextPush && path === '/api/sync/push') {
    controls.rejectNextPush = false;
    return new Response(JSON.stringify({results:JSON.parse(options.body).mutations.map(item =>
      ({mutationId:item.mutationId,status:'REJECTED',code:'INVALID_MUTATION'}))}), {status:200});
  }
  if (controls.contendedPushMutationId && path === '/api/sync/push') {
    const { mutations: [mutation] } = JSON.parse(options.body);
    if (mutation.mutationId === controls.contendedPushMutationId) {
      controls.contendedPushMutationId = null;
      return Response.json({results:[{mutationId:mutation.mutationId,status:'CONFLICT',code:'ENTITY_UNAVAILABLE'}]});
    }
  }
  if (controls.mockUnknownMutationStatus && path.startsWith('/api/sync/mutation-status?')) {
    return Response.json({outcome:'UNKNOWN'});
  }
  const response = await nativeFetch(url, options);
  if (path === '/api/sync/push') {
    const { mutations: [mutation] } = JSON.parse(options.body);
    controls.pushResponses.push({ id: mutation.mutationId, entityId: mutation.entityId,
      bytes: new TextEncoder().encode(options.body).byteLength, status: response.status });
  }
  if (controls.loseCreateReply && path === '/api/auth/create-household') throw new TypeError('Lost create reply');
  if (controls.loseClaimReply && path === '/api/auth/claim-device') throw new TypeError('Lost claim reply');
  if (controls.holdClaimReply && path === '/api/auth/claim-device') {
    controls.claimReplyHeld = true;
    await new Promise(() => {});
  }
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
    initialDeviceLink: new URL(location.href).searchParams.get('deviceLink'),
    isReady: () => controller.getState() === 'READY' });
  const shopping = createShoppingStore({ replica: controller.replica, authority, newId, clock });
  window.client = { controller, sync, repositories, shopping, replica: controller.replica,
    enable: () => sync.enable({ userName: 'Client owner', householdName: 'Client household', householdAddress: '', deviceName: 'Client test device' }),
    async remote(mutation) {
      const auth = await controller.replica.getAuth();
      const response = await nativeFetch('/api/sync/push', {method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer ' + auth.deviceToken,...MERGE_EVIDENCE_HEADERS},
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
  const unrelated = new URL(location.href).searchParams.has('unrelatedLocal');
  const event = createEvent({ title: unrelated ? 'Unrelated Device B event' : 'Existing owner event', category: 'general', date: '2026-10-05' },
    unrelated ? 'unrelated-device-b-event' : 'existing-owner-event');
  localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify({version:1,events:[event]}));
  localStorage.setItem('client-fixture-seeded', 'yes');
}
await mount();
window.clientReady = true;
`;

async function harness({ ui = false, sharedBackend = null, query = '', fixturePushLimit = Infinity } = {}) {
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
  const miniflare = sharedBackend ? null : new Miniflare({ modules: true,
    script: "export default {fetch(){return new Response('ok')}}", d1Databases: ['DB'] });
  const db = sharedBackend?.db ?? await miniflare.getD1Database('DB');
  if (!sharedBackend) for (const sql of migrationStatements(readFileSync(resolve(root, 'migrations/0001_majandus_backend.sql'), 'utf8'))) await db.exec(sql);
  const routes = new Map([
    ['/api/auth/create-household', createHousehold.onRequestPost],
    ['/api/auth/device-link', deviceLink.onRequestPost],
    ['/api/auth/claim-device', claimDevice.onRequestPost],
    ['/api/sync/bootstrap', bootstrap.onRequestGet],
    ['/api/sync/pull', pull.onRequestGet],
    ['/api/sync/push', push.onRequestPost],
    ['/api/sync/mutation-status', mutationStatus.onRequestGet],
  ]);
  let pushLimit = fixturePushLimit;
  let canonicalLimitResponse = false;
  let heldPush;
  const server = sharedBackend?.server ?? createServer(async (req, res) => {
    try {
      if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (routes.has(path)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (path === '/api/sync/push' && body.length > pushLimit) {
          res.writeHead(413, { 'Content-Type': canonicalLimitResponse ? 'application/json' : 'text/plain' });
          res.end(canonicalLimitResponse
            ? JSON.stringify({error:{code:'PAYLOAD_TOO_LARGE',message:'Request body too large.'}})
            : 'Fixture server has a lower cap.');
          return;
        }
        if (path === '/api/sync/push' && heldPush && body.includes(heldPush.mutationId)) {
          const hold = heldPush;
          heldPush = undefined;
          hold.notify();
          await hold.released;
        }
        const response = await routes.get(path)({ env: { DB: db }, request: new Request(`http://127.0.0.1${req.url}`, {
          method: req.method, headers: req.headers,
          ...(['GET','HEAD'].includes(req.method) ? {} : { body }),
        }) });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`);
    } catch { res.writeHead(500); res.end('Local test bridge failed'); }
  });
  if (!sharedBackend) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-client-sync-'));
  const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore','ignore','pipe'], windowsHide: true });
  const port = new URL(await waitForBrowserEndpoint(child)).port;
  const url = `http://127.0.0.1:${server.address().port}/${query}`;
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  async function connect(target) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
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
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', {url});
    await ready();
    return {socket, send, evaluate, ready};
  }
  const {socket, send, evaluate, ready} = await connect((await targets()).find(target => target.type === 'page'));
  return { db, server, evaluate, send,
    setPushLimit(bytes, { canonical = false } = {}) {
      pushLimit = bytes;
      canonicalLimitResponse = canonical;
    },
    holdNextPush(mutationId) {
      const { promise: reached, resolve: notify } = Promise.withResolvers();
      const { promise: released, resolve: release } = Promise.withResolvers();
      heldPush = { mutationId, notify, released };
      return { reached, release };
    },
    async newTab() {
      const {targetId} = await send('Target.createTarget', {url:'about:blank'});
      const tab = await connect((await targets()).find(target => target.id === targetId));
      return { evaluate: tab.evaluate, async close() {
        await send('Target.closeTarget', {targetId});
        tab.socket.close();
      } };
    },
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
      if (!sharedBackend) {
        await new Promise(resolve => server.close(resolve));
        await miniflare.dispose();
      }
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

test('oversized Calendar occurrence history cannot block independent pushes or the remote cursor', { timeout: 90000 }, async t => {
  const h = await harness();
  try {
    assert.equal(await h.evaluate('window.client.enable()'), true);
    const fixture = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      const start = '2026-10-05';
      const created = await calendar.create({title:'Large weekly series', category:'general', date:start,
        recurrence:{frequency:'weekly', interval:1}});
      const series = created.events.find(event => event.title === 'Large weekly series');
      await window.client.sync.run();
      const startAt = Date.parse(start);
      const dates = Array.from({length:52}, (_, index) =>
        new Date(startAt + index * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0,10));
      for (const [index, occurrenceDate] of dates.entries()) {
        const notes = String(index).padStart(2,'0') + 'õ'.repeat(20) + 'm'.repeat(1614);
        await calendar.update(series.id, {notes}, {scope:'occurrence',occurrenceDate});
      }
      const added = await calendar.create({title:'Later valid event',category:'general',date:'2026-10-07'});
      const valid = added.events.find(event => event.title === 'Later valid event');
      const shopping = await window.client.shopping.add({name:'Preserved Shopping item',quantity:'2'});
      const before = await window.client.snapshot();
      const remote = { id:'oversize-remote-event', title:'Already committed elsewhere', category:'general',
        date:'2026-10-08', source:'manual' };
      const result = await window.client.remote({mutationId:'oversize-remote-create',entityType:'calendar_event',
        entityId:remote.id,operation:'CREATE',baseRevision:0,patch:remote});
      return { seriesId:series.id, laterId:valid.id, remoteId:remote.id, remoteResult:result.results[0].status, dates,
        shoppingId:shopping.id, shoppingOutbox:before.outbox.filter(item => item.entityType === 'shopping_item'),
        initialCursor:before.state.serverCursor };
    })()`);
    assert.equal(fixture.remoteResult, 'APPLIED');
    const run = () => h.evaluate(`(async () => {
      window.controls.calls.length = 0;
      window.controls.pushResponses.length = 0;
      await window.client.sync.run();
      const snapshot = await window.client.snapshot();
      return { snapshot, status:window.client.sync.getSnapshot(), calls:window.controls.calls, pushes:window.controls.pushResponses };
    })()`);
    const first = await run();
    const retry = await run();
    const database = await h.db.prepare('SELECT id, revision FROM calendar_events ORDER BY id').all();
    const rejected = first.pushes.find(item => item.status === 413);
    const retryRejected = retry.pushes.find(item => item.status === 413);
    t.diagnostic(JSON.stringify({
      firstPushCount: first.pushes.length, firstRejectedOrdinal: rejected ? first.pushes.indexOf(rejected) + 1 : null,
      firstRejectedBytes: rejected?.bytes ?? null, firstRejectedStatus: rejected?.status ?? null,
      retryPushCount: retry.pushes.length, retryRejectedBytes: retryRejected?.bytes ?? null,
      sameRejectedMutationRetried: !!rejected && retryRejected?.id === rejected.id,
      localOverrides: Object.keys(retry.snapshot.calendar.find(event => event.id === fixture.seriesId).payload.overrides).length,
      laterEventOnServer: database.results.some(row => row.id === fixture.laterId),
      committedRemoteOnClient: retry.snapshot.calendar.some(event => event.id === fixture.remoteId),
      cursorBefore: fixture.initialCursor, cursorAfter: retry.snapshot.state.serverCursor,
      pullCalled: [...first.calls, ...retry.calls].some(path => path.startsWith('/api/sync/pull?')),
    }));
    const series = retry.snapshot.calendar.find(event => event.id === fixture.seriesId);
    assert.equal(Object.keys(series.payload.overrides).length, 52, 'oversized notes stay on the device');
    assert.ok(database.results.some(row => row.id === fixture.laterId), 'unrelated valid event reaches D1 despite the oversized series');
    assert.ok(retry.snapshot.calendar.some(event => event.id === fixture.remoteId), 'unrelated changes committed remotely reach the device');
    assert.ok(retry.snapshot.state.serverCursor > fixture.initialCursor, 'a successful unrelated pull advances the cursor');
    assert.equal(rejected, undefined, 'a known oversized request is not sent to the network');
    assert.ok(!retry.pushes.some(item => item.entityId === fixture.seriesId), 'a failed oversized series is not retransmitted');
    assert.equal(retry.status.status, 'attention', 'oversized local work is surfaced despite syncing everything else');
    assert.deepEqual(retry.status.oversizedEventIds, [fixture.seriesId]);
    assert.equal(retry.snapshot.conflicts.find(item => item.entityId === fixture.seriesId).result.requestBytes, 65_810);
    assert.equal(fixture.shoppingOutbox.length, 1);
    assert.deepEqual(retry.snapshot.outbox.filter(item => item.entityType === 'shopping_item'), fixture.shoppingOutbox);

    await h.reload();
    const afterReload = await run();
    assert.equal(afterReload.status.status, 'attention');
    assert.deepEqual(afterReload.status.oversizedEventIds, [fixture.seriesId]);
    assert.equal(afterReload.pushes.some(item => item.entityId === fixture.seriesId), false);
    assert.deepEqual(afterReload.snapshot.calendar.find(event => event.id === fixture.seriesId).payload, series.payload);
    assert.deepEqual(afterReload.snapshot.outbox.filter(item => item.entityType === 'shopping_item'), fixture.shoppingOutbox);

    const reduction = fixture.dates.slice(37).map(date => [date, 'Short note for ' + date]);
    await h.evaluate(`(async () => {
      for (const [occurrenceDate, notes] of ${JSON.stringify(reduction)}) {
        await window.client.repositories.calendar.update(${JSON.stringify(fixture.seriesId)}, {notes}, {scope:'occurrence',occurrenceDate});
      }
    })()`);
    const resumed = await run();
    assert.equal(resumed.status.status, 'synced', 'reducing notes allows ordinary synchronization to resume');
    assert.deepEqual(resumed.status.oversizedEventIds, []);
    const resumedPushes = resumed.pushes.filter(item => item.entityId === fixture.seriesId);
    assert.ok(resumedPushes.length > 0);
    assert.ok(resumedPushes.every(item => item.status === 200 && item.bytes <= 65536));
    assert.equal(resumed.snapshot.outbox.some(item => item.entityId === fixture.seriesId), false);
    assert.deepEqual(resumed.snapshot.outbox.filter(item => item.entityType === 'shopping_item'), fixture.shoppingOutbox);
    const saved = await h.db.prepare('SELECT revision, payload_json AS json FROM calendar_events WHERE id = ?').bind(fixture.seriesId).first();
    const payload = JSON.parse(saved.json);
    assert.deepEqual(payload, resumed.snapshot.calendar.find(event => event.id === fixture.seriesId).payload);
    assert.equal(Object.keys(payload.overrides).length, 52);
    for (const [date, notes] of reduction) assert.equal(payload.overrides[date].notes, notes);
    for (const date of fixture.dates.slice(0, 37)) {
      assert.equal(payload.overrides[date].notes, series.payload.overrides[date].notes);
    }
    assert.equal(await h.evaluate(`(async () => (await window.client.replica.getShoppingItem(${JSON.stringify(fixture.shoppingId)})).payload.name)()`),
      'Preserved Shopping item');
  } finally {
    await h.close();
  }
});

test('explicit deletion cancels an oversized Calendar CREATE that never reached D1', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    const blocked = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      const date = '2026-10-05';
      const created = await calendar.create({ title:'Never uploaded', category:'general', date,
        recurrence:{frequency:'weekly',interval:1} });
      const id = created.events.find(event => event.title === 'Never uploaded').id;
      for (let index = 0; index < 8; index++) {
        const occurrenceDate = new Date(Date.parse(date) + index * 7 * 86400000).toISOString().slice(0,10);
        await calendar.update(id, {notes:'õ'.repeat(4500)}, {scope:'occurrence',occurrenceDate});
      }
      const enabled = await window.client.enable();
      return {id, enabled, snapshot:await window.client.snapshot(), warning:window.client.sync.getSnapshot().oversizedEventIds,
        pushes:window.controls.pushResponses};
    })()`);
    assert.equal(blocked.enabled, true);
    const original = blocked.snapshot.outbox.find(item => item.entityId === blocked.id);
    assert.equal(original.operation, 'CREATE');
    assert.equal(original.attemptCount, 0);
    assert.deepEqual(blocked.warning, [blocked.id]);
    assert.ok(blocked.snapshot.conflicts.find(item => item.entityId === blocked.id).result.requestBytes > 65536);
    assert.equal(blocked.pushes.some(item => item.entityId === blocked.id), false);

    const after = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      await calendar.remove(${JSON.stringify(blocked.id)}, {scope:'series'});
      const added = await calendar.create({title:'Independent local event',category:'general',date:'2026-10-07'});
      const independent = added.events.find(event => event.title === 'Independent local event').id;
      const remoteId = 'never-uploaded-deletion-remote';
      await window.client.remote({mutationId:'never-uploaded-deletion-remote-create',entityType:'calendar_event',entityId:remoteId,
        operation:'CREATE',baseRevision:0,patch:{id:remoteId,title:'Independent remote event',category:'general',date:'2026-10-08',source:'manual'}});
      window.controls.pushResponses.length = 0;
      await window.client.sync.run();
      return {independent, remoteId, snapshot:await window.client.snapshot(), status:window.client.sync.getSnapshot(),
        pushes:window.controls.pushResponses};
    })()`);
    assert.ok(after.pushes.some(item => item.entityId === after.independent && item.status === 200), 'cancelling the local CREATE must not block other pushes');
    assert.ok(after.snapshot.calendar.some(item => item.id === after.remoteId), 'cancelling the local CREATE must not block remote pulls');
    assert.ok(after.snapshot.state.serverCursor > blocked.snapshot.state.serverCursor);
    assert.equal(after.snapshot.calendar.some(item => item.id === blocked.id), false);
    assert.equal(after.snapshot.outbox.some(item => item.entityId === blocked.id), false);
    assert.equal(after.snapshot.conflicts.some(item => item.entityId === blocked.id), false);
    assert.equal(after.pushes.some(item => item.entityId === blocked.id), false);
    assert.deepEqual(after.status.oversizedEventIds, []);
    assert.equal(after.status.status, 'synced');
    const server = await h.db.prepare('SELECT id FROM calendar_events WHERE id IN (?, ?) ORDER BY id')
      .bind(blocked.id, after.independent).all();
    assert.deepEqual(server.results, [{ id: after.independent }]);
    const eventsLog = await h.db.prepare('SELECT seq FROM change_log WHERE entity_id = ?').bind(blocked.id).all();
    assert.deepEqual(eventsLog.results, []);
    await h.reload();
    const reloaded = await h.evaluate('window.client.snapshot()');
    assert.equal(reloaded.calendar.some(item => item.id === blocked.id), false);
  } finally {
    await h.close();
  }
});

test('Calendar recovers an oversized queue with an explicit schedule reset followed by a smaller exception', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    assert.equal(await h.evaluate('window.client.enable()'), true);
    const observed = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      const date = '2026-10-05';
      const created = await calendar.create({title:'Weekday changes offline',category:'general',date,
        recurrence:{frequency:'weekly',interval:1}});
      const id = created.events.find(event => event.title === 'Weekday changes offline').id;
      await window.client.sync.run();
      window.controls.offline = true;
      for (let index = 0; index < 8; index++) {
        const occurrenceDate = new Date(Date.parse(date) + index * 7 * 86400000).toISOString().slice(0,10);
        await calendar.update(id, {notes:'õ'.repeat(4500)}, {scope:'occurrence',occurrenceDate});
      }
      await calendar.update(id, {date:'2026-10-06'}, {scope:'series'});
      await calendar.update(id, {notes:'New Tuesday note'}, {scope:'occurrence',occurrenceDate:'2026-10-13'});
      window.controls.offline = false;
      window.controls.pushResponses.length = 0;
      window.controls.pushes.length = 0;
      await window.client.sync.run();
      return {id,snapshot:await window.client.snapshot(),status:window.client.sync.getSnapshot(),
        pushes:window.controls.pushResponses,bodies:window.controls.pushes.flatMap(body => body.mutations)};
    })()`);
    assert.equal(observed.status.status, 'synced');
    assert.deepEqual(observed.status.oversizedEventIds, []);
    assert.equal(observed.snapshot.outbox.some(item => item.entityId === observed.id), false);
    assert.ok(observed.pushes.every(item => item.status === 200 && item.bytes <= 65536));
    const [reset, exception] = observed.bodies.slice(-2);
    assert.equal(reset.entityId, observed.id);
    assert.equal(reset.patch.date, '2026-10-06');
    assert.deepEqual(reset.patch.overrides ?? {}, {});
    assert.equal(exception.entityId, observed.id);
    assert.deepEqual(exception.patch.overrides, { '2026-10-13': {notes:'New Tuesday note'} });
    assert.equal(exception.baseRevision, reset.baseRevision + 1);
    const row = await h.db.prepare('SELECT payload_json FROM calendar_events WHERE id=?').bind(observed.id).first();
    const payload = JSON.parse(row.payload_json);
    assert.equal(payload.date, '2026-10-06');
    assert.deepEqual(payload.overrides, { '2026-10-13': {notes:'New Tuesday note'} });
    assert.deepEqual(observed.snapshot.calendar.find(item => item.id === observed.id).payload, payload);
  } finally {
    await h.close();
  }
});

test('Calendar handles an HTTP 413 durably and treats a preceding 5xx as retryable', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    assert.equal(await h.evaluate('window.client.enable()'), true);
    const retry = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      await calendar.update('existing-owner-event', {notes:'Retry this unchanged request'});
      const before = await window.client.snapshot();
      window.controls.push500 = true;
      await window.client.sync.run();
      const after = await window.client.snapshot();
      const status = window.client.sync.getSnapshot();
      window.controls.push500 = false;
      await window.client.sync.run();
      return { status, before, after, settled:await window.client.snapshot() };
    })()`);
    assert.equal(retry.status.status, 'waiting');
    assert.deepEqual(retry.status.oversizedEventIds ?? [], []);
    assert.deepEqual(retry.after.conflicts, retry.before.conflicts);
    const retryable = retry.before.outbox.find(item => item.entityId === 'existing-owner-event');
    assert.deepEqual(retry.after.outbox.find(item => item.mutationId === retryable.mutationId).patch, retryable.patch);
    assert.equal(retry.settled.outbox.length, 0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?')
      .bind(retryable.mutationId).first()).n, 1);

    h.setPushLimit(2048, { canonical: true });
    const setup = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      await calendar.update('existing-owner-event', {notes:'x'.repeat(2500)});
      const added = await calendar.create({title:'Unrelated after a server 413',category:'general',date:'2026-10-07'});
      return { snapshot:await window.client.snapshot(),validId:added.events.find(event => event.title === 'Unrelated after a server 413').id };
    })()`);
    const original = setup.snapshot.outbox.find(item => item.entityId === 'existing-owner-event');
    const rejected = await h.evaluate(`(async () => {
      window.controls.pushResponses.length = 0;
      await window.client.sync.run();
      return {snapshot:await window.client.snapshot(),status:window.client.sync.getSnapshot(),
        pushes:window.controls.pushResponses};
    })()`);
    assert.equal(rejected.status.status, 'attention');
    const [oversize] = rejected.pushes.filter(item => item.entityId === 'existing-owner-event');
    assert.deepEqual({ id:oversize.id, status:oversize.status }, { id:original.mutationId, status:413 });
    assert.ok(oversize.bytes > 2048 && oversize.bytes < 65536);
    assert.ok(rejected.pushes.some(item => item.entityId === setup.validId && item.status === 200), 'a real HTTP 413 does not stop subsequent writes');
    assert.deepEqual(rejected.status.oversizedEventIds, ['existing-owner-event']);
    const retained = rejected.snapshot.calendar.find(item => item.id === 'existing-owner-event');
    assert.equal(retained.payload.notes, original.patch.notes);
    assert.equal(rejected.snapshot.conflicts.find(item => item.entityId === retained.id).result.code, 'PAYLOAD_TOO_LARGE');

    await h.reload();
    await h.evaluate('window.client.sync.run()');
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'attention');
    assert.deepEqual(await h.evaluate('window.client.sync.getSnapshot().oversizedEventIds'), [retained.id]);
    assert.equal(await h.evaluate('window.controls.pushResponses.length'), 0);
    assert.equal((await h.evaluate('window.client.snapshot()')).calendar.find(item => item.id === retained.id).payload.notes, original.patch.notes);

    await h.evaluate("window.client.repositories.calendar.update('existing-owner-event', {notes:'Smaller note'})");
    await h.evaluate('window.client.sync.run()');
    assert.equal(await h.evaluate('window.client.sync.getSnapshot().status'), 'synced');
    const saved = await h.db.prepare("SELECT payload_json FROM calendar_events WHERE id='existing-owner-event'").first();
    assert.equal(JSON.parse(saved.payload_json).notes, 'Smaller note');
    const journal = await h.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?').bind(original.mutationId).first();
    assert.equal(journal.n, 0, 'the rejected mutation ID was never applied even after recovery');

    const race = await h.evaluate(`(async () => {
      const id = 'existing-owner-event';
      const calendar = window.client.repositories.calendar;
      await calendar.update(id, {notes:'y'.repeat(2500)});
      await window.client.sync.run();
      const baseRevision = (await window.client.snapshot()).calendar.find(item => item.id === id).revision;
      const remote = await window.client.remote({mutationId:'oversize-recovery-race',entityType:'calendar_event',
        entityId:id,operation:'UPDATE',baseRevision,patch:{notes:'Remote while quarantined'}});
      await calendar.update(id, {notes:'Locally reduced while away'});
      await window.client.sync.run();
      return {remoteStatus:remote.results[0].status,snapshot:await window.client.snapshot(),status:window.client.sync.getSnapshot()};
    })()`);
    assert.equal(race.remoteStatus, 'APPLIED');
    assert.equal(race.status.status, 'attention');
    assert.deepEqual(race.status.oversizedEventIds, []);
    const conflict = race.snapshot.conflicts.find(item => item.entityId === retained.id);
    assert.equal(conflict.result.code, 'FIELD_OVERLAP');
    assert.equal(conflict.localRecord.payload.notes, 'Locally reduced while away');
    const remote = await h.db.prepare("SELECT payload_json FROM calendar_events WHERE id='existing-owner-event'").first();
    assert.equal(JSON.parse(remote.payload_json).notes, 'Remote while quarantined');
  } finally {
    await h.close();
  }
});

const recoveryCap = 2048;

async function stageRecoveryCreate(harness, outcome = 'lost-response') {
  assert.equal(await harness.evaluate('window.client.enable()'), true);
  const queued = await harness.evaluate(`(async () => {
    const latest = await window.client.repositories.calendar.create({
      title:'Recovery create',category:'general',date:'2026-10-05',notes:'x'.repeat(2900)
    });
    const id = latest.events.find(event => event.title === 'Recovery create').id;
    return (await window.client.snapshot()).outbox.find(item => item.entityId === id);
  })()`);
  if (outcome === 'rejected') harness.setPushLimit(recoveryCap, { canonical: true });
  await harness.evaluate(`(async () => {
    window.controls.losePushReply = ${outcome === 'lost-response'};
    window.controls.offlinePush = ${outcome === 'offline'};
    await window.client.sync.run();
    window.controls.losePushReply = false;
    window.controls.offlinePush = false;
  })()`);
  return queued;
}

const recoveryRow = (harness, id) => harness.db.prepare(
  'SELECT id, revision, payload_json, deleted_at FROM calendar_events WHERE id = ?',
).bind(id).first();

test('recovery A/G preserves a lost CREATE acknowledgement and sends the correction once after restart', { timeout: 90000 }, async () => {
  const h = await harness();
  try {
    const original = await stageRecoveryCreate(h);
    const id = original.entityId;
    assert.equal((await recoveryRow(h, id)).revision, 1, 'CREATE committed despite the lost reply');
    const journal = await h.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?').bind(original.mutationId).first();
    assert.equal(journal.n, 1);
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.reload();
    await h.evaluate('window.client.sync.run()');
    assert.ok((await h.evaluate('window.controls.pushResponses')).some(item => item.id === original.mutationId && item.status === 413));
    const corrected = 'Shortened after the response was lost';
    const staged = await h.evaluate(`(async () => {
      await window.client.repositories.calendar.update(${JSON.stringify(id)}, {notes:${JSON.stringify(corrected)}});
      return (await window.client.snapshot()).outbox.find(item => item.entityId === ${JSON.stringify(id)} && item.operation === 'UPDATE');
    })()`);
    await h.evaluate('window.controls.losePushReply = true; window.client.sync.run()');
    await h.reload();
    await h.evaluate('window.client.sync.run()');
    const saved = await recoveryRow(h, id);
    assert.equal(JSON.parse(saved.payload_json).notes, corrected, 'after reconciliation, client must send a subsequent UPDATE, not retry as a duplicate CREATE');
    assert.equal(saved.revision, 2);
    const snapshot = await h.evaluate('window.client.snapshot()');
    assert.ok(!snapshot.conflicts.some(item => item.entityId === id));
    assert.ok(!snapshot.outbox.some(item => item.entityId === id));
    const writes = await h.db.prepare('SELECT operation, revision FROM change_log WHERE entity_id = ? ORDER BY seq').bind(id).all();
    assert.deepEqual(writes.results.map(({operation,revision}) => [operation,revision]), [['CREATE',1],['UPDATE',2]]);
    const correctedJournal = await h.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?').bind(staged.mutationId).first();
    assert.equal(correctedJournal.n, 1, 'the same corrected mutation ID is replayed after restart');
  } finally {
    await h.close();
  }
});

test('recovery B cancels a server-size-rejected CREATE on deletion without inventing a cloud tombstone', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    const original = await stageRecoveryCreate(h, 'rejected');
    const id = original.entityId;
    assert.equal(await recoveryRow(h, id), null);
    assert.ok((await h.evaluate('window.controls.pushResponses')).some(item => item.id === original.mutationId && item.status === 413));
    const unrelatedId = await h.evaluate(`(async () => {
      await window.client.repositories.calendar.remove(${JSON.stringify(id)});
      const latest = await window.client.repositories.calendar.create({title:'Unrelated after cancellation',category:'general',date:'2026-10-05'});
      await window.client.sync.run();
      return latest.events.find(event => event.title === 'Unrelated after cancellation').id;
    })()`);
    const snapshot = await h.evaluate('window.client.snapshot()');
    assert.ok(!snapshot.outbox.some(item => item.entityId === id), 'no invisible CREATE/DELETE may remain after cancellation');
    assert.ok(!snapshot.conflicts.some(item => item.entityId === id));
    assert.ok(!snapshot.calendar.some(item => item.id === id));
    assert.equal(await recoveryRow(h, id), null);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ?').bind(id).first()).n, 0);
    assert.equal((await recoveryRow(h, unrelatedId)).revision, 1);
  } finally {
    await h.close();
  }
});

test('recovery C reconciles an uncertain committed CREATE before honoring its queued DELETE', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    const original = await stageRecoveryCreate(h);
    const id = original.entityId;
    assert.equal((await recoveryRow(h, id)).deleted_at, null);
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.evaluate(`(async () => {
      await window.client.repositories.calendar.remove(${JSON.stringify(id)});
      await window.client.sync.run();
    })()`);
    await h.reload();
    await h.evaluate('window.client.sync.run()');
    const server = await recoveryRow(h, id);
    assert.ok(server?.deleted_at, 'the already committed CREATE must be acknowledged, then deleted using a real server tombstone');
    assert.equal(server.revision, 2);
    const snapshot = await h.evaluate('window.client.snapshot()');
    assert.ok(!snapshot.outbox.some(item => item.entityId === id));
    assert.ok(!snapshot.conflicts.some(item => item.entityId === id));
    const journal = await h.db.prepare('SELECT operation, revision FROM change_log WHERE entity_id = ? ORDER BY seq').bind(id).all();
    assert.deepEqual(journal.results.map(({operation,revision}) => [operation,revision]), [['CREATE',1],['DELETE',2]]);
  } finally {
    await h.close();
  }
});

test('recovery G keeps the same CREATE while another Chromium tab receives 413 before its earlier request commits', { timeout: 90000 }, async () => {
  const h = await harness();
  let peer;
  let hold;
  try {
    assert.equal(await h.evaluate('window.client.enable()'), true);
    const original = await h.evaluate(`(async () => {
      const result = await window.client.repositories.calendar.create({title:'Concurrent recovery create',category:'general',
        date:'2026-10-05',notes:'x'.repeat(2900)});
      const id = result.events.find(item => item.title === 'Concurrent recovery create').id;
      return (await window.client.snapshot()).outbox.find(item => item.entityId === id);
    })()`);
    const id = original.entityId;
    hold = h.holdNextPush(original.mutationId);
    await h.evaluate('window.controls.losePushReply = true; window.earlierRun = window.client.sync.run(); true');
    assert.equal(await Promise.race([hold.reached.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000).unref())]), true);
    assert.equal(await recoveryRow(h, id), null, 'earlier request is held before the D1 commit');
    h.setPushLimit(recoveryCap, { canonical: true });
    peer = await h.newTab();
    await peer.evaluate('window.client.sync.run()');
    assert.ok((await peer.evaluate('window.controls.pushResponses')).some(item => item.id === original.mutationId && item.status === 413));

    const correction = 'Shortened while the earlier request was held';
    const unknown = await peer.evaluate(`(async () => {
      await window.client.repositories.calendar.update(${JSON.stringify(id)}, {notes:${JSON.stringify(correction)}});
      await window.client.sync.run();
      return {snapshot:await window.client.snapshot(),calls:window.controls.calls};
    })()`);
    const queued = unknown.snapshot.outbox.filter(item => item.entityId === id);
    assert.equal(queued.length, 2);
    assert.equal(queued[0].mutationId, original.mutationId, 'UNKNOWN may not replace or discard the original command');
    assert.deepEqual(queued[0].patch, original.patch);
    assert.equal(queued[1].patch.notes, correction);
    assert.ok(unknown.calls.some(path => path.startsWith('/api/sync/mutation-status?')));
    assert.equal(await recoveryRow(h, id), null, 'no replacement CREATE overtakes the in-flight original');

    hold.release();
    await h.evaluate('window.earlierRun');
    assert.equal((await recoveryRow(h, id)).revision, 1, 'the held original was the only CREATE and its reply was lost');
    await peer.close();
    peer = null;
    await h.reload();
    await h.evaluate('window.client.sync.run()');
    const recovered = await recoveryRow(h, id);
    assert.equal(recovered.revision, 2);
    assert.equal(JSON.parse(recovered.payload_json).notes, correction);
    const journal = await h.db.prepare('SELECT operation, revision FROM change_log WHERE entity_id = ? ORDER BY seq').bind(id).all();
    assert.deepEqual(journal.results.map(({operation,revision}) => [operation,revision]), [['CREATE',1],['UPDATE',2]]);
    assert.ok(!(await h.evaluate('window.client.snapshot()')).outbox.some(item => item.entityId === id));
  } finally {
    hold?.release();
    if (hold) await h.evaluate('window.earlierRun').catch(() => undefined);
    await peer?.close();
    await h.close();
  }
});

test('recovery G keeps an uncertain CREATE after a contended manual retry until its journal outcome is known', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    const original = await stageRecoveryCreate(h);
    const id = original.entityId;
    const exactBody = await h.evaluate('window.controls.pushBodies.at(-1)');
    assert.equal((await recoveryRow(h, id)).revision, 1, 'the original CREATE already committed');
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.evaluate('window.controls.mockUnknownMutationStatus = true; window.client.sync.run()');
    assert.equal((await h.evaluate('window.controls.pushResponses')).at(-1).status, 413);
    const correction = 'Shorter after a contended retry';
    await h.evaluate(`window.client.repositories.calendar.update(${JSON.stringify(id)}, {notes:${JSON.stringify(correction)}})`);
    h.setPushLimit(65536);
    const disputed = await h.evaluate(`(async () => {
      window.controls.contendedPushMutationId = ${JSON.stringify(original.mutationId)};
      window.controls.pushBodies.length = 0;
      await window.client.sync.retryUncertain();
      return {snapshot:await window.client.snapshot(), bodies:window.controls.pushBodies,
        warning:window.client.sync.getSnapshot().uncertainEventIds};
    })()`);
    assert.deepEqual(disputed.bodies, [exactBody]);
    assert.deepEqual(disputed.warning, [id], 'one racing conflict is not evidence that the earlier exact request did not commit');
    const uncertain = disputed.snapshot.conflicts.find(item => item.entityId === id);
    assert.equal(uncertain.result.code, 'MUTATION_OUTCOME_UNKNOWN');
    const stillQueued = disputed.snapshot.outbox.filter(item => item.entityId === id);
    assert.equal(stillQueued[0].mutationId, original.mutationId);
    assert.deepEqual(stillQueued[0].patch, original.patch);
    assert.equal(stillQueued[1].patch.notes, correction);

    await h.reload();
    await h.evaluate('window.client.sync.run()');
    const saved = await recoveryRow(h, id);
    assert.equal(saved.revision, 2);
    assert.equal(JSON.parse(saved.payload_json).notes, correction);
    const history = await h.db.prepare('SELECT operation, revision FROM change_log WHERE entity_id = ? ORDER BY seq').bind(id).all();
    assert.deepEqual(history.results.map(({ operation, revision }) => [operation, revision]), [['CREATE', 1], ['UPDATE', 2]]);
    const final = await h.evaluate('window.client.snapshot()');
    assert.ok(!final.outbox.some(item => item.entityId === id));
    assert.ok(!final.conflicts.some(item => item.entityId === id));
  } finally {
    await h.close();
  }
});

test('recovery G manually retries the exact original CREATE only after the transport cap is restored', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    const original = await stageRecoveryCreate(h, 'offline');
    const id = original.entityId;
    const exactBody = await h.evaluate('window.controls.pushBodies.at(-1)');
    assert.equal(await recoveryRow(h, id), null, 'the first ambiguous submission never got to D1');
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.evaluate('window.client.sync.run()');
    const rejected = await h.evaluate('window.controls.pushResponses.at(-1)');
    assert.equal(rejected.id, original.mutationId);
    assert.equal(rejected.status, 413);
    assert.ok((await h.evaluate('window.client.sync.getSnapshot().uncertainEventIds')).includes(id));
    const correction = 'Shorter pending text';
    await h.evaluate(`window.client.repositories.calendar.update(${JSON.stringify(id)}, {notes:${JSON.stringify(correction)}})`);
    await h.reload();
    h.setPushLimit(65536);
    await h.evaluate('window.client.sync.run()');
    assert.deepEqual(await h.evaluate('window.controls.pushBodies'), [], 'automatic sync only looks up UNKNOWN work');
    assert.equal(await recoveryRow(h, id), null);
    assert.ok((await h.evaluate('window.controls.calls')).some(path => path.startsWith('/api/sync/mutation-status?')));

    await h.evaluate('window.client.sync.retryUncertain()');
    const outgoing = await h.evaluate('window.controls.pushBodies');
    assert.equal(outgoing.length, 2);
    assert.equal(outgoing[0], exactBody, 'manual retry preserves exact request bytes, original mutation ID and patch');
    const forwarded = JSON.parse(outgoing[1]).mutations[0];
    assert.equal(forwarded.operation, 'UPDATE');
    assert.equal(forwarded.baseRevision, 1);
    assert.equal(forwarded.patch.notes, correction);
    const saved = await recoveryRow(h, id);
    assert.equal(saved.revision, 2);
    assert.equal(JSON.parse(saved.payload_json).notes, correction);
    const journal = await h.db.prepare('SELECT operation, revision FROM change_log WHERE entity_id = ? ORDER BY seq').bind(id).all();
    assert.deepEqual(journal.results.map(({operation,revision}) => [operation,revision]), [['CREATE',1],['UPDATE',2]]);
    const snapshot = await h.evaluate('window.client.snapshot()');
    assert.ok(!snapshot.outbox.some(item => item.entityId === id));
    assert.ok(!snapshot.conflicts.some(item => item.entityId === id));
  } finally {
    await h.close();
  }
});

test('recovery C does not manually resubmit an UNKNOWN CREATE deleted in the meantime', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    const original = await stageRecoveryCreate(h, 'offline');
    const id = original.entityId;
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.evaluate(`(async () => {
      await window.client.sync.run();
      await window.client.repositories.calendar.remove(${JSON.stringify(id)});
    })()`);
    await h.reload();
    h.setPushLimit(65536);
    await h.evaluate('window.client.sync.retryUncertain()');
    const snapshot = await h.evaluate('window.client.snapshot()');
    const pending = snapshot.outbox.filter(item => item.entityId === id);
    assert.deepEqual(pending.map(item=>item.operation), ['CREATE','DELETE']);
    assert.equal(pending[0].mutationId, original.mutationId);
    assert.deepEqual(pending[0].patch, original.patch);
    assert.ok(snapshot.calendar.find(item => item.id === id).deletedAt);
    assert.ok((await h.evaluate('window.client.sync.getSnapshot().uncertainEventIds')).includes(id));
    assert.deepEqual(await h.evaluate('window.controls.pushBodies'), []);
    assert.equal(await recoveryRow(h, id), null);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ?').bind(id).first()).n, 0);
  } finally {
    await h.close();
  }
});

test('late CREATE evidence preserves disjoint remote edits from a linked device', { timeout: 90000 }, async () => {
  const a = await harness();
  let b;
  try {
    const original = await stageRecoveryCreate(a);
    const id = original.entityId;
    assert.equal((await recoveryRow(a, id)).revision, 1);
    const link = await a.evaluate('window.client.sync.createDeviceLink()');
    assert.ok(link);
    b = await harness({ sharedBackend: a, query: '?unrelatedLocal=1' });
    assert.equal(await b.evaluate(`window.client.sync.claimDevice({link:${JSON.stringify(link)},deviceName:'Second device'})`), true);

    a.setPushLimit(recoveryCap, { canonical: true });
    const remoteTitle = 'Teise seadme uus pealkiri';
    await b.evaluate(`window.client.repositories.calendar.update(${JSON.stringify(id)},{title:${JSON.stringify(remoteTitle)}})
      .then(()=>window.client.sync.run())`);
    const remoteBefore = await recoveryRow(a, id);
    assert.equal(remoteBefore.revision, 2);
    assert.equal(JSON.parse(remoteBefore.payload_json).title, remoteTitle);

    const localNotes = 'Lühendatud märkmed esimese seadme poolel';
    const pending = await a.evaluate(`(async () => {
      window.controls.unavailableMutationStatus = true;
      await window.client.sync.run();
      await window.client.repositories.calendar.update(${JSON.stringify(id)},{notes:${JSON.stringify(localNotes)}});
      const snapshot = await window.client.snapshot();
      return {snapshot,calls:window.controls.calls};
    })()`);
    assert.ok(pending.calls.some(path => path.startsWith('/api/sync/mutation-status?')));
    const blocked = pending.snapshot.conflicts.find(item => item.entityId === id);
    assert.equal(blocked.result.code, 'MUTATION_OUTCOME_UNKNOWN');
    assert.equal(blocked.remoteRecord.revision, 2, 'the pull preserves the genuine later server update before original proof arrives');
    assert.equal(blocked.remoteRecord.payload.title, remoteTitle);
    const queued = pending.snapshot.outbox.filter(item => item.entityId === id);
    assert.deepEqual(queued.map(item => item.operation), ['CREATE','UPDATE']);
    assert.equal(queued[0].mutationId, original.mutationId);
    assert.deepEqual(queued[0].patch, original.patch);

    await a.evaluate(`(async () => {
      window.controls.unavailableMutationStatus = false;
      window.controls.pushes.length = 0;
      await window.client.sync.run();
    })()`);
    const saved = await recoveryRow(a, id);
    const payload = JSON.parse(saved.payload_json);
    assert.equal(saved.revision, 3, 'rev1 proof must unblock the notes-only UPDATE and allow the server to merge the rev2 title');
    assert.equal(payload.title, remoteTitle);
    assert.equal(payload.notes, localNotes);
    const requests = (await a.evaluate('window.controls.pushes')).flatMap(batch => batch.mutations).filter(item => item.entityId === id);
    assert.deepEqual(requests.map(item => [item.mutationId,item.operation,item.baseRevision]), [[queued[1].mutationId,'UPDATE',1]]);
    const journal = await a.db.prepare('SELECT result_json FROM applied_mutations WHERE mutation_id = ?').bind(queued[1].mutationId).first();
    assert.equal(JSON.parse(journal.result_json).result.status, 'MERGED');
    const after = await a.evaluate('window.client.snapshot()');
    assert.ok(!after.outbox.some(item => item.entityId === id));
    assert.ok(!after.conflicts.some(item => item.entityId === id));
    assert.deepEqual(after.calendar.find(item => item.id === id).payload, payload);
  } finally {
    await b?.close();
    await a.close();
  }
});

test('recovery D retains a legal occurrence dependency when the combined replacement would be too large', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    assert.equal(await h.evaluate('window.client.enable()'), true);
    const series = await h.evaluate(`(async () => {
      const result = await window.client.repositories.calendar.create({title:'Recovery recurring',category:'general',date:'2026-10-05',
        recurrence:{frequency:'weekly',interval:1}});
      await window.client.sync.run();
      return result.events.find(event => event.title === 'Recovery recurring');
    })()`);
    const { id } = series;
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.evaluate(`(async () => {
      await window.client.repositories.calendar.update(${JSON.stringify(id)}, {notes:'x'.repeat(2900)}, {scope:'series'});
      await window.client.sync.run();
    })()`);
    const blocked = await h.evaluate('window.client.snapshot()');
    assert.equal(blocked.conflicts.find(item => item.entityId === id).result.code, 'PAYLOAD_TOO_LARGE');
    const exceptionDate = '2026-10-12';
    const occurrenceNotes = 'o'.repeat(1100);
    const seriesNotes = 's'.repeat(1100);
    const staged = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      await calendar.update(${JSON.stringify(id)}, {notes:${JSON.stringify(occurrenceNotes)}}, {scope:'occurrence',occurrenceDate:${JSON.stringify(exceptionDate)}});
      await calendar.update(${JSON.stringify(id)}, {notes:${JSON.stringify(seriesNotes)}}, {scope:'series'});
      const snapshot = await window.client.snapshot();
      window.controls.pushResponses.length = 0;
      await window.client.sync.run();
      return snapshot.outbox.filter(item => item.entityId === ${JSON.stringify(id)});
    })()`);
    const server = await recoveryRow(h, id);
    const payload = JSON.parse(server.payload_json);
    assert.equal(payload.notes, seriesNotes, 'the reduced original prerequisite must sync');
    assert.equal(payload.overrides[exceptionDate]?.notes, occurrenceNotes, 'the separately legal dependent must then sync');
    assert.deepEqual(payload.recurrence, series.recurrence);
    const outgoing = (await h.evaluate('window.controls.pushResponses')).filter(item => item.entityId === id && item.status === 200);
    assert.equal(outgoing.at(-1).id, staged.find(item => Object.hasOwn(item.patch,'overrides')).mutationId, 'dependent keeps its original ID and follows the corrected predecessor');
    assert.equal(server.revision, 3);
    assert.ok(!(await h.evaluate('window.client.snapshot()')).outbox.some(item => item.entityId === id));
  } finally {
    await h.close();
  }
});

test('recovery E records real carried MERGED evidence as a durable field conflict after shrinking', { timeout: 60000 }, async () => {
  const h = await harness();
  try {
    assert.equal(await h.evaluate('window.client.enable()'), true);
    const { id } = await h.evaluate(`(async () => {
      const result = await window.client.repositories.calendar.create({title:'Merge recovery recurring',category:'general',
        date:'2026-10-05',recurrence:{frequency:'weekly',interval:1}});
      await window.client.sync.run();
      return result.events.find(item => item.title==='Merge recovery recurring');
    })()`);
    h.setPushLimit(recoveryCap, { canonical: true });
    await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      const id = ${JSON.stringify(id)};
      await window.client.remote({mutationId:'merge-recovery-remote-title',entityType:'calendar_event',entityId:id,
        operation:'UPDATE',baseRevision:1,patch:{title:'Teise seadme pealkiri'}});
      await calendar.update(id,{notes:'Safe local note'},{scope:'series'});
      await calendar.update(id,{notes:'z'.repeat(2900)},{scope:'occurrence',occurrenceDate:'2026-10-12'});
      await calendar.update(id,{title:'Kohalik pealkiri'},{scope:'series'});
      await window.client.sync.run();
    })()`);
    const blocked = await h.evaluate('window.client.snapshot()');
    assert.equal(blocked.conflicts.find(item => item.entityId === id).result.code, 'PAYLOAD_TOO_LARGE');
    assert.ok(blocked.outbox.find(item => item.entityId === id)?.mergeEvidence, 'received real evidence from the safe predecessor');
    await h.evaluate(`window.client.repositories.calendar.update(${JSON.stringify(id)}, {notes:'Väike märkus'},
      {scope:'occurrence',occurrenceDate:'2026-10-12'}).then(()=>window.client.sync.run())`);
    await h.reload();
    await h.evaluate('window.client.sync.run()');
    const snapshot = await h.evaluate('window.client.snapshot()');
    const conflict = snapshot.conflicts.find(item => item.entityId === id);
    assert.equal(conflict.result.code, 'FIELD_OVERLAP');
    assert.equal(conflict.remoteRecord.payload.title, 'Teise seadme pealkiri');
    assert.equal(conflict.localRecord.payload.title, 'Kohalik pealkiri');
    assert.ok(!(await h.evaluate('window.client.sync.getSnapshot().oversizedEventIds')).includes(id));
    assert.equal(JSON.parse((await recoveryRow(h, id)).payload_json).title, 'Teise seadme pealkiri');
  } finally {
    await h.close();
  }
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

test('MERGED calendar predecessor cannot erase a remote field through a later queued edit or deletion', {timeout:60000}, async () => {
  const h = await harness();
  try {
    await h.evaluate('window.client.enable()');
    const updated = await h.evaluate(`(async () => {
      const id = 'existing-owner-event';
      const calendar = window.client.repositories.calendar;
      await calendar.update(id, {notes:'Local note'});
      await calendar.update(id, {time:'12:30'});
      await calendar.update(id, {title:'Local title'});
      await window.client.remote({mutationId:'remote-title',entityType:'calendar_event',entityId:id,operation:'UPDATE',baseRevision:1,patch:{title:'Remote title'}});
      await window.client.sync.run();
      return window.client.snapshot();
    })()`);
    const edited = await h.db.prepare("SELECT payload_json FROM calendar_events WHERE id='existing-owner-event'").first();
    assert.equal(JSON.parse(edited.payload_json).title, 'Remote title');
    assert.equal(JSON.parse(edited.payload_json).notes, 'Local note');
    assert.equal(JSON.parse(edited.payload_json).time, '12:30');
    assert.equal(updated.conflicts[0].localRecord.payload.title, 'Local title');
    assert.equal(updated.conflicts[0].remoteRecord.payload.title, 'Remote title');
    assert.ok(updated.outbox.some(item => item.patch.title === 'Local title' && item.attemptCount === 0));
    const deleted = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      await calendar.create({title:'Delete candidate',category:'general',date:'2026-10-08'});
      await window.client.sync.run();
      const id = (await window.client.snapshot()).calendar.find(item => item.payload.title === 'Delete candidate').id;
      await calendar.update(id, {notes:'Local note'});
      await calendar.remove(id);
      await window.client.remote({mutationId:'remote-retain',entityType:'calendar_event',entityId:id,operation:'UPDATE',baseRevision:1,patch:{title:'Keep this event'}});
      await window.client.sync.run();
      return {id, ...await window.client.snapshot()};
    })()`);
    const retained = await h.db.prepare('SELECT payload_json,deleted_at FROM calendar_events WHERE id=?').bind(deleted.id).first();
    assert.equal(JSON.parse(retained.payload_json).title, 'Keep this event');
    assert.equal(retained.deleted_at, null);
    const conflict = deleted.conflicts.find(item => item.entityId === deleted.id);
    assert.equal(conflict?.mutation.operation, 'DELETE');
    assert.ok(conflict.localRecord.deletedAt);
    assert.equal(conflict.remoteRecord.payload.title, 'Keep this event');
  } finally { await h.close(); }
});

test('MERGED calendar predecessors preserve remote exclusions when a queued series edit changes its date', {timeout:60000}, async () => {
  const h = await harness();
  try {
    const result = await h.evaluate(`(async () => {
      const calendar = window.client.repositories.calendar;
      await window.client.enable();
      await calendar.create({title:'Weekly event', category:'general', date:'2026-10-08',
        recurrence:{frequency:'weekly', interval:1}});
      await window.client.sync.run();
      const id = (await window.client.snapshot()).calendar.find(item => item.payload.title === 'Weekly event').id;
      await calendar.update(id, {notes:'Local note'}, {scope:'series'});
      await calendar.update(id, {date:'2026-10-09'}, {scope:'series'});
      await window.client.remote({mutationId:'remote-exclusion',entityType:'calendar_event',entityId:id,
        operation:'UPDATE',baseRevision:1,patch:{excludedDates:['2026-10-15']}});
      await window.client.sync.run();
      return {id, ...await window.client.snapshot()};
    })()`);
    const row = await h.db.prepare('SELECT payload_json FROM calendar_events WHERE id=?').bind(result.id).first();
    const payload = JSON.parse(row.payload_json);
    assert.equal(payload.date, '2026-10-08');
    assert.deepEqual(payload.excludedDates, ['2026-10-15']);
    assert.equal(payload.notes, 'Local note');
    const conflict = result.conflicts.find(item => item.entityId === result.id);
    assert.equal(conflict.result.code, 'FIELD_OVERLAP');
    assert.equal(conflict.localRecord.payload.date, '2026-10-09');
    assert.deepEqual(conflict.remoteRecord.payload.excludedDates, ['2026-10-15']);
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

test('two isolated devices join the same user, bootstrap only the server calendar, and sync A CREATE / B UPDATE in both directions', {timeout:90000}, async () => {
  const a = await harness();
  let b;
  try {
    await a.evaluate('window.client.enable()');
    const link = await a.evaluate('window.client.sync.createDeviceLink()');
    assert.equal(typeof link, 'string');
    b = await harness({sharedBackend:a,query:'?unrelatedLocal=1'});
    const joined = await b.evaluate(`window.client.sync.claimDevice({link:${JSON.stringify(link)},deviceName:'Device B'})`);
    assert.equal(joined, true);
    const owner = await a.evaluate('window.client.snapshot()');
    const joinedState = await b.evaluate('window.client.snapshot()');
    assert.equal(joinedState.householdId, owner.householdId);
    assert.deepEqual(joinedState.view.events.map(event => event.title), ['Existing owner event']);
    assert.deepEqual(joinedState.outbox, []);
    assert.equal(joinedState.state.bootstrapCompleted, true);
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/auth/create-household')"), false);
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/sync/push')"), false);
    const archive = await b.evaluate("window.client.replica.getMeta('calendarBeforeDeviceLinkV1')");
    assert.equal(archive.calendarEvents[0].payload.title, 'Unrelated Device B event');
    assert.equal((await a.db.prepare("SELECT count(*) AS n FROM calendar_events WHERE id = 'unrelated-device-b-event'").first()).n, 0);
    const ids = await a.db.prepare('SELECT user_id, token_hash FROM device_sessions').all();
    assert.equal(ids.results.length, 2);
    assert.equal(ids.results[0].user_id, ids.results[1].user_id);
    assert.equal(ids.results[0].token_hash === ids.results[1].token_hash, false);
    const created = await a.evaluate(`(async () => {
      await window.client.repositories.calendar.create({title:'A to B',category:'general',date:'2026-10-06'});
      await window.client.sync.run(); return window.client.snapshot();
    })()`);
    const eventId = created.calendar.find(record => record.payload.title === 'A to B').id;
    await b.evaluate('window.client.sync.run()');
    assert.ok((await b.evaluate('window.client.snapshot()')).view.events.some(event => event.title === 'A to B'));
    await b.evaluate(`(async () => {
      await window.client.repositories.calendar.update(${JSON.stringify(eventId)},{title:'B to A'});
      await window.client.sync.run();
    })()`);
    await a.evaluate('window.client.sync.run()');
    assert.ok((await a.evaluate('window.client.snapshot()')).view.events.some(event => event.title === 'B to A'));
    for (const device of [a,b]) {
      assert.equal(await device.evaluate(`(async () => {
        const auth = await window.client.replica.getAuth();
        const data = JSON.stringify({calendar:await window.client.replica.listCalendarEvents(),
          outbox:await window.client.replica.listOutboxBySequence(),pushes:window.controls.pushes});
        return data.includes(auth.deviceToken) || data.includes(new URL(${JSON.stringify(link)}).searchParams.get('deviceLink'));
      })()`), false);
    }
    for (const [table, expected] of [['households',1],['users',1],['device_sessions',2]]) {
      assert.equal((await a.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, expected);
    }
    await b.reload();
    await b.evaluate('window.client.sync.run()');
    assert.equal((await b.evaluate('window.client.snapshot()')).hasAuth, true);
    assert.ok((await b.evaluate('window.client.snapshot()')).view.events.some(event => event.title === 'B to A'));
    assert.equal((await b.evaluate("window.client.replica.getMeta('calendarBeforeDeviceLinkV1')")).calendarEvents[0].payload.title, 'Unrelated Device B event');
  } finally { if (b) await b.close(); await a.close(); }
});

test('the visible Settings flow issues a copyable link and opening it on B asks only device name, claims and shows A calendar', {timeout:90000}, async () => {
  const a = await harness({ui:true});
  let b;
  try {
    await a.evaluate(`window.uiRuntime.getSnapshot().session.sync.enable({userName:'Owner A',householdName:'Same home',deviceName:'A'})`);
    await a.evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === 'Seaded').click()");
    await a.waitFor("[...document.querySelectorAll('button')].some(button => button.textContent === 'Lisa teine seade')");
    await a.evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Lisa teine seade').click()");
    await a.waitFor("Boolean(document.getElementById('device-link-created')?.value)");
    const link = await a.evaluate("document.getElementById('device-link-created').value");
    const token = new URL(link).searchParams.get('deviceLink');
    b = await harness({ui:true,sharedBackend:a,query:`?unrelatedLocal=1&deviceLink=${encodeURIComponent(token)}`});
    await b.waitFor("!!document.getElementById('device-link-name')");
    assert.equal(await b.evaluate("document.querySelector('h1')?.textContent"), 'Seaded');
    assert.equal(await b.evaluate("document.getElementById('calendar-sync-user') === null && document.getElementById('calendar-sync-household') === null"), true);
    assert.equal(await b.evaluate("new URL(location.href).searchParams.has('deviceLink')"), false);
    await b.evaluate(`(() => {
      const input = document.getElementById('device-link-name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'B phone');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await b.evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Ühenda seade').click()");
    await b.waitFor("window.uiRuntime.getSnapshot().session.sync.getSnapshot().status === 'synced'");
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/auth/create-household')"), false);
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/sync/push')"), false);
    await b.evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === 'Kalender').click()");
    await b.waitFor("document.body.textContent.includes('Existing owner event')");
    assert.equal(await b.evaluate("document.body.textContent.includes('Unrelated Device B event')"), false);
    assert.equal(await b.evaluate(`(async () => {
      const auth = await window.uiReplica.getAuth();
      return document.body.textContent.includes(auth.deviceToken) || JSON.stringify(await window.uiReplica.getSyncState()).includes(${JSON.stringify(token)});
    })()`), false);
  } finally { if (b) await b.close(); await a.close(); }
});

test('a lost claim reply is not retried automatically or converted into household creation; a fresh manually pasted code can join safely', {timeout:90000}, async () => {
  const a = await harness();
  let b;
  try {
    await a.evaluate('window.client.enable()');
    const link = await a.evaluate('window.client.sync.createDeviceLink()');
    b = await harness({sharedBackend:a,query:'?unrelatedLocal=1'});
    assert.equal(await b.evaluate(`(async () => {
      window.controls.loseClaimReply=true;
      return window.client.sync.claimDevice({link:${JSON.stringify(link)},deviceName:'B'});
    })()`), false);
    assert.equal((await b.evaluate('window.client.snapshot()')).state.setupStatus, 'claim-unknown');
    assert.equal((await b.evaluate('window.client.snapshot()')).calendar[0].payload.title, 'Unrelated Device B event');
    await b.reload();
    await b.evaluate('window.client.sync.run()');
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/auth/claim-device') || window.controls.calls.includes('/api/auth/create-household')"), false);
    const freshLink = await a.evaluate('window.client.sync.createDeviceLink()');
    const code = new URL(freshLink).searchParams.get('deviceLink');
    assert.equal(await b.evaluate(`window.client.sync.claimDevice({link:${JSON.stringify(code)},deviceName:'B retry'})`), true);
    assert.deepEqual((await b.evaluate('window.client.snapshot()')).view.events.map(event => event.title), ['Existing owner event']);
    assert.equal((await a.db.prepare('SELECT count(*) AS n FROM households').first()).n, 1);
    assert.equal((await a.db.prepare('SELECT count(*) AS n FROM users').first()).n, 1);
  } finally { if (b) await b.close(); await a.close(); }
});

test('an invalid incoming link never starts OWNER setup; interrupted claiming after reload permits only an explicit fresh-link retry', {timeout:90000}, async () => {
  const a = await harness();
  let b;
  try {
    await a.evaluate('window.client.enable()');
    b = await harness({sharedBackend:a,query:'?unrelatedLocal=1&deviceLink=invalid-code'});
    assert.equal(await b.evaluate('window.client.sync.getSnapshot().hasIncomingLink'), true);
    assert.equal(await b.evaluate('window.client.enable()'), false);
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/auth/create-household')"), false);
    await b.evaluate('window.client.sync.dismissIncomingLink()');
    const link = await a.evaluate('window.client.sync.createDeviceLink()');
    await b.evaluate(`(() => {
      window.controls.holdClaimReply=true;
      window.claimPending=window.client.sync.claimDevice({link:${JSON.stringify(link)},deviceName:'B interrupted'});
    })()`);
    await b.waitFor('window.controls.claimReplyHeld === true');
    assert.equal((await b.evaluate('window.client.snapshot()')).state.setupStatus, 'claiming');
    await b.reload();
    await b.evaluate('window.client.sync.run()');
    assert.equal((await b.evaluate('window.client.snapshot()')).state.setupStatus, 'claim-unknown');
    assert.equal(await b.evaluate("window.controls.calls.includes('/api/auth/claim-device') || window.controls.calls.includes('/api/auth/create-household')"), false);
    const fresh = await a.evaluate('window.client.sync.createDeviceLink()');
    assert.equal(await b.evaluate(`window.client.sync.claimDevice({link:${JSON.stringify(fresh)},deviceName:'B recovered'})`), true);
    assert.deepEqual((await b.evaluate('window.client.snapshot()')).view.events.map(event => event.title), ['Existing owner event']);
    assert.equal((await a.db.prepare('SELECT count(*) AS n FROM households').first()).n, 1);
    assert.equal((await a.db.prepare('SELECT count(*) AS n FROM users').first()).n, 1);
  } finally { if (b) await b.close(); await a.close(); }
});

test('categories V2 old bootstrap and all category transitions round-trip between two devices through the real outbox', {timeout:90000}, async () => {
  const a = await harness();
  let b;
  try {
    await a.evaluate(`(async () => {
      await window.client.enable();
      const template = (await window.client.snapshot()).calendar[0].payload;
      for (const category of ['payment','maintenance','waste','general']) {
        const patch = {...template,id:'old-' + category,title:'Old ' + category,category,subtype:category==='waste'?'paper':null};
        await window.client.remote({mutationId:'old-create-' + category,entityType:'calendar_event',entityId:patch.id,operation:'CREATE',baseRevision:0,patch});
      }
      await window.client.sync.run();
    })()`);
    const link = await a.evaluate('window.client.sync.createDeviceLink()');
    b = await harness({sharedBackend:a,query:'?unrelatedLocal=1'});
    assert.equal(await b.evaluate(`window.client.sync.claimDevice({link:${JSON.stringify(link)},deviceName:'Category Device B'})`),true);
    for (const category of ['payment','maintenance','waste','general']) {
      const old = (await b.evaluate('window.client.snapshot()')).view.events.find(event=>event.id==='old-' + category);
      assert.equal(old.category,category);
      assert.equal(Object.hasOwn(old,'categoryLabel'),false);
      assert.equal(Object.hasOwn(old,'categoryColor'),false);
    }
    const catA = {category:'custom:32d04c45-5f31-4d12-8337-2f829c473a01',categoryLabel:'Koertekool',categoryColor:'#7A5CC8'};
    const catB = {category:'custom:91d2731e-c1c7-4a13-90ec-5f16cc916ba2',categoryLabel:'Rattasõit',categoryColor:'#278B8B'};
    for (const [writer, reader, patch] of [
      [a,b,catA], [b,a,catB], [a,b,{category:'culture'}],
      [b,a,catA], [a,b,{category:'waste',subtype:'bio'}], [b,a,catB],
    ]) {
      const pending = await writer.evaluate(`(async () => {
        await window.client.repositories.calendar.update('existing-owner-event',${JSON.stringify(patch)});
        return window.client.snapshot();
      })()`);
      const mutation = pending.outbox.find(item=>item.entityId==='existing-owner-event');
      assert.equal(mutation.patch.category,patch.category);
      assert.equal(Object.hasOwn(mutation.patch,'subtype'),true);
      assert.equal(Object.hasOwn(mutation.patch,'categoryLabel'),true);
      assert.equal(Object.hasOwn(mutation.patch,'categoryColor'),true);
      if (!patch.category.startsWith('custom:')) {
        assert.equal(mutation.patch.categoryLabel,null); assert.equal(mutation.patch.categoryColor,null);
      }
      await writer.evaluate('window.client.sync.run()');
      assert.deepEqual((await writer.evaluate('window.client.snapshot()')).outbox,[]);
      await reader.evaluate('window.client.sync.run()');
      const snapshot = await reader.evaluate('window.client.snapshot()');
      const event = snapshot.view.events.find(event=>event.id==='existing-owner-event');
      assert.equal(event.category,patch.category);
      assert.equal(event.categoryLabel,patch.categoryLabel ?? null);
      assert.equal(event.categoryColor,patch.categoryColor ?? null);
      if (patch.category.startsWith('custom:')) {
        const choices = mergeCalendarCategories({categories:[],hiddenIds:[]},snapshot.view.events);
        assert.ok(choices.some(choice=>choice.id===patch.category && choice.label===patch.categoryLabel && choice.color===patch.categoryColor));
      }
      assert.equal(snapshot.tokenLeaked,false);
    }
    const migrated = await b.evaluate(`(async () => {
      await window.client.repositories.calendar.update('old-payment',{title:'Edited old payment'});
      await window.client.sync.run();return window.client.snapshot();
    })()`);
    assert.equal(migrated.view.events.find(event=>event.id==='old-payment').category,'general');
    await a.evaluate('window.client.sync.run()');
    assert.equal((await a.evaluate('window.client.snapshot()')).view.events.find(event=>event.id==='old-payment').category,'general');
    await b.reload();await b.evaluate('window.client.sync.run()');
    const reloaded = await b.evaluate('window.client.snapshot()');
    assert.equal(reloaded.view.events.find(event=>event.id==='existing-owner-event').categoryLabel,'Rattasõit');
    assert.deepEqual(reloaded.outbox,[]);assert.deepEqual(reloaded.conflicts,[]);
  } finally { if (b) await b.close(); await a.close(); }
});

test('Calendar recovery UI opens valid series and occurrence editors with a deleted first occurrence', { timeout:60000 }, async () => {
  const h = await harness({ ui:true });
  const session = 'window.uiRuntime.getSnapshot().session';
  const title = 'Mahukas kontrollsari';
  const section = "document.querySelector('[aria-label=\"Mahukad sündmused\"]')";
  const warning = 'Sündmus on sünkroonimiseks liiga mahukas. Sündmus on seadmes alles.';
  const button = (container, label) =>
    `[...${container}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`;
  const calendar = "document.querySelector('nav')";
  const dialog = "document.querySelector('dialog[open]')";
  try {
    await h.send('Emulation.setDeviceMetricsOverride', {width:320,height:640,deviceScaleFactor:1,mobile:true});
    await h.waitFor('innerWidth===320 && innerHeight===640');
    assert.equal(await h.evaluate(`${session}.sync.enable({userName:'Kontrollija',householdName:'Kohalik test',deviceName:'Brauser'})`),true);
    const { id, originalDate, movedDate } = await h.evaluate(`(async () => {
      const store = ${session}.stores.calendar;
      controls.offline = true;
      const created = await store.mutate(repo=>repo.create({title:${JSON.stringify(title)},category:'general',
        date:'2024-01-01',recurrence:{frequency:'weekly',interval:1}}), 'Failed to create fixture');
      const id = created.events.find(event=>event.title===${JSON.stringify(title)}).id;
      await store.mutate(repo=>repo.remove(id,{scope:'occurrence',occurrenceDate:'2024-01-01'}),'Failed to delete first occurrence');
      const originalDate = '2024-04-08';
      const movedDate = '2024-04-09';
      for(let index=1;index<=14;index++){
        const occurrenceDate = new Date(Date.UTC(2024,0,1+index*7)).toISOString().slice(0,10);
        const patch = {notes:'x'.repeat(4900),...(occurrenceDate===originalDate?{date:movedDate}:{})};
        await store.mutate(repo=>repo.update(id,patch,{scope:'occurrence',occurrenceDate}),'Failed to seed override');
      }
      controls.offline = false;
      await ${session}.sync.run();
      return {id,originalDate,movedDate};
    })()`);

    const openCalendar = async () => {
      await h.evaluate(button(calendar,'Kalender'));
      await h.waitFor(`${section}?.innerText.includes(${JSON.stringify(title)})`);
      assert.equal(await h.evaluate(`${section}.querySelector('[role=alert]').textContent`),warning);
    };
    await openCalendar();
    await h.reload();
    await openCalendar();
    await h.evaluate(button(section,'Ava sündmus'));
    await h.waitFor(`Boolean(${dialog})`);
    const general = await h.evaluate(`({
      title:${dialog}.querySelector('h2').textContent,
      eventTitle:${dialog}.querySelector('#event-title')?.value ?? null,
      editingSeries:${dialog}.innerText.includes('Muudad kogu sarja.'),
      displayingDeletedOccurrence:${dialog}.innerText.includes('1. jaanuar 2024 ·'),
    })`);
    assert.deepEqual(general,{title:'Muuda sündmust',eventTitle:title,editingSeries:true,displayingDeletedOccurrence:false});
    assert.equal(await h.evaluate(`${dialog}.querySelector('#event-repeat').disabled`),false);
    assert.equal(await h.evaluate(`${dialog}.scrollWidth<=${dialog}.clientWidth && ${dialog}.getBoundingClientRect().height<=innerHeight`),true);
    await h.evaluate(button(dialog,'Tühista'));
    await h.evaluate(`${section}.querySelector('details summary').click()`);
    assert.equal(await h.evaluate(`${section}.querySelectorAll('details li button').length`),14);
    await h.evaluate(`[...${section}.querySelectorAll('details li button')]
      .find(item=>item.textContent.includes('9. aprill 2024 (algselt 8. aprill 2024)')).click()`);
    await h.waitFor(`Boolean(${dialog})`);
    assert.equal(await h.evaluate(`${dialog}.innerText.includes('Muudad ainult seda üksikkorda.')`),true);
    assert.equal(await h.evaluate(`${dialog}.querySelector('#event-repeat').disabled`),true);
    await h.waitFor("document.querySelector('#event-notes')?.value.length === 4900");
    assert.equal(await h.evaluate("document.querySelector('#event-date').value"),movedDate);
    await h.evaluate(`(() => {
      const notes=document.querySelector('#event-notes');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(notes,'Lühem märkus');
      notes.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await h.evaluate(`${dialog}.querySelector('button[type=submit]').scrollIntoView({block:'center'})`);
    const saveTarget = `(() => {
      const submit = ${dialog}.querySelector('button[type=submit]');
      const {left,top,width,height} = submit.getBoundingClientRect();
      const x=left+width/2, y=top+height/2;
      return {x,y,clickable:submit.contains(document.elementFromPoint(x,y))};
    })()`;
    await h.waitFor(`${saveTarget}.clickable`);
    const { clickable, ...point } = await h.evaluate(saveTarget);
    assert.equal(clickable,true);
    await h.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await h.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await h.waitFor("!document.querySelector('dialog[open]')");
    const saved = await h.evaluate(`window.uiReplica.listCalendarEvents().then(records=>
      records.find(record=>record.id===${JSON.stringify(id)}).payload.overrides[${JSON.stringify(originalDate)}])`);
    assert.deepEqual(saved,{date:movedDate,notes:'Lühem märkus'});
    await h.evaluate(`${session}.sync.run()`);
    await h.waitFor(`!${section}`);
    const synced = await h.db.prepare('SELECT payload_json FROM calendar_events WHERE id=?').bind(id).first();
    const { overrides, excludedDates } = JSON.parse(synced.payload_json);
    assert.deepEqual(excludedDates,['2024-01-01']);
    assert.equal(Object.keys(overrides).length,14);
    assert.deepEqual(overrides[originalDate],{date:movedDate,notes:'Lühem märkus'});
    assert.ok(Object.entries(overrides).filter(([date])=>date!==originalDate).every(([,value])=>value.notes.length===4900));
  } finally { await h.close(); }
});

test('Calendar distinguishes uncertainty about a deleted event from a field conflict', { timeout:60000 }, async () => {
  const h = await harness({ ui:true });
  const session = 'window.uiRuntime.getSnapshot().session';
  const uncertain = "document.querySelector('[aria-label=\"Kinnitust ootavad muudatused\"]')";
  const fields = "document.querySelector('[aria-label=\"Sündmuste konfliktid\"]')";
  const size = "document.querySelector('[aria-label=\"Mahukad sündmused\"]')";
  try {
    assert.equal(await h.evaluate(`${session}.sync.enable({userName:'Kontrollija',householdName:'Kohalik test',deviceName:'Brauser'})`),true);
    const id = await h.evaluate(`(async () => {
      controls.losePushReply = true;
      const store = ${session}.stores.calendar;
      const saved = await store.mutate(repo=>repo.create({title:'Kustutatud kontrollsündmus',category:'general',
        date:'2026-10-06',notes:'x'.repeat(2900)}), 'Create failed');
      await ${session}.sync.run();
      controls.losePushReply = false;
      return saved.events.find(event=>event.title==='Kustutatud kontrollsündmus').id;
    })()`);
    assert.equal((await recoveryRow(h,id)).revision,1);
    h.setPushLimit(recoveryCap,{canonical:true});
    await h.evaluate(`(async () => {
      Object.defineProperty(controls,'offline',{configurable:true,get:()=>controls.calls.at(-1)?.startsWith('/api/sync/mutation-status?')});
      await ${session}.stores.calendar.mutate(repo=>repo.remove(${JSON.stringify(id)}), 'Delete failed');
      await ${session}.sync.run();
      [...document.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Kalender').click();
    })()`);
    await h.waitFor(`Boolean(${uncertain})`);
    assert.match(await h.evaluate(`${uncertain}.querySelector('[role=alert]').textContent`),/tulemus pole veel kinnitatud/);
    assert.equal(await h.evaluate(`Boolean(${uncertain}.querySelector('li'))`),false,'locally deleted event has no visible details');
    assert.equal(await h.evaluate(`Boolean(${size})`),false);
    await h.waitFor(`${uncertain}.querySelector('button')?.disabled===false`);
    await h.evaluate(`(() => {
      Object.defineProperty(controls,'offline',{configurable:true,writable:true,value:false});
      ${uncertain}.querySelector('button').click();
    })()`);
    await h.waitFor(`!${uncertain}`);
    assert.ok((await recoveryRow(h,id)).deleted_at);

    await h.evaluate(`(async () => {
      const auth = await window.uiReplica.getAuth();
      const id = 'existing-owner-event';
      const mutation = {mutationId:'ui-conflict-remote-title',entityType:'calendar_event',entityId:id,
        operation:'UPDATE',baseRevision:1,patch:{title:'Teise seadme pealkiri'}};
      const response = await fetch('/api/sync/push',{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.deviceToken},
        body:JSON.stringify({mutations:[mutation]})});
      if ((await response.json()).results[0].status!=='APPLIED') throw Error('Remote fixture update failed');
      await ${session}.stores.calendar.mutate(repo=>repo.update(id,{title:'Minu kohalik pealkiri'}),'Update failed');
      await ${session}.sync.run();
    })()`);
    await h.waitFor(`Boolean(${fields})`);
    assert.match(await h.evaluate(`${fields}.querySelector('[role=alert]').textContent`),/muudeti ka teises seadmes/);
    assert.equal(await h.evaluate(`${fields}.querySelector('li').textContent`),'Minu kohalik pealkiri');
    assert.equal(await h.evaluate(`Boolean(${size})`),false);
    assert.equal(JSON.parse((await recoveryRow(h,'existing-owner-event')).payload_json).title,'Teise seadme pealkiri');
  } finally { await h.close(); }
});
