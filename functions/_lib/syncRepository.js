// D1 persistence for the calendar mutation service. Domain decisions live in sync.js.
const bind = (db, sql, values) => db.prepare(sql).bind(...values);

export async function readCalendarBootstrap(db, householdId) {
  const [cursorResult, rowsResult] = await db.batch([
    bind(db,
      "SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE household_id = ? AND entity_type = 'calendar_event'",
      [householdId]),
    bind(db,
      `SELECT event.id, event.payload_json, event.revision, event.created_at,
              event.updated_at, event.deleted_at,
              log.revision AS latest_revision, log.operation AS latest_operation
       FROM calendar_events AS event
       LEFT JOIN change_log AS log ON log.seq = (
         SELECT MAX(seq) FROM change_log
         WHERE household_id = event.household_id AND entity_type = 'calendar_event' AND entity_id = event.id
       )
       WHERE event.household_id = ? ORDER BY event.id`,
      [householdId]),
  ]);
  return { cursor: cursorResult.results[0].cursor, rows: rowsResult.results };
}

export async function readCalendarDelta(db, householdId, after) {
  const [cursorResult, ownershipResult, changesResult] = await db.batch([
    bind(db,
      "SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE household_id = ? AND entity_type = 'calendar_event'",
      [householdId]),
    bind(db,
      "SELECT seq FROM change_log WHERE household_id = ? AND entity_type = 'calendar_event' AND seq = ? LIMIT 1",
      [householdId, after]),
    bind(db,
      `WITH latest AS (
         SELECT entity_id, MAX(seq) AS seq FROM change_log
         WHERE household_id = ? AND entity_type = 'calendar_event' AND seq > ?
         GROUP BY entity_id
       )
       SELECT log.seq, log.entity_type, log.entity_id, log.operation,
              log.revision AS change_revision,
              event.id, event.payload_json, event.revision,
              event.created_at, event.updated_at, event.deleted_at
       FROM latest
       JOIN change_log AS log ON log.seq = latest.seq
       LEFT JOIN calendar_events AS event
         ON event.id = log.entity_id AND event.household_id = log.household_id
       ORDER BY log.seq`,
      [householdId, after]),
  ]);
  return {
    cursor: cursorResult.results[0].cursor,
    owned: ownershipResult.results.length === 1,
    rows: changesResult.results,
  };
}

export function projectCalendarRow(row) {
  if (!row || typeof row.id !== "string" || row.id.length === 0
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.payload_json !== "string") throw new TypeError("Invalid calendar row");
  for (const timestamp of [row.created_at, row.updated_at, row.deleted_at]) {
    if (timestamp === null) continue;
    if (typeof timestamp !== "string" || !Number.isFinite(new Date(timestamp).valueOf())
      || new Date(timestamp).toISOString() !== timestamp) throw new TypeError("Invalid calendar row");
  }
  if (row.created_at === null || row.updated_at === null) throw new TypeError("Invalid calendar row");
  const payload = JSON.parse(row.payload_json);
  if (!payload || Array.isArray(payload) || typeof payload !== "object" || payload.id !== row.id) {
    throw new TypeError("Invalid calendar row");
  }
  return {
    id: row.id, payload, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  };
}

export function findAppliedMutation(db, mutationId) {
  return bind(db,
    "SELECT household_id, result_json FROM applied_mutations WHERE mutation_id = ? LIMIT 1",
    [mutationId]).first();
}

export function findCalendarEntity(db, householdId, entityId) {
  return bind(db,
    "SELECT id, household_id, payload_json, revision, created_at, updated_at, deleted_at FROM calendar_events WHERE household_id = ? AND id = ? LIMIT 1",
    [householdId, entityId]).first();
}

export function findCalendarEntityId(db, entityId) {
  return bind(db, "SELECT id FROM calendar_events WHERE id = ? LIMIT 1", [entityId]).first();
}

export async function findChangedFieldsSince(db, householdId, entityId, baseRevision) {
  const response = await bind(db,
    "SELECT revision, changed_fields_json FROM change_log WHERE household_id = ? AND entity_type = 'calendar_event' AND entity_id = ? AND revision > ? ORDER BY revision",
    [householdId, entityId, baseRevision]).all();
  return response.results;
}

function changeLogStatement(db, record, guardUpdate) {
  const householdExpression = guardUpdate ? "CASE WHEN changes() = 1 THEN ? ELSE NULL END" : "?";
  return bind(db,
    `INSERT INTO change_log (household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at)
     VALUES (${householdExpression}, 'calendar_event', ?, ?, ?, ?, ?, ?)`,
    [record.householdId, record.entityId, record.revision, record.operation,
      JSON.stringify(record.changedFields), record.userId, record.timestamp]);
}

function appliedStatement(db, record) {
  return bind(db,
    "INSERT INTO applied_mutations (mutation_id, household_id, result_json, created_at) VALUES (?, ?, ?, ?)",
    [record.mutationId, record.householdId,
      JSON.stringify({ digest: record.digest, result: record.result }), record.timestamp]);
}

export function commitCalendarCreate(db, record) {
  return db.batch([
    bind(db,
      "INSERT INTO calendar_events (id, household_id, payload_json, revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, ?, ?, NULL)",
      [record.entityId, record.householdId, record.payloadJson, record.timestamp, record.timestamp]),
    changeLogStatement(db, record, false),
    appliedStatement(db, record),
  ]);
}

export function commitCalendarUpdate(db, record) {
  return db.batch([
    bind(db,
      "UPDATE calendar_events SET payload_json = ?, revision = ?, updated_at = ? WHERE id = ? AND household_id = ? AND revision = ? AND deleted_at IS NULL",
      [record.payloadJson, record.revision, record.timestamp, record.entityId,
        record.householdId, record.expectedRevision]),
    // A zero-row guarded UPDATE is not a D1 error. A NOT NULL violation in the
    // next statement aborts the batch before any log or idempotency row commits.
    changeLogStatement(db, record, true),
    appliedStatement(db, record),
  ]);
}

export function commitCalendarDelete(db, record) {
  return db.batch([
    bind(db,
      "UPDATE calendar_events SET revision = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND household_id = ? AND revision = ? AND deleted_at IS NULL",
      [record.revision, record.timestamp, record.timestamp, record.entityId,
        record.householdId, record.expectedRevision]),
    changeLogStatement(db, record, true),
    appliedStatement(db, record),
  ]);
}
