import assert from "node:assert/strict";
import { test } from "node:test";
import * as shoppingEndpoint from "../../functions/api/shopping/push.js";
import * as calendarEndpoint from "../../functions/api/sync/push.js";
import { withFreshDb, request, item, uuidFor, rows } from "./shopping-fixtures.mjs";

const CAPABILITY = "merge-evidence-v1";
const retryable = mutationId => ({ mutationId, status: "RETRYABLE", code: "CLIENT_UPGRADE_REQUIRED" });

const domains = [
  {
    name: "shopping", path: "/api/shopping/push", endpoint: shoppingEndpoint, table: "shopping_items",
    type: "shopping_item", id: uuidFor, create: id => item({ id, name: "Original", quantity: "1" }),
    remote: { quantity: "2" }, overlap: { quantity: "3" }, disjoint: { name: "Local name" }, dependent: { note: "Safe note" },
  },
  {
    name: "calendar", path: "/api/sync/push", endpoint: calendarEndpoint, table: "calendar_events",
    type: "calendar_event", id: value => `calendar_${value}`,
    create: id => ({ id, title: "Original", category: "general", date: "2026-10-05", source: "manual" }),
    remote: { title: "Remote title" }, overlap: { title: "Local title" }, disjoint: { notes: "Local note" }, dependent: { time: "10:30" },
  },
];

for (const domain of domains) {
  test(`${domain.name} requires explicit merge capability for writes and replay and stops a blocked batch`, async () => {
    await withFreshDb(async ({ db, a }) => {
      const { name, endpoint, path, table, type, id, create, remote, overlap, disjoint } = domain;
      const entityId = id(1);
      const build = (operation, sequence, baseRevision, patch, entity = entityId) =>
        ({ mutationId: id(100 + sequence), entityType: type, entityId: entity, operation, baseRevision, patch });
      const post = (mutations, capability) => endpoint.onRequestPost({
        request: request(path, a, { method: "POST", headers: {
          "Content-Type": "application/json",
          ...(capability === undefined ? {} : { "X-Annivibe-Sync-Capabilities": capability }),
        }, body: JSON.stringify({ mutations }) }),
        env: { DB: db },
      });
      const snapshot = async () => ({
        records: await rows(db, `SELECT id, revision, payload_json FROM ${table} ORDER BY id`),
        history: await rows(db, "SELECT * FROM change_log ORDER BY seq"),
        journal: await rows(db, "SELECT * FROM applied_mutations ORDER BY mutation_id"),
      });
      const assertUpgrade = async response => {
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error.code, "CLIENT_UPGRADE_REQUIRED");
      };

      for (const mutation of [build("CREATE", 1, 0, create(entityId)), build("UPDATE", 2, 1, remote)]) {
        const response = await post([mutation]);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).results[0].status, "APPLIED");
      }
      const before = await snapshot();
      const conflict = await post([build("UPDATE", 3, 1, overlap)]);
      assert.equal((await conflict.json()).results[0].code, "FIELD_OVERLAP", name);
      const stale = build("UPDATE", 4, 1, disjoint);
      await assertUpgrade(await post([stale]));
      await assertUpgrade(await post([stale], "merge-evidence-v10"));
      assert.deepEqual(await snapshot(), before, "unsupported singleton retries leave entity and both journals unchanged");

      const anotherId = id(2);
      const prefix = build("CREATE", 5, 0, create(anotherId), anotherId);
      // If the suffix ran after the refusal, its base would still equal the current revision.
      const dependent = build("UPDATE", 6, 2, overlap);
      const batch = [prefix, stale, dependent];
      const first = await post(batch);
      assert.equal(first.status, 200);
      assert.deepEqual((await first.json()).results, [
        { mutationId: prefix.mutationId, status: "APPLIED", revision: 1 },
        retryable(stale.mutationId), retryable(dependent.mutationId),
      ]);
      const afterBatch = await snapshot();
      assert.deepEqual(afterBatch.records.find(row => row.id === entityId), before.records[0]);
      assert.equal(afterBatch.history.length, before.history.length + 1);
      assert.equal(afterBatch.journal.length, before.journal.length + 1);
      const repeated = await post(batch);
      assert.equal(repeated.status, 200);
      assert.deepEqual((await repeated.json()).results, [
        { mutationId: prefix.mutationId, status: "REPLAYED", result: { status: "APPLIED", revision: 1 } },
        retryable(stale.mutationId), retryable(dependent.mutationId),
      ]);
      assert.deepEqual(await snapshot(), afterBatch);

      // The supported write commits; the client may lose that response and replay the same ID.
      const committed = await post([stale], `unrelated-v1, ${CAPABILITY}`);
      assert.equal(committed.status, 200);
      const afterMerge = await snapshot();
      assert.equal(afterMerge.records.find(row => row.id === entityId).revision, 3);
      assert.equal(afterMerge.history.length, afterBatch.history.length + 1);
      assert.equal(afterMerge.journal.length, afterBatch.journal.length + 1);
      await assertUpgrade(await post([stale]));
      const replay = await post([stale], CAPABILITY);
      const [ack] = (await replay.json()).results;
      assert.equal(ack.status, "REPLAYED");
      assert.equal(ack.result.status, "MERGED");
      assert.deepEqual(ack.result.merge.fields, Object.keys(remote));
      assert.deepEqual(await snapshot(), afterMerge, "replay never applies again");

      // Simulate a durable merge journal record created by the older release.
      await db.prepare("UPDATE applied_mutations SET result_json=json_remove(result_json, '$.result.merge') WHERE mutation_id=?")
        .bind(stale.mutationId).run();
      const oldJournal = await snapshot();
      await assertUpgrade(await post([stale]));
      const legacyReplay = await post([stale], CAPABILITY);
      assert.deepEqual((await legacyReplay.json()).results, [
        { mutationId: stale.mutationId, status: "REPLAYED", result: { status: "MERGED", revision: 3 } },
      ]);
      assert.deepEqual(await snapshot(), oldJournal);
    });
  });

  test(`${domain.name} protects mixed-version tabs after a capable MERGED acknowledgement`, async () => {
    await withFreshDb(async ({ db, a }) => {
      const id = uuidFor(30);
      const other = domains.find(entry => entry !== domain);
      const build = (target, n, operation, baseRevision, patch, entityId = id) => ({
        mutationId: uuidFor(n), entityType: target.type, entityId, operation, baseRevision, patch,
      });
      const post = (target, mutation, capable = false) => target.endpoint.onRequestPost({
        request: request(target.path, a, { method: "POST", headers: {
          "Content-Type": "application/json",
          ...(capable ? { "X-Annivibe-Sync-Capabilities": CAPABILITY } : {}),
        }, body: JSON.stringify({ mutations: [mutation] }) }),
        env: { DB: db },
      });
      async function assertResult(response, status, revision) {
        assert.equal(response.status, 200);
        const [ack] = (await response.json()).results;
        assert.equal(ack.status, status);
        assert.equal((status === "REPLAYED" ? ack.result : ack).revision, revision);
      }
      async function assertUpgrade(response) {
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error.code, "CLIENT_UPGRADE_REQUIRED");
      }

      const create = build(domain, 31, "CREATE", 0, domain.create(id));
      await assertResult(await post(domain, create), "APPLIED", 1);
      const earlierUpdate = build(domain, 32, "UPDATE", 1, domain.remote);
      await assertResult(await post(domain, earlierUpdate), "APPLIED", 2);
      await assertResult(await post(domain, build(domain, 33, "UPDATE", 1, domain.disjoint), true), "MERGED", 3);
      await assertResult(await post(domain, earlierUpdate), "REPLAYED", 2);

      // A cached tab reads the same IndexedDB, sees the safe dependent's new base,
      // and can no longer acknowledge it while ignoring the stored merge evidence.
      const dependent = build(domain, 34, "UPDATE", 3, domain.dependent);
      await assertUpgrade(await post(domain, dependent));
      await assertUpgrade(await post(domain, build(domain, 35, "DELETE", 3, {})));
      assert.deepEqual(await rows(db, "SELECT revision FROM change_log WHERE entity_type=? AND entity_id=? ORDER BY revision", domain.type, id),
        [{ revision: 1 }, { revision: 2 }, { revision: 3 }]);
      assert.deepEqual(await rows(db, "SELECT mutation_id FROM applied_mutations WHERE mutation_id IN (?,?)", dependent.mutationId, uuidFor(35)), []);
      await assertResult(await post(domain, dependent, true), "APPLIED", 4);
      // If the new tab wins first, an old replay must not discard the causal evidence either.
      await assertUpgrade(await post(domain, dependent));
      await assertResult(await post(domain, dependent, true), "REPLAYED", 4);
      await assertResult(await post(domain, create), "REPLAYED", 1);
      await assertUpgrade(await post(domain, build(domain, 36, "UPDATE", 4, domain.overlap)));

      const unrelated = uuidFor(40);
      await assertResult(await post(domain, build(domain, 37, "CREATE", 0, domain.create(unrelated), unrelated)), "APPLIED", 1);
      const normal = build(domain, 38, "UPDATE", 1, domain.remote, unrelated);
      await assertResult(await post(domain, normal), "APPLIED", 2);
      await assertResult(await post(domain, normal), "REPLAYED", 2);
      await assertResult(await post(other, build(other, 39, "CREATE", 0, other.create(id))), "APPLIED", 1);
      await assertResult(await post(other, build(other, 40, "UPDATE", 1, other.remote)), "APPLIED", 2);
    });
  });
}
