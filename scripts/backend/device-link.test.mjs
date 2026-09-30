import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import * as createHousehold from '../../functions/api/auth/create-household.js';
import * as deviceLink from '../../functions/api/auth/device-link.js';
import * as claimDevice from '../../functions/api/auth/claim-device.js';
import * as session from '../../functions/api/auth/session.js';

function migrationStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index++) {
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

const digest = (kind, secret) => createHash('sha256').update(`majandus:v1:${kind}:${secret}`).digest('hex');
const request = (path, input, token) => new Request(`https://example.test/api/auth/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(input),
});
const issue = (db, owner) => deviceLink.onRequestPost({ env: { DB: db }, request: request('device-link', {}, owner.deviceSession.token) });
const claim = (db, linkToken, deviceName = 'Device B') => claimDevice.onRequestPost({ env: { DB: db },
  request: request('claim-device', { linkToken, deviceName }) });
const counts = async db => Object.fromEntries(await Promise.all(['households', 'users', 'device_sessions', 'one_time_tokens']
  .map(async table => [table, (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n])));

async function withDb(run) {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    for (const sql of migrationStatements(readFileSync(new URL('../../migrations/0001_majandus_backend.sql', import.meta.url), 'utf8'))) await db.exec(sql);
    const response = await createHousehold.onRequestPost({ env: { DB: db }, request: request('create-household', {
      userName: 'Link owner', householdName: 'Existing household', deviceName: 'Device A',
    }) });
    assert.equal(response.status, 201);
    await run(db, await response.json());
  } finally { await mf.dispose(); }
}

test('Device A issues a hash-only short-lived DEVICE_LINK; B receives a distinct authenticated session for the same user', async () => {
  await withDb(async (db, owner) => {
    const response = await issue(db, owner);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const link = await response.json();
    assert.deepEqual(Object.keys(link).sort(), ['expiresAt', 'linkToken']);
    assert.match(link.linkToken, /^m1l_[A-Za-z0-9_-]{43}$/);
    const row = await db.prepare('SELECT * FROM one_time_tokens').first();
    assert.match(row.id, /^ott_/);
    assert.equal(row.purpose, 'DEVICE_LINK');
    assert.equal(row.subject_user_id, owner.account.userId);
    assert.equal(row.household_id, owner.household.id);
    assert.equal(row.token_hash, digest('device-link', link.linkToken));
    assert.equal(JSON.stringify(row).includes(link.linkToken), false);
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 10 * 60 * 1000);
    assert.equal(row.expires_at, link.expiresAt);
    const claimed = await claim(db, link.linkToken, '  Device B  ');
    assert.equal(claimed.status, 201);
    const b = await claimed.json();
    assert.deepEqual(b.account, owner.account);
    assert.deepEqual(b.household, owner.household);
    assert.notEqual(b.deviceSession.id, owner.deviceSession.id);
    assert.notEqual(b.deviceSession.token, owner.deviceSession.token);
    assert.equal(b.deviceSession.deviceName, 'Device B');
    assert.deepEqual(Object.keys(b).sort(), ['account', 'deviceSession', 'household']);
    const authenticated = await session.onRequestGet({ env: { DB: db }, request: new Request('https://example.test/api/auth/session', {
      headers: { Authorization: `Bearer ${b.deviceSession.token}` },
    }) });
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.json()).account.userId, owner.account.userId);
    assert.deepEqual(await counts(db), { households: 1, users: 1, device_sessions: 2, one_time_tokens: 1 });
    const saved = await db.prepare('SELECT * FROM device_sessions WHERE id = ?').bind(b.deviceSession.id).first();
    assert.equal(saved.token_hash, digest('device-session', b.deviceSession.token));
    assert.equal(JSON.stringify(saved).includes(b.deviceSession.token), false);
  });
});

test('concurrent claims have one winner; reused, wrong, expired, revoked and wrong-purpose links fail without new records', async () => {
  await withDb(async (db, owner) => {
    const link = await (await issue(db, owner)).json();
    const responses = await Promise.all([claim(db, link.linkToken, 'B'), claim(db, link.linkToken, 'C')]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
    const expected = { error: { code: 'INVALID_DEVICE_LINK', message: 'Device link is invalid or expired.' } };
    const reject = async token => {
      const response = await claim(db, token);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), expected);
    };
    await reject(link.linkToken);
    await reject(`m1l_${'Z'.repeat(43)}`);
    const expired = await (await issue(db, owner)).json();
    await db.prepare('UPDATE one_time_tokens SET created_at = ?, expires_at = ? WHERE token_hash = ?')
      .bind('2020-01-01T00:00:00.000Z', '2020-01-01T00:10:00.000Z', digest('device-link', expired.linkToken)).run();
    await reject(expired.linkToken);
    const revoked = await (await issue(db, owner)).json();
    await db.prepare('UPDATE one_time_tokens SET revoked_at = created_at WHERE token_hash = ?').bind(digest('device-link', revoked.linkToken)).run();
    await reject(revoked.linkToken);
    const wrongPurpose = await (await issue(db, owner)).json();
    await db.prepare("UPDATE one_time_tokens SET purpose = 'MEMBER_RECOVERY' WHERE token_hash = ?").bind(digest('device-link', wrongPurpose.linkToken)).run();
    await reject(wrongPurpose.linkToken);
    assert.equal((await counts(db)).device_sessions, 2);
  });
});

test('session insertion failure rolls back token consumption; the same link can then be claimed once', async () => {
  await withDb(async (db, owner) => {
    const link = await (await issue(db, owner)).json();
    await db.exec("CREATE TRIGGER reject_test_session BEFORE INSERT ON device_sessions BEGIN SELECT RAISE(ABORT, 'test insert failure'); END;");
    assert.equal((await claim(db, link.linkToken)).status, 500);
    assert.equal((await db.prepare('SELECT consumed_at FROM one_time_tokens').first()).consumed_at, null);
    assert.equal((await counts(db)).device_sessions, 1);
    await db.exec('DROP TRIGGER reject_test_session;');
    assert.equal((await claim(db, link.linkToken)).status, 201);
    assert.equal((await claim(db, link.linkToken)).status, 400);
  });
});

test('an active MEMBER can link a second device to themselves without becoming the household OWNER', async () => {
  await withDb(async (db, owner) => {
    const stamp = new Date().toISOString();
    const token = `m1s_${'M'.repeat(43)}`;
    await db.prepare("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, 'Member', 'MEMBER', ?)")
      .bind('usr_member', owner.household.id, stamp).run();
    await db.prepare("INSERT INTO device_sessions (id,user_id,token_hash,device_name,created_at,last_seen_at) VALUES ('ses_member','usr_member',?,'Member A',?,?)")
      .bind(digest('device-session', token), stamp, stamp).run();
    const link = await (await issue(db, { deviceSession: { token } })).json();
    const response = await claim(db, link.linkToken);
    assert.equal(response.status, 201);
    const joined = await response.json();
    assert.equal(joined.account.userId, 'usr_member');
    assert.equal(joined.account.role, 'MEMBER');
    assert.equal(joined.household.id, owner.household.id);
    assert.equal((await counts(db)).users, 2);
    const revokedUserLink = await (await issue(db, { deviceSession: { token } })).json();
    await db.prepare("UPDATE users SET revoked_at = created_at WHERE id = 'usr_member'").run();
    assert.equal((await claim(db, revokedUserLink.linkToken)).status, 400);
    assert.equal((await counts(db)).device_sessions, 3);
  });
});

test('link routes require their exact methods/auth and reject identity injection or malformed input safely', async () => {
  for (const endpoint of [deviceLink, claimDevice]) {
    assert.deepEqual(Object.keys(endpoint).sort(), ['onRequest', 'onRequestPost']);
    const wrongMethod = endpoint.onRequest({ request: new Request('https://example.test/', { method: 'GET' }) });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('Allow'), 'POST');
  }
  await withDb(async (db, owner) => {
    assert.equal((await deviceLink.onRequestPost({ env: { DB: db }, request: request('device-link', {}) })).status, 401);
    assert.equal((await claimDevice.onRequestPost({ env: {}, request: request('claim-device', {}) })).status, 500);
    const link = await (await issue(db, owner)).json();
    for (const input of [
      { linkToken: link.linkToken, deviceName: 'B', userId: 'usr_other' },
      { linkToken: link.linkToken, deviceName: 'B', householdId: 'hld_other' },
      { linkToken: link.linkToken, deviceName: 'B', role: 'OWNER' },
      { linkToken: 'not-a-link', deviceName: 'B' },
      { linkToken: link.linkToken, deviceName: ' ' },
      { linkToken: link.linkToken, deviceName: 'x'.repeat(121) },
    ]) {
      const response = await claimDevice.onRequestPost({ env: { DB: db }, request: request('claim-device', input) });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } });
    }
    assert.equal((await counts(db)).device_sessions, 1);
    assert.equal((await claim(db, link.linkToken)).status, 201);
  });
});
