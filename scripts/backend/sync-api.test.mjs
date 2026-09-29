import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import * as bootstrapEndpoint from "../../functions/api/sync/bootstrap.js";
import * as pullEndpoint from "../../functions/api/sync/pull.js";
import * as pushEndpoint from "../../functions/api/sync/push.js";
import { insertHouseholdCreation } from "../../functions/_lib/db.js";
import { applyCalendarMutation, validateCalendarEventPayload } from "../../functions/_lib/sync.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const NOW = "2026-09-29T10:00:00.000Z";

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
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character !== ";") continue;
    const statement = sql.slice(start, index + 1);
    if (/^\s*CREATE\s+TRIGGER\b/i.test(statement) && !/\bEND\s*;\s*$/i.test(statement)) continue;
    if (statement.trim()) statements.push(statement.replace(/\s+/g, " ").trim());
    start = index + 1;
  }
  assert.equal(sql.slice(start).trim(), "");
  return statements;
}

function identity(suffix) {
  const token = `m1s_${suffix === "a" ? "A".repeat(43) : "B".repeat(43)}`;
  return { householdId: `hld_${suffix}`, userId: `usr_${suffix}`, sessionId: `ses_${suffix}`, token };
}

async function seedOwner(db, suffix) {
  const owner = identity(suffix);
  const tokenHash = createHash("sha256")
    .update(`majandus:v1:device-session:${owner.token}`, "utf8").digest("hex");
  await insertHouseholdCreation(db, {
    householdId: owner.householdId, householdName: `Household ${suffix}`,
    householdAddress: null, ownerUserId: owner.userId, revision: 1,
    createdAt: NOW, updatedAt: NOW, userName: `Owner ${suffix}`, role: "OWNER",
    sessionId: owner.sessionId, tokenHash, deviceName: `Device ${suffix}`,
    lastSeenAt: NOW,
    recoveryHash: createHash("sha256").update(`sync-api-recovery:${suffix}`).digest("hex"),
  });
  return owner;
}

async function withFreshDb(run) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: ["DB"],
  });
  const db = await miniflare.getD1Database("DB");
  try {
    for (const statement of migrationStatements(migrationSql)) await db.exec(statement);
    const a = await seedOwner(db, "a");
    const b = await seedOwner(db, "b");
    return await run({ db, a, b });
  } finally {
    await miniflare.dispose();
  }
}

function request(path, owner, options = {}) {
  const headers = { ...(owner ? { Authorization: `Bearer ${owner.token}` } : {}), ...options.headers };
  return new Request(`https://example.test${path}`, { method: options.method ?? "GET", headers, body: options.body });
}

function observeDbBoundaries(db, { rejectConcurrent = false } = {}) {
  const batches = [];
  const standalone = [];
  const statements = new WeakMap();
  let active = 0;
  async function execute(run) {
    if (rejectConcurrent) assert.equal(active, 0, "dependent mutations must not overlap D1 operations");
    active += 1;
    try {
      return await run();
    } finally {
      active -= 1;
    }
  }
  function observeStatement(statement) {
    const observed = { bind: (...values) => observeStatement(statement.bind(...values)) };
    for (const method of ["first", "all", "run", "raw"]) {
      observed[method] = (...args) => {
        standalone.push(method);
        return execute(() => statement[method](...args));
      };
    }
    statements.set(observed, statement);
    return observed;
  }
  return {
    db: {
      prepare: (sql) => observeStatement(db.prepare(sql)),
      batch: (prepared) => {
        batches.push(prepared.length);
        return execute(() => db.batch(prepared.map((statement) => statements.get(statement))));
      },
    },
    batches, standalone,
  };
}

test("sync route modules expose only their Pages method and fallback handlers", () => {
  assert.deepEqual(Object.keys(bootstrapEndpoint).sort(), ["onRequest", "onRequestGet"]);
  assert.deepEqual(Object.keys(pullEndpoint).sort(), ["onRequest", "onRequestGet"]);
  assert.deepEqual(Object.keys(pushEndpoint).sort(), ["onRequest", "onRequestPost"]);
});

function event(id, title = `Event ${id}`) {
  return {
    id, title, category: "general", subtype: null, date: "2026-10-05", time: null,
    recurrence: { frequency: "none", interval: 1 }, reminder: { daysBefore: 0 },
    source: "manual", householdId: null, notes: "", seriesId: null,
    excludedDates: [], overrides: {},
  };
}

function mutation(operation, mutationId, entityId, patch, baseRevision = operation === "CREATE" ? 0 : 1) {
  return { mutationId, entityType: "calendar_event", entityId, operation, baseRevision, patch };
}

async function apply(db, owner, value) {
  return applyCalendarMutation({
    db, context: { ...owner, role: "OWNER" }, mutation: value, clock: () => NOW,
  });
}

test("bootstrap returns an authenticated empty household snapshot and cursor zero", async () => {
  await withFreshDb(async ({ db, a }) => {
    const response = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: db },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { cursor: 0, calendarEvents: [] });
  });
});

test("bootstrap returns ordered active records and tombstones with a household-owned cursor", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    assert.equal((await apply(db, b, mutation("CREATE", "mut_b", "evt_b", event("evt_b", "Private B")))).status, "APPLIED");
    assert.equal((await apply(db, a, mutation("CREATE", "mut_a2", "evt_2", event("evt_2")))).status, "APPLIED");
    assert.equal((await apply(db, a, mutation("CREATE", "mut_a1", "evt_1", event("evt_1")))).status, "APPLIED");
    assert.equal((await apply(db, a, mutation("DELETE", "mut_delete", "evt_1", {}))).status, "APPLIED");

    const responseA = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: db },
    });
    assert.equal(responseA.status, 200);
    assert.deepEqual(await responseA.json(), {
      cursor: 4,
      calendarEvents: [
        { id: "evt_1", payload: event("evt_1"), revision: 2, createdAt: NOW, updatedAt: NOW, deletedAt: NOW },
        { id: "evt_2", payload: event("evt_2"), revision: 1, createdAt: NOW, updatedAt: NOW, deletedAt: null },
      ],
    });
    const responseB = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", b), env: { DB: db },
    });
    assert.equal(responseB.status, 200);
    assert.deepEqual(await responseB.json(), {
      cursor: 1,
      calendarEvents: [{ id: "evt_b", payload: event("evt_b", "Private B"), revision: 1, createdAt: NOW, updatedAt: NOW, deletedAt: null }],
    });
  });
});

test("bootstrap reads cursor and records through one D1 batch after its auth lookup", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation("CREATE", "mut_bootstrap_batch", "evt_batch", event("evt_batch")));
    const observed = observeDbBoundaries(db);
    const response = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: observed.db },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      cursor: 1,
      calendarEvents: [{
        id: "evt_batch", payload: event("evt_batch"), revision: 1,
        createdAt: NOW, updatedAt: NOW, deletedAt: null,
      }],
    });
    assert.deepEqual(observed.batches, [2], "cursor and records must share one two-statement batch");
    assert.deepEqual(observed.standalone, ["first"], "only the auth lookup may read outside that batch");
  });
});

test("bootstrap uses canonical auth and method errors and fails closed on corrupt persisted payload", async () => {
  await withFreshDb(async ({ db, a }) => {
    const missingDb = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: {} });
    assert.equal(missingDb.status, 500);
    assert.deepEqual(await missingDb.json(), { error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    const missingBearer = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", null), env: { DB: db } });
    assert.equal(missingBearer.status, 401);
    assert.equal(missingBearer.headers.get("WWW-Authenticate"), "Bearer");
    assert.deepEqual(await missingBearer.json(), { error: { code: "UNAUTHORIZED", message: "Authentication required." } });
    const method = bootstrapEndpoint.onRequest({ request: request("/api/sync/bootstrap", a, { method: "POST" }) });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("Allow"), "GET");
    const selector = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap?householdId=hld_b", a), env: { DB: db },
    });
    assert.equal(selector.status, 400);
    assert.deepEqual(await selector.json(), { error: { code: "INVALID_REQUEST", message: "Invalid request." } });

    await apply(db, a, mutation("CREATE", "mut_corrupt", "evt_corrupt", event("evt_corrupt")));
    await db.prepare("UPDATE calendar_events SET payload_json = '{}' WHERE id = ?").bind("evt_corrupt").run();
    const corrupt = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.equal(corrupt.status, 500);
    assert.deepEqual(await corrupt.json(), { error: { code: "INTERNAL_ERROR", message: "Internal server error." } });

    await db.prepare("UPDATE calendar_events SET payload_json = ? WHERE id = ?")
      .bind(JSON.stringify(event("evt_corrupt")), "evt_corrupt").run();
    await db.prepare("DELETE FROM change_log WHERE entity_id = ?").bind("evt_corrupt").run();
    const missingHistory = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.equal(missingHistory.status, 500);
  });
});

test("pull after zero returns an empty authenticated delta and cursor zero", async () => {
  await withFreshDb(async ({ db, a }) => {
    const response = await pullEndpoint.onRequestGet({
      request: request("/api/sync/pull?after=0", a), env: { DB: db },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { cursor: 0, changes: [] });
  });
});

test("pull collapses repeated entity history, sorts latest deltas, and isolates households", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    await apply(db, b, mutation("CREATE", "mut_b", "evt_b", event("evt_b", "PRIVATE B")));
    await apply(db, a, mutation("CREATE", "mut_a1", "evt_1", event("evt_1")));
    await apply(db, a, mutation("UPDATE", "mut_a2", "evt_1", { title: "Updated" }, 1));
    await apply(db, a, mutation("CREATE", "mut_a3", "evt_2", event("evt_2")));
    await apply(db, a, mutation("UPDATE", "mut_a4", "evt_1", { notes: "Latest" }, 2));

    const pull = async (owner, after) => {
      const response = await pullEndpoint.onRequestGet({
        request: request(`/api/sync/pull?after=${after}`, owner), env: { DB: db },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const currentA = await pull(a, 0);
    assert.deepEqual(currentA, {
      cursor: 5,
      changes: [
        {
          seq: 4, entityType: "calendar_event", entityId: "evt_2", operation: "CREATE", revision: 1,
          record: { id: "evt_2", payload: event("evt_2"), revision: 1, createdAt: NOW, updatedAt: NOW, deletedAt: null },
        },
        {
          seq: 5, entityType: "calendar_event", entityId: "evt_1", operation: "UPDATE", revision: 3,
          record: { id: "evt_1", payload: { ...event("evt_1", "Updated"), notes: "Latest" }, revision: 3, createdAt: NOW, updatedAt: NOW, deletedAt: null },
        },
      ],
    });
    assert.equal(currentA.changes[1].record.payload.notes, "Latest");
    assert.deepEqual((await pull(a, 2)).changes.map(({ seq }) => seq), [4, 5]);
    assert.deepEqual((await pull(a, 4)).changes.map(({ seq }) => seq), [5]);
    assert.deepEqual(await pull(a, 5), { cursor: 5, changes: [] });
    await apply(db, a, mutation("DELETE", "mut_a5", "evt_2", {}, 1));
    assert.deepEqual(await pull(a, 5), {
      cursor: 6,
      changes: [{
        seq: 6, entityType: "calendar_event", entityId: "evt_2", operation: "DELETE", revision: 2,
        record: { id: "evt_2", payload: event("evt_2"), revision: 2, createdAt: NOW, updatedAt: NOW, deletedAt: NOW },
      }],
    });
    assert.deepEqual(await pull(b, 0), {
      cursor: 1,
      changes: [{
        seq: 1, entityType: "calendar_event", entityId: "evt_b", operation: "CREATE", revision: 1,
        record: { id: "evt_b", payload: event("evt_b", "PRIVATE B"), revision: 1, createdAt: NOW, updatedAt: NOW, deletedAt: null },
      }],
    });
    assert.doesNotMatch(JSON.stringify(currentA), /PRIVATE B|hld_b|usr_b|token_hash|result_json/);
    assert.doesNotMatch(JSON.stringify(currentA), new RegExp(a.token));
  });
});

test("pull reads cursor, ownership, and records through one D1 batch after its auth lookup", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation("CREATE", "mut_pull_create", "evt_batch", event("evt_batch")));
    await apply(db, a, mutation("UPDATE", "mut_pull_update", "evt_batch", { title: "Batch snapshot" }, 1));
    const observed = observeDbBoundaries(db);
    const response = await pullEndpoint.onRequestGet({
      request: request("/api/sync/pull?after=1", a), env: { DB: observed.db },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      cursor: 2,
      changes: [{
        seq: 2, entityType: "calendar_event", entityId: "evt_batch", operation: "UPDATE", revision: 2,
        record: {
          id: "evt_batch", payload: event("evt_batch", "Batch snapshot"), revision: 2,
          createdAt: NOW, updatedAt: NOW, deletedAt: null,
        },
      }],
    });
    assert.deepEqual(observed.batches, [3], "cursor, ownership, and records must share one batch");
    assert.deepEqual(observed.standalone, ["first"], "only the auth lookup may read outside that batch");
  });
});

test("pull rejects malformed queries and foreign, impossible, or unprovable cursors", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    for (const path of [
      "/api/sync/pull", "/api/sync/pull?after=", "/api/sync/pull?after=-1",
      "/api/sync/pull?after=01", "/api/sync/pull?after=1.0", "/api/sync/pull?after=1e0",
      "/api/sync/pull?after=9007199254740992", "/api/sync/pull?after=0&after=0",
      "/api/sync/pull?after=0&householdId=hld_b", "/api/sync/pull?after=%30",
    ]) {
      const response = await pullEndpoint.onRequestGet({ request: request(path, a), env: { DB: db } });
      assert.equal(response.status, 400, path);
      assert.deepEqual(await response.json(), { error: { code: "INVALID_REQUEST", message: "Invalid request." } }, path);
    }
    await apply(db, b, mutation("CREATE", "mut_b", "evt_b", event("evt_b")));
    await apply(db, a, mutation("CREATE", "mut_a", "evt_a", event("evt_a")));
    for (const after of [1, 3]) {
      const response = await pullEndpoint.onRequestGet({
        request: request(`/api/sync/pull?after=${after}`, a), env: { DB: db },
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: { code: "RESYNC_REQUIRED", message: "Full resync required." } });
    }
    await db.prepare("DELETE FROM change_log WHERE household_id = ? AND seq = ?").bind(a.householdId, 2).run();
    const unprovable = await pullEndpoint.onRequestGet({
      request: request("/api/sync/pull?after=2", a), env: { DB: db },
    });
    assert.equal(unprovable.status, 409);
    assert.equal((await unprovable.json()).error.code, "RESYNC_REQUIRED");
  });
});

test("pull uses canonical auth and method errors and fails closed on unreadable D1", async () => {
  await withFreshDb(async ({ db, a }) => {
    const missingDb = await pullEndpoint.onRequestGet({ request: request("/api/sync/pull?after=0", a), env: {} });
    assert.equal(missingDb.status, 500);
    const missingBearer = await pullEndpoint.onRequestGet({ request: request("/api/sync/pull?after=0", null), env: { DB: db } });
    assert.equal(missingBearer.status, 401);
    assert.equal(missingBearer.headers.get("WWW-Authenticate"), "Bearer");
    const method = pullEndpoint.onRequest({ request: request("/api/sync/pull?after=0", a, { method: "HEAD" }) });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("Allow"), "GET");

    await apply(db, a, mutation("CREATE", "mut_bad", "evt_bad", event("evt_bad")));
    await db.prepare("UPDATE calendar_events SET payload_json = '{}' WHERE id = ?").bind("evt_bad").run();
    const corrupt = await pullEndpoint.onRequestGet({ request: request("/api/sync/pull?after=0", a), env: { DB: db } });
    assert.equal(corrupt.status, 500);
    assert.deepEqual(await corrupt.json(), { error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
  });
});

test("push creates a calendar event for the bearer household and bootstrap reads it", async () => {
  await withFreshDb(async ({ db, a }) => {
    const value = mutation("CREATE", "mut_push", "evt_push", event("evt_push"));
    const response = await pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: [value] }),
      }), env: { DB: db },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { results: [{ mutationId: "mut_push", status: "APPLIED", revision: 1 }] });
    const bootstrap = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.equal(bootstrap.status, 200);
    const snapshot = await bootstrap.json();
    assert.equal(snapshot.cursor, 1);
    assert.equal(snapshot.calendarEvents[0].id, "evt_push");
    assert.deepEqual(snapshot.calendarEvents[0].payload, event("evt_push"));
  });
});

test("push accepts maximum valid multibyte notes and preserves them in bootstrap", async () => {
  await withFreshDb(async ({ db, a }) => {
    const notes = "😀".repeat(2500);
    assert.equal(notes.length, 5000);
    assert.equal(new TextEncoder().encode(notes).byteLength, 10000);
    const value = mutation("CREATE", "mut_large_notes", "evt_large_notes", {
      ...event("evt_large_notes"), notes,
    });
    const body = JSON.stringify({ mutations: [value] });
    assert.ok(new TextEncoder().encode(body).byteLength > 8192);
    assert.ok(new TextEncoder().encode(body).byteLength < 65536);
    const response = await pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      }), env: { DB: db },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      results: [{ mutationId: "mut_large_notes", status: "APPLIED", revision: 1 }],
    });
    const bootstrap = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: db },
    });
    assert.equal(bootstrap.status, 200);
    const snapshot = await bootstrap.json();
    assert.equal(snapshot.cursor, 1);
    assert.equal(snapshot.calendarEvents[0].payload.notes, notes);
  });
});

test("push returns canonical 413 above its UTF-8 byte cap while preserving auth and parse errors", async () => {
  await withFreshDb(async ({ db, a }) => {
    const payload = {
      ...event("evt_large_overrides"),
      recurrence: { frequency: "weekly", interval: 1 },
      seriesId: "series:evt_large_overrides",
      overrides: Object.fromEntries([
        "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02",
        "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30",
      ].map((date) => [date, { notes: "😀".repeat(2500) }])),
    };
    assert.doesNotThrow(() => validateCalendarEventPayload(payload, payload.id));
    const oversized = JSON.stringify({
      mutations: [mutation("CREATE", "mut_large_overrides", payload.id, payload)],
    });
    assert.ok(oversized.length < 65536);
    assert.ok(new TextEncoder().encode(oversized).byteLength > 65536);
    const post = (body, owner = a, headers = {}) => pushEndpoint.onRequestPost({
      request: request("/api/sync/push", owner, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
      }), env: { DB: db },
    });
    for (const [body, headers] of [
      [oversized, {}],
      ['{"mutations":[]}', { "Content-Length": "65537" }],
    ]) {
      const response = await post(body, a, headers);
      assert.equal(response.status, 413);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
      assert.deepEqual(await response.json(), {
        error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large." },
      });
    }
    const exactCap = await post('{"mutations":[]}'.padEnd(65536, " "));
    assert.equal(exactCap.status, 200);
    assert.deepEqual(await exactCap.json(), { results: [] });
    const malformed = await post("{");
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: { code: "INVALID_REQUEST", message: "Invalid request." },
    });
    const missingBearer = await post(oversized, null);
    assert.equal(missingBearer.status, 401);
    assert.equal(missingBearer.headers.get("WWW-Authenticate"), "Bearer");
    const snapshot = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: db },
    });
    assert.deepEqual(await snapshot.json(), { cursor: 0, calendarEvents: [] });
  });
});

test("push accepts eight mutations and rejects nine before applying any of them", async () => {
  await withFreshDb(async ({ db, a }) => {
    const post = (mutations) => pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations }),
      }), env: { DB: db },
    });
    const eight = Array.from({ length: 8 }, (_, index) => mutation(
      "CREATE", `mut_batch_${index}`, `evt_batch_${index}`, event(`evt_batch_${index}`),
    ));
    const allowed = await post(eight);
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), {
      results: eight.map(({ mutationId }) => ({ mutationId, status: "APPLIED", revision: 1 })),
    });
    const nine = Array.from({ length: 9 }, (_, index) => mutation(
      "CREATE", `mut_rejected_batch_${index}`, `evt_rejected_batch_${index}`, event(`evt_rejected_batch_${index}`),
    ));
    const rejected = await post(nine);
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), {
      error: { code: "INVALID_REQUEST", message: "Invalid request." },
    });
    const bootstrap = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: db },
    });
    assert.deepEqual((await bootstrap.json()).calendarEvents.map(({ id }) => id),
      eight.map(({ entityId }) => entityId));
  });
});

test("push applies dependent CREATE UPDATE DELETE in input order with revisions one two three", async () => {
  await withFreshDb(async ({ db, a }) => {
    const observed = observeDbBoundaries(db, { rejectConcurrent: true });
    const response = await pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: [
          mutation("CREATE", "mut_order_create", "evt_order", event("evt_order"), 0),
          mutation("UPDATE", "mut_order_update", "evt_order", { title: "Ordered update" }, 1),
          mutation("DELETE", "mut_order_delete", "evt_order", {}, 2),
        ] }),
      }), env: { DB: observed.db },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [
      { mutationId: "mut_order_create", status: "APPLIED", revision: 1 },
      { mutationId: "mut_order_update", status: "APPLIED", revision: 2 },
      { mutationId: "mut_order_delete", status: "APPLIED", revision: 3 },
    ] });
    const bootstrap = await bootstrapEndpoint.onRequestGet({
      request: request("/api/sync/bootstrap", a), env: { DB: db },
    });
    assert.equal(bootstrap.status, 200);
    const snapshot = await bootstrap.json();
    assert.equal(snapshot.cursor, 3);
    assert.equal(snapshot.calendarEvents.length, 1);
    assert.equal(snapshot.calendarEvents[0].revision, 3);
    assert.equal(snapshot.calendarEvents[0].payload.title, "Ordered update");
    assert.notEqual(snapshot.calendarEvents[0].deletedAt, null);
  });
});

test("push keeps valid mutations around an invalid item and preserves replay and conflict results", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    const first = mutation("CREATE", "mut_first", "evt_first", event("evt_first"));
    const second = mutation("CREATE", "mut_second", "evt_second", event("evt_second"));
    const invalid = { ...mutation("CREATE", "mut_invalid", "evt_invalid", event("evt_invalid")), householdId: b.householdId };
    const post = async (mutations) => {
      const response = await pushEndpoint.onRequestPost({
        request: request("/api/sync/push", a, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mutations }),
        }), env: { DB: db },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.deepEqual(await post([first, invalid, second]), {
      results: [
        { mutationId: "mut_first", status: "APPLIED", revision: 1 },
        { mutationId: "mut_invalid", status: "REJECTED", code: "INVALID_REQUEST" },
        { mutationId: "mut_second", status: "APPLIED", revision: 1 },
      ],
    });
    assert.deepEqual(await post([first, mutation("CREATE", "mut_collision", "evt_first", event("evt_first", "Other")), null]), {
      results: [
        { mutationId: "mut_first", status: "REPLAYED", result: { status: "APPLIED", revision: 1 } },
        { mutationId: "mut_collision", status: "CONFLICT", code: "ENTITY_UNAVAILABLE" },
        { mutationId: null, status: "REJECTED", code: "INVALID_REQUEST" },
      ],
    });
    const bootstrapA = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.deepEqual((await bootstrapA.json()).calendarEvents.map(({ id }) => id), ["evt_first", "evt_second"]);
    const bootstrapB = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", b), env: { DB: db } });
    assert.deepEqual(await bootstrapB.json(), { cursor: 0, calendarEvents: [] });
  });
});

test("push rejects body and query selectors while bearer household remains authoritative", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    const post = async (path, body) => pushEndpoint.onRequestPost({
      request: request(path, a, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }), env: { DB: db },
    });
    for (const [path, body] of [
      ["/api/sync/push?householdId=hld_b", { mutations: [] }],
      ["/api/sync/push", { mutations: [], householdId: b.householdId }],
    ]) {
      const response = await post(path, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: "INVALID_REQUEST", message: "Invalid request." } });
    }
    const forged = mutation("CREATE", "mut_forged", "evt_forged", event("evt_forged"));
    forged.patch.householdId = b.householdId;
    const rejected = await post("/api/sync/push", { mutations: [forged] });
    assert.deepEqual(await rejected.json(), {
      results: [{ mutationId: "mut_forged", status: "REJECTED", code: "INVALID_REQUEST" }],
    });
    const legitimate = await post("/api/sync/push", {
      mutations: [mutation("CREATE", "mut_legitimate", "evt_legitimate", event("evt_legitimate"))],
    });
    assert.equal(legitimate.status, 200);
    const aSnapshot = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.deepEqual((await aSnapshot.json()).calendarEvents.map(({ id }) => id), ["evt_legitimate"]);
    const bSnapshot = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", b), env: { DB: db } });
    assert.deepEqual(await bSnapshot.json(), { cursor: 0, calendarEvents: [] });
  });
});

test("push validates the JSON container and finite batch size without changing D1", async () => {
  await withFreshDb(async ({ db, a }) => {
    const post = async (body, contentType = "application/json") => pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": contentType }, body,
      }), env: { DB: db },
    });
    for (const body of [
      "{}", "[]", "not-json", '{"mutations":{}}', '{"mutations":null}',
      '{"mutations":[],"other":true}', JSON.stringify({ mutations: Array(51).fill(null) }),
      JSON.stringify({ mutations: [], padding: "x".repeat(8200) }),
    ]) {
      const response = await post(body);
      assert.equal(response.status, 400, body.slice(0, 80));
      assert.deepEqual(await response.json(), { error: { code: "INVALID_REQUEST", message: "Invalid request." } });
    }
    assert.equal((await post('{"mutations":[]}', "text/plain")).status, 400);
    const empty = await post('{"mutations":[]}', "application/json; charset=utf-8");
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { results: [] });
    const snapshot = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.deepEqual(await snapshot.json(), { cursor: 0, calendarEvents: [] });
  });
});

test("push preserves MERGED and canonical auth, method, and infrastructure errors", async () => {
  await withFreshDb(async ({ db, a }) => {
    const post = async (mutations) => pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations }),
      }), env: { DB: db },
    });
    const original = mutation("CREATE", "mut_create", "evt_merge", event("evt_merge"));
    const title = mutation("UPDATE", "mut_title", "evt_merge", { title: "New title" }, 1);
    const notes = mutation("UPDATE", "mut_notes", "evt_merge", { notes: "Separate note" }, 1);
    assert.equal((await post([original])).status, 200);
    assert.equal((await post([title])).status, 200);
    const merged = await post([notes]);
    assert.deepEqual(await merged.json(), { results: [{ mutationId: "mut_notes", status: "MERGED", revision: 3 }] });

    const missingDb = await pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"mutations":[]}' }),
      env: {},
    });
    assert.equal(missingDb.status, 500);
    const missingBearer = await pushEndpoint.onRequestPost({
      request: request("/api/sync/push", null, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"mutations":[]}' }),
      env: { DB: db },
    });
    assert.equal(missingBearer.status, 401);
    assert.equal(missingBearer.headers.get("WWW-Authenticate"), "Bearer");
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const response = pushEndpoint.onRequest({ request: request("/api/sync/push", a, { method }) });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "POST");
    }
    await db.exec("DROP TABLE applied_mutations;");
    const broken = await post([mutation("CREATE", "mut_broken", "evt_broken", event("evt_broken"))]);
    assert.equal(broken.status, 500);
    const brokenBody = await broken.json();
    assert.deepEqual(brokenBody, { error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    assert.doesNotMatch(JSON.stringify(brokenBody), new RegExp(a.token));
  });
});

test("push reports a later D1 failure while an earlier acknowledged mutation replays safely", async () => {
  await withFreshDb(async ({ db, a }) => {
    const first = mutation("CREATE", "mut_safe_first", "evt_first", event("evt_first"));
    const second = mutation("CREATE", "mut_failing_second", "evt_second", event("evt_second"));
    const post = async () => pushEndpoint.onRequestPost({
      request: request("/api/sync/push", a, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: [first, second] }),
      }), env: { DB: db },
    });
    await db.prepare(`CREATE TRIGGER fail_second_sync_change BEFORE INSERT ON change_log
      WHEN NEW.entity_id = 'evt_second' BEGIN SELECT RAISE(ABORT, 'injected fault'); END`).run();
    const failed = await post();
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    const partial = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.deepEqual((await partial.json()).calendarEvents.map(({ id }) => id), ["evt_first"]);

    await db.exec("DROP TRIGGER fail_second_sync_change;");
    const retry = await post();
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { results: [
      { mutationId: "mut_safe_first", status: "REPLAYED", result: { status: "APPLIED", revision: 1 } },
      { mutationId: "mut_failing_second", status: "APPLIED", revision: 1 },
    ] });
    const complete = await bootstrapEndpoint.onRequestGet({ request: request("/api/sync/bootstrap", a), env: { DB: db } });
    assert.deepEqual((await complete.json()).calendarEvents.map(({ id }) => id), ["evt_first", "evt_second"]);
  });
});
