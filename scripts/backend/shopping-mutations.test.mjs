import assert from "node:assert/strict";
import { test } from "node:test";
import { applyShoppingMutation, shoppingMutationDigest, canonicalJson } from "../../functions/_lib/shopping.js";
import { withFreshDb, mutation, item, ITEM_A, ITEM_B, uuidFor, NOW, CREATED, rows, one, seedCalendar, seedMember, synchronizeShoppingReads } from "./shopping-fixtures.mjs";

const apply = (db, context, value, clock = () => NOW) => applyShoppingMutation({ db, context, mutation: value, clock });

test("shopping CREATE atomically persists one canonical item, one history row and one replay result", async () => {
  await withFreshDb(async ({ db, a }) => {
    const value = mutation("CREATE", 100, item({ name: " Piim " }));
    assert.deepEqual(await apply(db, a, value), { status: "APPLIED", revision: 1 });
    const record = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
    assert.deepEqual(JSON.parse(record.payload_json), item());
    assert.equal(record.household_id, a.householdId);
    assert.equal(record.created_at, CREATED);
    assert.equal(record.updated_at, NOW);
    assert.equal(record.deleted_at, null);
    const logs = await rows(db, "SELECT * FROM change_log");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].entity_type, "shopping_item");
    assert.equal(logs[0].changed_by, a.userId);
    assert.deepEqual(JSON.parse(logs[0].changed_fields_json), ["category", "checkedAt", "createdAt", "id", "name", "note", "quantity"]);
    const stored = await rows(db, "SELECT * FROM applied_mutations");
    assert.equal(stored.length, 1);
    assert.deepEqual(JSON.parse(stored[0].result_json).result, { status: "APPLIED", revision: 1 });
  });
});

test("shopping fingerprints normalized mutations independently of property order", async () => {
  const value = mutation();
  const reversed = Object.fromEntries(Object.entries(value).reverse());
  reversed.patch = Object.fromEntries(Object.entries(item({ name: " Piim " })).reverse());
  assert.equal(await shoppingMutationDigest(value), await shoppingMutationDigest(reversed));
  assert.notEqual(await shoppingMutationDigest(value), await shoppingMutationDigest(mutation("CREATE", 100, item({ note: "Changed" }))));
  assert.match(await shoppingMutationDigest(value), /^[0-9a-f]{64}$/);
  assert.equal(canonicalJson({ b: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"b":1}');
});

test("shopping edits, checks and unchecks preserve immutable creation data with ordered revisions", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    assert.deepEqual(await apply(db, a, mutation("UPDATE", 101, { name: "  Kaerapiim ", quantity: "2 l", checkedAt: NOW })), { status: "APPLIED", revision: 2 });
    const checked = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
    assert.deepEqual(JSON.parse(checked.payload_json), item({ name: "Kaerapiim", quantity: "2 l", checkedAt: NOW }));
    assert.equal(checked.created_at, CREATED);
    assert.deepEqual(await apply(db, a, mutation("UPDATE", 102, { checkedAt: null }, 2)), { status: "APPLIED", revision: 3 });
    assert.equal(JSON.parse((await one(db, "SELECT payload_json FROM shopping_items WHERE id = ?", ITEM_A)).payload_json).checkedAt, null);
    assert.deepEqual((await rows(db, "SELECT revision FROM change_log ORDER BY seq")).map(row => row.revision), [1, 2, 3]);
  });
});

test("shopping deletion retains a tombstone and cannot resurrect through UPDATE or CREATE", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    assert.deepEqual(await apply(db, a, mutation("DELETE", 103)), { status: "APPLIED", revision: 2 });
    const tombstone = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
    assert.equal(tombstone.deleted_at, NOW);
    assert.equal(tombstone.revision, 2);
    assert.deepEqual(JSON.parse(tombstone.payload_json), item());
    for (const value of [mutation("UPDATE", 104, { name: "Resurrect" }, 2), mutation("CREATE", 105), mutation("DELETE", 106, {}, 2)]) {
      assert.deepEqual(await apply(db, a, value), { status: "CONFLICT", code: "ENTITY_UNAVAILABLE" });
    }
    assert.deepEqual(await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A), tombstone);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
  });
});

test("stale shopping updates merge disjoint fields using contiguous history", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { name: "Kaerapiim" }));
    assert.deepEqual(await apply(db, a, mutation("UPDATE", 102, { quantity: "2 l" })), { status: "MERGED", revision: 3 });
    assert.deepEqual(JSON.parse((await one(db, "SELECT payload_json FROM shopping_items WHERE id = ?", ITEM_A)).payload_json), item({ name: "Kaerapiim", quantity: "2 l" }));
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 3")).changed_fields_json), ["quantity"]);
  });
});

test("stale same-field shopping updates retain the server value and return a conflict", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { checkedAt: NOW }));
    const before = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
    assert.deepEqual(await apply(db, a, mutation("UPDATE", 102, { checkedAt: null })), { status: "CONFLICT", code: "FIELD_OVERLAP" });
    assert.deepEqual(await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A), before);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
  });
});

test("missing shopping history cannot authorize a stale merge", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { name: "Kaerapiim" }));
    await db.prepare("DELETE FROM change_log WHERE entity_type = 'shopping_item' AND revision = 2").run();
    const before = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
    assert.deepEqual(await apply(db, a, mutation("UPDATE", 102, { quantity: "2 l" })), { status: "CONFLICT", code: "HISTORY_UNAVAILABLE" });
    assert.deepEqual(await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A), before);
    assert.equal(await one(db, "SELECT * FROM applied_mutations WHERE mutation_id = ?", uuidFor(102)), null);
  });
});

test("stale DELETE and future shopping revisions are safe conflicts", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { note: "New server note" }));
    for (const value of [mutation("DELETE", 102), mutation("UPDATE", 103, { name: "Future" }, 3)]) {
      assert.deepEqual(await apply(db, a, value), { status: "CONFLICT", code: "ENTITY_UNAVAILABLE" });
    }
    assert.equal((await one(db, "SELECT revision FROM shopping_items WHERE id = ?", ITEM_A)).revision, 2);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
});

test("shopping replay is durable and mutation ID reuse rejects changed data and households", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    const created = mutation();
    assert.deepEqual(await apply(db, a, created), { status: "APPLIED", revision: 1 });
    assert.deepEqual(await apply(db, a, created), { status: "REPLAYED", result: { status: "APPLIED", revision: 1 } });
    assert.deepEqual(await apply(db, a, { ...created, patch: item({ note: "Reused" }) }), { status: "REJECTED", code: "MUTATION_ID_REUSED" });
    assert.deepEqual(await apply(db, b, created), { status: "REJECTED", code: "MUTATION_UNAVAILABLE" });
    assert.equal((await rows(db, "SELECT * FROM shopping_items")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 1);
  });
});

test("shopping IDs cannot collide across households and foreign/missing records return identical conflicts", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    await apply(db, b, mutation("CREATE", 100, item({ note: "FOREIGN PRIVATE VALUE" })));
    const before = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
    assert.deepEqual(await apply(db, a, mutation("CREATE", 101)), { status: "CONFLICT", code: "ENTITY_UNAVAILABLE" });
    for (const operation of ["UPDATE", "DELETE"]) {
      const patch = operation === "UPDATE" ? { note: "Intrusion" } : {};
      const foreign = await apply(db, a, mutation(operation, 102, patch));
      const missing = await apply(db, a, mutation(operation, 103, patch, 1, ITEM_B));
      assert.deepEqual(foreign, { status: "CONFLICT", code: "ENTITY_UNAVAILABLE" });
      assert.deepEqual(missing, foreign);
      assert.doesNotMatch(JSON.stringify(foreign), /FOREIGN|hld_b|usr_b/);
    }
    assert.deepEqual(await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A), before);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
  });
});

test("same household MEMBER can create, edit and delete shopping items", async () => {
  await withFreshDb(async ({ db, a }) => {
    const member = await seedMember(db, a);
    assert.equal((await apply(db, member, mutation())).status, "APPLIED");
    assert.equal((await apply(db, member, mutation("UPDATE", 101, { category: "home" }))).status, "APPLIED");
    assert.equal((await apply(db, member, mutation("DELETE", 102, {}, 2))).status, "APPLIED");
    assert.deepEqual((await rows(db, "SELECT changed_by FROM change_log")).map(row => row.changed_by), [member.userId, member.userId, member.userId]);
  });
});

test("shopping immutable UPDATE fields reject even when unchanged", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    for (const patch of [{ id: ITEM_A }, { createdAt: CREATED }]) {
      assert.deepEqual(await apply(db, a, mutation("UPDATE", 101, patch)), { status: "REJECTED", code: "IMMUTABLE_FIELD" });
    }
    assert.equal((await one(db, "SELECT revision FROM shopping_items WHERE id = ?", ITEM_A)).revision, 1);
  });
});

test("shopping invalid envelopes, credentials and partial values reject before any write or clock", async () => {
  await withFreshDb(async ({ db, a }) => {
    const bad = [null, [], {}, { ...mutation(), mutationId: "mut_1" }, { ...mutation(), entityId: "item_1" },
      { ...mutation(), householdId: a.householdId }, { ...mutation(), token: "PRIVATE" },
      { ...mutation(), entityType: "calendar_event" }, { ...mutation(), operation: "UPSERT" },
      { ...mutation(), baseRevision: 1 }, { ...mutation(), baseRevision: Number.MAX_SAFE_INTEGER + 1 },
      mutation("UPDATE", 101, {}, 0), mutation("UPDATE", 102, { note: null }),
      mutation("UPDATE", 103, { householdId: null }), mutation("DELETE", 104, { checkedAt: null }),
      { ...mutation(), patch: item({ householdId: a.householdId }) }];
    for (const value of bad) {
      assert.deepEqual(await apply(db, a, value, () => { throw new Error("Clock must not run"); }), { status: "REJECTED", code: "INVALID_REQUEST" });
    }
    assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
    assert.deepEqual(await rows(db, "SELECT * FROM change_log"), []);
    assert.deepEqual(await rows(db, "SELECT * FROM applied_mutations"), []);
  });
});

test("shopping writes and shared mutation IDs preserve every existing calendar row", async () => {
  await withFreshDb(async ({ db, a }) => {
    await seedCalendar(db, a, "calendar_fixture", uuidFor(99));
    const calendar = await rows(db, "SELECT * FROM calendar_events");
    const logs = await rows(db, "SELECT * FROM change_log WHERE entity_type = 'calendar_event'");
    const applied = await rows(db, "SELECT * FROM applied_mutations WHERE mutation_id = ?", uuidFor(99));
    assert.deepEqual(await apply(db, a, mutation("CREATE", 99)), { status: "REJECTED", code: "MUTATION_ID_REUSED" });
    await apply(db, a, mutation());
    await apply(db, a, mutation("UPDATE", 101, { name: "Uus" }));
    await apply(db, a, mutation("DELETE", 102, {}, 2));
    assert.deepEqual(await rows(db, "SELECT * FROM calendar_events"), calendar);
    assert.deepEqual(await rows(db, "SELECT * FROM change_log WHERE entity_type = 'calendar_event'"), logs);
    assert.deepEqual(await rows(db, "SELECT * FROM applied_mutations WHERE mutation_id = ?", uuidFor(99)), applied);
  });
});

for (const table of ["change_log", "applied_mutations"]) {
  test(`shopping ${table} failure rolls back the item and both durable journals`, async () => {
    await withFreshDb(async ({ db, a }) => {
      await db.exec(`CREATE TRIGGER shopping_test_abort BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'PRIVATE_D1_SENTINEL'); END;`);
      await assert.rejects(() => apply(db, a, mutation()), error => error instanceof Error && !/PRIVATE_D1_SENTINEL/.test(error.message));
      assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
      assert.deepEqual(await rows(db, "SELECT * FROM change_log"), []);
      assert.deepEqual(await rows(db, "SELECT * FROM applied_mutations"), []);
      await db.exec("DROP TRIGGER shopping_test_abort;");
      assert.deepEqual(await apply(db, a, mutation()), { status: "APPLIED", revision: 1 });
    });
  });
}

test("concurrent same-field shopping updates have one durable winner and no orphan ACK or journal", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    const barrier = synchronizeShoppingReads(db);
    try {
      const results = await Promise.all([
        apply(barrier.db, a, mutation("UPDATE", 101, { name: "A wins" })),
        apply(barrier.db, a, mutation("UPDATE", 102, { name: "B wins" })),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(), ["APPLIED", "CONFLICT"]);
      const winner = results.findIndex(result => result.status === "APPLIED");
      const row = await one(db, "SELECT * FROM shopping_items WHERE id = ?", ITEM_A);
      assert.equal(row.revision, 2);
      assert.equal(JSON.parse(row.payload_json).name, winner === 0 ? "A wins" : "B wins");
      assert.deepEqual((await rows(db, "SELECT revision FROM change_log ORDER BY seq")).map(row => row.revision), [1, 2]);
      assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
    } finally { barrier.dispose(); }
  });
});

test("concurrent identical shopping mutations replay the durable winner without duplicate revisions", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    const barrier = synchronizeShoppingReads(db);
    try {
      const value = mutation("UPDATE", 101, { quantity: "2 l" });
      const results = await Promise.all([apply(barrier.db, a, value), apply(barrier.db, a, value)]);
      assert.deepEqual(results.map(result => result.status).sort(), ["APPLIED", "REPLAYED"]);
      assert.deepEqual(results.find(result => result.status === "REPLAYED").result, { status: "APPLIED", revision: 2 });
      assert.equal((await one(db, "SELECT revision FROM shopping_items WHERE id = ?", ITEM_A)).revision, 2);
      assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
      assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
    } finally { barrier.dispose(); }
  });
});

test("a concurrent disjoint shopping loser can retry and merge without losing either accepted field", async () => {
  await withFreshDb(async ({ db, a }) => {
    await apply(db, a, mutation());
    const barrier = synchronizeShoppingReads(db);
    try {
      const values = [mutation("UPDATE", 101, { name: "Kaerapiim" }), mutation("UPDATE", 102, { quantity: "2 l" })];
      const results = await Promise.all(values.map(value => apply(barrier.db, a, value)));
      assert.deepEqual(results.map(result => result.status).sort(), ["APPLIED", "CONFLICT"]);
      assert.deepEqual(await apply(db, a, values[results.findIndex(result => result.status === "CONFLICT")]), { status: "MERGED", revision: 3 });
      assert.deepEqual(JSON.parse((await one(db, "SELECT payload_json FROM shopping_items WHERE id = ?", ITEM_A)).payload_json), item({ name: "Kaerapiim", quantity: "2 l" }));
      assert.equal((await rows(db, "SELECT * FROM change_log")).length, 3);
      assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 3);
    } finally { barrier.dispose(); }
  });
});
