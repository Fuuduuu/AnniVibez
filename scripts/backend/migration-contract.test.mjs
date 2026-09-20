import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Miniflare } from "miniflare";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationPath = resolve(root, "migrations/0001_majandus_backend.sql");
const configPath = resolve(here, "wrangler.test.jsonc");
const migrationSql = readFileSync(migrationPath, "utf8");
const localPersistPath = resolve(root, ".tmp/majandus-d1-test");

let miniflare;
let db;

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
    const endsTrigger = /\bEND\s*;\s*$/i.test(statement);
    if (isTrigger && !endsTrigger) continue;
    if (statement.trim()) statements.push(statement.replace(/\s+/g, " ").trim());
    start = index + 1;
  }
  assert.equal(sql.slice(start).trim(), "", "migration must end with a semicolon");
  return statements;
}

const hash = (value) => value.toString(16).padStart(64, "0");

async function run(sql, ...bindings) {
  const statement = db.prepare(sql);
  return bindings.length === 0 ? statement.run() : statement.bind(...bindings).run();
}

async function all(sql, ...bindings) {
  const statement = db.prepare(sql);
  const result = bindings.length === 0 ? await statement.all() : await statement.bind(...bindings).all();
  return result.results;
}

async function batch(statements) {
  return db.batch(
    statements.map(([sql, bindings = []]) => {
      const statement = db.prepare(sql);
      return bindings.length === 0 ? statement : statement.bind(...bindings);
    }),
  );
}

async function rejects(sql, ...bindings) {
  await assert.rejects(() => run(sql, ...bindings));
}

async function rejectsCheck(sql, ...bindings) {
  await assert.rejects(() => run(sql, ...bindings), /CHECK constraint failed/);
}

async function freshMigratedDb() {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: ["DB"],
  });
  const freshDb = await miniflare.getD1Database("DB");
  for (const statement of migrationStatements(migrationSql)) await freshDb.exec(statement);
  return freshDb;
}

before(async () => {
  db = await freshMigratedDb();
});

after(async () => {
  await miniflare?.dispose();
});

test("the test-only Wrangler configuration has no remote account or deployment fields", () => {
  const config = readFileSync(configPath, "utf8");
  assert.match(config, /"migrations_dir"\s*:\s*"\.\.\/\.\.\/migrations"/);
  assert.doesNotMatch(config, /"account_id"\s*:/);
  assert.doesNotMatch(config, /"pages_build_output_dir"\s*:/);
});

test("creates exactly the canonical Phase 1 tables with required identity fields", async () => {
  const tables = await all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  assert.deepEqual(
    tables.map(({ name }) => name),
    [
      "applied_mutations",
      "calendar_events",
      "change_log",
      "device_sessions",
      "household_recovery",
      "households",
      "one_time_tokens",
      "shared_places",
      "users",
      "waste_config",
    ],
  );

  const expectedRequiredFields = {
    households: ["id", "name", "owner_member_id", "owner_marker", "revision", "created_at", "updated_at"],
    users: ["id", "household_id", "name", "role", "created_at"],
    device_sessions: ["id", "user_id", "token_hash", "device_name", "created_at", "last_seen_at"],
    one_time_tokens: ["id", "household_id", "purpose", "token_hash", "created_by_user_id", "created_at", "expires_at"],
    household_recovery: ["household_id", "recovery_hash", "created_at"],
    calendar_events: ["id", "household_id", "payload_json", "revision", "created_at", "updated_at"],
    waste_config: ["id", "household_id", "payload_json", "revision", "updated_at"],
    shared_places: ["id", "household_id", "name", "address", "lat", "lon", "revision", "updated_at"],
    change_log: ["seq", "household_id", "entity_type", "entity_id", "revision", "operation", "changed_fields_json", "changed_by", "changed_at"],
    applied_mutations: ["mutation_id", "household_id", "result_json", "created_at"],
  };

  for (const [table, requiredFields] of Object.entries(expectedRequiredFields)) {
    const columns = await all(`PRAGMA table_info(${table})`);
    const required = new Set(columns.filter(({ notnull, pk }) => notnull === 1 || pk > 0).map(({ name }) => name));
    for (const field of requiredFields) assert.ok(required.has(field), `${table}.${field} must be required`);
    assert.ok(!columns.some(({ name }) => /^(token|recovery|secret|code)$/i.test(name)), `${table} has a plaintext credential column`);
  }

  const userColumns = await all("PRAGMA table_xinfo(users)");
  assert.ok(userColumns.some(({ name, hidden }) => name === "owner_marker" && hidden === 3), "users.owner_marker must be stored generated state");

  const expectedForeignKeys = {
    households: ["users"],
    users: ["households"],
    device_sessions: ["users"],
    one_time_tokens: ["households", "users", "users", "users"],
    household_recovery: ["households"],
    calendar_events: ["households"],
    waste_config: ["households"],
    shared_places: ["households"],
    change_log: ["households", "users"],
    applied_mutations: ["households"],
  };
  for (const [table, targets] of Object.entries(expectedForeignKeys)) {
    const foreignKeys = await all(`PRAGMA foreign_key_list(${table})`);
    assert.deepEqual([...new Set(foreignKeys.map(({ table: target }) => target))].sort(), [...new Set(targets)].sort());
  }

  const householdForeignKeys = await all("PRAGMA foreign_key_list(households)");
  assert.ok(householdForeignKeys.some(({ table: target, from, to }) => target === "users" && from === "owner_member_id" && to === "id"));
  assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
});

test("creates an initial household, OWNER, session, and recovery record in one valid D1 batch", async () => {
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-owner", "Owner home", "u-owner", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-owner", "h-owner", "Owner", "OWNER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", ["s-initial", "u-owner", hash(1), "Browser", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)", ["h-owner", hash(2), "2026-09-20T00:00:00Z"]],
  ]);

  assert.deepEqual(await all("SELECT id, owner_member_id FROM households WHERE id = ?", "h-owner"), [{ id: "h-owner", owner_member_id: "u-owner" }]);
  assert.deepEqual(await all("SELECT id FROM users WHERE household_id = ? AND role = 'OWNER' AND revoked_at IS NULL", "h-owner"), [{ id: "u-owner" }]);
  assert.deepEqual(await all("SELECT id FROM device_sessions WHERE id = ?", "s-initial"), [{ id: "s-initial" }]);
  assert.deepEqual(await all("SELECT household_id FROM household_recovery WHERE household_id = ?", "h-owner"), [{ household_id: "h-owner" }]);
});

test("rejects revision values below 1 for every revision-constrained Phase 1 table", async () => {
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-revision", "Revision home", "u-revision", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-revision", "h-revision", "Revision owner", "OWNER", "2026-09-20T00:00:00Z"]],
  ]);
  await assert.rejects(() => batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-revision-invalid", "Invalid revision", "u-revision-invalid", 0, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-revision-invalid", "h-revision-invalid", "Invalid revision owner", "OWNER", "2026-09-20T00:00:00Z"]],
  ]), /CHECK constraint failed/);
  assert.deepEqual(await all("SELECT id FROM households WHERE id = ?", "h-revision-invalid"), []);

  await run("INSERT INTO calendar_events (id, household_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "e-revision-valid", "h-revision", "{}", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await rejectsCheck("INSERT INTO calendar_events (id, household_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "e-revision-invalid", "h-revision", "{}", 0, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await run("INSERT INTO waste_config (id, household_id, payload_json, revision, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)", "w-revision-valid", "h-revision", "{}", 1, "2026-09-20T00:00:00Z", "2026-09-20T01:00:00Z");
  await rejectsCheck("INSERT INTO waste_config (id, household_id, payload_json, revision, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)", "w-revision-invalid", "h-revision", "{}", 0, "2026-09-20T00:00:00Z", "2026-09-20T01:00:00Z");
  await run("INSERT INTO shared_places (id, household_id, name, address, lat, lon, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "p-revision-valid", "h-revision", "Revision place", "Revision address", 59.0, 26.0, 1, "2026-09-20T00:00:00Z");
  await rejectsCheck("INSERT INTO shared_places (id, household_id, name, address, lat, lon, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "p-revision-invalid", "h-revision", "Revision place", "Revision address", 59.0, 26.0, 0, "2026-09-20T00:00:00Z");
  await run("INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "h-revision", "calendar_event", "e-revision-valid", 1, "CREATE", "[]", "u-revision", "2026-09-20T00:00:00Z");
  await rejectsCheck("INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "h-revision", "calendar_event", "e-revision-invalid", 0, "CREATE", "[]", "u-revision", "2026-09-20T00:00:00Z");
});

test("rejects malformed JSON for every json_valid Phase 1 column", async () => {
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-json", "JSON home", "u-json", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-json", "h-json", "JSON owner", "OWNER", "2026-09-20T00:00:00Z"]],
  ]);
  await run("INSERT INTO calendar_events (id, household_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "e-json-valid", "h-json", "{}", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await rejectsCheck("INSERT INTO calendar_events (id, household_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "e-json-invalid", "h-json", "{not-json}", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await run("INSERT INTO waste_config (id, household_id, payload_json, revision, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)", "w-json-valid", "h-json", "{}", 1, "2026-09-20T00:00:00Z", "2026-09-20T01:00:00Z");
  await rejectsCheck("INSERT INTO waste_config (id, household_id, payload_json, revision, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)", "w-json-invalid", "h-json", "{not-json}", 1, "2026-09-20T00:00:00Z", "2026-09-20T01:00:00Z");
  await run("INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "h-json", "calendar_event", "e-json-valid", 1, "CREATE", "[]", "u-json", "2026-09-20T00:00:00Z");
  await rejectsCheck("INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "h-json", "calendar_event", "e-json-invalid", 1, "CREATE", "{not-json}", "u-json", "2026-09-20T00:00:00Z");
  await run("INSERT INTO applied_mutations (mutation_id, household_id, result_json, created_at) VALUES (?, ?, ?, ?)", "m-json-valid", "h-json", "{}", "2026-09-20T00:00:00Z");
  await rejectsCheck("INSERT INTO applied_mutations (mutation_id, household_id, result_json, created_at) VALUES (?, ?, ?, ?)", "m-json-invalid", "h-json", "{not-json}", "2026-09-20T00:00:00Z");
});

test("rejects ownerless, invalid, and duplicate active-owner household mutations", async () => {
  await rejects("INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "h-ownerless", "Ownerless", "missing-owner", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  assert.deepEqual(await all("SELECT id FROM households WHERE id = ?", "h-ownerless"), []);
  await rejects("INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "h-null-pointer", "Null pointer", null, 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await rejects("INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "h-cross-pointer", "Cross pointer", "u-owner", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  assert.deepEqual(await all("SELECT id FROM households WHERE id IN ('h-null-pointer', 'h-cross-pointer')"), []);
  await rejects("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", "u-second-owner", "h-owner", "Second owner", "OWNER", "2026-09-20T00:00:00Z");
  await rejects("UPDATE users SET revoked_at = ? WHERE id = ?", "2026-09-20T01:00:00Z", "u-owner");
  await rejects("UPDATE users SET role = 'MEMBER' WHERE id = ?", "u-owner");
  await rejects("DELETE FROM users WHERE id = ?", "u-owner");
  await rejects("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", "u-invalid-role", "h-owner", "Invalid", "ADMIN", "2026-09-20T00:00:00Z");
  await rejects("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", "u-orphan", "missing-household", "Orphan", "MEMBER", "2026-09-20T00:00:00Z");
  assert.deepEqual(await all("SELECT role, revoked_at FROM users WHERE id = ?", "u-owner"), [{ role: "OWNER", revoked_at: null }]);
});

test("permits only an atomic ownership transfer and rejects adversarial follow-up SQL", async () => {
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-transfer", "Transfer home", "u-transfer-a", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-transfer-a", "h-transfer", "A", "OWNER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-transfer-b", "h-transfer", "B", "MEMBER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", ["s-transfer", "u-transfer-a", hash(3), "Browser", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)", ["h-transfer", hash(4), "2026-09-20T00:00:00Z"]],
  ]);
  await batch([
    ["UPDATE households SET owner_member_id = ? WHERE id = ?", ["u-transfer-b", "h-transfer"]],
    ["UPDATE users SET role = 'MEMBER' WHERE id = ?", ["u-transfer-a"]],
    ["UPDATE users SET role = 'OWNER' WHERE id = ?", ["u-transfer-b"]],
  ]);

  assert.deepEqual(await all("SELECT owner_member_id FROM households WHERE id = ?", "h-transfer"), [{ owner_member_id: "u-transfer-b" }]);
  assert.deepEqual(await all("SELECT id FROM users WHERE household_id = ? AND role = 'OWNER' AND revoked_at IS NULL", "h-transfer"), [{ id: "u-transfer-b" }]);
  await rejects("UPDATE users SET revoked_at = ? WHERE id = ?", "2026-09-20T01:00:00Z", "u-transfer-b");
  await rejects("UPDATE users SET role = 'MEMBER' WHERE id = ?", "u-transfer-b");
  await rejects("DELETE FROM users WHERE id = ?", "u-transfer-b");
  await rejects("INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", "u-transfer-second-owner", "h-transfer", "Second owner", "OWNER", "2026-09-20T00:00:00Z");
  assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
});

test("rolls back an unresolved deferred owner pointer batch without partial rows", async () => {
  await assert.rejects(() => batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-rollback", "Rollback home", "u-rollback", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-rollback", "h-rollback", "Rollback member", "MEMBER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", ["s-rollback", "u-rollback", hash(5), "Browser", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)", ["h-rollback", hash(6), "2026-09-20T00:00:00Z"]],
  ]));
  assert.deepEqual(await all("SELECT id FROM households WHERE id = ?", "h-rollback"), []);
  assert.deepEqual(await all("SELECT id FROM users WHERE id = ?", "u-rollback"), []);
  assert.deepEqual(await all("SELECT id FROM device_sessions WHERE id = ?", "s-rollback"), []);
  assert.deepEqual(await all("SELECT household_id FROM household_recovery WHERE household_id = ?", "h-rollback"), []);
});

test("enforces globally unique recovery hashes while accepting distinct valid hashes", async () => {
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-recovery-a", "Recovery A", "u-recovery-a", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-recovery-a", "h-recovery-a", "A", "OWNER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)", ["h-recovery-a", hash(7), "2026-09-20T00:00:00Z"]],
  ]);
  await assert.rejects(() => batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-recovery-b", "Recovery B", "u-recovery-b", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-recovery-b", "h-recovery-b", "B", "OWNER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)", ["h-recovery-b", hash(7), "2026-09-20T00:00:00Z"]],
  ]));
  assert.deepEqual(await all("SELECT id FROM households WHERE id = ?", "h-recovery-b"), []);
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-recovery-b", "Recovery B", "u-recovery-b", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-recovery-b", "h-recovery-b", "B", "OWNER", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)", ["h-recovery-b", hash(8), "2026-09-20T00:00:00Z"]],
  ]);
  assert.deepEqual(await all("SELECT recovery_hash FROM household_recovery WHERE household_id = ?", "h-recovery-b"), [{ recovery_hash: hash(8) }]);
});

test("enforces all declared foreign keys, including sessions and change-log attribution", async () => {
  await rejects("INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", "s-orphan", "missing-user", hash(1), "Browser", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await rejects("INSERT INTO calendar_events (id, household_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "e-orphan", "missing-household", "{}", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await rejects("INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "h-owner", "calendar_event", "e-1", 1, "CREATE", "[]", "missing-user", "2026-09-20T00:00:00Z");
  await batch([
    ["INSERT INTO households (id, name, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["h-other", "Other home", "u-other", 1, "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"]],
    ["INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)", ["u-other", "h-other", "Other owner", "OWNER", "2026-09-20T00:00:00Z"]],
  ]);
  await rejects("INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "h-owner", "calendar_event", "e-2", 1, "CREATE", "[]", "u-other", "2026-09-20T00:00:00Z");
});

test("enforces one-time token state and same-household ownership invariants", async () => {
  await rejects("INSERT INTO one_time_tokens (id, household_id, subject_user_id, purpose, token_hash, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "t-cross-subject", "h-owner", "u-other", "DEVICE_LINK", hash(2), "u-owner", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z");
  await rejects("INSERT INTO one_time_tokens (id, household_id, purpose, token_hash, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "t-cross-creator", "h-owner", "INVITE", hash(3), "u-other", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z");
  await rejects("INSERT INTO one_time_tokens (id, household_id, subject_user_id, purpose, token_hash, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "t-invite-subject", "h-owner", "u-owner", "INVITE", hash(4), "u-owner", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z");
  await rejects("INSERT INTO one_time_tokens (id, household_id, purpose, token_hash, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "t-link-no-subject", "h-owner", "DEVICE_LINK", hash(5), "u-owner", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z");
  await rejects("INSERT INTO one_time_tokens (id, household_id, purpose, token_hash, created_by_user_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "t-consumed-unpaired", "h-owner", "INVITE", hash(6), "u-owner", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z", "2026-09-20T01:00:00Z");
});

test("enforces hashed-token uniqueness, active waste-config uniqueness, and change-log/idempotency indexes", async () => {
  await run("INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", "s-owner", "u-owner", hash(7), "Browser", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await rejects("INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", "s-duplicate", "u-owner", hash(7), "Phone", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z");
  await run("INSERT INTO waste_config (id, household_id, payload_json, revision, updated_at) VALUES (?, ?, ?, ?, ?)", "w-1", "h-owner", "{}", 1, "2026-09-20T00:00:00Z");
  await rejects("INSERT INTO waste_config (id, household_id, payload_json, revision, updated_at) VALUES (?, ?, ?, ?, ?)", "w-2", "h-owner", "{}", 1, "2026-09-20T00:00:00Z");

  await run("INSERT INTO one_time_tokens (id, household_id, purpose, token_hash, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "t-valid", "h-owner", "INVITE", hash(8), "u-owner", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z");
  await rejects("INSERT INTO one_time_tokens (id, household_id, purpose, token_hash, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "t-duplicate", "h-owner", "INVITE", hash(8), "u-owner", "2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z");
  const ownerIndexes = await all("PRAGMA index_list(users)");
  const sessionIndexes = await all("PRAGMA index_list(device_sessions)");
  const tokenIndexes = await all("PRAGMA index_list(one_time_tokens)");
  const wasteIndexes = await all("PRAGMA index_list(waste_config)");
  const changeIndexes = await all("PRAGMA index_list(change_log)");
  const mutationIndexes = await all("PRAGMA index_list(applied_mutations)");
  assert.ok(ownerIndexes.some(({ name, unique }) => name === "idx_users_one_active_owner" && unique === 1));
  assert.ok(sessionIndexes.some(({ unique }) => unique === 1));
  assert.ok(tokenIndexes.some(({ name }) => name === "idx_one_time_tokens_active_household_purpose"));
  assert.ok(tokenIndexes.some(({ name }) => name === "idx_one_time_tokens_active_subject"));
  assert.ok(wasteIndexes.some(({ name, unique }) => name === "idx_waste_config_one_active" && unique === 1));
  assert.ok(changeIndexes.some(({ name }) => name === "idx_change_log_household_seq"));
  assert.ok(mutationIndexes.some(({ unique }) => unique === 1));
  assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
});

test("Wrangler applies the migration to the exact local D1 test state directory", () => {
  rmSync(localPersistPath, { recursive: true, force: true });
  const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  const args = [
    "d1",
    "migrations",
    "apply",
    "majandus-backend-test",
    "--local",
    "--config",
    "scripts/backend/wrangler.test.jsonc",
    "--persist-to",
    ".tmp/majandus-d1-test",
  ];
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /0001_majandus_backend\.sql/);
});
