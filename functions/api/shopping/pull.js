import { requireAuthenticated } from "../../_lib/auth.js";
import { apiError, json, requireMethod } from "../../_lib/http.js";
import { canonicalJson, validateShoppingItemPayload } from "../../_lib/shopping.js";
import { projectShoppingRow, readShoppingDelta } from "../../_lib/shoppingRepository.js";

const internalError = () => apiError(500, "INTERNAL_ERROR", "Internal server error.");
const invalidRequest = () => apiError(400, "INVALID_REQUEST", "Invalid request.");
const resyncRequired = () => apiError(409, "RESYNC_REQUIRED", "Full resync required.");

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
    const { cursor, owned, incomplete, rows } = await readShoppingDelta(db, authentication.context.householdId, after);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(rows)) throw new TypeError("Invalid shopping delta");
    if (incomplete || after > cursor || (after !== 0 && !owned)) return resyncRequired();
    // Sequence numbers include other domains. Revision continuity is per item.
    if (rows.some(row => !row.id || row.change_revision !== row.revision
      || row.history_count !== row.revision - row.history_base_revision
      || row.history_distinct !== row.history_count || row.history_first !== row.history_base_revision + 1
      || row.history_last !== row.revision)) return resyncRequired();
    const changes = rows.map(row => {
      const record = projectShoppingRow(row);
      if (canonicalJson(validateShoppingItemPayload(record.payload, record.id)) !== canonicalJson(record.payload)
        || row.entity_type !== "shopping_item" || row.entity_id !== record.id
        || !Number.isSafeInteger(row.seq) || row.seq <= after || row.seq > cursor
        || !["CREATE", "UPDATE", "DELETE"].includes(row.operation)
        || (row.operation === "DELETE") !== (record.deletedAt !== null)) throw new TypeError("Invalid shopping delta");
      return { seq: row.seq, entityType: "shopping_item", entityId: row.entity_id,
        operation: row.operation, revision: row.change_revision, record };
    });
    return json(200, { cursor, changes });
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "GET");
}
