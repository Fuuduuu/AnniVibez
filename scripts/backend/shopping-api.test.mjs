import assert from "node:assert/strict";
import { test } from "node:test";
import * as bootstrapEndpoint from "../../functions/api/shopping/bootstrap.js";
import * as pullEndpoint from "../../functions/api/shopping/pull.js";
import * as pushEndpoint from "../../functions/api/shopping/push.js";
import { applyShoppingMutation } from "../../functions/_lib/shopping.js";
import { withFreshDb, request, mutation, item, ITEM_A, ITEM_B, uuidFor, NOW, rows, seedCalendar, seedMember, observeD1 } from "./shopping-fixtures.mjs";

const apply = (db, context, value) => applyShoppingMutation({ db, context, mutation: value, clock: () => NOW });
const bootstrap = (db, owner, query = "") => bootstrapEndpoint.onRequestGet({ request: request(`/api/shopping/bootstrap${query}`, owner), env: { DB: db } });
const pull = (db, owner, after = 0) => pullEndpoint.onRequestGet({ request: request(`/api/shopping/pull?after=${after}`, owner), env: { DB: db } });
const push = (db, owner, mutations) => pushEndpoint.onRequestPost({ request: request("/api/shopping/push", owner, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mutations }),
}), env: { DB: db } });

test("shopping bootstrap starts empty and returns canonical records with its owned cursor", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    const empty = await bootstrap(db, a);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { cursor: 0, shoppingItems: [] });
    await apply(db, a, mutation());
    await apply(db, b, mutation("CREATE", 101, item({ id: ITEM_B, note: "FOREIGN PRIVATE DATA" }), 0, ITEM_B));
    const response = await bootstrap(db, a);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { cursor: 1, shoppingItems: [{ id: ITEM_A, payload: item(), revision: 1, updatedAt: NOW, deletedAt: null }] });
    assert.equal((await rows(db, "SELECT * FROM shopping_items")).length, 2);
  });
});

test("shopping pull coalesces current records and tombstones while filtering interleaved calendar and foreign logs", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    await seedCalendar(db, a, "calendar_1", "calendar_mut_1");
    await apply(db, a, mutation());
    await seedCalendar(db, a, "calendar_2", "calendar_mut_2");
    await apply(db, b, mutation("CREATE", 101, item({ id: ITEM_B }), 0, ITEM_B));
    await apply(db, a, mutation("UPDATE", 102, { note: "Shopping note" }));
    await apply(db, a, mutation("DELETE", 103, {}, 2));
    const response = await pull(db, a, 2);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cursor: 6, changes: [{
      seq: 6, entityType: "shopping_item", entityId: ITEM_A, operation: "DELETE", revision: 3,
      record: { id: ITEM_A, payload: item({ note: "Shopping note" }), revision: 3, updatedAt: NOW, deletedAt: NOW },
    }] });
    await seedCalendar(db, a, "calendar_3", "calendar_mut_3");
    const unchanged = await pull(db, a, 6);
    assert.deepEqual(await unchanged.json(), { cursor: 6, changes: [] });
    const snapshot = await bootstrap(db, a);
    assert.equal(snapshot.status, 200);
    assert.equal((await snapshot.json()).shoppingItems[0].deletedAt, NOW);
  });
});

test("shopping rejects ahead, foreign, calendar and missing-history cursors with RESYNC_REQUIRED", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    await seedCalendar(db, a);
    await apply(db, a, mutation());
    await apply(db, b, mutation("CREATE", 101, item({ id: ITEM_B }), 0, ITEM_B));
    for (const after of [1, 3, 999]) {
      const response = await pull(db, a, after);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, "RESYNC_REQUIRED");
    }
    await apply(db, a, mutation("UPDATE", 102, { note: "Current" }));
    await db.prepare("DELETE FROM change_log WHERE seq = 2").run();
    const expired = await pull(db, a, 2);
    assert.equal(expired.status, 409);
    assert.equal((await expired.json()).error.code, "RESYNC_REQUIRED");
  });
});

test("shopping pulls reject a missing revision after the cursor and can recover with a full snapshot", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { note: "middle" }));
    await apply(db, a, mutation("UPDATE", 102, { quantity: "2" }, 2));
    await db.prepare("DELETE FROM change_log WHERE revision = 2 AND entity_type = 'shopping_item'").run();
    const gap = await pull(db, a, 1);
    assert.equal(gap.status, 409);
    assert.equal((await gap.json()).error.code, "RESYNC_REQUIRED");
    const boot = await bootstrap(db, a);
    assert.equal(boot.status, 200);
    const latest = await boot.json();
    assert.equal(latest.cursor, 3);
    assert.equal(latest.shoppingItems[0].revision, 3);
    assert.deepEqual(await (await pull(db, a, latest.cursor)).json(), { cursor: 3, changes: [] });
  });
});

test("shopping cursor syntax rejects missing, duplicated, noninteger and noncanonical values", async () => {
  await withFreshDb(async ({ db, a }) => {
    for (const query of ["", "?after=-1", "?after=1.5", "?after=01", "?after=NaN", "?after=9007199254740992", "?after=0&after=0", "?after=0&extra=x", "?after=%30"]) {
      const response = await pullEndpoint.onRequestGet({ request: request(`/api/shopping/pull${query}`, a), env: { DB: db } });
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error.code, "INVALID_REQUEST");
    }
    assert.deepEqual(await (await pull(db, a)).json(), { cursor: 0, changes: [] });
  });
});

test("shopping push applies ordered dependent mutations and returns calendar-compatible replay ACKs", async () => {
  await withFreshDb(async ({ db, a }) => {
    const values = [mutation(), mutation("UPDATE", 101, { checkedAt: NOW }), mutation("DELETE", 102, {}, 2)];
    const response = await push(db, a, values);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: values.map((value, index) => ({ mutationId: value.mutationId, status: "APPLIED", revision: index + 1 })) });
    const replay = await push(db, a, values);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { results: values.map((value, index) => ({ mutationId: value.mutationId, status: "REPLAYED", result: { status: "APPLIED", revision: index + 1 } })) });
    const record = (await (await bootstrap(db, a)).json()).shoppingItems[0];
    assert.equal(typeof record.deletedAt, "string");
    assert.equal(new Date(record.deletedAt).toISOString(), record.deletedAt);
    assert.equal(record.updatedAt, record.deletedAt);
    assert.equal(record.payload.checkedAt, NOW);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 3);
  });
});

test("shopping cannot advance a cursor past an item whose latest journal row is missing", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { note: "Must not disappear" }));
    await apply(db, a, mutation("CREATE", 102, item({ id: ITEM_B }), 0, ITEM_B));
    await db.prepare("DELETE FROM change_log WHERE seq = 2").run();
    const response = await pull(db, a, 1);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "RESYNC_REQUIRED");
  });
});

test("shopping bootstrap and pull keep rows and cursor in one D1 batch even when a later write occurs", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    const cases = [
      { endpoint: bootstrapEndpoint, path: "/api/shopping/bootstrap", cursor: 1, revision: 1, name: "Piim", count: 2 },
      { endpoint: pullEndpoint, path: "/api/shopping/pull?after=0", cursor: 2, revision: 2, name: "After snapshot 1", count: 3 },
    ];
    for (const [index, sample] of cases.entries()) {
      const observed = observeD1(db, { afterBatch: () => apply(db, a, mutation("UPDATE", 101 + index, { name: `After snapshot ${index + 1}` }, sample.revision)) });
      const response = await sample.endpoint.onRequestGet({ request: request(sample.path, a), env: { DB: observed.db } });
      assert.equal(response.status, 200);
      const body = await response.json();
      const record = body.shoppingItems?.[0] ?? body.changes[0].record;
      assert.equal(body.cursor, sample.cursor);
      assert.equal(record.revision, sample.revision);
      assert.equal(record.payload.name, sample.name);
      assert.deepEqual(observed.batches, [sample.count]);
      assert.equal(observed.standalone.length, 1);
      assert.match(observed.standalone[0].sql, /FROM device_sessions/);
    }
  });
});

test("shopping routes expose Pages method handlers and reject unsupported methods with canonical Allow", async () => {
  for (const [endpoint, method, exports, path] of [
    [bootstrapEndpoint, "GET", ["onRequest", "onRequestGet"], "/api/shopping/bootstrap"],
    [pullEndpoint, "GET", ["onRequest", "onRequestGet"], "/api/shopping/pull?after=0"],
    [pushEndpoint, "POST", ["onRequest", "onRequestPost"], "/api/shopping/push"],
  ]) {
    assert.deepEqual(Object.keys(endpoint).sort(), exports);
    for (const other of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].filter(value => value !== method)) {
      const response = endpoint.onRequest({ request: request(path, null, { method: other }) });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), method);
      assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
    }
  }
});

test("shopping requires a valid active bearer session and has no OWNER-only gate", async () => {
  await withFreshDb(async ({ db, a }) => {
    const member = await seedMember(db, a);
    const response = await push(db, member, [mutation()]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).results[0].status, "APPLIED");
    assert.equal((await bootstrap(db, member)).status, 200);
    assert.equal((await pull(db, member)).status, 200);
    for (const [endpoint, method, path] of [[bootstrapEndpoint, "GET", "/api/shopping/bootstrap"], [pullEndpoint, "GET", "/api/shopping/pull?after=0"], [pushEndpoint, "POST", "/api/shopping/push"]]) {
      for (const authorization of [undefined, "Bearer invalid", `Bearer m1s_${"X".repeat(43)}`]) {
        const response = await endpoint[method === "POST" ? "onRequestPost" : "onRequestGet"]({ request: request(path, null, { method, headers: authorization ? { Authorization: authorization } : {} }), env: { DB: db } });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("www-authenticate"), "Bearer");
        assert.equal((await response.json()).error.code, "UNAUTHORIZED");
      }
    }
    await db.prepare("UPDATE device_sessions SET revoked_at = ? WHERE id = ?").bind(NOW, member.sessionId).run();
    assert.equal((await bootstrap(db, member)).status, 401);
  });
});

test("shopping infrastructure failures produce safe 500 responses rather than fake 401 or success", async () => {
  await withFreshDb(async ({ db, a }) => {
    const brokenRead = { prepare() { throw new Error("PRIVATE_INFRASTRUCTURE_DETAIL"); } };
    for (const endpoint of [bootstrapEndpoint, pullEndpoint]) {
      const response = await endpoint.onRequestGet({ request: request("/api/shopping/pull?after=0", a), env: { DB: brokenRead } });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    }
    const brokenBatch = { prepare: sql => db.prepare(sql), batch() { throw new Error("PRIVATE_BATCH_DETAIL"); } };
    for (const [endpoint, path] of [[bootstrapEndpoint, "/api/shopping/bootstrap"], [pullEndpoint, "/api/shopping/pull?after=0"]]) {
      const response = await endpoint.onRequestGet({ request: request(path, a), env: { DB: brokenBatch } });
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
    }
    const pushFailure = await push(brokenBatch, a, [mutation()]);
    assert.equal(pushFailure.status, 500);
    assert.equal((await pushFailure.json()).error.code, "INTERNAL_ERROR");
    assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
    const missing = await bootstrapEndpoint.onRequestGet({ request: request("/api/shopping/bootstrap", a), env: {} });
    assert.equal(missing.status, 500);
  });
});

test("shopping push accepts eight mutations and rejects a ninth before any writes", async () => {
  await withFreshDb(async ({ db, a }) => {
    const values = Array.from({ length: 9 }, (_, index) => mutation("CREATE", 100 + index, item({ id: uuidFor(10 + index) }), 0, uuidFor(10 + index)));
    const tooMany = await push(db, a, values);
    assert.equal(tooMany.status, 400);
    assert.equal((await tooMany.json()).error.code, "INVALID_REQUEST");
    assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
    const accepted = await push(db, a, values.slice(0, 8));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).results.every(result => result.status === "APPLIED"), true);
    assert.equal((await rows(db, "SELECT * FROM shopping_items")).length, 8);
    assert.deepEqual(await (await push(db, a, [])).json(), { results: [] });
  });
});

test("shopping push distinguishes measured UTF-8 oversize bodies from malformed JSON", async () => {
  await withFreshDb(async ({ db, a }) => {
    for (const body of ["x".repeat(65537), JSON.stringify({ mutations: [], extra: "😀".repeat(17000) })]) {
      const response = await pushEndpoint.onRequestPost({ request: request("/api/shopping/push", a, { method: "POST", headers: { "Content-Type": "application/json" }, body }), env: { DB: db } });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
    }
    const maximum = mutation("CREATE", 100, item({ name: "😀".repeat(80), quantity: "😀".repeat(20), note: "😀".repeat(250) }));
    const response = await push(db, a, [maximum]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).results[0].status, "APPLIED");
  });
});

test("shopping routes reject unexpected queries and malformed request bodies", async () => {
  await withFreshDb(async ({ db, a }) => {
    assert.equal((await bootstrap(db, a, "?householdId=hld_b")).status, 400);
    const invalid = ["", "{", "[]", "null", '{}', '{"mutations":{}}', '{"mutations":[],"householdId":"hld_b"}'];
    for (const body of invalid) {
      const response = await pushEndpoint.onRequestPost({ request: request("/api/shopping/push", a, { method: "POST", headers: { "Content-Type": "application/json" }, body }), env: { DB: db } });
      assert.equal(response.status, 400, body);
      assert.equal((await response.json()).error.code, "INVALID_REQUEST");
    }
    for (const headers of [{ "Content-Type": "text/plain" }, { "Content-Type": "application/json; charset=latin1" }]) {
      const response = await pushEndpoint.onRequestPost({ request: request("/api/shopping/push", a, { method: "POST", headers, body: '{"mutations":[]}' }), env: { DB: db } });
      assert.equal(response.status, 400);
    }
    const query = await pushEndpoint.onRequestPost({ request: request("/api/shopping/push?householdId=hld_b", a, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"mutations":[]}' }), env: { DB: db } });
    assert.equal(query.status, 400);
    const invalidUtf8 = await pushEndpoint.onRequestPost({ request: request("/api/shopping/push", a, { method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([0xc3]) }), env: { DB: db } });
    assert.equal(invalidUtf8.status, 400);
    assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
  });
});

test("shopping push returns explicit mutation conflicts and rejections without leaking foreign data", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    await apply(db, b, mutation());
    const values = [mutation("UPDATE", 101, { name: "Intrusion" }), { ...mutation("CREATE", 102), patch: item({ householdId: b.householdId }) }, null];
    const response = await push(db, a, values);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [
      { mutationId: uuidFor(101), status: "CONFLICT", code: "ENTITY_UNAVAILABLE" },
      { mutationId: uuidFor(102), status: "REJECTED", code: "INVALID_REQUEST" },
      { mutationId: null, status: "REJECTED", code: "INVALID_REQUEST" },
    ] });
    assert.deepEqual((await (await bootstrap(db, a)).json()).shoppingItems, []);
    assert.equal((await rows(db, "SELECT * FROM shopping_items")).length, 1);
  });
});
