import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { insertHouseholdCreation } from "../../functions/_lib/db.js";
import { applyCalendarMutation } from "../../functions/_lib/sync.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const NOW = "2026-10-04T10:00:00.000Z";
export const CREATED = "2026-10-04T08:00:00.000Z";
export const uuidFor = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const ITEM_A = uuidFor(1);
export const ITEM_B = uuidFor(2);
export const item = (patch = {}) => ({
  id: ITEM_A, name: "Piim", quantity: "", category: "food", note: "",
  checkedAt: null, createdAt: CREATED, ...patch,
});
export const mutation = (operation = "CREATE", n = 100, patch, baseRevision = operation === "CREATE" ? 0 : 1, entityId = ITEM_A) => ({
  mutationId: uuidFor(n), entityType: "shopping_item", entityId, operation, baseRevision,
  patch: patch ?? (operation === "CREATE" ? item({ id: entityId }) : {}),
});

export function migrationStatements(sql) {
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

export async function applyShoppingMigration(db) {
  const sql = readFileSync(resolve(root, "migrations/0002_shopping_items.sql"), "utf8");
  for (const statement of migrationStatements(sql)) await db.exec(statement);
}

function identity(suffix) {
  return {
    householdId: `hld_${suffix}`, userId: `usr_${suffix}`, sessionId: `ses_${suffix}`,
    role: "OWNER", token: `m1s_${suffix.toUpperCase().repeat(43)}`,
  };
}

async function seedOwner(db, suffix) {
  const owner = identity(suffix);
  const hash = createHash("sha256").update(`majandus:v1:device-session:${owner.token}`).digest("hex");
  await insertHouseholdCreation(db, {
    householdId: owner.householdId, householdName: `Household ${suffix}`, householdAddress: null,
    ownerUserId: owner.userId, revision: 1, createdAt: NOW, updatedAt: NOW,
    userName: `Owner ${suffix}`, role: "OWNER", sessionId: owner.sessionId,
    tokenHash: hash, deviceName: `Device ${suffix}`, lastSeenAt: NOW,
    recoveryHash: createHash("sha256").update(`shopping-fixture-recovery:${suffix}`).digest("hex"),
  });
  return owner;
}

export async function seedMember(db, owner) {
  const member = { householdId: owner.householdId, userId: "usr_member", sessionId: "ses_member", role: "MEMBER", token: `m1s_${"M".repeat(43)}` };
  await db.prepare("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(member.userId, member.householdId, "Member", member.role, NOW).run();
  const hash = createHash("sha256").update(`majandus:v1:device-session:${member.token}`).digest("hex");
  await db.prepare("INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(member.sessionId, member.userId, hash, "Member device", NOW, NOW).run();
  return member;
}

export async function withFreshDb(run, { shopping = true, seed = true } = {}) {
  const miniflare = new Miniflare({
    modules: true, script: "export default { fetch() { return new Response('ok'); } };", d1Databases: ["DB"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const initial = readFileSync(resolve(root, "migrations/0001_majandus_backend.sql"), "utf8");
    for (const statement of migrationStatements(initial)) await db.exec(statement);
    if (shopping) await applyShoppingMigration(db);
    const a = seed ? await seedOwner(db, "a") : null;
    const b = seed ? await seedOwner(db, "b") : null;
    return await run({ db, a, b });
  } finally {
    await miniflare.dispose();
  }
}

export async function seedCalendar(db, owner, id = "calendar_fixture", n = "calendar_mutation") {
  const payload = {
    id, title: "Calendar remains private", category: "general", subtype: null, date: "2026-10-05", time: null,
    recurrence: { frequency: "none", interval: 1 }, reminder: { daysBefore: 0 }, source: "manual",
    householdId: null, notes: "Calendar sentinel", seriesId: null, excludedDates: [], overrides: {},
  };
  const result = await applyCalendarMutation({ db, context: owner, clock: () => NOW,
    mutation: { mutationId: n, entityType: "calendar_event", entityId: id, operation: "CREATE", baseRevision: 0, patch: payload } });
  assert.equal(result.status, "APPLIED");
}

export const request = (path, owner, options = {}) => new Request(`https://example.test${path}`, {
  method: options.method ?? "GET",
  headers: { ...(owner ? { Authorization: `Bearer ${owner.token}` } : {}), ...options.headers }, body: options.body,
});

export const rows = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results;
export const one = (db, sql, ...values) => db.prepare(sql).bind(...values).first();

// The D1 boundary can delay reads or insert a later write after a read batch.
// Domain and repository code still execute unchanged against real local D1.
export function observeD1(db, { beforeFirst, afterBatch } = {}) {
  const statements = new WeakMap();
  const standalone = [];
  const batches = [];
  function wrap(statement, sql, bindings = []) {
    const wrapped = { bind: (...values) => wrap(statement.bind(...values), sql, values) };
    for (const method of ["first", "all", "run", "raw"]) {
      wrapped[method] = async (...args) => {
        standalone.push({ method, sql, bindings });
        const result = await statement[method](...args);
        if (method === "first" && beforeFirst) await beforeFirst({ sql, bindings, result });
        return result;
      };
    }
    statements.set(wrapped, statement);
    return wrapped;
  }
  return { standalone, batches, db: {
    prepare: sql => wrap(db.prepare(sql), sql),
    async batch(prepared) {
      batches.push(prepared.length);
      const result = await db.batch(prepared.map(statement => statements.get(statement)));
      if (afterBatch) await afterBatch();
      return result;
    },
  } };
}

export function synchronizeShoppingReads(db) {
  let arrived = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(() => release(), 15000);
  const observed = observeD1(db, { beforeFirst: async ({ sql }) => {
    if (!/FROM shopping_items WHERE household_id/.test(sql) || arrived >= 2) return;
    arrived += 1;
    if (arrived === 2) { clearTimeout(timer); release(); }
    await barrier;
    assert.equal(arrived, 2, "both callers must read before either guarded write");
  } });
  return { db: observed.db, dispose: () => clearTimeout(timer) };
}
