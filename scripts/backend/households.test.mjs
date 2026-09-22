import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import * as households from "../../functions/_lib/households.js";

const { createHousehold, publicHouseholdCreation } = households;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const FIXED_TIME = "2026-09-22T00:00:00.000Z";
const validInput = {
  userName: "  Märt 😀  ",
  householdName: "  Kase kodu  ",
  householdAddress: "  Õnne 1  ",
  deviceName: "  Märt telefon  ",
};
const normalizedInput = {
  userName: "Märt 😀",
  householdName: "Kase kodu",
  householdAddress: "Õnne 1",
  deviceName: "Märt telefon",
};

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

function expectedHash(kind, secret) {
  return createHash("sha256").update(`majandus:v1:${kind}:${secret}`, "utf8").digest("hex");
}

function recordingDb({ batchError } = {}) {
  const calls = { bindings: [], batch: 0 };
  return {
    calls,
    db: {
      prepare() {
        const statement = {
          bind(...values) {
            calls.bindings.push(values);
            return statement;
          },
        };
        return statement;
      },
      async batch() {
        calls.batch += 1;
        if (batchError) throw batchError;
        return [];
      },
    },
  };
}

async function capturedRejection(operation) {
  try {
    await operation();
    assert.fail("expected rejection");
  } catch (error) {
    return error;
  }
}

test("exports only the two locked Phase 6 APIs", () => {
  assert.deepEqual(Object.keys(households).sort(), ["createHousehold", "publicHouseholdCreation"]);
});

test("rejects invalid household creation input before clock or repository work", async () => {
  const invalidInputs = [
    { ...validInput, unknown: true },
    { ...validInput, role: "OWNER" },
    { ...validInput, householdId: "hld_forged" },
    { ...validInput, revision: 1 },
    { ...validInput, createdAt: FIXED_TIME },
    { householdName: "Kase kodu", deviceName: "Telefon" },
  ];

  for (const input of invalidInputs) {
    const recording = recordingDb();
    let clockCalls = 0;
    assert.deepEqual(
      await createHousehold({
        db: recording.db,
        input,
        clock: () => {
          clockCalls += 1;
          return FIXED_TIME;
        },
      }),
      { ok: false, code: "INVALID_REQUEST" },
    );
    assert.equal(clockCalls, 0);
    assert.equal(recording.calls.batch, 0);
    assert.deepEqual(recording.calls.bindings, []);
  }
});

test("creates one coherent local-D1 household creation from normalized input", async () => {
  await withFreshDb(async (db) => {
    let clockCalls = 0;
    const result = await createHousehold({
      db,
      input: validInput,
      clock: () => {
        clockCalls += 1;
        return FIXED_TIME;
      },
    });

    assert.equal(clockCalls, 1);
    assert.deepEqual(Object.keys(result).sort(), ["account", "deviceSession", "household", "secrets"]);
    assert.deepEqual(Object.keys(result.household).sort(), ["address", "createdAt", "id", "name", "revision", "updatedAt"]);
    assert.deepEqual(Object.keys(result.account).sort(), ["displayName", "role", "userId"]);
    assert.deepEqual(Object.keys(result.deviceSession).sort(), ["createdAt", "deviceName", "id"]);
    assert.deepEqual(Object.keys(result.secrets).sort(), ["deviceToken", "recoveryCode"]);
    assert.match(result.household.id, /^hld_/);
    assert.match(result.account.userId, /^usr_/);
    assert.match(result.deviceSession.id, /^ses_/);
    assert.match(result.secrets.deviceToken, /^m1s_[A-Za-z0-9_-]{43}$/);
    assert.match(result.secrets.recoveryCode, /^m1r_[A-Za-z0-9_-]{43}$/);
    assert.equal(result.household.name, normalizedInput.householdName);
    assert.equal(result.household.address, normalizedInput.householdAddress);
    assert.equal(result.account.displayName, normalizedInput.userName);
    assert.equal(result.account.role, "OWNER");
    assert.equal(result.deviceSession.deviceName, normalizedInput.deviceName);
    assert.deepEqual(
      [result.household.createdAt, result.household.updatedAt, result.deviceSession.createdAt],
      [FIXED_TIME, FIXED_TIME, FIXED_TIME],
    );

    const householdsRows = await all(db, "SELECT id, name, address, owner_member_id, revision, created_at, updated_at FROM households");
    const users = await all(db, "SELECT id, household_id, name, role, created_at FROM users");
    const sessions = await all(db, "SELECT id, user_id, token_hash, device_name, created_at, last_seen_at FROM device_sessions");
    const recoveries = await all(db, "SELECT household_id, recovery_hash, created_at FROM household_recovery");
    assert.deepEqual(householdsRows, [{
      id: result.household.id,
      name: normalizedInput.householdName,
      address: normalizedInput.householdAddress,
      owner_member_id: result.account.userId,
      revision: 1,
      created_at: FIXED_TIME,
      updated_at: FIXED_TIME,
    }]);
    assert.deepEqual(users, [{
      id: result.account.userId,
      household_id: result.household.id,
      name: normalizedInput.userName,
      role: "OWNER",
      created_at: FIXED_TIME,
    }]);
    assert.deepEqual(sessions, [{
      id: result.deviceSession.id,
      user_id: result.account.userId,
      token_hash: expectedHash("device-session", result.secrets.deviceToken),
      device_name: normalizedInput.deviceName,
      created_at: FIXED_TIME,
      last_seen_at: FIXED_TIME,
    }]);
    assert.deepEqual(recoveries, [{
      household_id: result.household.id,
      recovery_hash: expectedHash("household-recovery", result.secrets.recoveryCode),
      created_at: FIXED_TIME,
    }]);
    assert.doesNotMatch(JSON.stringify({ householdsRows, users, sessions, recoveries }), new RegExp(`${result.secrets.deviceToken}|${result.secrets.recoveryCode}`));
    assert.deepEqual(await all(db, "PRAGMA foreign_key_check"), []);
  });
});

test("accepts omitted address as null without duplicate-name semantics", async () => {
  await withFreshDb(async (db) => {
    const clock = () => FIXED_TIME;
    const first = await createHousehold({
      db,
      input: { userName: "Mari", householdName: "Sama nimi", deviceName: "Telefon" },
      clock,
    });
    const second = await createHousehold({
      db,
      input: { userName: "Karl", householdName: "Sama nimi", householdAddress: null, deviceName: "Tahvel" },
      clock,
    });
    assert.equal(first.household.address, null);
    assert.equal(second.household.address, null);
    assert.notEqual(first.household.id, second.household.id);
    assert.equal((await all(db, "SELECT id FROM households WHERE name = ?", "Sama nimi")).length, 2);
  });
});

test("rejects invalid or non-zero-argument clocks before repository use and propagates clock errors", async () => {
  for (const clock of [null, () => "", () => "2026-09-22T00:00:00Z", () => "not a date", (ignored) => FIXED_TIME]) {
    const recording = recordingDb();
    const error = await capturedRejection(() => createHousehold({ db: recording.db, input: validInput, clock }));
    assert.equal(error.message, "Invalid household creation clock");
    assert.equal(recording.calls.batch, 0);
    assert.deepEqual(recording.calls.bindings, []);
  }

  const recording = recordingDb();
  const clockError = new Error("clock unavailable");
  const error = await capturedRejection(() => createHousehold({
    db: recording.db,
    input: validInput,
    clock: () => { throw clockError; },
  }));
  assert.equal(error, clockError);
  assert.equal(recording.calls.batch, 0);
});

test("sends only hashes to the repository and projects the exact public result without mutation", async () => {
  const recording = recordingDb();
  const internalResult = await createHousehold({ db: recording.db, input: validInput, clock: () => FIXED_TIME });
  assert.equal(recording.calls.batch, 1);
  const bindings = JSON.stringify(recording.calls.bindings);
  assert.match(bindings, new RegExp(expectedHash("device-session", internalResult.secrets.deviceToken)));
  assert.match(bindings, new RegExp(expectedHash("household-recovery", internalResult.secrets.recoveryCode)));
  assert.doesNotMatch(bindings, new RegExp(`${internalResult.secrets.deviceToken}|${internalResult.secrets.recoveryCode}`));
  assert.equal("tokenHash" in internalResult, false);
  assert.equal("recoveryHash" in internalResult, false);

  const seeded = {
    ...internalResult,
    extra: "ignored",
    household: { ...internalResult.household, owner_member_id: "ignored" },
    account: { ...internalResult.account, tokenHash: "ignored" },
    deviceSession: { ...internalResult.deviceSession, recoveryHash: "ignored" },
    secrets: { ...internalResult.secrets, extra: "ignored" },
  };
  const before = structuredClone(seeded);
  assert.deepEqual(publicHouseholdCreation(seeded), {
    account: { userId: internalResult.account.userId, displayName: normalizedInput.userName, role: "OWNER" },
    household: {
      id: internalResult.household.id,
      name: normalizedInput.householdName,
      address: normalizedInput.householdAddress,
      revision: 1,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    },
    deviceSession: {
      id: internalResult.deviceSession.id,
      deviceName: normalizedInput.deviceName,
      createdAt: FIXED_TIME,
      token: internalResult.secrets.deviceToken,
    },
    recovery: { code: internalResult.secrets.recoveryCode },
  });
  assert.deepEqual(seeded, before);
  assert.throws(() => publicHouseholdCreation({}), /Invalid household creation result/);
  const malformedTimestamp = structuredClone(internalResult);
  malformedTimestamp.household.createdAt = "not-an-instant";
  assert.throws(() => publicHouseholdCreation(malformedTimestamp), /Invalid household creation result/);
});

test("propagates the original repository error once without retry or credentials", async () => {
  const repositoryError = new Error("D1 batch rejected");
  const recording = recordingDb({ batchError: repositoryError });
  const error = await capturedRejection(() => createHousehold({ db: recording.db, input: validInput, clock: () => FIXED_TIME }));
  assert.equal(error, repositoryError);
  assert.equal(recording.calls.batch, 1);
});
