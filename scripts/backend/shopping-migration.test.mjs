import assert from "node:assert/strict";
import { test } from "node:test";
import { applyShoppingMigration, withFreshDb, seedCalendar, rows, ITEM_A, item, CREATED, NOW } from "./shopping-fixtures.mjs";

test("shopping migration adds an empty table to a fresh 0001 database", async () => {
  await withFreshDb(async ({ db }) => {
    assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
    const indexes = await rows(db, "PRAGMA index_list(shopping_items)");
    assert.ok(indexes.some(index => index.name === "idx_shopping_items_household"));
  }, { seed: false });
});

test("shopping migration preserves every existing row and schema object on a populated 0001 database", async () => {
  await withFreshDb(async ({ db, a }) => {
    await seedCalendar(db, a);
    const tables = (await rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(row => row.name);
    const snapshots = new Map();
    for (const name of tables) snapshots.set(name, await rows(db, `SELECT * FROM ${name}`));
    const objects = await rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name");
    await applyShoppingMigration(db);
    for (const name of tables) assert.deepEqual(await rows(db, `SELECT * FROM ${name}`), snapshots.get(name), name);
    const after = await rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name != 'shopping_items' ORDER BY name");
    assert.deepEqual(after, objects);
    assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
  }, { shopping: false });
});

test("shopping SQL protects JSON, revisions, household ownership and globally unique IDs", async () => {
  await withFreshDb(async ({ db, a }) => {
    const insert = values => db.prepare("INSERT INTO shopping_items (id, household_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(...values).run();
    const valid = [ITEM_A, a.householdId, JSON.stringify(item()), 1, CREATED, NOW];
    for (const [index, value] of [[0, null], [1, null], [1, "foreign_missing"], [2, "{broken"], [3, 0], [4, null], [5, null]]) {
      const candidate = [...valid];
      candidate[index] = value;
      await assert.rejects(() => insert(candidate));
      assert.deepEqual(await rows(db, "SELECT * FROM shopping_items"), []);
    }
    await insert(valid);
    await assert.rejects(() => insert(valid));
    assert.equal((await rows(db, "SELECT * FROM shopping_items")).length, 1);
  });
});
