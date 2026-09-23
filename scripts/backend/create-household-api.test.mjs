import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import * as endpoint from "../../functions/api/auth/create-household.js";

const { onRequest, onRequestPost } = endpoint;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const encoder = new TextEncoder();
const URL = "https://example.test/api/auth/create-household";
const validInput = {
  userName: "Mari",
  householdName: "Kase kodu",
  householdAddress: "Näide 1, Rakvere",
  deviceName: "Mari telefon",
};
const canonicalInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const deviceToken = /^m1s_[A-Za-z0-9_-]{43}$/;
const recoveryCode = /^m1r_[A-Za-z0-9_-]{43}$/;

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

function postRequest(body = JSON.stringify(validInput), headers = { "content-type": "application/json" }) {
  return new Request(URL, { method: "POST", headers, body });
}

async function countHouseholds(db) {
  return (await db.prepare("SELECT COUNT(*) AS count FROM households").first()).count;
}

async function assertError(response, status, code, message, forbidden = []) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { error: { code, message } });
  const text = JSON.stringify(body);
  for (const value of forbidden) assert.equal(text.includes(value), false);
  return body;
}

test("exports only the locked Phase 7 handlers", () => {
  assert.deepEqual(Object.keys(endpoint).sort(), ["onRequest", "onRequestPost"]);
});

test("POST creates one household and returns only the public creation result", async () => {
  await withFreshDb(async (db) => {
    const response = await onRequestPost({ request: postRequest(), env: { DB: db } });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");

    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["account", "deviceSession", "household", "recovery"]);
    assert.deepEqual(Object.keys(body.account).sort(), ["displayName", "role", "userId"]);
    assert.deepEqual(Object.keys(body.household).sort(), ["address", "createdAt", "id", "name", "revision", "updatedAt"]);
    assert.deepEqual(Object.keys(body.deviceSession).sort(), ["createdAt", "deviceName", "id", "token"]);
    assert.deepEqual(Object.keys(body.recovery).sort(), ["code"]);
    assert.match(body.deviceSession.token, deviceToken);
    assert.match(body.recovery.code, recoveryCode);
    assert.match(body.household.createdAt, canonicalInstant);
    assert.deepEqual(
      [body.household.createdAt, body.household.updatedAt, body.deviceSession.createdAt],
      [body.household.createdAt, body.household.createdAt, body.household.createdAt],
    );
    assert.equal("tokenHash" in body, false);
    assert.equal("recoveryHash" in body, false);
    assert.equal("secrets" in body, false);
    assert.equal(JSON.stringify(body).includes("owner_member_id"), false);
    assert.equal(await countHouseholds(db), 1);
    const persisted = (await db.prepare("SELECT created_at, updated_at FROM households").all()).results;
    assert.deepEqual(persisted, [{ created_at: body.household.createdAt, updated_at: body.household.updatedAt }]);
  });
});

test("POST preserves an omitted optional household address as null", async () => {
  await withFreshDb(async (db) => {
    const input = {
      userName: "Mari",
      householdName: "Addressless Household",
      deviceName: "Primary device",
    };
    const response = await onRequestPost({
      request: postRequest(JSON.stringify(input)),
      env: { DB: db },
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.household).sort(), [
      "address",
      "createdAt",
      "id",
      "name",
      "revision",
      "updatedAt",
    ]);
    assert.equal(body.household.address, null);

    const persisted = await db
      .prepare("SELECT id, address FROM households WHERE id = ?")
      .bind(body.household.id)
      .first();
    assert.deepEqual(persisted, { id: body.household.id, address: null });
  });
});

test("POST maps malformed transport and invalid client fields to one canonical 400 without persistence", async () => {
  const cases = [
    () => postRequest(JSON.stringify(validInput), { "content-type": "text/plain" }),
    () => postRequest("{", { "content-type": "application/json" }),
    () => postRequest("[]", { "content-type": "application/json" }),
    () => postRequest(JSON.stringify({ ...validInput, userName: undefined }), { "content-type": "application/json" }),
    () => postRequest(JSON.stringify({ ...validInput, role: "OWNER" }), { "content-type": "application/json" }),
    () => postRequest(JSON.stringify({ ...validInput, householdId: "hld_forged" }), { "content-type": "application/json" }),
    () => postRequest(JSON.stringify({ ...validInput, userName: "x".repeat(9000) }), { "content-type": "application/json" }),
  ];

  await withFreshDb(async (db) => {
    for (const makeRequest of cases) {
      await assertError(
        await onRequestPost({ request: makeRequest(), env: { DB: db } }),
        400,
        "INVALID_REQUEST",
        "Invalid request.",
      );
      assert.equal(await countHouseholds(db), 0);
    }
  });
});

test("POST maps a missing DB binding to the canonical generic 500", async () => {
  const response = await onRequestPost({ request: postRequest(), env: {} });
  await assertError(response, 500, "INTERNAL_ERROR", "Internal server error.");
});

test("POST collapses one repository failure to the generic 500 without retry or detail leakage", async () => {
  await withFreshDb(async (db) => {
    const rawError = new Error("D1 batch failure must never reach clients");
    let batchCalls = 0;
    const failingDb = {
      prepare: db.prepare.bind(db),
      async batch() {
        batchCalls += 1;
        throw rawError;
      },
    };
    const response = await onRequestPost({ request: postRequest(), env: { DB: failingDb } });
    await assertError(response, 500, "INTERNAL_ERROR", "Internal server error.", [rawError.message]);
    assert.equal(batchCalls, 1);
    assert.equal(await countHouseholds(db), 0);
  });
});

test("generic handler returns the canonical 405 without consulting a DB", async () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
    const response = await onRequest({
      request: new Request(URL, { method }),
      env: { get DB() { throw new Error("non-POST handler must not inspect DB"); } },
    });
    assert.equal(response.headers.get("allow"), "POST");
    await assertError(response, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  }
});

test("POST permits duplicate household names without a conflict result", async () => {
  await withFreshDb(async (db) => {
    const first = await onRequestPost({ request: postRequest(JSON.stringify({ ...validInput, householdName: "Same name" })), env: { DB: db } });
    const second = await onRequestPost({ request: postRequest(JSON.stringify({ ...validInput, userName: "Karl", householdName: "Same name", deviceName: "Karl phone" })), env: { DB: db } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.notEqual(firstBody.household.id, secondBody.household.id);
    assert.equal(await countHouseholds(db), 2);
  });
});
