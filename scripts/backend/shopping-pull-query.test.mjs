import assert from "node:assert/strict";
import { test } from "node:test";
import { readShoppingBootstrap, readShoppingDelta } from "../../functions/_lib/shoppingRepository.js";
import { withFreshDb, mutation, item, ITEM_A, ITEM_B, uuidFor, NOW, seedCalendar, request } from "./shopping-fixtures.mjs";
import { applyShoppingMutation } from "../../functions/_lib/shopping.js";
import * as bootstrapEndpoint from "../../functions/api/shopping/bootstrap.js";
import * as pullEndpoint from "../../functions/api/shopping/pull.js";

// Frozen read queries from 8187699: semantic oracle, never used by production.
const priorBind = (db, sql, values) => db.prepare(sql).bind(...values);

async function readBeforeShoppingBootstrap(db, householdId) {
  const [cursorResult, rowsResult] = await db.batch([
    priorBind(db, "SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE household_id = ? AND entity_type = 'shopping_item'", [householdId]),
    priorBind(db,
      `SELECT item.id, item.payload_json, item.revision, item.created_at, item.updated_at, item.deleted_at,
              log.revision AS latest_revision, log.operation AS latest_operation
       FROM shopping_items AS item
       LEFT JOIN change_log AS log ON log.seq = (
         SELECT MAX(seq) FROM change_log
         WHERE household_id = item.household_id AND entity_type = 'shopping_item' AND entity_id = item.id
       )
       WHERE item.household_id = ? ORDER BY item.id`, [householdId]),
  ]);
  return { cursor: cursorResult.results[0].cursor, rows: rowsResult.results };
}

async function readBeforeShoppingDelta(db, householdId, after) {
  const [cursorResult, ownershipResult, changesResult] = await db.batch([
    priorBind(db,
      `WITH scoped AS (
         SELECT seq, entity_id, revision, operation FROM change_log
         WHERE household_id = ? AND entity_type = 'shopping_item'
       )
       SELECT COALESCE(MAX(seq), 0) AS cursor,
         CASE WHEN EXISTS (
           SELECT 1 FROM shopping_items AS item
           LEFT JOIN scoped AS log ON log.seq = (SELECT MAX(seq) FROM scoped WHERE entity_id = item.id)
           WHERE item.household_id = ? AND (log.seq IS NULL OR log.revision != item.revision
             OR (log.operation = 'DELETE') != (item.deleted_at IS NOT NULL))
         ) OR EXISTS (
           SELECT 1 FROM scoped AS log LEFT JOIN shopping_items AS item
             ON item.id = log.entity_id AND item.household_id = ?
           WHERE item.id IS NULL
         ) THEN 1 ELSE 0 END AS history_incomplete
       FROM scoped`, [householdId, householdId, householdId]),
    priorBind(db, "SELECT seq FROM change_log WHERE household_id = ? AND entity_type = 'shopping_item' AND seq = ? LIMIT 1", [householdId, after]),
    priorBind(db,
      `WITH latest AS (
         SELECT entity_id, MAX(seq) AS seq, COUNT(*) AS history_count,
                COUNT(DISTINCT revision) AS history_distinct,
                MIN(revision) AS history_first, MAX(revision) AS history_last
         FROM change_log WHERE household_id = ? AND entity_type = 'shopping_item' AND seq > ?
         GROUP BY entity_id
       )
       SELECT log.seq, log.entity_type, log.entity_id, log.operation, log.revision AS change_revision,
              item.id, item.payload_json, item.revision, item.created_at, item.updated_at, item.deleted_at,
              latest.history_count, latest.history_distinct, latest.history_first, latest.history_last,
              COALESCE((SELECT MAX(revision) FROM change_log
                        WHERE household_id = ? AND entity_type = 'shopping_item'
                          AND entity_id = log.entity_id AND seq <= ?), 0) AS history_base_revision
       FROM latest JOIN change_log AS log ON log.seq = latest.seq
       LEFT JOIN shopping_items AS item ON item.id = log.entity_id AND item.household_id = log.household_id
       ORDER BY log.seq`, [householdId, after, householdId, after]),
  ]);
  return { cursor: cursorResult.results[0].cursor, incomplete: cursorResult.results[0].history_incomplete === 1,
    owned: ownershipResult.results.length === 1, rows: changesResult.results };
}

// Observe only the SQL actually submitted at the repository's D1 batch boundary.
function captureReads(db) {
  const submitted = [];
  const statements = new WeakMap();
  const wrap = (statement, sql, values = []) => {
    const wrapped = { bind: (...bindings) => wrap(statement.bind(...bindings), sql, bindings) };
    statements.set(wrapped, { statement, sql, values });
    return wrapped;
  };
  return { submitted, db: {
    prepare: sql => wrap(db.prepare(sql), sql),
    batch: prepared => {
      const batch = prepared.map(statement => statements.get(statement));
      submitted.push(batch);
      return db.batch(batch.map(({ statement }) => statement));
    },
  } };
}

test("shopping read plans aggregate history once instead of correlating a scan per item", async t => {
  await withFreshDb(async ({ db, a }) => {
    assert.equal((await applyShoppingMutation({ db, context: a, mutation: mutation(), clock: () => NOW })).status, "APPLIED");
    const observed = captureReads(db);
    await readShoppingBootstrap(observed.db, a.householdId);
    await readShoppingDelta(observed.db, a.householdId, 1);
    assert.deepEqual(observed.submitted.map(batch => batch.length), [2, 3], "each coherent read still uses one batch");
    const historyReads = [observed.submitted[0][1], observed.submitted[1][0], observed.submitted[1][2]];
    for (const [index, { sql, values }] of historyReads.entries()) {
      const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all()).results;
      const details = plan.map(row => row.detail);
      t.diagnostic(`read ${index}: ${details.join(" | ")}`);
      assert.ok(!details.some(detail => /CORRELATED/i.test(detail)), `history read ${index} must not run a correlated subquery`);
      assert.match(sql, /GROUP BY\s+entity_id/i, "latest changes must be computed as a set");
    }
  });
});

const apply = async (db, context, value) => {
  const result = await applyShoppingMutation({ db, context, mutation: value, clock: () => NOW });
  assert.equal(result.status, "APPLIED");
};

async function compareBootstrap(db, owner) {
  const old = await readBeforeShoppingBootstrap(db, owner.householdId);
  assert.deepEqual(await readShoppingBootstrap(db, owner.householdId), old);
  return old;
}

async function comparePull(db, owner, after, expectedStatus = 200) {
  const observed = captureReads(db);
  const old = await readBeforeShoppingDelta(observed.db, owner.householdId, after);
  const optimized = await readShoppingDelta(db, owner.householdId, after);
  assert.deepEqual(optimized, old, `repository result at cursor ${after}`);
  // The unchanged endpoint runs once with each SQL implementation, including its
  // auth, cursor ownership, continuity, tombstone and canonical-payload checks.
  const priorDb = { prepare: sql => db.prepare(sql),
    batch: () => db.batch(observed.submitted[0].map(({ statement }) => statement)) };
  const invoke = db => pullEndpoint.onRequestGet({
    request: request(`/api/shopping/pull?after=${after}`, owner), env: { DB: db },
  });
  const [before, afterOptimization] = await Promise.all([invoke(priorDb), invoke(db)]);
  assert.equal(afterOptimization.status, before.status);
  assert.equal(afterOptimization.status, expectedStatus);
  const body = await afterOptimization.json();
  assert.deepEqual(body, await before.json());
  if (expectedStatus === 409) assert.equal(body.error.code, "RESYNC_REQUIRED");
  else assert.ok(body.changes.every(change => change.entityType === "shopping_item"));
  return body;
}

test("set-based shopping reads match the previous empty, CREATE, UPDATE, DELETE and mixed-history results", async () => {
  await withFreshDb(async ({ db, a, b }) => {
    assert.deepEqual(await compareBootstrap(db, a), { cursor: 0, rows: [] });
    assert.deepEqual(await comparePull(db, a, 0), { cursor: 0, changes: [] });
    await apply(db, a, mutation());
    let body = await comparePull(db, a, 0);
    assert.deepEqual(body.changes.map(({ seq, entityId, operation, revision }) => ({ seq, entityId, operation, revision })),
      [{ seq: 1, entityId: ITEM_A, operation: "CREATE", revision: 1 }]);
    assert.equal((await compareBootstrap(db, a)).rows.length, 1);
    await apply(db, a, mutation("UPDATE", 101, { quantity: "2 l" }));
    body = await comparePull(db, a, 1);
    assert.equal(body.changes[0].operation, "UPDATE");
    assert.equal(body.changes[0].revision, 2);
    assert.equal(body.changes[0].record.payload.quantity, "2 l");
    await seedCalendar(db, a, ITEM_A, "calendar_same_entity_id");
    await apply(db, b, mutation("CREATE", 102, item({ id: uuidFor(3), note: "FOREIGN" }), 0, uuidFor(3)));
    await apply(db, a, mutation("CREATE", 103, item({ id: ITEM_B, name: "Leib" }), 0, ITEM_B));
    await apply(db, a, mutation("UPDATE", 104, { note: "latest note" }, 2));
    await apply(db, a, mutation("DELETE", 105, {}, 3));
    body = await comparePull(db, a, 0);
    assert.equal(body.cursor, 7, "calendar and foreign rows do not define the shopping cursor");
    assert.deepEqual(body.changes.map(change => [change.seq, change.entityId, change.operation, change.revision]),
      [[5, ITEM_B, "CREATE", 1], [7, ITEM_A, "DELETE", 4]]);
    const tombstone = body.changes[1].record;
    assert.equal(tombstone.deletedAt, NOW);
    assert.deepEqual(tombstone.payload, item({ quantity: "2 l", note: "latest note" }));
    assert.equal(JSON.stringify(body).includes("FOREIGN"), false);
    for (const cursor of [1, 2, 5, 6, 7]) await comparePull(db, a, cursor);
    for (const cursor of [3, 4, 8, 999]) await comparePull(db, a, cursor, 409);
    assert.deepEqual(await comparePull(db, a, 7), { cursor: 7, changes: [] });
    const boot = await compareBootstrap(db, a);
    assert.deepEqual(boot.rows.map(row => [row.id, row.revision, row.latest_operation]),
      [[ITEM_A, 4, "DELETE"], [ITEM_B, 1, "CREATE"]]);
    const response = await bootstrapEndpoint.onRequestGet({ request: request("/api/shopping/bootstrap", a), env: { DB: db } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).shoppingItems[0], tombstone);
    await comparePull(db, b, 4);
    await comparePull(db, b, 7, 409);
  });
});

test("set-based shopping reads preserve RESYNC_REQUIRED for missing, orphaned and inconsistent history", async t => {
  const cases = [
    ["latest revision missing", "DELETE FROM change_log WHERE seq = 3"],
    ["middle revision missing", "DELETE FROM change_log WHERE seq = 2"],
    ["item has no history", "DELETE FROM change_log"],
    ["history has no item", "DELETE FROM shopping_items"],
    ["latest revision disagrees", "UPDATE change_log SET revision = 8 WHERE seq = 3"],
    ["latest operation disagrees", "UPDATE change_log SET operation = 'DELETE' WHERE seq = 3"],
  ];
  for (const [name, sql] of cases) await t.test(name, async () => {
    await withFreshDb(async ({ db, a }) => {
      await apply(db, a, mutation());
      await apply(db, a, mutation("UPDATE", 101, { note: "middle" }));
      await apply(db, a, mutation("UPDATE", 102, { quantity: "3" }, 2));
      await db.prepare(sql).run();
      await compareBootstrap(db, a);
      await comparePull(db, a, 0, 409);
      await comparePull(db, a, 1, 409);
    });
  });
});

test("set-based shopping pull stays equivalent on 11000 interleaved history rows without per-item scans", async t => {
  await withFreshDb(async ({ db, a, b }) => {
    const ids = "'00000000-0000-4000-8000-' || printf('%012x', n + 1000)";
    const numbers = "WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < 299)";
    await db.prepare(`${numbers}
      INSERT INTO shopping_items (id, household_id, payload_json, revision, created_at, updated_at, deleted_at)
      SELECT ${ids}, ?, json_object('id', ${ids}, 'name', 'Synthetic item', 'quantity', '', 'category', 'food',
        'note', '', 'checkedAt', NULL, 'createdAt', ?), 20, ?, ?, CASE WHEN n % 7 = 0 THEN ? ELSE NULL END
      FROM numbers`).bind(a.householdId, NOW, NOW, NOW, NOW).run();
    await db.prepare(`${numbers}, revisions(rev) AS (SELECT 1 UNION ALL SELECT rev + 1 FROM revisions WHERE rev < 20)
      INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at)
      SELECT ?, 'shopping_item', ${ids}, rev, CASE WHEN rev = 1 THEN 'CREATE'
        WHEN rev = 20 AND n % 7 = 0 THEN 'DELETE' ELSE 'UPDATE' END, '[]', ?, ?
      FROM revisions CROSS JOIN numbers ORDER BY rev, n`).bind(a.householdId, a.userId, NOW).run();
    for (const [household, type, count] of [[a, 'calendar_event', 3000], [b, 'shopping_item', 2000]]) {
      await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
        INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at)
        SELECT ?, ?, 'unrelated-' || n, 1, 'CREATE', '[]', ?, ? FROM numbers`)
        .bind(count - 1, household.householdId, type, household.userId, NOW).run();
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM change_log").first()).count, 11000);
    for (const cursor of [0, 3000, 5700, 6000]) {
      const body = await comparePull(db, a, cursor);
      assert.equal(body.cursor, 6000);
      assert.equal(body.changes.length, cursor === 6000 ? 0 : 300);
      assert.deepEqual(body.changes.map(change => change.seq), cursor === 6000 ? [] : Array.from({ length: 300 }, (_, n) => 5701 + n));
      if (body.changes.length) assert.equal(body.changes[0].record.deletedAt, NOW, "latest tombstones are retained");
    }
    assert.equal((await compareBootstrap(db, a)).rows.length, 300);
    await comparePull(db, a, 6001, 409);
    await comparePull(db, a, 9001, 409);
    const observed = captureReads(db);
    await readShoppingDelta(observed.db, a.householdId, 5700);
    for (const { sql, values } of observed.submitted[0]) {
      const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all()).results.map(row => row.detail);
      assert.equal(plan.some(detail => /CORRELATED/i.test(detail)), false);
      t.diagnostic(`large-history plan: ${plan.join(" | ")}`);
    }
  });
});
