import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import * as authentication from "../../functions/_lib/auth.js";
import * as repository from "../../functions/_lib/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const TOKEN = `m1s_${"A".repeat(43)}`;

function requestWithAuthorization(value, options = {}) {
  const headers = new Headers(options.headers);
  if (value !== undefined) headers.set("Authorization", value);
  const init = { headers };
  if (options.body !== undefined) {
    init.method = "POST";
    init.body = JSON.stringify(options.body);
    headers.set("Content-Type", "application/json");
  }
  return new Request(`https://example.test/session${options.query ?? ""}`, init);
}

function recordingDb({ row = null, error, rowForHash } = {}) {
  const calls = [];
  return {
    calls,
    db: {
      prepare(sql) {
        if (error) throw error;
        const call = { sql, bindings: [] };
        calls.push(call);
        const statement = {
          bind(...values) {
            call.bindings = values;
            return statement;
          },
          async first() {
            if (error) throw error;
            return rowForHash ? rowForHash(call.bindings[0]) : row;
          },
        };
        return statement;
      },
    },
  };
}

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
    if (/^\s*CREATE\s+TRIGGER\b/i.test(statement) && !/\bEND\s*;\s*$/i.test(statement)) continue;
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

async function seedActiveSession(db, { sessionId = "ses_local", userId = "usr_local", token = TOKEN } = {}) {
  const tokenHash = createHash("sha256")
    .update(`majandus:v1:device-session:${token}`, "utf8")
    .digest("hex");
  await repository.insertHouseholdCreation(db, {
    householdId: "hld_local",
    householdName: "Local household",
    householdAddress: null,
    ownerUserId: userId,
    revision: 1,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    userName: "Local owner",
    role: "OWNER",
    sessionId,
    tokenHash,
    deviceName: "Local device",
    lastSeenAt: "2026-09-22T00:00:00.000Z",
    recoveryHash: "b".repeat(64),
  });
}

test("exports only the locked Phase 5 authentication interface", async () => {
  assert.deepEqual(Object.keys(authentication).sort(), [
    "authenticateDevice",
    "requireAuthenticated",
  ]);
});

test("authenticates a valid bearer into an exact repository-selected trusted context", async () => {
  const row = {
    session_id: "ses_repository",
    user_id: "usr_repository",
    household_id: "hld_repository",
    role: "OWNER",
    internal_note: "must not leak",
  };
  const { db, calls } = recordingDb({ row });

  const request = requestWithAuthorization(`Bearer ${TOKEN}`);
  const context = await authentication.authenticateDevice(request, db);

  assert.deepEqual(context, {
    sessionId: "ses_repository",
    userId: "usr_repository",
    householdId: "hld_repository",
    role: "OWNER",
  });
  assert.deepEqual(calls[0].bindings, [
    createHash("sha256").update(`majandus:v1:device-session:${TOKEN}`, "utf8").digest("hex"),
  ]);
  assert.equal(calls[0].bindings.includes(TOKEN), false);
  assert.equal(calls[0].bindings.includes(request), false);
  assert.equal(calls[0].bindings.includes(context), false);
});

test("wraps successful authentication in the locked requireAuthenticated envelope", async () => {
  const { db } = recordingDb({
    row: {
      session_id: "ses_required",
      user_id: "usr_required",
      household_id: "hld_required",
      role: "MEMBER",
    },
  });

  assert.deepEqual(
    await authentication.requireAuthenticated(requestWithAuthorization(`Bearer ${TOKEN}`), db),
    {
      ok: true,
      context: {
        sessionId: "ses_required",
        userId: "usr_required",
        householdId: "hld_required",
        role: "MEMBER",
      },
    },
  );
});

test("maps missing, malformed, and unknown credentials to identical canonical 401 responses", async () => {
  const requests = [
    requestWithAuthorization(undefined),
    requestWithAuthorization(`Bearer m1r_${"A".repeat(43)}`),
    requestWithAuthorization(`Bearer m1s_${"B".repeat(43)}`),
  ];
  const responses = [];

  for (const request of requests) {
    const { db } = recordingDb();
    const result = await authentication.requireAuthenticated(request, db);
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get("WWW-Authenticate"), "Bearer");
    assert.equal(result.response.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.equal(result.response.headers.get("Cache-Control"), "no-store");
    const body = await result.response.text();
    assert.equal(body.includes(TOKEN), false);
    assert.equal(body.includes(createHash("sha256").update(`majandus:v1:device-session:${TOKEN}`, "utf8").digest("hex")), false);
    const header = request.headers.get("Authorization");
    if (header !== null) assert.equal(body.includes(header), false);
    responses.push(body);
  }

  assert.deepEqual(responses, [
    '{"error":{"code":"UNAUTHORIZED","message":"Authentication required."}}',
    '{"error":{"code":"UNAUTHORIZED","message":"Authentication required."}}',
    '{"error":{"code":"UNAUTHORIZED","message":"Authentication required."}}',
  ]);
});

test("rejects invalid complete Authorization values before a repository lookup", async () => {
  const invalidValues = [
    undefined,
    "",
    "Basic credential",
    "Bearer ",
    `Bearer  ${TOKEN}`,
    `Bearer\t${TOKEN}`,
    `Bearer ${TOKEN}, Bearer ${TOKEN}`,
    `Bearer m1r_${"A".repeat(43)}`,
    `Bearer m1s_${"A".repeat(42)}`,
    `Bearer m1s_${"A".repeat(44)}`,
    `Bearer m1s_${"A".repeat(42)}+`,
    `Bearer m1s_${"A".repeat(42)}/`,
    `Bearer m1s_${"A".repeat(42)}=`,
    `Bearer m1s_${"A".repeat(20)} ${"A".repeat(22)}`,
  ];

  for (const value of invalidValues) {
    const { db, calls } = recordingDb({ error: new Error("repository must not be called") });
    assert.equal(await authentication.authenticateDevice(requestWithAuthorization(value), db), null);
    assert.equal(calls.length, 0);
  }
});

test("accepts Bearer scheme casing without folding the device token", async () => {
  const row = {
    session_id: "ses_case",
    user_id: "usr_case",
    household_id: "hld_case",
    role: "MEMBER",
  };
  const expectedHash = createHash("sha256")
    .update(`majandus:v1:device-session:${TOKEN}`, "utf8")
    .digest("hex");
  const tokenWithDifferentCase = `m1s_a${"A".repeat(42)}`;

  for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
    const { db } = recordingDb({ rowForHash: (hash) => (hash === expectedHash ? row : null) });
    assert.deepEqual(await authentication.authenticateDevice(requestWithAuthorization(`${scheme} ${TOKEN}`), db), {
      sessionId: "ses_case",
      userId: "usr_case",
      householdId: "hld_case",
      role: "MEMBER",
    });
  }

  const { db } = recordingDb({ rowForHash: (hash) => (hash === expectedHash ? row : null) });
  assert.equal(
    await authentication.authenticateDevice(requestWithAuthorization(`Bearer ${tokenWithDifferentCase}`), db),
    null,
  );
});

test("propagates repository failures and rejects malformed non-null trusted rows without leakage", async () => {
  const infrastructureError = new Error("D1 unavailable");
  const unavailable = recordingDb({ error: infrastructureError });
  await assert.rejects(
    () => authentication.authenticateDevice(requestWithAuthorization(`Bearer ${TOKEN}`), unavailable.db),
    (error) => error === infrastructureError,
  );

  const malformed = recordingDb({
    row: {
      session_id: "ses_secret",
      user_id: "usr_secret",
      household_id: "hld_secret",
      role: "",
    },
  });
  const malformedRequest = requestWithAuthorization(`Bearer ${TOKEN}`);
  const tokenHash = createHash("sha256")
    .update(`majandus:v1:device-session:${TOKEN}`, "utf8")
    .digest("hex");
  await assert.rejects(
    () => authentication.authenticateDevice(malformedRequest, malformed.db),
    (error) => {
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes(tokenHash), false);
      assert.equal(error.message.includes(malformedRequest.headers.get("Authorization")), false);
      assert.equal(error.message.includes("ses_secret"), false);
      return error.message === "Invalid trusted authentication context";
    },
  );
});

test("uses local D1 active-session state for unknown, revoked-session, and revoked-user failures", async () => {
  await withFreshDb(async (db) => {
    await seedActiveSession(db);
    assert.equal(
      await authentication.authenticateDevice(requestWithAuthorization(`Bearer m1s_${"B".repeat(43)}`), db),
      null,
    );
    assert.deepEqual(await authentication.authenticateDevice(requestWithAuthorization(`Bearer ${TOKEN}`), db), {
      sessionId: "ses_local",
      userId: "usr_local",
      householdId: "hld_local",
      role: "OWNER",
    });
    await db.prepare("UPDATE device_sessions SET revoked_at = ? WHERE id = ?")
      .bind("2026-09-22T01:00:00.000Z", "ses_local")
      .run();
    assert.equal(await authentication.authenticateDevice(requestWithAuthorization(`Bearer ${TOKEN}`), db), null);
  });

  await withFreshDb(async (db) => {
    await seedActiveSession(db);
    const memberToken = `m1s_${"C".repeat(43)}`;
    const memberTokenHash = createHash("sha256")
      .update(`majandus:v1:device-session:${memberToken}`, "utf8")
      .digest("hex");
    await db.prepare("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("usr_member", "hld_local", "Local member", "MEMBER", "2026-09-22T00:00:00.000Z")
      .run();
    await db.prepare("INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("ses_member", "usr_member", memberTokenHash, "Member device", "2026-09-22T00:00:00.000Z", "2026-09-22T00:00:00.000Z")
      .run();
    assert.deepEqual(await authentication.authenticateDevice(requestWithAuthorization(`Bearer ${memberToken}`), db), {
      sessionId: "ses_member",
      userId: "usr_member",
      householdId: "hld_local",
      role: "MEMBER",
    });
    await db.prepare("UPDATE users SET revoked_at = ? WHERE id = ?")
      .bind("2026-09-22T01:00:00.000Z", "usr_member")
      .run();
    assert.equal(await authentication.authenticateDevice(requestWithAuthorization(`Bearer ${memberToken}`), db), null);
  });
});

test("uses repository identity despite conflicting client-controlled identity input", async () => {
  const { db } = recordingDb({
    row: {
      session_id: "ses_repository_only",
      user_id: "usr_repository_only",
      household_id: "hld_repository_only",
      role: "OWNER",
    },
  });
  const request = requestWithAuthorization(`Bearer ${TOKEN}`, {
    query: "?sessionId=ses_client&userId=usr_client&householdId=hld_client&role=MEMBER",
    headers: {
      "X-Session-Id": "ses_client",
      "X-User-Id": "usr_client",
      "X-Household-Id": "hld_client",
      "X-Role": "MEMBER",
    },
    body: {
      sessionId: "ses_client",
      userId: "usr_client",
      householdId: "hld_client",
      role: "MEMBER",
    },
  });

  assert.deepEqual(await request.clone().json(), {
    sessionId: "ses_client",
    userId: "usr_client",
    householdId: "hld_client",
    role: "MEMBER",
  });

  const context = await authentication.authenticateDevice(request, db);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual(context, {
    sessionId: "ses_repository_only",
    userId: "usr_repository_only",
    householdId: "hld_repository_only",
    role: "OWNER",
  });
});

test("requireAuthenticated propagates infrastructure and missing-binding failures", async () => {
  const infrastructureError = new Error("D1 unavailable");
  const unavailable = recordingDb({ error: infrastructureError });
  await assert.rejects(
    () => authentication.requireAuthenticated(requestWithAuthorization(`Bearer ${TOKEN}`), unavailable.db),
    (error) => error === infrastructureError,
  );
  await assert.rejects(
    () => authentication.requireAuthenticated(requestWithAuthorization(`Bearer ${TOKEN}`), undefined),
    TypeError,
  );
});
