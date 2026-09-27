// D1 persistence for the calendar mutation service. Domain decisions live in sync.js.
const bind = (db, sql, values) => db.prepare(sql).bind(...values);

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
