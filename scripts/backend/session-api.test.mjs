import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import * as sessionEndpoint from "../../functions/api/auth/session.js";
import * as repository from "../../functions/_lib/db.js";

// Direct handler contract only. Actual Cloudflare Pages file/method dispatch is mandatory Phase 9 work.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const CREATED_AT = "2026-09-22T00:00:00.000Z";
const UPDATED_AT = "2026-09-22T00:05:00.000Z";
const REVOKED_AT = "2026-09-22T01:00:00.000Z";

function migrationStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== ";") continue;

    const statement = sql.slice(start, index + 1);
    const isTrigger = /^\s*CREATE\s+TRIGGER\b/i.test(statement);
    if (isTrigger && !/\bEND\s*;\s*$/i.test(statement)) continue;
    if (statement.trim()) statements.push(statement.replace(/\s+/g, " ").trim());
    start = index + 1;
  }
  assert.equal(sql.slice(start).trim(), "", "migration must end with a semicolon");
  return statements;
}

async function withFreshDb(callback) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: ["DB"],
  });
  const db = await miniflare.getD1Database("DB");
  try {
    for (const statement of migrationStatements(migrationSql)) await db.exec(statement);
    return await callback(db);
  } finally {
    await miniflare.dispose();
  }
}

function tokenFor(letter) {
  return `m1s_${letter.repeat(43)}`;
}

function tokenHash(token) {
  return createHash("sha256")
    .update(`majandus:v1:device-session:${token}`, "utf8")
    .digest("hex");
}

async function seedOwner(db, suffix) {
  const identity = {
    householdId: `hld_${suffix}`,
    householdName: `Household ${suffix}`,
    householdAddress: `Address ${suffix}`,
    userId: `usr_${suffix}`,
    displayName: `Display ${suffix}`,
    role: "OWNER",
    sessionId: `ses_${suffix}`,
    deviceName: `Device ${suffix}`,
    token: tokenFor(suffix === "a" ? "A" : "B"),
  };
  await repository.insertHouseholdCreation(db, {
    householdId: identity.householdId,
    householdName: identity.householdName,
    householdAddress: identity.householdAddress,
    ownerUserId: identity.userId,
    revision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    userName: identity.displayName,
    role: "OWNER",
    sessionId: identity.sessionId,
    tokenHash: tokenHash(identity.token),
    deviceName: identity.deviceName,
    lastSeenAt: UPDATED_AT,
    recoveryHash: createHash("sha256").update(`majandus:test-recovery:${suffix}`, "utf8").digest("hex"),
  });
  return identity;
}

async function seedMember(db, householdId, suffix) {
  const member = {
    userId: `usr_${suffix}`,
    sessionId: `ses_${suffix}`,
    displayName: `Display ${suffix}`,
    deviceName: `Device ${suffix}`,
    token: tokenFor("M"),
  };
  await db.prepare("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(member.userId, householdId, member.displayName, "MEMBER", CREATED_AT)
    .run();
  await db.prepare("INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(member.sessionId, member.userId, tokenHash(member.token), member.deviceName, CREATED_AT, UPDATED_AT)
    .run();
  return { ...member, householdId };
}

function expectedMetadata(identity, role = "OWNER") {
  return {
    session: {
      id: identity.sessionId,
      deviceName: identity.deviceName,
      createdAt: CREATED_AT,
      lastSeenAt: UPDATED_AT,
    },
    account: { userId: identity.userId, displayName: identity.displayName, role },
    household: {
      id: identity.householdId,
      name: identity.householdName,
      address: identity.householdAddress,
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
  };
}

function bearerRequest(token, options = {}) {
  return new Request("https://example.test/api/auth/session", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
}

async function responseSnapshot(response) {
  const copy = response.clone();
  return {
    status: response.status,
    headers: [...response.headers].sort(([left], [right]) => left.localeCompare(right)),
    body: await copy.text(),
  };
}

function expectedHeaders(extra = {}) {
  return Object.entries({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extra,
  }).sort(([left], [right]) => left.localeCompare(right));
}

async function assertCanonicalError(response, { status, code, message, headers = {} }) {
  const snapshot = await responseSnapshot(response);
  assert.equal(snapshot.status, status);
  assert.deepEqual(snapshot.headers, expectedHeaders(headers));
  assert.equal(snapshot.body, JSON.stringify({ error: { code, message } }));
}

async function assertCanonicalUnauthorized(response) {
  await assertCanonicalError(response, {
    status: 401,
    code: "UNAUTHORIZED",
    message: "Authentication required.",
    headers: { "www-authenticate": "Bearer" },
  });
}

async function assertCanonicalInternalError(response) {
  await assertCanonicalError(response, {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error.",
  });
}

function fakeMetadataRow(identity, role = "OWNER") {
  return {
    session_id: identity.sessionId,
    device_name: identity.deviceName,
    session_created_at: CREATED_AT,
    last_seen_at: UPDATED_AT,
    user_id: identity.userId,
    display_name: identity.displayName,
    role,
    household_id: identity.householdId,
    household_name: identity.householdName,
    household_address: identity.householdAddress,
    household_revision: 1,
    household_created_at: CREATED_AT,
    household_updated_at: UPDATED_AT,
    token_hash: "must-not-leak-token-hash",
    recovery_hash: "must-not-leak-recovery-hash",
    owner_member_id: "must-not-leak-owner-marker",
  };
}

function wrappedLookupDb({ identity, metadata = fakeMetadataRow(identity), authError, metadataError } = {}) {
  const calls = [];
  return {
    calls,
    db: {
      prepare(sql) {
        const call = { sql, bindings: [] };
        calls.push(call);
        if (authError && /device_sessions\.token_hash/.test(sql)) throw authError;
        if (metadataError && /device_sessions\.id = \?/.test(sql)) throw metadataError;
        const statement = {
          bind(...bindings) {
            call.bindings = bindings;
            return statement;
          },
          async first() {
            if (/device_sessions\.token_hash/.test(sql)) {
              return {
                session_id: identity.sessionId,
                user_id: identity.userId,
                household_id: identity.householdId,
                role: "OWNER",
              };
            }
            return metadata;
          },
        };
        return statement;
      },
    },
  };
}

test("exports exactly the two Phase 8 direct handlers", () => {
  assert.deepEqual(Object.keys(sessionEndpoint).sort(), ["onRequest", "onRequestGet"]);
});

test("returns exact safe no-store metadata for a valid local-D1 bearer without changing last_seen_at", async () => {
  await withFreshDb(async (db) => {
    const identity = await seedOwner(db, "a");
    const before = await db.prepare("SELECT last_seen_at FROM device_sessions WHERE id = ?")
      .bind(identity.sessionId)
      .first();

    const response = await sessionEndpoint.onRequestGet({ request: bearerRequest(identity.token), env: { DB: db } });

    assert.equal(response.status, 200);
    assert.deepEqual([...response.headers].sort(([left], [right]) => left.localeCompare(right)), expectedHeaders());
    const body = await response.json();
    assert.deepEqual(body, expectedMetadata(identity));
    assert.deepEqual(Object.keys(body).sort(), ["account", "household", "session"]);
    assert.deepEqual(Object.keys(body.session).sort(), ["createdAt", "deviceName", "id", "lastSeenAt"]);
    assert.deepEqual(Object.keys(body.account).sort(), ["displayName", "role", "userId"]);
    assert.deepEqual(Object.keys(body.household).sort(), ["address", "createdAt", "id", "name", "revision", "updatedAt"]);
    const serialized = JSON.stringify(body);
    for (const marker of [identity.token, tokenHash(identity.token), "d".repeat(64), "token_hash", "recovery_hash", "owner_member_id"])
      assert.equal(serialized.includes(marker), false, `response leaked ${marker}`);

    const after = await db.prepare("SELECT last_seen_at FROM device_sessions WHERE id = ?")
      .bind(identity.sessionId)
      .first();
    assert.equal(after.last_seen_at, before.last_seen_at);
  });
});

test("missing, malformed, and unknown bearer credentials return byte-identical canonical 401", async () => {
  await withFreshDb(async (db) => {
    const identity = await seedOwner(db, "a");
    const responses = [
      await sessionEndpoint.onRequestGet({ request: new Request("https://example.test/api/auth/session"), env: { DB: db } }),
      await sessionEndpoint.onRequestGet({ request: bearerRequest("not-a-canonical-token"), env: { DB: db } }),
      await sessionEndpoint.onRequestGet({ request: bearerRequest(tokenFor("Z")), env: { DB: db } }),
    ];
    const snapshots = [];
    for (const response of responses) {
      await assertCanonicalUnauthorized(response);
      snapshots.push(await responseSnapshot(response.clone()));
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
    assert.deepEqual(snapshots[2], snapshots[0]);
    assert.equal(JSON.stringify(snapshots).includes(identity.token), false);
  });
});

test("session revocation follows a successful positive control and rejects the same token", async () => {
  await withFreshDb(async (db) => {
    const identity = await seedOwner(db, "a");
    const request = () => bearerRequest(identity.token);
    const positive = await sessionEndpoint.onRequestGet({ request: request(), env: { DB: db } });
    assert.equal(positive.status, 200);
    assert.deepEqual(await positive.json(), expectedMetadata(identity));

    await db.prepare("UPDATE device_sessions SET revoked_at = ? WHERE id = ?")
      .bind(REVOKED_AT, identity.sessionId)
      .run();
    const revoked = await sessionEndpoint.onRequestGet({ request: request(), env: { DB: db } });
    await assertCanonicalUnauthorized(revoked);
  });
});

test("MEMBER user revocation follows a successful positive control and rejects the same token", async () => {
  await withFreshDb(async (db) => {
    const owner = await seedOwner(db, "a");
    const member = await seedMember(db, owner.householdId, "member");
    const request = () => bearerRequest(member.token);
    const positive = await sessionEndpoint.onRequestGet({ request: request(), env: { DB: db } });
    assert.equal(positive.status, 200);
    assert.deepEqual(await positive.json(), expectedMetadata({ ...member, householdName: owner.householdName, householdAddress: owner.householdAddress }, "MEMBER"));

    await db.prepare("UPDATE users SET revoked_at = ? WHERE id = ?")
      .bind(REVOKED_AT, member.userId)
      .run();
    const revoked = await sessionEndpoint.onRequestGet({ request: request(), env: { DB: db } });
    await assertCanonicalUnauthorized(revoked);
  });
});

test("metadata null after successful authentication returns the ordinary canonical 401", async () => {
  const identity = {
    householdId: "hld_wrapper",
    householdName: "Wrapper household",
    householdAddress: null,
    userId: "usr_wrapper",
    displayName: "Wrapper user",
    sessionId: "ses_wrapper",
    deviceName: "Wrapper device",
    token: tokenFor("W"),
  };
  const positiveLookup = wrappedLookupDb({ identity });
  const positive = await sessionEndpoint.onRequestGet({ request: bearerRequest(identity.token), env: { DB: positiveLookup.db } });
  assert.equal(positive.status, 200);
  assert.deepEqual(await positive.json(), expectedMetadata(identity));
  assert.equal(positiveLookup.calls.length, 2);

  const nullLookup = wrappedLookupDb({ identity, metadata: null });
  const nullResponse = await sessionEndpoint.onRequestGet({ request: bearerRequest(identity.token), env: { DB: nullLookup.db } });
  assert.equal(nullLookup.calls.length, 2, "auth succeeds before the metadata lookup returns null");
  assert.deepEqual(nullLookup.calls[0].bindings, [tokenHash(identity.token)]);
  assert.deepEqual(nullLookup.calls[1].bindings, [identity.sessionId, identity.userId, identity.householdId]);
  await assertCanonicalUnauthorized(nullResponse);

  const ordinary = await sessionEndpoint.onRequestGet({
    request: new Request("https://example.test/api/auth/session"),
    env: { DB: nullLookup.db },
  });
  assert.deepEqual(await responseSnapshot(nullResponse.clone()), await responseSnapshot(ordinary));
});

test("missing DB returns canonical 500 before authentication for absent and well-formed bearer credentials", async () => {
  const responses = [
    await sessionEndpoint.onRequestGet({ request: new Request("https://example.test/api/auth/session"), env: undefined }),
    await sessionEndpoint.onRequestGet({ request: bearerRequest(tokenFor("Q")), env: {} }),
  ];
  for (const response of responses) {
    await assertCanonicalInternalError(response);
    assert.equal((await responseSnapshot(response.clone())).body.includes("Q".repeat(43)), false);
  }
  assert.deepEqual(await responseSnapshot(responses[1].clone()), await responseSnapshot(responses[0]));
});

test("auth-path D1 failure is a canonical 500 without infrastructure details", async () => {
  const identity = {
    householdId: "hld_failure",
    householdName: "Failure household",
    householdAddress: null,
    userId: "usr_failure",
    displayName: "Failure user",
    sessionId: "ses_failure",
    deviceName: "Failure device",
    token: tokenFor("F"),
  };
  const privateError = "AUTH_DATABASE_PRIVATE_DETAIL";
  const wrapped = wrappedLookupDb({ identity, authError: new Error(privateError) });
  const response = await sessionEndpoint.onRequestGet({ request: bearerRequest(identity.token), env: { DB: wrapped.db } });
  await assertCanonicalInternalError(response);
  assert.equal((await responseSnapshot(response.clone())).body.includes(privateError), false);
});

test("metadata D1 failure is a canonical 500, not 401, and exposes no raw error", async () => {
  const identity = {
    householdId: "hld_metadata_failure",
    householdName: "Failure household",
    householdAddress: null,
    userId: "usr_metadata_failure",
    displayName: "Failure user",
    sessionId: "ses_metadata_failure",
    deviceName: "Failure device",
    token: tokenFor("E"),
  };
  const privateError = "METADATA_DATABASE_PRIVATE_DETAIL";
  const wrapped = wrappedLookupDb({ identity, metadataError: new Error(privateError) });
  const response = await sessionEndpoint.onRequestGet({ request: bearerRequest(identity.token), env: { DB: wrapped.db } });
  assert.equal(wrapped.calls.length, 2, "authentication succeeds before metadata failure");
  await assertCanonicalInternalError(response);
  assert.equal((await responseSnapshot(response.clone())).body.includes(privateError), false);
});

test("metadata projection invariant failures return only the canonical 500", async () => {
  const identity = {
    householdId: "hld_projection_failure",
    householdName: "Projection household",
    householdAddress: null,
    userId: "usr_projection_failure",
    displayName: "Projection user",
    sessionId: "ses_projection_failure",
    deviceName: "Projection device",
    token: tokenFor("P"),
  };
  const wrapped = wrappedLookupDb({ identity, metadata: { session: null } });
  const response = await sessionEndpoint.onRequestGet({ request: bearerRequest(identity.token), env: { DB: wrapped.db } });
  await assertCanonicalInternalError(response);
});

test("a real authenticated identity A defeats B's real IDs and role in query and custom headers", async () => {
  await withFreshDb(async (db) => {
    const identityA = await seedOwner(db, "a");
    const identityB = await seedOwner(db, "b");
    const request = new Request(
      `https://example.test/api/auth/session?sessionId=${identityB.sessionId}&userId=${identityB.userId}&householdId=${identityB.householdId}&role=${identityB.role}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${identityA.token}`,
          "X-Session-Id": identityB.sessionId,
          "X-User-Id": identityB.userId,
          "X-Household-Id": identityB.householdId,
          "X-Role": identityB.role,
        },
      },
    );
    const response = await sessionEndpoint.onRequestGet({ request, env: { DB: db } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, expectedMetadata(identityA));
    assert.notDeepEqual(body, expectedMetadata(identityB));
    const serialized = JSON.stringify(body);
    for (const marker of [identityB.token, identityB.sessionId, identityB.userId, identityB.householdId, "token_hash", "recovery_hash"])
      assert.equal(serialized.includes(marker), false, `response leaked ${marker}`);
  });
});

test("generic onRequest directly returns canonical 405 for POST, HEAD, OPTIONS, PUT, and DELETE", async () => {
  for (const method of ["POST", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
    const request = new Request("https://example.test/api/auth/session", { method });
    const response = await sessionEndpoint.onRequest({ request });
    await assertCanonicalError(response, {
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
      headers: { allow: "GET" },
    });
  }
});
