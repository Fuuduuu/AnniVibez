import { requireAuthenticated } from "../../_lib/auth.js";
import { apiError, json, requireMethod } from "../../_lib/http.js";
import { canonicalJson, validateShoppingItemPayload } from "../../_lib/shopping.js";
import { projectShoppingRow, readShoppingBootstrap } from "../../_lib/shoppingRepository.js";

const internalError = () => apiError(500, "INTERNAL_ERROR", "Internal server error.");

export async function onRequestGet({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) return internalError();
    const authentication = await requireAuthenticated(request, db);
    if (authentication.ok === false) return authentication.response;
    if (authentication.ok !== true) throw new TypeError("Invalid authentication result");
    if (new URL(request.url).searchParams.size !== 0) return apiError(400, "INVALID_REQUEST", "Invalid request.");
    const { cursor, rows } = await readShoppingBootstrap(db, authentication.context.householdId);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(rows)) throw new TypeError("Invalid shopping snapshot");
    const shoppingItems = rows.map(row => {
      const record = projectShoppingRow(row);
      if (canonicalJson(validateShoppingItemPayload(record.payload, record.id)) !== canonicalJson(record.payload)
        || row.latest_revision !== record.revision || !["CREATE", "UPDATE", "DELETE"].includes(row.latest_operation)
        || (row.latest_operation === "DELETE") !== (record.deletedAt !== null)) throw new TypeError("Invalid shopping history");
      return record;
    });
    return json(200, { cursor, shoppingItems });
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "GET");
}
