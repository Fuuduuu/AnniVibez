import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import * as repository from "../../functions/_lib/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const TOKEN_HASH = "a".repeat(64);
const RECOVERY_HASH = "b".repeat(64);
const CREATED_AT = "2026-09-21T00:00:00.000Z";
const UPDATED_AT = "2026-09-21T00:01:00.000Z";

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

async function all(db, sql, ...values) {
  const statement = db.prepare(sql);
  const result = values.length === 0 ? await statement.all() : await statement.bind(...values).all();
  return result.results;
}

async function run(db, sql, ...values) {
  const statement = db.prepare(sql);
  return values.length === 0 ? statement.run() : statement.bind(...values).run();
}

function creationRecord(overrides = {}) {
  return {
    householdId: "hld_repo",
    householdName: "O'Connor kodu; DROP TABLE users; --",
    householdAddress: "Õnne 1",
    ownerUserId: "usr_owner",
    revision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    userName: "Märt 'Owner'",
    role: "OWNER",
    sessionId: "ses_initial",
    tokenHash: TOKEN_HASH,
    deviceName: "Telefon 'A'",
    lastSeenAt: UPDATED_AT,
    recoveryHash: RECOVERY_HASH,
    ...overrides,
  };
}

function recordingDb({ first = null, firstError, batchError } = {}) {
  const calls = { prepare: [], batch: [] };
  return {
    calls,
    db: {
      prepare(sql) {
        const call = { sql, bindings: [] };
        calls.prepare.push(call);
        if (firstError) throw firstError;
        const statement = {
          async first() {
            if (firstError) throw firstError;
            return first;
          },
          bind(...values) {
            call.bindings = values;
            return statement;
          },
        };
        return statement;
      },
      async batch(statements) {
        calls.batch.push(statements);
        if (batchError) throw batchError;
        return [];
      },
    },
  };
}

test("exports only the three narrow Phase 4 repository operations", () => {
  assert.deepEqual(Object.keys(repository).sort(), [
    "findActiveSessionByHash",
    "findSessionMetadataByTrustedContext",
    "insertHouseholdCreation",
  ]);
});

test("rejects noncanonical active-session hashes without preparing a D1 query", async () => {
  for (const invalid of ["A".repeat(64), "a".repeat(63), "g".repeat(64), null]) {
    const { db, calls } = recordingDb();
    await assert.rejects(() => repository.findActiveSessionByHash(db, invalid), RangeError);
    assert.equal(calls.prepare.length, 0);
  }
});

test("looks up only an active scoped session and propagates D1 failure", async () => {
  const valid = recordingDb({
    first: { session_id: "ses_1", user_id: "usr_1", household_id: "hld_1", role: "MEMBER" },
  });
  assert.deepEqual(await repository.findActiveSessionByHash(valid.db, TOKEN_HASH), {
    sessionId: "ses_1",
    userId: "usr_1",
    householdId: "hld_1",
    role: "MEMBER",
  });
  assert.equal(valid.calls.prepare.length, 1);
  assert.deepEqual(valid.calls.prepare[0].bindings, [TOKEN_HASH]);
  assert.match(valid.calls.prepare[0].sql, /device_sessions\.revoked_at IS NULL/);
  assert.match(valid.calls.prepare[0].sql, /users\.revoked_at IS NULL/);
  assert.match(valid.calls.prepare[0].sql, /JOIN households/);

  const failed = recordingDb({ firstError: new Error("d1 unavailable") });
  await assert.rejects(() => repository.findActiveSessionByHash(failed.db, TOKEN_HASH), /d1 unavailable/);
});

test("maps trusted session metadata exactly and propagates D1 failure", async () => {
  const valid = recordingDb({
    first: {
      session_id: "ses_1",
      device_name: "Phone",
      session_created_at: CREATED_AT,
      last_seen_at: UPDATED_AT,
      user_id: "usr_1",
      display_name: "Märt",
      role: "OWNER",
      household_id: "hld_1",
      household_name: "Kodu",
      household_address: "Õnne 1",
      household_revision: 1,
      household_created_at: CREATED_AT,
      household_updated_at: UPDATED_AT,
      token_hash: TOKEN_HASH,
      owner_marker: 1,
    },
  });
  assert.deepEqual(
    await repository.findSessionMetadataByTrustedContext(valid.db, {
      sessionId: "ses_1",
      userId: "usr_1",
      householdId: "hld_1",
      role: "forged",
    }),
    {
      session: { id: "ses_1", deviceName: "Phone", createdAt: CREATED_AT, lastSeenAt: UPDATED_AT },
      account: { userId: "usr_1", displayName: "Märt", role: "OWNER" },
      household: { id: "hld_1", name: "Kodu", address: "Õnne 1", revision: 1, createdAt: CREATED_AT, updatedAt: UPDATED_AT },
    },
  );
  assert.deepEqual(valid.calls.prepare[0].bindings, ["ses_1", "usr_1", "hld_1"]);
  assert.match(valid.calls.prepare[0].sql, /device_sessions\.id = \?/);
  assert.match(valid.calls.prepare[0].sql, /device_sessions\.user_id = \?/);
  assert.match(valid.calls.prepare[0].sql, /users\.household_id = \?/);

  const failed = recordingDb({ firstError: new Error("metadata failure") });
  await assert.rejects(
    () => repository.findSessionMetadataByTrustedContext(failed.db, { sessionId: "ses_1", userId: "usr_1", householdId: "hld_1" }),
    /metadata failure/,
  );
});

test("uses one bound parent-first batch and excludes plaintext credential fields", async () => {
  const recording = recordingDb();
  const result = await repository.insertHouseholdCreation(
    recording.db,
    creationRecord({ deviceToken: "m1s_PLAINTEXT_SENTINEL", recoveryCode: "m1r_PLAINTEXT_SENTINEL" }),
  );
  assert.equal(result, undefined);
  assert.equal(recording.calls.batch.length, 1);
  assert.equal(recording.calls.batch[0].length, 4);
  assert.match(recording.calls.prepare[0].sql, /^INSERT INTO households/);
  assert.match(recording.calls.prepare[1].sql, /^INSERT INTO users/);
  assert.match(recording.calls.prepare[2].sql, /^INSERT INTO device_sessions/);
  assert.match(recording.calls.prepare[3].sql, /^INSERT INTO household_recovery/);
  assert.deepEqual(recording.calls.prepare.map(({ bindings }) => bindings), [
    ["hld_repo", "O'Connor kodu; DROP TABLE users; --", "Õnne 1", "usr_owner", 1, CREATED_AT, UPDATED_AT],
    ["usr_owner", "hld_repo", "Märt 'Owner'", "OWNER", CREATED_AT],
    ["ses_initial", "usr_owner", TOKEN_HASH, "Telefon 'A'", CREATED_AT, UPDATED_AT],
    ["hld_repo", RECOVERY_HASH, CREATED_AT],
  ]);
  const inspected = JSON.stringify(recording.calls);
  assert.doesNotMatch(inspected, /m1s_PLAINTEXT_SENTINEL|m1r_PLAINTEXT_SENTINEL/);
  assert.doesNotMatch(recording.calls.prepare.map(({ sql }) => sql).join("\n"), /O'Connor|Õnne|Märt|DROP TABLE|[ab]{64}/);
});

test("rejects invalid creation hashes without executing a batch and propagates batch errors", async () => {
  for (const overrides of [{ tokenHash: "A".repeat(64) }, { recoveryHash: "b".repeat(63) }]) {
    const recording = recordingDb();
    await assert.rejects(() => repository.insertHouseholdCreation(recording.db, creationRecord(overrides)), RangeError);
    assert.equal(recording.calls.batch.length, 0);
  }

  const failed = recordingDb({ batchError: new Error("batch failed") });
  await assert.rejects(() => repository.insertHouseholdCreation(failed.db, creationRecord()), /batch failed/);
});

test("persists and resolves only the valid local D1 relationship", async () => {
  await withFreshDb(async (db) => {
    await repository.insertHouseholdCreation(db, creationRecord());

    assert.deepEqual(await all(db, "SELECT id, owner_member_id FROM households"), [{ id: "hld_repo", owner_member_id: "usr_owner" }]);
    assert.deepEqual(await all(db, "SELECT id FROM users WHERE role = 'OWNER' AND revoked_at IS NULL"), [{ id: "usr_owner" }]);
    assert.deepEqual(await all(db, "SELECT id FROM device_sessions"), [{ id: "ses_initial" }]);
    assert.deepEqual(await all(db, "SELECT household_id FROM household_recovery"), [{ household_id: "hld_repo" }]);
    assert.deepEqual(await repository.findActiveSessionByHash(db, TOKEN_HASH), {
      sessionId: "ses_initial",
      userId: "usr_owner",
      householdId: "hld_repo",
      role: "OWNER",
    });
    assert.deepEqual(
      await repository.findSessionMetadataByTrustedContext(db, {
        sessionId: "ses_initial",
        userId: "usr_owner",
        householdId: "hld_repo",
      }),
      {
        session: { id: "ses_initial", deviceName: "Telefon 'A'", createdAt: CREATED_AT, lastSeenAt: UPDATED_AT },
        account: { userId: "usr_owner", displayName: "Märt 'Owner'", role: "OWNER" },
        household: { id: "hld_repo", name: "O'Connor kodu; DROP TABLE users; --", address: "Õnne 1", revision: 1, createdAt: CREATED_AT, updatedAt: UPDATED_AT },
      },
    );
    assert.equal(await repository.findActiveSessionByHash(db, "c".repeat(64)), null);
    assert.equal(
      await repository.findSessionMetadataByTrustedContext(db, {
        sessionId: "ses_initial",
        userId: "other-user",
        householdId: "hld_repo",
      }),
      null,
    );
    assert.equal(
      await repository.findSessionMetadataByTrustedContext(db, {
        sessionId: "ses_initial",
        userId: "usr_owner",
        householdId: "other-household",
      }),
      null,
    );

    await run(db, "UPDATE device_sessions SET revoked_at = ? WHERE id = ?", UPDATED_AT, "ses_initial");
    assert.equal(await repository.findActiveSessionByHash(db, TOKEN_HASH), null);
    assert.equal(
      await repository.findSessionMetadataByTrustedContext(db, {
        sessionId: "ses_initial",
        userId: "usr_owner",
        householdId: "hld_repo",
      }),
      null,
    );
    assert.deepEqual(await all(db, "PRAGMA foreign_key_check"), []);
  });
});

test("rejects revoked users and missing relationships through the local D1 query", async () => {
  await withFreshDb(async (db) => {
    await repository.insertHouseholdCreation(db, creationRecord());
    await run(db, "INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", "usr_member", "hld_repo", "Member", "MEMBER", CREATED_AT);
    await run(db, "INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", "ses_member", "usr_member", "c".repeat(64), "Member phone", CREATED_AT, UPDATED_AT);
    await run(db, "UPDATE users SET revoked_at = ? WHERE id = ?", UPDATED_AT, "usr_member");
    assert.equal(await repository.findActiveSessionByHash(db, "c".repeat(64)), null);
    assert.equal(
      await repository.findSessionMetadataByTrustedContext(db, {
        sessionId: "ses_member",
        userId: "usr_member",
        householdId: "hld_repo",
      }),
      null,
    );
  });
});
