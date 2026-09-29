import { requireAuthenticated } from "../../_lib/auth.js";
import { apiError, json, requireMethod } from "../../_lib/http.js";
import { canonicalJson, validateCalendarEventPayload } from "../../_lib/sync.js";
import { projectCalendarRow, readCalendarBootstrap } from "../../_lib/syncRepository.js";

function internalError() {
  return apiError(500, "INTERNAL_ERROR", "Internal server error.");
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) return internalError();
    const authentication = await requireAuthenticated(request, db);
    if (authentication.ok === false) return authentication.response;
    if (authentication.ok !== true) throw new TypeError("Invalid authentication result");
    if (new URL(request.url).searchParams.size !== 0) {
      return apiError(400, "INVALID_REQUEST", "Invalid request.");
    }

    const { cursor, rows } = await readCalendarBootstrap(db, authentication.context.householdId);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(rows)) throw new TypeError("Invalid calendar snapshot");
    const calendarEvents = rows.map((row) => {
      const record = projectCalendarRow(row);
      if (canonicalJson(validateCalendarEventPayload(record.payload, record.id)) !== canonicalJson(record.payload)) {
        throw new TypeError("Invalid calendar payload");
      }
      if (row.latest_revision !== record.revision
        || !["CREATE", "UPDATE", "DELETE"].includes(row.latest_operation)
        || (row.latest_operation === "DELETE") !== (record.deletedAt !== null)) {
        throw new TypeError("Invalid calendar history");
      }
      return record;
    });
    return json(200, { cursor, calendarEvents });
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "GET");
}
