import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { shoppingHarness } from '../shopping/client-harness.mjs';
import { reloadWithCachedClient } from './cached-client-worker.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselineSha = 'b47e01ba673d30021bf768df653f7257ac53b1b4';

async function withBaselineCheckout(run) {
  const temporary = mkdtempSync(join(tmpdir(), 'annivibe-sync-baseline-'));
  const archive = join(temporary, 'baseline.tar');
  try {
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, baselineSha, 'src', 'functions', 'package.json'], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', temporary], { cwd: root });
    await run(temporary);
  } finally {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    assert.match(basename(temporary), /^annivibe-sync-baseline-/);
    rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const domains = [
  { name: 'Shopping', run: 'client.sync.run()', snapshot: 'client.snapshot()',
    view: 'client.sync.getSnapshot()', create: "client.store.add({name:'Piim'})", store: 'shopping_items',
    createItem: name => `client.store.add({name:${JSON.stringify(name)},quantity:'1'})`,
    repository: 'client.store', records: 'records', sharedField: 'quantity', firstField: 'name', nextField: 'note',
    remoteValue: '2', localValue: '3', firstValue: 'Nimi A-st', nextValue: 'Märkus A-st' },
  { name: 'Calendar', run: 'client.calendarSync.run()', snapshot: 'client.calendar.snapshot()',
    view: 'client.calendarSync.getSnapshot()',
    create: "client.calendarRepository.create({title:'Kohtumine',category:'general',date:'2026-10-04'})",
    store: 'calendar_events', createItem: title => `client.calendarRepository.create({title:${JSON.stringify(title)},category:'general',date:'2026-10-04'}).then(result=>result.events.find(event=>event.title===${JSON.stringify(title)}))`,
    repository: 'client.calendarRepository', records: 'calendar', sharedField: 'title', firstField: 'notes', nextField: 'time',
    remoteValue: 'Pealkiri B-st', localValue: 'Pealkiri A-st', firstValue: 'Märkus A-st', nextValue: '12:00' },
];

async function authPost(harness, endpoint, body, token) {
  const response = await fetch(new URL(endpoint, harness.url), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201, endpoint);
  return response.json();
}

const authFrom = ({ deviceSession, household, account }) => ({
  key: 'device', deviceToken: deviceSession.token, sessionId: deviceSession.id, householdId: household.id, userId: account.userId,
});

async function installOwner(harness) {
  const auth = authFrom(await authPost(harness, '/api/auth/create-household',
    { userName: 'Kohalik omanik', householdName: 'Versioonikatse', deviceName: 'A' }));
  await harness.evaluate(`client.calendar.install(${JSON.stringify(auth)})`);
  return auth;
}

async function joinDevice(host, harness, owner) {
  const { linkToken } = await authPost(host, '/api/auth/device-link', {}, owner.deviceToken);
  const auth = authFrom(await authPost(host, '/api/auth/claim-device', { linkToken, deviceName: 'B' }));
  assert.equal(auth.householdId, owner.householdId);
  await harness.evaluate(`client.calendar.setupStatus('claiming').then(()=>client.calendar.installJoined(${JSON.stringify(auth)}))`);
}

const pendingWork = snapshot => snapshot.outbox.map(({ lastAttemptAt, attemptCount, ...item }) => item);

test('both push clients advertise merge evidence and keep upgrade-required work retryable', { timeout: 60000 }, async () => {
  const harness = await shoppingHarness({ backend: true });
  try {
    await installOwner(harness);
    for (const domain of domains) {
      await harness.evaluate(domain.run);
      await harness.evaluate(domain.create);
      const before = pendingWork(await harness.evaluate(domain.snapshot));
      assert.equal(before.length, 1);
      await harness.evaluate(`controls.upgradeRequired = true; ${domain.run}`);
      const attempted = await harness.evaluate('controls.pushCapabilities.at(-1)');
      const state = await harness.evaluate(domain.snapshot);
      assert.equal(attempted, 'merge-evidence-v1', domain.name);
      assert.deepEqual(pendingWork(state), before, domain.name);
      assert.equal(state.conflicts.length, 0, domain.name);
      assert.match((await harness.evaluate(domain.view)).error, /uuenda|uuendamist/iu, domain.name);
      await harness.evaluate(`controls.upgradeRequired = false; ${domain.run}`);
      assert.equal((await harness.evaluate(domain.snapshot)).outbox.length, 0, domain.name);
      assert.equal((await harness.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?')
        .bind(before[0].mutationId).first()).n, 1, domain.name);
    }
  } finally {
    await harness.close();
  }
});

async function readServerItem(harness, domain, id) {
  const row = await harness.db.prepare(`SELECT payload_json, deleted_at, revision FROM ${domain.store} WHERE id = ?`).bind(id).first();
  return { payload: JSON.parse(row.payload_json), deletedAt: row.deleted_at, revision: row.revision };
}

function update(domain, id, field, value) {
  return `${domain.repository}.update(${JSON.stringify(id)}, ${JSON.stringify({ [field]: value })})`;
}

async function checkSyncCase({ hub, peer, domain, legacyClient, legacyWorker, operation }) {
  const { id } = await peer.evaluate(domain.createItem(`${domain.name} ${operation}`));
  await peer.evaluate(domain.run);
  const initial = await peer.evaluate(domain.snapshot);
  assert.ok(!initial.outbox.some(item => item.entityId === id), 'ordinary operations still work for this client version');
  assert.equal(await peer.evaluate('controls.pushCapabilities.at(-1)'), legacyClient ? null : 'merge-evidence-v1');
  await hub.evaluate(domain.run);

  const finalChange = operation === 'delete'
    ? `${domain.repository}.remove(${JSON.stringify(id)})`
    : operation === 'overlap' ? update(domain, id, domain.sharedField, domain.localValue)
      : update(domain, id, domain.nextField, domain.nextValue);
  await peer.evaluate(`(async () => {
    controls.offline = true;
    await ${update(domain, id, domain.firstField, domain.firstValue)};
    await ${finalChange};
    await ${domain.run};
    controls.offline = false;
  })()`);
  const offlineStatus = domain.name === 'Calendar' && initial.conflicts.length ? 'attention' : 'waiting';
  assert.equal((await peer.evaluate(domain.view)).status, offlineStatus);
  const getItemWork = async () => pendingWork(await peer.evaluate(domain.snapshot)).filter(item => item.entityId === id);
  const original = await getItemWork();
  assert.equal(original.length, 2);
  await hub.evaluate(`${update(domain, id, domain.sharedField, domain.remoteValue)}.then(()=>${domain.run})`);
  const before = await readServerItem(hub, domain, id);
  assert.equal(before.revision, 2);
  assert.equal(before.payload[domain.sharedField], domain.remoteValue);

  if (legacyClient && !legacyWorker && operation === 'overlap') {
    await reloadWithCachedClient(peer, '/fixture-baseline.js');
    assert.deepEqual(await getItemWork(), original, 'old service-worker-controlled reload retains offline outbox');
  }

  const rec = async () => peer.evaluate(`(async()=>{controls.loseReply=true;await ${domain.run};return controls.pushResponses.at(-1);})()`);
  const firstReply = await rec();
  assert.equal((await peer.evaluate(domain.view)).status, offlineStatus);
  assert.deepEqual(await getItemWork(), original, 'lost reply keeps both commands and their original identities');
  await peer.evaluate(domain.run);
  const tries = (await peer.evaluate('controls.pushes')).map(request => request.mutations[0]);
  assert.deepEqual(tries.filter(item => item.mutationId === original[0].mutationId).map(item => item.baseRevision),
    (legacyClient && !legacyWorker && operation === 'overlap' ? [1, 1] : [1, 1, 1]), 'retries keep the original command and base');

  if (legacyClient && !legacyWorker) {
    const upgrade = { status: 409, body: { error: { code: 'CLIENT_UPGRADE_REQUIRED' } } };
    assert.equal(firstReply.status, upgrade.status);
    assert.equal(firstReply.body.error.code, upgrade.body.error.code);
    assert.deepEqual(await readServerItem(hub, domain, id), before);
    assert.deepEqual(await getItemWork(), original);
    assert.ok(!(await peer.evaluate(domain.snapshot)).conflicts.some(item => item.entityId === id));
    for (const item of original) {
      const applied = await hub.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?').bind(item.mutationId).first();
      assert.equal(applied.n, 0, 'gate did not consume mutation identity');
    }
    await peer.loadClient(false);
    assert.deepEqual(await getItemWork(), original, 'upgrading preserves queued IndexedDB work');
    await peer.evaluate(domain.run);
  } else {
    assert.equal(firstReply.body.results[0].status, 'MERGED');
    const firstReplies = (await peer.evaluate('controls.pushResponses')).flatMap(response => response.body?.results ?? [])
      .filter(result => result.mutationId === original[0].mutationId);
    assert.equal(firstReplies[1].status, 'REPLAYED');
    assert.deepEqual(firstReplies[1].result.merge, firstReplies[0].merge);
  }

  const final = await readServerItem(hub, domain, id);
  const state = await peer.evaluate(domain.snapshot);
  const conflict = state.conflicts.find(item => item.entityId === id);
  const legacyControl = legacyClient && legacyWorker;
  const allowed = legacyControl || (!legacyWorker && operation === 'disjoint');
  assert.equal(final.payload[domain.firstField], domain.firstValue);
  assert.equal(final.payload[domain.sharedField], legacyControl && operation === 'overlap' ? domain.localValue : domain.remoteValue);
  assert.equal(!!final.deletedAt, legacyControl && operation === 'delete');
  assert.equal(final.revision, allowed ? 4 : 3);
  assert.equal((await hub.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id = ?')
    .bind(original[0].mutationId).first()).n, 1);
  if (allowed) {
    if (operation === 'disjoint') assert.equal(final.payload[domain.nextField], domain.nextValue);
    assert.equal(conflict, undefined);
    assert.deepEqual(await getItemWork(), []);
  } else {
    assert.equal(conflict?.result.code, legacyWorker ? 'MERGE_UNCERTAIN' : operation === 'delete' ? 'STALE_DELETE' : 'FIELD_OVERLAP');
    assert.equal(conflict.remoteRecord.payload[domain.sharedField], domain.remoteValue);
    if (operation === 'overlap') assert.equal(conflict.localRecord.payload[domain.sharedField], domain.localValue);
    assert.deepEqual(await getItemWork(), [original[1]]);
    assert.equal(state[domain.records].find(item => item.id === id).syncStatus, 'conflict');
  }
  if (legacyClient && !legacyWorker) await peer.loadClient(true);
}

async function checkCachedTakeover(hub, peer, domain) {
  const { id } = await peer.evaluate(domain.createItem(`${domain.name} legacy takeover`));
  await peer.evaluate(domain.run);
  await hub.evaluate(domain.run);
  await peer.evaluate(`(async()=> {
    await ${update(domain, id, domain.firstField, domain.firstValue)};
    await ${update(domain, id, domain.nextField, domain.nextValue)};
    await ${update(domain, id, domain.sharedField, domain.localValue)};
  })()`);
  await hub.evaluate(`${update(domain, id, domain.sharedField, domain.remoteValue)}.then(()=>${domain.run})`);
  const itemWork = async () => pendingWork(await peer.evaluate(domain.snapshot)).filter(item => item.entityId === id);
  const original = await itemWork();
  assert.equal(original.length, 3);
  await peer.evaluate(`controls.holdPushNumber=controls.pushes.length+2; window.heldRun=${domain.run}; true`);
  await peer.waitFor('controls.pushHeld === true');
  const pending = await itemWork();
  assert.deepEqual(pending.map(item => item.mutationId), original.slice(1).map(item => item.mutationId));
  assert.equal(pending[0].baseRevision, 3);
  assert.ok(pending[0].mergeEvidence);
  const merged = await readServerItem(hub, domain, id);
  assert.equal(merged.revision, 3);
  assert.equal(merged.payload[domain.sharedField], domain.remoteValue);

  await peer.loadClient(true);
  await reloadWithCachedClient(peer, '/fixture-baseline.js');
  assert.deepEqual(await itemWork(), pending, 'a cached old client inherits the rebased pending work');
  await peer.evaluate(domain.run);
  const denied = await peer.evaluate('controls.pushResponses.at(-1)');
  assert.equal(await peer.evaluate('controls.pushCapabilities.at(-1)'), null);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error.code, 'CLIENT_UPGRADE_REQUIRED');
  assert.deepEqual(await readServerItem(hub, domain, id), merged);
  assert.deepEqual(await itemWork(), pending);

  await peer.loadClient(false);
  await peer.evaluate(domain.run);
  const current = await readServerItem(hub, domain, id);
  assert.equal(current.revision, 4);
  assert.equal(current.payload[domain.nextField], domain.nextValue);
  assert.equal(current.payload[domain.sharedField], domain.remoteValue);
  assert.deepEqual((await itemWork()).map(item => item.mutationId), [original[2].mutationId]);
  const conflict = (await peer.evaluate(domain.snapshot)).conflicts.find(item => item.entityId === id);
  assert.equal(conflict?.result.code, 'FIELD_OVERLAP');
  assert.equal(conflict.localRecord.payload[domain.sharedField], domain.localValue);
  assert.equal(conflict.remoteRecord.payload[domain.sharedField], domain.remoteValue);
}

test('exact baseline and current sync clients and workers interoperate in all four combinations', { timeout: 180000 }, async t => {
  await withBaselineCheckout(async baseline => {
    for (const legacyWorker of [true, false]) {
      const hub = await shoppingHarness({ backend: true, ...(legacyWorker ? { backendRoot: baseline } : {}) });
      try {
        const owner = await installOwner(hub);
        for (const legacyClient of [true, false]) {
          const name = `${legacyClient ? 'old' : 'current'} client / ${legacyWorker ? 'old' : 'current'} worker`;
          await t.test(name, async t => {
            const peer = await shoppingHarness({ sharedBackend: hub, ...(legacyClient ? { clientRoot: baseline } : {}) });
            try {
              await joinDevice(hub, peer, owner);
              for (const domain of domains) {
                for (const operation of ['overlap', 'disjoint', 'delete']) {
                  await t.test(`${domain.name} ${operation}`, () => checkSyncCase({ hub, peer, domain, legacyClient, legacyWorker, operation }));
                }
                if (!legacyClient && !legacyWorker) {
                  await t.test(`${domain.name} cached old bundle cannot discard a capable client's carried evidence`,
                    () => checkCachedTakeover(hub, peer, domain));
                }
              }
            } finally {
              await peer.close();
            }
          });
        }
      } finally {
        await hub.close();
      }
    }
  });
});
