import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shoppingHarness } from './client-harness.mjs';

const options = { concurrency: false, timeout: 60000 };

function installEdgeFixtures() {
  const stamp = '2026-10-04T08:00:00.000Z';
  const auth = {
    key: 'device', deviceToken: 'm1s_' + 'a'.repeat(43),
    householdId: 'hld_11111111-1111-4111-8111-111111111111',
    userId: 'usr_22222222-2222-4222-8222-222222222222',
    sessionId: 'ses_33333333-3333-4333-8333-333333333333',
  };
  const remote = (id, name, revision = 1, patch = {}) => ({
    id, payload: { id, name, quantity: '', category: 'food', note: '', checkedAt: null, createdAt: stamp, ...patch },
    revision, updatedAt: stamp, deletedAt: null,
  });
  const attempt = async operation => {
    try { await operation(); return { rejected: false }; }
    catch (error) { return { rejected: true, name: error.name, reason: error.reason, message: error.message }; }
  };
  const names = ['meta', 'auth', 'householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState', 'outbox', 'syncState', 'conflicts', 'shoppingItems'];
  const dump = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, await client.all(name)])));
  const prepare = async () => { await client.install(auth); await client.store.prepareSync(); };
  window.edge = { stamp, auth, remote, attempt, dump, prepare };
}

async function edgeHarness() {
  const harness = await shoppingHarness();
  await harness.evaluate(`(${installEdgeFixtures.toString()})(); true`);
  return harness;
}

function replaceShoppingTransport(harness, handle) {
  const original = harness.server.listeners('request');
  for (const listener of original) harness.server.off('request', listener);
  harness.server.on('request', async (request, response) => {
    const path = new URL(request.url, harness.url).pathname;
    if (!path.startsWith('/api/shopping/')) {
      for (const listener of original) listener.call(harness.server, request, response);
      return;
    }
    try { await handle(request, response, path); }
    catch (error) { response.writeHead(500); response.end('Test transport failed: ' + error.message); }
  });
}

test('shopping authority change refuses local and remote writes without altering records, outbox or cursor', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      await edge.prepare();
      const item = await client.store.add({ name: 'Alles jääv ost' });
      await client.store.applyRemote([], 7, true);
      await client.replica.transact('meta', 'readwrite', async ({ stores }) => {
        const owner = await new Promise((resolve, reject) => {
          const request = stores.meta.get('storageAuthorityV1');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        stores.meta.put({ ...owner, switchId: 'changed-authority' });
      });
      const before = await edge.dump();
      const errors = [];
      for (const operation of [
        () => client.store.add({ name: 'Ei tohi lisanduda' }),
        () => client.store.update(item.id, { note: 'Ei tohi muutuda' }),
        () => client.store.remove(item.id),
        () => client.store.applyRemote([edge.remote(crypto.randomUUID(), 'Ei tohi saabuda')], 99),
      ]) errors.push(await edge.attempt(operation));
      return { before, after: await edge.dump(), errors, snapshot: await client.snapshot() };
    })()`);
    assert.equal(result.errors.length, 4);
    for (const error of result.errors) {
      assert.equal(error.rejected, true);
      assert.equal(error.name, 'RuntimeAuthorityError');
      assert.equal(error.reason, 'authority-mismatch');
    }
    assert.deepEqual(result.after, result.before);
    assert.equal(result.snapshot.state.serverCursor, 7);
    assert.equal(result.snapshot.outbox.length, 1);
  } finally { await h.close(); }
});

test('aborted shopping remote apply rolls back every record, pending mutation, cursor and published view', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      await edge.prepare();
      await client.store.add({ name: 'Kohalik ost' });
      const before = await edge.dump(), viewBefore = client.store.getSnapshot();
      controls.abortNextCommit = true;
      const error = await edge.attempt(() => client.store.applyRemote([edge.remote(crypto.randomUUID(), 'Katkestatud saabuv ost')], 23, true));
      return { before, after: await edge.dump(), viewBefore, viewAfter: client.store.getSnapshot(), error, state: (await client.snapshot()).state };
    })()`);
    assert.equal(result.error.rejected, true);
    assert.equal(result.error.name, 'AbortError');
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.viewAfter, result.viewBefore);
    assert.equal(result.state.serverCursor, 0);
    assert.equal(result.state.bootstrapCompleted, false);
  } finally { await h.close(); }
});

test('shopping bootstrap preserves same-name different-id local contents and their one final CREATE across reload', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      const local = await client.store.add({ name: 'Piim', quantity: '1 l', note: 'Minu kohalik ost' });
      await client.store.update(local.id, { quantity: '2 l' });
      await edge.prepare();
      const before = await client.snapshot();
      const incoming = edge.remote(crypto.randomUUID(), 'Piim', 3, { quantity: '1 pakk', note: 'Teise seadme ost' });
      await client.store.applyRemote([incoming], 31, true);
      return { before, after: await client.snapshot(), incoming, localId: local.id };
    })()`);
    assert.equal(result.after.records.length, 2);
    assert.equal(new Set(result.after.records.map(record => record.id)).size, 2);
    assert.deepEqual(result.after.records.find(record => record.id === result.localId), result.before.records[0]);
    assert.deepEqual(result.after.outbox, result.before.outbox);
    assert.equal(result.after.outbox.length, 1);
    assert.equal(result.after.outbox[0].operation, 'CREATE');
    assert.equal(result.after.outbox[0].patch.quantity, '2 l');
    assert.equal(result.after.conflicts.length, 0);
    assert.equal(result.after.records.find(record => record.id === result.incoming.id).payload.name, 'Piim');
    assert.equal(result.after.state.serverCursor, 31);
    await h.reload();
    const persisted = await h.evaluate('client.snapshot()');
    assert.deepEqual(persisted.records, result.after.records);
    assert.deepEqual(persisted.outbox, result.after.outbox);
    assert.deepEqual(persisted.state, result.after.state);
  } finally { await h.close(); }
});

test('shopping CRUD, acknowledgement and remote apply retain calendar records, conflicts, pending outbox and cursor', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      const id = 'calendar-protected';
      const payload = { id, title: 'Alles jääv kalender', category: 'general', subtype: null, date: '2026-10-05', time: null,
        recurrence: { frequency: 'none', interval: 1 }, reminder: { daysBefore: 0 }, source: 'manual', householdId: null,
        notes: 'Kalendri märkus', seriesId: null, excludedDates: [], overrides: {} };
      await client.replica.putCalendarEvent({ id, payload, revision: 0, updatedAt: edge.stamp, deletedAt: null, syncStatus: 'local' });
      await client.replica.enqueueOutbox({ mutationId: crypto.randomUUID(), entityType: 'calendar_event', entityId: id,
        operation: 'CREATE', baseRevision: 0, patch: payload, createdAt: edge.stamp, attemptCount: 2, lastAttemptAt: edge.stamp });
      await client.replica.transact(['syncState', 'conflicts'], 'readwrite', ({ stores }) => {
        stores.syncState.put({ key: 'calendar', serverCursor: 17, bootstrapCompleted: true, lastSuccessfulSyncAt: edge.stamp, lastAttemptAt: edge.stamp });
        stores.conflicts.put({ id: 'calendar:' + id, entityType: 'calendar_event', entityId: id, preserved: { local: 'Kohalik', server: 'Server' } });
      });
      const before = await client.calendar.snapshot();
      await edge.prepare();
      const item = await client.store.add({ name: 'Pesugeel', category: 'home' });
      await client.store.update(item.id, { quantity: '1 pudel' });
      await client.store.check(item.id, true);
      await client.store.clearChecked();
      const shopping = await client.snapshot();
      const first = shopping.outbox[0];
      await client.store.attempt(first.mutationId);
      await client.store.acknowledge(first.mutationId, 1);
      await client.store.applyRemote([edge.remote(crypto.randomUUID(), 'Saabuv ost')], 50, true);
      return { before, after: await client.calendar.snapshot(), shopping: await client.snapshot(), outbox: await client.all('outbox'), conflicts: await client.all('conflicts') };
    })()`);
    for (const field of ['calendar', 'outbox', 'state', 'conflicts', 'archive', 'household']) {
      assert.deepEqual(result.after[field], result.before[field], `calendar ${field} preserved`);
    }
    assert.deepEqual(result.outbox.filter(record => record.entityType === 'calendar_event'), result.before.outbox);
    assert.deepEqual(result.conflicts.filter(record => record.entityType === 'calendar_event'), result.before.conflicts);
    assert.equal(result.after.state.serverCursor, 17);
    assert.equal(result.shopping.state.serverCursor, 50);
    assert.equal(new Set(result.outbox.map(record => record.sequence)).size, result.outbox.length, 'both domains retain unique generic sequence values');
  } finally { await h.close(); }
});

test('a shopping pull response held across a new local edit preserves the newer local value and pending mutation', options, async () => {
  const h = await edgeHarness();
  let releasePull;
  try {
    const remote = await h.evaluate(`(async () => {
      await edge.prepare();
      const item = edge.remote(crypto.randomUUID(), 'Piim', 1, { quantity: '1 l' });
      edge.itemId = item.id;
      await client.store.applyRemote([item], 20, true);
      return { ...item, revision: 2, payload: { ...item.payload, quantity: '2 l', note: 'Saabuv varasem vastus' } };
    })()`);
    const held = new Promise(resolve => { releasePull = resolve; });
    let signalArrival;
    const arrived = new Promise(resolve => { signalArrival = resolve; });
    replaceShoppingTransport(h, async (request, response, path) => {
      signalArrival();
      assert.equal(path, '/api/shopping/pull');
      assert.equal(new URL(request.url, h.url).searchParams.get('after'), '20');
      await held;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ changes: [{ entityType: 'shopping_item', record: remote }], cursor: 21 }));
    });
    await h.evaluate('(window.edgeRun = client.sync.run(), true)');
    await h.waitFor("controls.calls.some(path => path.startsWith('/api/shopping/pull?'))");
    await arrived;
    const beforeResponse = await h.evaluate(`(async () => {
      await client.store.update(edge.itemId, { quantity: '3 l', note: 'Uus kohalik märkus' });
      return client.snapshot();
    })()`);
    releasePull();
    const result = await h.evaluate(`(async () => { await edgeRun; return { after: await client.snapshot(), view: client.store.getSnapshot(), calls: controls.calls }; })()`);
    assert.deepEqual(result.after.records, beforeResponse.records);
    assert.deepEqual(result.after.outbox, beforeResponse.outbox);
    assert.equal(result.after.records[0].payload.quantity, '3 l');
    assert.equal(result.after.records[0].payload.note, 'Uus kohalik märkus');
    assert.equal(result.after.records[0].syncStatus, 'pending');
    assert.equal(result.after.state.serverCursor, 21);
    assert.equal(result.view.pendingCount, 1);
    assert.deepEqual(result.calls, ['/api/shopping/pull?after=20']);
  } finally { releasePull?.(); await h.close(); }
});

test('a remote shopping tombstone against a pending edit keeps the edit and queue in an explicit conflict', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      await edge.prepare();
      const remote = edge.remote(crypto.randomUUID(), 'Leib');
      await client.store.applyRemote([remote], 8, true);
      await client.store.update(remote.id, { note: 'Minu säiliv muudatus' });
      const before = await client.snapshot();
      const tombstone = { ...remote, revision: 2, deletedAt: edge.stamp };
      await client.store.applyRemote([tombstone], 9);
      return { before, after: await client.snapshot(), view: client.store.getSnapshot(), tombstone };
    })()`);
    assert.deepEqual(result.after.outbox, result.before.outbox);
    assert.equal(result.after.outbox.length, 1);
    assert.deepEqual(result.after.records[0].payload, result.before.records[0].payload);
    assert.equal(result.after.records[0].deletedAt, null);
    assert.equal(result.after.records[0].syncStatus, 'conflict');
    assert.equal(result.after.conflicts.length, 1);
    assert.deepEqual(result.after.conflicts[0].localRecord, result.before.records[0]);
    assert.equal(result.after.conflicts[0].remoteRecord.deletedAt, result.tombstone.deletedAt);
    assert.equal(result.after.state.serverCursor, 9);
    assert.equal(result.view.conflicts[0].remoteDeleted, true);
    assert.equal(result.view.items[0].note, 'Minu säiliv muudatus');
  } finally { await h.close(); }
});

test('malformed and ambiguous remote shopping records never partially apply valid records or advance the cursor', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      await edge.prepare();
      await client.store.add({ name: 'Säiliv kohalik ost' });
      await client.store.applyRemote([], 13, true);
      const valid = edge.remote(crypto.randomUUID(), 'Kehtiv saabuv ost');
      const malformed = [
        ['null', [null]], ['unknown envelope field', [{ ...valid, householdId: edge.auth.householdId }]],
        ['absent deletedAt', [(({ deletedAt, ...rest }) => rest)(valid)]],
        ['zero revision', [{ ...valid, revision: 0 }]], ['unsafe revision', [{ ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }]],
        ['bad timestamp', [{ ...valid, updatedAt: '2026-02-30T08:00:00.000Z' }]],
        ['payload identity mismatch', [{ ...valid, payload: { ...valid.payload, id: crypto.randomUUID() } }]],
        ['unknown payload field', [{ ...valid, payload: { ...valid.payload, ignored: true } }]],
        ['normalization would change payload', [{ ...valid, payload: { ...valid.payload, name: ' Padded ' } }]],
        ['bad checkedAt', [{ ...valid, payload: { ...valid.payload, checkedAt: 'yesterday' } }]],
        ['ambiguous same revision', [valid, { ...valid, payload: { ...valid.payload, note: 'Different same revision' } }]],
      ];
      const before = await edge.dump();
      const errors = [];
      for (const [name, rows] of malformed) {
        const result = await edge.attempt(() => client.store.applyRemote([edge.remote(crypto.randomUUID(), 'Must not partially apply'), ...rows], 200));
        errors.push({ case: name, ...result });
      }
      return { before, after: await edge.dump(), errors, state: (await client.snapshot()).state };
    })()`);
    assert.equal(result.errors.length, 11);
    for (const error of result.errors) {
      assert.equal(error.rejected, true, error.case);
      assert.equal(error.name, 'TypeError', error.case);
    }
    assert.deepEqual(result.after, result.before);
    assert.equal(result.state.serverCursor, 13);
  } finally { await h.close(); }
});

test('shopping generic sequence exhaustion aborts a multi-item clear and a new add without losing acknowledged data', options, async () => {
  const h = await edgeHarness();
  try {
    const result = await h.evaluate(`(async () => {
      await edge.prepare();
      const first = await client.store.add({ name: 'Esimene säiliv ost' });
      const second = await client.store.add({ name: 'Teine säiliv ost' });
      await client.store.check(first.id, true); await client.store.check(second.id, true);
      await client.replica.putMeta({ key: 'outboxSequence', value: Number.MAX_SAFE_INTEGER - 1 });
      const beforeClear = await edge.dump();
      const clearError = await edge.attempt(() => client.store.clearChecked());
      const afterClear = await edge.dump();
      await client.store.add({ name: 'Viimane lubatud järjekorranumber' });
      const beforeAdd = await edge.dump();
      const addError = await edge.attempt(() => client.store.add({ name: 'Ei tohi salvestuda' }));
      return { beforeClear, afterClear, clearError, beforeAdd, afterAdd: await edge.dump(), addError, state: await client.snapshot() };
    })()`);
    assert.equal(result.clearError.rejected, true);
    assert.equal(result.clearError.name, 'RangeError');
    assert.deepEqual(result.afterClear, result.beforeClear, 'even the first planned deletion and sequence allocation were rolled back');
    assert.equal(result.addError.rejected, true);
    assert.equal(result.addError.name, 'RangeError');
    assert.deepEqual(result.afterAdd, result.beforeAdd);
    assert.equal(result.state.sequence, Number.MAX_SAFE_INTEGER);
    assert.equal(result.state.outbox.at(-1).sequence, Number.MAX_SAFE_INTEGER);
    assert.equal(result.state.records.length, 3);
    assert.ok(result.state.records.every(record => record.deletedAt === null));
  } finally { await h.close(); }
});
