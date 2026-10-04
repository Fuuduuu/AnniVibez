// Shopping uses the shared journal and idempotency tables with its own entity type.
const bind = (db, sql, values) => db.prepare(sql).bind(...values);

export async function readShoppingBootstrap(db, householdId) {
  const [cursorResult, rowsResult] = await db.batch([
    bind(db, "SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE household_id = ? AND entity_type = 'shopping_item'", [householdId]),
    bind(db,
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

export async function readShoppingDelta(db, householdId, after) {
  const [cursorResult, ownershipResult, changesResult] = await db.batch([
    bind(db,
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
    bind(db, "SELECT seq FROM change_log WHERE household_id = ? AND entity_type = 'shopping_item' AND seq = ? LIMIT 1", [householdId, after]),
    bind(db,
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

export function projectShoppingRow(row) {
  if (!row || typeof row.id !== "string" || row.id.length === 0
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.payload_json !== "string") throw new TypeError("Invalid shopping row");
  for (const value of [row.created_at, row.updated_at, row.deleted_at]) {
    if (value === null) continue;
    if (typeof value !== "string" || !Number.isFinite(new Date(value).valueOf())
      || new Date(value).toISOString() !== value) throw new TypeError("Invalid shopping timestamp");
  }
  if (row.created_at === null || row.updated_at === null) throw new TypeError("Invalid shopping timestamp");
  const payload = JSON.parse(row.payload_json);
  if (!payload || Array.isArray(payload) || typeof payload !== "object"
    || payload.id !== row.id || payload.createdAt !== row.created_at) throw new TypeError("Invalid shopping payload");
  return { id: row.id, payload, revision: row.revision, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

export function findAppliedShoppingMutation(db, mutationId) {
  return bind(db, "SELECT household_id, result_json FROM applied_mutations WHERE mutation_id = ? LIMIT 1", [mutationId]).first();
}

export function findShoppingEntityId(db, entityId) {
  return bind(db, "SELECT id FROM shopping_items WHERE id = ? LIMIT 1", [entityId]).first();
}

export function findShoppingEntity(db, householdId, entityId) {
  return bind(db, "SELECT id, household_id, payload_json, revision, created_at, updated_at, deleted_at FROM shopping_items WHERE household_id = ? AND id = ? LIMIT 1", [householdId, entityId]).first();
}

export async function findShoppingChangedFieldsSince(db, householdId, entityId, baseRevision) {
  const response = await bind(db,
    "SELECT revision, changed_fields_json FROM change_log WHERE household_id = ? AND entity_type = 'shopping_item' AND entity_id = ? AND revision > ? ORDER BY revision",
    [householdId, entityId, baseRevision]).all();
  return response.results;
}

function changeLogStatement(db, record, guarded) {
  const household = guarded ? "CASE WHEN changes() = 1 THEN ? ELSE NULL END" : "?";
  return bind(db,
    `INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at)
     VALUES (${household}, 'shopping_item', ?, ?, ?, ?, ?, ?)`,
    [record.householdId, record.entityId, record.revision, record.operation,
      JSON.stringify(record.changedFields), record.userId, record.timestamp]);
}

function appliedStatement(db, record) {
  return bind(db, "INSERT INTO applied_mutations (mutation_id, household_id, result_json, created_at) VALUES (?, ?, ?, ?)",
    [record.mutationId, record.householdId, JSON.stringify({ digest: record.digest, result: record.result }), record.timestamp]);
}

export function commitShoppingCreate(db, record) {
  return db.batch([
    bind(db, "INSERT INTO shopping_items (id, household_id, payload_json, revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, ?, ?, NULL)",
      [record.entityId, record.householdId, record.payloadJson, record.createdAt, record.timestamp]),
    changeLogStatement(db, record, false),
    appliedStatement(db, record),
  ]);
}

export function commitShoppingUpdate(db, record) {
  return db.batch([
    bind(db, "UPDATE shopping_items SET payload_json = ?, revision = ?, updated_at = ? WHERE id = ? AND household_id = ? AND revision = ? AND deleted_at IS NULL",
      [record.payloadJson, record.revision, record.timestamp, record.entityId, record.householdId, record.expectedRevision]),
    // A lost revision guard must abort the entire batch, including its journal.
    // changes() = 0 yields a NOT NULL violation instead of an orphan history row.
    changeLogStatement(db, record, true),
    appliedStatement(db, record),
  ]);
}

export function commitShoppingDelete(db, record) {
  return db.batch([
    bind(db, "UPDATE shopping_items SET revision = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND household_id = ? AND revision = ? AND deleted_at IS NULL",
      [record.revision, record.timestamp, record.timestamp, record.entityId, record.householdId, record.expectedRevision]),
    changeLogStatement(db, record, true),
    appliedStatement(db, record),
  ]);
}
