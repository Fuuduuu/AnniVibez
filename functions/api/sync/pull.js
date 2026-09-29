import { requireAuthenticated } from "../../_lib/auth.js";
import { apiError, json, requireMethod } from "../../_lib/http.js";
import { canonicalJson, validateCalendarEventPayload } from "../../_lib/sync.js";
import { projectCalendarRow, readCalendarDelta } from "../../_lib/syncRepository.js";

function internalError() {
  return apiError(500, "INTERNAL_ERROR", "Internal server error.");
}

function invalidRequest() {
  return apiError(400, "INVALID_REQUEST", "Invalid request.");
}

function resyncRequired() {
  return apiError(409, "RESYNC_REQUIRED", "Full resync required.");
}

function afterCursor(request) {
  const url = new URL(request.url);
  const entries = [...url.searchParams];
  if (entries.length !== 1 || entries[0][0] !== "after") return null;
  const value = entries[0][1];
  if (!/^(0|[1-9][0-9]*)$/.test(value) || url.search !== `?after=${value}`) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) return internalError();
    const authentication = await requireAuthenticated(request, db);
    if (authentication.ok === false) return authentication.response;
    if (authentication.ok !== true) throw new TypeError("Invalid authentication result");

    const after = afterCursor(request);
    if (after === null) return invalidRequest();
    const { cursor, owned, rows } = await readCalendarDelta(db, authentication.context.householdId, after);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(rows)) throw new TypeError("Invalid calendar delta");
    if (after !== 0 && !owned) return resyncRequired();
    const changes = rows.map((row) => {
      const record = projectCalendarRow(row);
      if (canonicalJson(validateCalendarEventPayload(record.payload, record.id)) !== canonicalJson(record.payload)
        || row.entity_type !== "calendar_event" || row.entity_id !== record.id
        || !Number.isSafeInteger(row.seq) || row.seq <= after || row.seq > cursor
        || !["CREATE", "UPDATE", "DELETE"].includes(row.operation)
        || row.change_revision !== record.revision) throw new TypeError("Invalid calendar delta");
      return {
        seq: row.seq, entityType: "calendar_event", entityId: row.entity_id,
        operation: row.operation, revision: row.change_revision, record,
      };
    });
    return json(200, { cursor, changes });
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "GET");
}
