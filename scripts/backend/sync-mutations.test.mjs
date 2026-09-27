import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { insertHouseholdCreation } from "../../functions/_lib/db.js";
import {
  applyCalendarMutation,
  calendarMutationDigest,
  canonicalJson,
  validateCalendarEventPayload,
} from "../../functions/_lib/sync.js";
import { createEvent, validateEvent } from "../../src/calendar/eventModel.js";
import { createEventRepository, EVENT_STORAGE_KEY } from "../../src/calendar/eventRepository.js";
import { reconcileWaste } from "../../src/waste/reconcile.js";

// RED interface gate for Sync V1A-1. The four sync.js exports above are the
// proposed GREEN seam. applyCalendarMutation receives only trusted context,
// one mutation, a D1 binding and an injected clock; it returns a status result.
// REPLAYED.result is the original stored result. syncRepository.js is the
// repository collaborator, tested through the public mutation seam and D1.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationSql = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
const NOW = "2026-09-27T10:00:00.000Z";
const CONTEXT_A = Object.freeze({ sessionId: "ses_a", userId: "usr_a", householdId: "hld_a", role: "OWNER" });
const CONTEXT_B = Object.freeze({ sessionId: "ses_b", userId: "usr_b", householdId: "hld_b", role: "OWNER" });

function manualEvent(overrides = {}) {
  return {
    id: "evt_1", title: "Arsti aeg", category: "general", subtype: null,
    date: "2026-10-05", time: null, recurrence: { frequency: "none", interval: 1 },
    reminder: { daysBefore: 0 }, source: "manual", householdId: null,
    notes: "", seriesId: null, excludedDates: [], overrides: {}, ...overrides,
  };
}

function weeklyEvent(overrides = {}) {
  return manualEvent({
    recurrence: { frequency: "weekly", interval: 1 }, seriesId: "series:evt_1",
    ...overrides,
  });
}

function importedEvent(overrides = {}) {
  return manualEvent({
    title: "Biojäätmed", category: "waste", subtype: "bio", source: "imported",
    importMeta: {
      provider: "provider-a", providerName: "Linna vedaja", address: "Õnne  1",
      addressKey: "õnne 1", externalId: "schedule-1", importedAt: NOW,
    },
    ...overrides,
  });
}

function mutation(operation = "CREATE", overrides = {}) {
  return {
    mutationId: "mut_1", entityType: "calendar_event", entityId: "evt_1",
    operation, baseRevision: operation === "CREATE" ? 0 : 1,
    patch: operation === "CREATE" ? manualEvent() : {}, ...overrides,
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
    if (character === "'" || character === '"') { quote = character; continue; }
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
    await seedOwner(db, "a");
    await seedOwner(db, "b");
    return await callback(db);
  } finally {
    await miniflare.dispose();
  }
}

async function seedOwner(db, suffix) {
  await insertHouseholdCreation(db, {
    householdId: `hld_${suffix}`, householdName: `Household ${suffix}`,
    householdAddress: `Address ${suffix}`, ownerUserId: `usr_${suffix}`,
    revision: 1, createdAt: NOW, updatedAt: NOW,
    userName: `Owner ${suffix}`, role: "OWNER", sessionId: `ses_${suffix}`,
    tokenHash: suffix.repeat(64), deviceName: `Device ${suffix}`,
    lastSeenAt: NOW, recoveryHash: (suffix === "a" ? "c" : "d").repeat(64),
  });
}

async function rows(db, sql, ...values) {
  const statement = db.prepare(sql);
  const result = await (values.length ? statement.bind(...values) : statement).all();
  return result.results;
}

async function one(db, sql, ...values) {
  const statement = db.prepare(sql);
  return (values.length ? statement.bind(...values) : statement).first();
}

async function apply(db, value, context = CONTEXT_A) {
  return applyCalendarMutation({ db, context, mutation: value, clock: () => NOW });
}

async function create(db, event = manualEvent(), id = "mut_create", context = CONTEXT_A) {
  return apply(db, mutation("CREATE", { mutationId: id, entityId: event.id, patch: event }), context);
}

async function update(db, patch, id = "mut_update", baseRevision = 1, context = CONTEXT_A) {
  return apply(db, mutation("UPDATE", { mutationId: id, patch, baseRevision }), context);
}

async function assertNoMutationRows(db) {
  assert.deepEqual(await rows(db, "SELECT id FROM calendar_events"), []);
  assert.deepEqual(await rows(db, "SELECT seq FROM change_log"), []);
  assert.deepEqual(await rows(db, "SELECT mutation_id FROM applied_mutations"), []);
}

function assertRejected(result, code) {
  assert.equal(result.status, "REJECTED");
  if (code) assert.equal(result.code, code);
}

function assertConflict(result, code) {
  assert.equal(result.status, "CONFLICT");
  if (code) assert.equal(result.code, code);
}

// A. Strict server validator: one top-level test for each accepted case.
test("01 canonical fully specified manual event is returned byte-identically", () => {
  const event = manualEvent();
  assert.deepEqual(validateCalendarEventPayload(event, event.id), event);
  assert.equal(JSON.stringify(validateCalendarEventPayload(event, event.id)), JSON.stringify(event));
});

test("02 absent optional fields default; present noncanonical values and waste without subtype reject", () => {
  const minimal = { id: "evt_1", title: "Arsti aeg", category: "general", date: "2026-10-05", source: "manual" };
  assert.deepEqual(validateCalendarEventPayload(minimal, "evt_1"), manualEvent());
  assert.deepEqual(validateCalendarEventPayload({
    ...minimal, recurrence: { frequency: "weekly" }, seriesId: "series:evt_1",
  }, "evt_1"), weeklyEvent());
  for (const event of [
    { ...minimal, category: "waste" },
    { ...minimal, title: " Arsti aeg " },
    { ...minimal, time: "" },
    { ...minimal, notes: null },
  ]) assert.throws(() => validateCalendarEventPayload(event, "evt_1"));
});

test("03 unknown top-level, recurrence, reminder, override and import metadata keys reject", () => {
  for (const event of [
    manualEvent({ syncStatus: "synced" }),
    manualEvent({ recurrence: { frequency: "none", interval: 1, weekStart: 1 } }),
    manualEvent({ reminder: { daysBefore: 0, channel: "sms" } }),
    weeklyEvent({ overrides: { "2026-10-12": { title: "Other", prototypeFlag: true } } }),
    importedEvent({ importMeta: { ...importedEvent().importMeta, rawResponse: "secret" } }),
  ]) assert.throws(() => validateCalendarEventPayload(event, "evt_1"));
});

test("04 recurrence and reminder reject malformed, out-of-range and noncanonical shapes", () => {
  for (const recurrence of [
    null, { frequency: "daily", interval: 1 }, { frequency: "none", interval: 2 },
    { frequency: "weekly", interval: 53 }, { frequency: "monthly", interval: 13 },
    { frequency: "yearly", interval: 2 }, { frequency: "weekly", interval: 1.5 },
    { frequency: "weekly", interval: "1" },
  ]) assert.throws(() => validateCalendarEventPayload(weeklyEvent({ recurrence }), "evt_1"));
  for (const reminder of [null, { daysBefore: 2 }, { daysBefore: "1" }, { daysBefore: -1 }, { daysBefore: 0.5 }]) {
    assert.throws(() => validateCalendarEventPayload(manualEvent({ reminder }), "evt_1"));
  }
});

test("05 import metadata enforces lengths, derived address key, canonical time and imported waste relationship", () => {
  assert.deepEqual(validateCalendarEventPayload(importedEvent(), "evt_1"), importedEvent());
  for (const [key, maximum] of [["provider", 100], ["providerName", 100], ["address", 500], ["externalId", 1500]]) {
    const meta = importedEvent().importMeta;
    assert.doesNotThrow(() => validateCalendarEventPayload(importedEvent({ importMeta: { ...meta, [key]: "a".repeat(maximum), ...(key === "address" ? { addressKey: "a".repeat(maximum) } : {}) } }), "evt_1"));
    assert.throws(() => validateCalendarEventPayload(importedEvent({ importMeta: { ...meta, [key]: "a".repeat(maximum + 1) } }), "evt_1"));
  }
  for (const meta of [
    { ...importedEvent().importMeta, addressKey: "õnne  1" },
    { ...importedEvent().importMeta, importedAt: "2026-09-27T10:00:00Z" },
    { ...importedEvent().importMeta, importedAt: "2026-02-29T10:00:00.000Z" },
    { ...importedEvent().importMeta, provider: " " },
  ]) assert.throws(() => validateCalendarEventPayload(importedEvent({ importMeta: meta }), "evt_1"));
  assert.throws(() => validateCalendarEventPayload(importedEvent({ category: "general", subtype: null }), "evt_1"));
});

test("06 a real reconcileWaste event validates; imported source requires importMeta", () => {
  const source = { id: "waste-provider", name: "Linna vedaja" };
  const result = reconcileWaste([], {
    status: "SUPPORTED_WITH_RESULTS", provider: source, address: "Õnne  1",
    entries: [{ externalId: "route-1", date: "2026-10-05", subtype: "bio", title: "Biojäätmed", time: null }],
  }, new Date(NOW), () => "evt_1");
  assert.deepEqual(validateCalendarEventPayload(result.events[0], "evt_1"), result.events[0]);
  const missing = importedEvent();
  delete missing.importMeta;
  assert.throws(() => validateCalendarEventPayload(missing, "evt_1"));
});

test("07 payload ID must equal the mutation entity ID", () => {
  assert.throws(() => validateCalendarEventPayload(manualEvent(), "evt_other"));
});

test("08 only absent or null payload householdId is accepted and canonicalizes to null", () => {
  const absent = manualEvent();
  delete absent.householdId;
  assert.equal(validateCalendarEventPayload(absent, "evt_1").householdId, null);
  assert.equal(validateCalendarEventPayload(manualEvent(), "evt_1").householdId, null);
  assert.throws(() => validateCalendarEventPayload(manualEvent({ householdId: "hld_a" }), "evt_1"));
});

test("09 title and notes lengths use current JavaScript UTF-16 String.length", () => {
  assert.doesNotThrow(() => validateCalendarEventPayload(manualEvent({ title: "a".repeat(200), notes: "b".repeat(5000) }), "evt_1"));
  for (const event of [
    manualEvent({ title: "a".repeat(201) }), manualEvent({ title: "😀".repeat(101) }),
    manualEvent({ notes: "b".repeat(5001) }),
  ]) assert.throws(() => validateCalendarEventPayload(event, "evt_1"));
});

// B. Canonical JSON and digest.
test("10 canonicalJson sorts recursively, preserves array order and has no whitespace", () => {
  assert.equal(canonicalJson({ z: [{ b: 2, a: 1 }, 3], a: { y: "sp ace", x: [2, 1] } }),
    '{"a":{"x":[2,1],"y":"sp ace"},"z":[{"a":1,"b":2},3]}');
});

test("11 digest matches the fixed UTF-8 SHA-256 delete vector and excludes mutationId", async () => {
  const value = mutation("DELETE", { mutationId: "mut_any", baseRevision: 7, patch: {} });
  assert.equal(await calendarMutationDigest(value), "93f85034cfafbbbc83e1ecf3dc1b45bd62f190445ae50be48eb76fde083a9fac");
  assert.equal(await calendarMutationDigest({ ...value, mutationId: "mut_other" }), await calendarMutationDigest(value));
});

test("12 digest is stable under key permutations and equivalent defaults, but every canonical mutation field matters", async () => {
  const full = mutation("CREATE");
  const minimal = { id: "evt_1", title: "Arsti aeg", category: "general", date: "2026-10-05", source: "manual" };
  const permuted = { patch: { source: "manual", date: "2026-10-05", category: "general", title: "Arsti aeg", id: "evt_1" },
    baseRevision: 0, operation: "CREATE", entityId: "evt_1", entityType: "calendar_event", mutationId: "another" };
  assert.deepEqual(validateCalendarEventPayload(minimal, "evt_1"), full.patch);
  const digest = await calendarMutationDigest(full);
  assert.equal(await calendarMutationDigest(permuted), digest);
  const recurring = mutation("CREATE", { patch: weeklyEvent() });
  const withoutInterval = { ...recurring, patch: { ...recurring.patch, recurrence: { frequency: "weekly" } } };
  assert.deepEqual(validateCalendarEventPayload(withoutInterval.patch, "evt_1"), recurring.patch);
  assert.equal(await calendarMutationDigest(withoutInterval), await calendarMutationDigest(recurring));
  for (const changed of [
    { ...full, entityId: "evt_2", patch: { ...full.patch, id: "evt_2" } },
    { ...full, operation: "UPDATE", baseRevision: 1, patch: { title: "Arsti aeg" } },
    { ...full, baseRevision: 1 },
    { ...full, patch: { ...full.patch, title: "Uus aeg" } },
  ]) assert.notEqual(await calendarMutationDigest(changed), digest);
  await assert.rejects(() => calendarMutationDigest({ ...full, patch: { ...full.patch, prototypeOnly: true } }));
});

// C. CREATE: all four durable effects are observed in the migrated local D1.
test("13 CREATE at base 0 writes revision 1, calendar row, CREATE log and idempotency record", async () => {
  await withFreshDb(async db => {
    const result = await create(db);
    assert.equal(result.status, "APPLIED");
    assert.equal(result.revision, 1);
    const event = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(event.household_id, CONTEXT_A.householdId);
    assert.equal(event.revision, 1);
    assert.equal(event.created_at, NOW);
    assert.equal(event.updated_at, NOW);
    assert.equal(event.deleted_at, null);
    assert.deepEqual(JSON.parse(event.payload_json), manualEvent());
    const log = await one(db, "SELECT * FROM change_log WHERE entity_id = ?", "evt_1");
    assert.equal(log.household_id, CONTEXT_A.householdId);
    assert.equal(log.entity_type, "calendar_event");
    assert.equal(log.operation, "CREATE");
    assert.equal(log.revision, 1);
    assert.equal(log.changed_by, CONTEXT_A.userId);
    assert.deepEqual(JSON.parse(log.changed_fields_json), Object.keys(manualEvent()).sort());
    const applied = await one(db, "SELECT * FROM applied_mutations WHERE mutation_id = ?", "mut_create");
    assert.equal(applied.household_id, CONTEXT_A.householdId);
    assert.deepEqual(JSON.parse(applied.result_json), {
      digest: await calendarMutationDigest(mutation("CREATE", { mutationId: "mut_create" })),
      result,
    });
  });
});

test("14 CREATE with any nonzero base revision rejects without a write", async () => {
  await withFreshDb(async db => {
    for (const baseRevision of [-1, 1, 1.5, "0"]) {
      assertRejected(await apply(db, mutation("CREATE", { mutationId: `mut_${String(baseRevision)}`, baseRevision })));
      await assertNoMutationRows(db);
    }
  });
});

test("15 a live same-household ID collision returns a generic conflict and changes nothing", async () => {
  await withFreshDb(async db => {
    await create(db);
    const result = await create(db, manualEvent({ title: "Replacement" }), "mut_collision");
    assertConflict(result);
    assert.equal(JSON.stringify(result).includes("Arsti aeg"), false);
    assert.equal((await rows(db, "SELECT * FROM calendar_events")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
  });
});

test("16 a tombstoned same-household ID collides with the same generic CREATE conflict", async () => {
  await withFreshDb(async db => {
    await create(db);
    const live = await create(db, manualEvent({ title: "Replacement" }), "mut_live_collision");
    const removed = await apply(db, mutation("DELETE", { mutationId: "mut_delete", baseRevision: 1 }));
    assert.equal(removed.status, "APPLIED");
    const tombstone = await create(db, manualEvent({ title: "Replacement" }), "mut_tombstone_collision");
    assert.deepEqual(tombstone, live);
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 2);
  });
});

test("17 a foreign-household ID collision is equally generic and leaks no foreign payload", async () => {
  await withFreshDb(async db => {
    await create(db, manualEvent({ id: "evt_local" }), "mut_local");
    const local = await create(db, manualEvent({ id: "evt_local" }), "mut_local_collision");
    await create(db, manualEvent({ id: "evt_foreign", title: "PRIVATE FOREIGN TITLE" }), "mut_foreign", CONTEXT_B);
    const foreign = await create(db, manualEvent({ id: "evt_foreign" }), "mut_foreign_collision", CONTEXT_A);
    assert.deepEqual(foreign, local);
    assert.doesNotMatch(JSON.stringify(foreign), /PRIVATE FOREIGN TITLE|hld_b|usr_b/);
    assert.equal((await one(db, "SELECT payload_json FROM calendar_events WHERE id = ?", "evt_foreign")).payload_json.includes("PRIVATE FOREIGN TITLE"), true);
  });
});

// D. Idempotency: the digest binds the canonical mutation, not the retry ID.
test("18 retrying the same mutation ID and digest replays its stored original result", async () => {
  await withFreshDb(async db => {
    const first = await create(db);
    const retry = await create(db);
    assert.equal(retry.status, "REPLAYED");
    assert.deepEqual(retry.result, first);
    assert.equal((await rows(db, "SELECT * FROM calendar_events")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 1);
  });
});

test("19 reuse of a mutation ID with different entity, operation, base or patch rejects", async () => {
  await withFreshDb(async db => {
    await create(db, manualEvent(), "mut_fixed");
    const original = mutation("CREATE", { mutationId: "mut_fixed" });
    const variants = [
      { ...original, entityId: "evt_2", patch: manualEvent({ id: "evt_2" }) },
      { ...original, operation: "DELETE", patch: {} },
      { ...original, baseRevision: 1 },
      { ...original, patch: manualEvent({ title: "Different" }) },
    ];
    for (const variant of variants) assertRejected(await apply(db, variant), "MUTATION_ID_REUSED");
    assert.equal((await rows(db, "SELECT * FROM calendar_events")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 1);
  });
});

test("20 a foreign-household mutation ID is generically unavailable without result_json leakage", async () => {
  await withFreshDb(async db => {
    await create(db, manualEvent({ id: "evt_private", title: "PRIVATE FOREIGN TITLE" }), "mut_shared", CONTEXT_B);
    const result = await create(db, manualEvent({ id: "evt_local" }), "mut_shared", CONTEXT_A);
    assert.ok(["CONFLICT", "REJECTED"].includes(result.status));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE FOREIGN TITLE|evt_private|hld_b|usr_b/);
    assert.equal(await one(db, "SELECT id FROM calendar_events WHERE id = ?", "evt_local"), null);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 1);
  });
});

test("21 concurrent duplicate application yields one APPLIED and one REPLAYED", async () => {
  await withFreshDb(async db => {
    const [left, right] = await Promise.all([create(db), create(db)]);
    assert.deepEqual([left.status, right.status].sort(), ["APPLIED", "REPLAYED"]);
    const applied = left.status === "APPLIED" ? left : right;
    const replayed = left.status === "REPLAYED" ? left : right;
    assert.deepEqual(replayed.result, applied);
    assert.equal((await rows(db, "SELECT * FROM calendar_events")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 1);
  });
});

// E. UPDATE: overlap is semantic-group based, while the log records only
// top-level keys whose canonical values actually changed after derivation.
test("22 head-based UPDATE writes revision 2 and only actually changed fields", async () => {
  await withFreshDb(async db => {
    await create(db);
    const result = await update(db, { title: "Arsti aeg", notes: "Bring documents" });
    assert.equal(result.status, "APPLIED");
    assert.equal(result.revision, 2);
    const row = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(row.revision, 2);
    assert.equal(JSON.parse(row.payload_json).notes, "Bring documents");
    const log = await one(db, "SELECT * FROM change_log WHERE entity_id = ? AND revision = 2", "evt_1");
    assert.equal(log.operation, "UPDATE");
    assert.deepEqual(JSON.parse(log.changed_fields_json), ["notes"]);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
  });
});

test("23 stale notes patch merges after a title-only history change", async () => {
  await withFreshDb(async db => {
    await create(db);
    await update(db, { title: "New title" }, "mut_title");
    const result = await update(db, { notes: "Personal note" }, "mut_notes", 1);
    assert.equal(result.status, "MERGED");
    assert.equal(result.revision, 3);
    const row = await one(db, "SELECT payload_json, revision FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(row.revision, 3);
    assert.equal(JSON.parse(row.payload_json).title, "New title");
    assert.equal(JSON.parse(row.payload_json).notes, "Personal note");
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 3")).changed_fields_json), ["notes"]);
  });
});

test("24 stale patch to the same semantic title field conflicts without writing", async () => {
  await withFreshDb(async db => {
    await create(db);
    await update(db, { title: "First" }, "mut_first");
    assertConflict(await update(db, { title: "Second" }, "mut_second", 1), "FIELD_OVERLAP");
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 2);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
});

test("25 history date and incoming recurrence overlap through GROUP_RULE", async () => {
  await withFreshDb(async db => {
    await create(db, weeklyEvent());
    assert.equal((await update(db, { date: "2026-10-12" }, "mut_date")).status, "APPLIED");
    const after = JSON.parse((await one(db, "SELECT payload_json FROM calendar_events WHERE id = ?", "evt_1")).payload_json);
    assert.deepEqual({ recurrence: after.recurrence, seriesId: after.seriesId, excludedDates: after.excludedDates, overrides: after.overrides },
      { recurrence: { frequency: "weekly", interval: 1 }, seriesId: "series:evt_1", excludedDates: [], overrides: {} });
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 2")).changed_fields_json), ["date"]);
    assertConflict(await update(db, { recurrence: { frequency: "monthly", interval: 1 } }, "mut_recurrence", 1), "FIELD_OVERLAP");
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 2);
  });
});

test("26 history recurrence and incoming occurrence overrides overlap through GROUP_RULE", async () => {
  await withFreshDb(async db => {
    await create(db, weeklyEvent());
    assert.equal((await update(db, { recurrence: { frequency: "weekly", interval: 2 } }, "mut_recurrence")).status, "APPLIED");
    const after = JSON.parse((await one(db, "SELECT payload_json FROM calendar_events WHERE id = ?", "evt_1")).payload_json);
    assert.deepEqual({ seriesId: after.seriesId, excludedDates: after.excludedDates, overrides: after.overrides },
      { seriesId: "series:evt_1", excludedDates: [], overrides: {} });
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 2")).changed_fields_json), ["recurrence"]);
    assertConflict(await update(db, { overrides: { "2026-10-19": { title: "Moved" } } }, "mut_overrides", 1), "FIELD_OVERLAP");
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
});

test("27 history category and incoming subtype overlap through GROUP_IDENTITY", async () => {
  await withFreshDb(async db => {
    const base = manualEvent();
    assert.deepEqual(validateCalendarEventPayload({ ...base, subtype: null }, "evt_1"), base);
    await create(db, base);
    assert.equal((await update(db, { category: "payment" }, "mut_category")).status, "APPLIED");
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 2")).changed_fields_json), ["category"]);
    const before = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1");
    assert.deepEqual(validateCalendarEventPayload({ ...JSON.parse(before.payload_json), subtype: null }, "evt_1"),
      JSON.parse(before.payload_json));
    assertConflict(await update(db, { subtype: null }, "mut_subtype", 1), "FIELD_OVERLAP");
    assert.deepEqual(await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1"), before);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
  });
});

test("28 derivation logs actual recurrence reset fields, not every field in a touched group", async () => {
  await withFreshDb(async db => {
    await create(db, weeklyEvent({ excludedDates: ["2026-10-12"], overrides: { "2026-10-19": { title: "Different" } } }));
    const result = await update(db, { recurrence: { frequency: "none", interval: 1 } }, "mut_stop_recurrence");
    assert.equal(result.status, "APPLIED");
    const event = JSON.parse((await one(db, "SELECT payload_json FROM calendar_events WHERE id = ?", "evt_1")).payload_json);
    assert.deepEqual({ recurrence: event.recurrence, seriesId: event.seriesId, excludedDates: event.excludedDates, overrides: event.overrides },
      { recurrence: { frequency: "none", interval: 1 }, seriesId: null, excludedDates: [], overrides: {} });
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 2")).changed_fields_json),
      ["excludedDates", "overrides", "recurrence", "seriesId"]);
  });
});

test("29 disjoint stale invalid identity, including an explicit null waste subtype, returns MERGE_INVALID", async () => {
  await withFreshDb(async db => {
    const base = weeklyEvent();
    const stalePatch = { overrides: { "2026-10-12": { subtype: null } } };
    assert.doesNotThrow(() => validateCalendarEventPayload({ ...base, ...stalePatch }, "evt_1"));
    await create(db, base);
    await update(db, { category: "waste", subtype: "mixed" }, "mut_identity");
    assertConflict(await update(db, stalePatch, "mut_invalid_merge", 1), "MERGE_INVALID");
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 2);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
  await withFreshDb(async db => {
    assert.equal((await create(db, manualEvent({ category: "waste", subtype: "mixed" }))).status, "APPLIED");
    assert.equal((await update(db, { title: "Updated title" }, "mut_title")).status, "APPLIED");
    const before = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(before.revision, 2);
    assert.equal(JSON.parse(before.payload_json).subtype, "mixed");
    assert.deepEqual(JSON.parse((await one(db,
      "SELECT changed_fields_json FROM change_log WHERE entity_id = ? AND revision = 2", "evt_1")).changed_fields_json), ["title"]);
    const logsBefore = await rows(db, "SELECT * FROM change_log ORDER BY seq");
    const appliedBefore = await rows(db, "SELECT * FROM applied_mutations ORDER BY mutation_id");
    const result = await update(db, { subtype: null }, "mut_stale_null_subtype", 1);
    assert.deepEqual({
      status: result.status, code: result.code ?? null,
      event: await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1"),
      logs: await rows(db, "SELECT * FROM change_log ORDER BY seq"),
      applied: await rows(db, "SELECT * FROM applied_mutations ORDER BY mutation_id"),
      failedMutation: await one(db, "SELECT mutation_id FROM applied_mutations WHERE mutation_id = ?", "mut_stale_null_subtype"),
    }, {
      status: "CONFLICT", code: "MERGE_INVALID", event: before,
      logs: logsBefore, applied: appliedBefore, failedMutation: null,
    });
  });
});

test("30 UPDATE against a tombstone conflicts without a new row or log", async () => {
  await withFreshDb(async db => {
    await create(db);
    await apply(db, mutation("DELETE", { mutationId: "mut_delete", baseRevision: 1 }));
    assertConflict(await update(db, { notes: "Too late" }, "mut_too_late", 2));
    const row = await one(db, "SELECT revision, deleted_at FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(row.revision, 2);
    assert.equal(row.deleted_at, NOW);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
});

test("31 future UPDATE base conflicts; zero or negative base rejects with no write", async () => {
  await withFreshDb(async db => {
    await create(db);
    assertConflict(await update(db, { notes: "Future" }, "mut_future", 3));
    for (const baseRevision of [0, -1]) assertRejected(await update(db, { notes: "Invalid" }, `mut_${baseRevision}`, baseRevision));
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
  });
});

test("32 every immutable UPDATE field is rejected even when its value looks unchanged", async () => {
  await withFreshDb(async db => {
    await create(db);
    for (const [key, value] of [["id", "evt_1"], ["householdId", null], ["source", "manual"]]) {
      assertRejected(await update(db, { [key]: value }, `mut_immutable_${key}`), "IMMUTABLE_FIELD");
    }
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
  });
});

test("33 imported waste may refresh importMeta and remains a canonical event", async () => {
  await withFreshDb(async db => {
    await create(db, importedEvent());
    const refreshed = { ...importedEvent().importMeta, importedAt: "2026-09-28T10:00:00.000Z", externalId: "schedule-2" };
    const result = await update(db, { importMeta: refreshed }, "mut_refresh");
    assert.equal(result.status, "APPLIED");
    const event = JSON.parse((await one(db, "SELECT payload_json FROM calendar_events WHERE id = ?", "evt_1")).payload_json);
    assert.deepEqual(event.importMeta, refreshed);
    assert.deepEqual(validateCalendarEventPayload(event, "evt_1"), event);
    assert.deepEqual(JSON.parse((await one(db, "SELECT changed_fields_json FROM change_log WHERE revision = 2")).changed_fields_json), ["importMeta"]);
  });
});

test("34 invalid metadata, imported-to-nonwaste and explicit null waste subtype UPDATE reject", async () => {
  await withFreshDb(async db => {
    await create(db);
    assertRejected(await update(db, { importMeta: importedEvent().importMeta }, "mut_manual_meta"));
    await create(db, importedEvent({ id: "evt_imported" }), "mut_imported");
    const badMeta = { ...importedEvent().importMeta, addressKey: "wrong" };
    for (const patch of [{ importMeta: badMeta }, { category: "general", subtype: null }]) {
      const result = await apply(db, mutation("UPDATE", {
        mutationId: `mut_bad_${Object.keys(patch)[0]}`, entityId: "evt_imported", baseRevision: 1, patch,
      }));
      assertRejected(result);
    }
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_imported")).revision, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
  await withFreshDb(async db => {
    assert.equal((await create(db, manualEvent({ category: "waste", subtype: "mixed" }))).status, "APPLIED");
    const before = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(before.revision, 1);
    assert.equal(JSON.parse(before.payload_json).subtype, "mixed");
    const logsBefore = await rows(db, "SELECT * FROM change_log ORDER BY seq");
    const appliedBefore = await rows(db, "SELECT * FROM applied_mutations ORDER BY mutation_id");
    const result = await update(db, { subtype: null }, "mut_current_null_subtype", before.revision);
    assert.deepEqual({
      status: result.status, code: result.code ?? null,
      event: await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1"),
      logs: await rows(db, "SELECT * FROM change_log ORDER BY seq"),
      applied: await rows(db, "SELECT * FROM applied_mutations ORDER BY mutation_id"),
      failedMutation: await one(db, "SELECT mutation_id FROM applied_mutations WHERE mutation_id = ?", "mut_current_null_subtype"),
    }, {
      status: "REJECTED", code: "INVALID_PAYLOAD", event: before,
      logs: logsBefore, applied: appliedBefore, failedMutation: null,
    });
  });
});

test("35 foreign entity UPDATE and DELETE are generic conflicts and leave the foreign row untouched", async () => {
  await withFreshDb(async db => {
    await create(db, manualEvent({ id: "evt_private", title: "PRIVATE FOREIGN TITLE" }), "mut_private", CONTEXT_B);
    const before = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_private");
    const foreign = await apply(db, mutation("UPDATE", { mutationId: "mut_try_foreign", entityId: "evt_private", patch: { notes: "Intrusion" } }), CONTEXT_A);
    const missing = await apply(db, mutation("UPDATE", { mutationId: "mut_try_missing", entityId: "evt_missing", patch: { notes: "Intrusion" } }), CONTEXT_A);
    assertConflict(foreign);
    assert.deepEqual(foreign, missing);
    assert.doesNotMatch(JSON.stringify(foreign), /PRIVATE FOREIGN TITLE|hld_b|usr_b/);
    assert.deepEqual(await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_private"), before);

    const beforeDelete = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_private");
    const logsBeforeDelete = await rows(db, "SELECT * FROM change_log WHERE entity_id = ? ORDER BY seq", "evt_private");
    assert.equal(beforeDelete.household_id, CONTEXT_B.householdId);
    assert.equal(beforeDelete.revision, 1, "the foreign DELETE targets the current revision");
    assert.equal(beforeDelete.deleted_at, null);
    assert.equal(beforeDelete.payload_json.includes("PRIVATE FOREIGN TITLE"), true);
    const foreignDelete = await apply(db, mutation("DELETE", {
      mutationId: "mut_try_foreign_delete", entityId: "evt_private", baseRevision: 1,
    }), CONTEXT_A);
    const missingDelete = await apply(db, mutation("DELETE", {
      mutationId: "mut_try_missing_delete", entityId: "evt_missing", baseRevision: 1,
    }), CONTEXT_A);
    assertConflict(foreignDelete);
    assert.deepEqual(foreignDelete, missingDelete);
    assert.doesNotMatch(JSON.stringify(foreignDelete), /PRIVATE FOREIGN TITLE|hld_b|usr_b/);
    const afterDelete = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_private");
    assert.deepEqual(afterDelete, beforeDelete);
    assert.equal(afterDelete.deleted_at, null);
    assert.equal(afterDelete.revision, beforeDelete.revision);
    assert.equal(afterDelete.payload_json, beforeDelete.payload_json);
    assert.equal(afterDelete.updated_at, beforeDelete.updated_at);
    assert.deepEqual(await rows(db, "SELECT * FROM change_log WHERE entity_id = ? ORDER BY seq", "evt_private"), logsBeforeDelete);
    assert.deepEqual(await rows(db, "SELECT seq FROM change_log WHERE household_id = ? AND entity_id = ? AND operation = 'DELETE'", CONTEXT_B.householdId, "evt_private"), []);
    assert.equal(await one(db, "SELECT mutation_id FROM applied_mutations WHERE mutation_id = ?", "mut_try_foreign_delete"), null);
  });
});

// F. DELETE is exact-revision only, retains a tombstone and never hard-deletes.
test("36 exact-head DELETE tombstones the row, increments revision and appends a DELETE log", async () => {
  await withFreshDb(async db => {
    await create(db);
    const result = await apply(db, mutation("DELETE", { mutationId: "mut_delete", baseRevision: 1 }));
    assert.equal(result.status, "APPLIED");
    assert.equal(result.revision, 2);
    const row = await one(db, "SELECT * FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(row.revision, 2);
    assert.equal(row.deleted_at, NOW);
    assert.deepEqual(JSON.parse(row.payload_json), manualEvent());
    const log = await one(db, "SELECT * FROM change_log WHERE entity_id = ? AND revision = 2", "evt_1");
    assert.equal(log.operation, "DELETE");
    assert.equal(log.changed_by, CONTEXT_A.userId);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 2);
  });
});

test("37 stale DELETE conflicts and preserves the newer live revision", async () => {
  await withFreshDb(async db => {
    await create(db);
    await update(db, { notes: "New data" }, "mut_new_data");
    assertConflict(await apply(db, mutation("DELETE", { mutationId: "mut_stale_delete", baseRevision: 1 })));
    const row = await one(db, "SELECT revision, deleted_at, payload_json FROM calendar_events WHERE id = ?", "evt_1");
    assert.equal(row.revision, 2);
    assert.equal(row.deleted_at, null);
    assert.equal(JSON.parse(row.payload_json).notes, "New data");
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
});

test("38 DELETE of an already tombstoned event conflicts and does not hard-delete", async () => {
  await withFreshDb(async db => {
    await create(db);
    await apply(db, mutation("DELETE", { mutationId: "mut_delete_once", baseRevision: 1 }));
    assertConflict(await apply(db, mutation("DELETE", { mutationId: "mut_delete_twice", baseRevision: 2 })));
    assert.equal((await rows(db, "SELECT * FROM calendar_events")).length, 1);
    assert.equal((await one(db, "SELECT revision FROM calendar_events WHERE id = ?", "evt_1")).revision, 2);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 2);
  });
});

// G. The test trigger aborts the change-log statement inside the same D1 batch.
test("39 forced change_log abort rolls back all three writes, hides D1 detail and permits retry", async () => {
  await withFreshDb(async db => {
    await db.exec("CREATE TRIGGER test_abort_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT, 'PRIVATE_D1_SENTINEL'); END;");
    let failure;
    try { failure = await create(db); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof Error || (failure !== null && typeof failure === "object"), "the injected D1 failure must be visible as a safe failure");
    if (!(failure instanceof Error)) {
      assert.equal(typeof failure.status, "string", "a structured failure must report a status");
      assert.ok(!["APPLIED", "MERGED", "REPLAYED"].includes(failure.status), "the forced abort must not be acknowledged as success");
    }
    assert.doesNotMatch(JSON.stringify(failure instanceof Error ? { message: failure.message } : failure), /PRIVATE_D1_SENTINEL|SQLITE_CONSTRAINT|change_log/i);
    await assertNoMutationRows(db);
    await db.exec("DROP TRIGGER test_abort_log;");
    const recovered = await create(db);
    assert.equal(recovered.status, "APPLIED");
    assert.equal((await rows(db, "SELECT * FROM calendar_events")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM change_log")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM applied_mutations")).length, 1);
  });
});

// H. Client code supplies oracle examples only. Production Functions may not
// import it; the corpus also contains inputs the lenient client would accept.
test("40 production create/update/remove/reconcile corpus matches strict server canonical semantics", () => {
  const categories = ["waste", "maintenance", "payment", "general"];
  const wasteSubtypes = ["mixed", "bio", "paper", "packaging", "other"];
  const frequencies = ["none", "weekly", "monthly", "yearly"];
  const reminders = [0, 1, 3, 7];
  const createdEvents = [];
  for (const category of categories) {
    for (const subtype of category === "waste" ? wasteSubtypes : [null]) {
      for (const frequency of frequencies) {
        for (const daysBefore of reminders) {
          const id = `evt_corpus_${category}_${subtype ?? "none"}_${frequency}_${daysBefore}`;
          const created = createEvent({
            title: "Arsti aeg", category, ...(subtype === null ? {} : { subtype }),
            date: "2026-10-05", recurrence: { frequency }, reminder: { daysBefore },
          }, id);
          assert.equal(created.subtype, subtype);
          assert.deepEqual(created.recurrence, { frequency, interval: 1 });
          assert.equal(created.seriesId, frequency === "none" ? null : `series:${id}`);
          assert.deepEqual(validateEvent(created), created);
          assert.deepEqual(validateCalendarEventPayload(created, id), created);
          createdEvents.push(created);
        }
      }
    }
  }
  assert.equal(createdEvents.length, 128);

  const seriesId = "evt_corpus_general_none_weekly_0";
  const seriesSeed = createdEvents.find(event => event.id === seriesId);
  assert.ok(seriesSeed);
  let saved = JSON.stringify({ version: 1, events: [seriesSeed] });
  const storage = { getItem(key) { assert.equal(key, EVENT_STORAGE_KEY); return saved; },
    setItem(key, value) { assert.equal(key, EVENT_STORAGE_KEY); saved = value; } };
  const repository = createEventRepository(storage, () => "not-used");
  repository.update(seriesId, { title: "Moved occurrence" }, { scope: "occurrence", occurrenceDate: "2026-10-12" });
  const withOverride = repository.load().events[0];
  assert.deepEqual(withOverride.overrides, { "2026-10-12": { title: "Moved occurrence" } });
  assert.deepEqual(validateEvent(withOverride), withOverride);
  assert.deepEqual(validateCalendarEventPayload(withOverride, seriesId), withOverride);

  repository.remove(seriesId, { scope: "occurrence", occurrenceDate: "2026-10-19" });
  const withExclusion = repository.load().events[0];
  assert.deepEqual(withExclusion.excludedDates, ["2026-10-19"]);
  assert.deepEqual(withExclusion.overrides, withOverride.overrides);
  assert.deepEqual(validateEvent(withExclusion), withExclusion);
  assert.deepEqual(validateCalendarEventPayload(withExclusion, seriesId), withExclusion);

  repository.update(seriesId, { date: "2026-10-12", recurrence: { frequency: "monthly", interval: 2 } }, { scope: "series" });
  const updatedSeries = repository.load().events[0];
  assert.equal(updatedSeries.date, "2026-10-12");
  assert.deepEqual(updatedSeries.recurrence, { frequency: "monthly", interval: 2 });
  assert.equal(updatedSeries.seriesId, seriesSeed.seriesId);
  assert.deepEqual(updatedSeries.excludedDates, []);
  assert.deepEqual(updatedSeries.overrides, {});
  assert.deepEqual(validateEvent(updatedSeries), updatedSeries);
  assert.deepEqual(validateCalendarEventPayload(updatedSeries, seriesId), updatedSeries);

  const initialWasteResult = {
    status: "SUPPORTED_WITH_RESULTS", provider: { id: "provider-a", name: "Linna vedaja" },
    address: "Õnne  1", entries: [{ externalId: "route-1", date: "2026-10-05", subtype: "bio", title: "Biojäätmed", time: null }],
  };
  const imported = reconcileWaste([], initialWasteResult, new Date(NOW), () => "evt_waste").events[0];
  assert.deepEqual(validateEvent(imported), imported);
  assert.deepEqual(validateCalendarEventPayload(imported, imported.id), imported);

  const refreshedResult = reconcileWaste([imported], {
    ...initialWasteResult,
    entries: [{ externalId: "route-1", date: "2026-10-06", subtype: "paper", title: "Paber ja papp", time: "08:30" }],
  }, new Date("2026-09-28T10:00:00.000Z"), () => { throw new Error("refresh must reuse the matching event ID"); });
  assert.equal(refreshedResult.events.length, 1);
  const refreshed = refreshedResult.events[0];
  assert.equal(refreshed.id, imported.id);
  assert.deepEqual({ date: refreshed.date, subtype: refreshed.subtype, title: refreshed.title, time: refreshed.time },
    { date: "2026-10-06", subtype: "paper", title: "Paber ja papp", time: "08:30" });
  assert.equal(refreshed.importMeta.externalId, imported.importMeta.externalId);
  assert.equal(refreshed.importMeta.importedAt, imported.importMeta.importedAt);
  assert.deepEqual(refreshed.importMeta, imported.importMeta);
  assert.deepEqual(validateEvent(refreshed), refreshed);
  assert.deepEqual(validateCalendarEventPayload(refreshed, refreshed.id), refreshed);
});

test("41 security corpus rejects unknown and prototype keys, bad relationships, oversize and invalid protocol inputs", async () => {
  const imported = importedEvent();
  const invalidEvents = [
    manualEvent({ unexpected: true }), manualEvent({ prototypeWidget: "demo" }),
    manualEvent({ householdId: "hld_b" }),
    manualEvent({ importMeta: imported.importMeta }),
    importedEvent({ importMeta: { ...imported.importMeta, addressKey: "forged" } }),
    importedEvent({ category: "general", subtype: null }),
    manualEvent({ title: "x".repeat(201) }), manualEvent({ notes: "x".repeat(5001) }),
    manualEvent({ id: "x".repeat(201) }),
    weeklyEvent({ recurrence: { frequency: "weekly", interval: 0 } }),
    manualEvent({ reminder: { daysBefore: 7, extra: true } }),
    weeklyEvent({ overrides: { "2026-10-12": { recurrence: { frequency: "none", interval: 1 } } } }),
    weeklyEvent({ excludedDates: ["2026-10-12", "2026-10-12"] }),
    weeklyEvent({ excludedDates: ["2026-10-19", "2026-10-12"] }),
    weeklyEvent({ excludedDates: ["2026-02-29"] }),
    manualEvent({ category: "unknown" }), manualEvent({ category: "waste", subtype: null }),
    manualEvent({ subtype: "mixed" }),
  ];
  for (const event of invalidEvents) assert.throws(() => validateCalendarEventPayload(event, event.id));
  await withFreshDb(async db => {
    for (const bad of [
      mutation("CREATE", { entityType: "diary" }),
      mutation("UPSERT"),
      mutation("CREATE", { baseRevision: 0.5 }),
      mutation("CREATE", { patch: manualEvent({ householdId: "hld_b" }) }),
    ]) assertRejected(await apply(db, bad));
    await assertNoMutationRows(db);
  });
});

test("42 both future production modules have no src/ imports", () => {
  for (const path of ["functions/_lib/sync.js", "functions/_lib/syncRepository.js"]) {
    // readFileSync deliberately fails if a module is absent. In this RED pass
    // the static sync.js import above fails first with ERR_MODULE_NOT_FOUND.
    const source = readFileSync(resolve(root, path), "utf8");
    assert.doesNotMatch(source, /\b(?:from\s*|import\s*\(\s*|import\s*)["'][^"']*src[/\\]/);
  }
});
