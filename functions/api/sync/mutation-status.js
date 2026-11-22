import { requireAuthenticated } from "../../_lib/auth.js";
import { apiError, json, requireMethod } from "../../_lib/http.js";
import { clientUpgradeResponse, supportsMergeEvidence } from "../../_lib/mergeCapability.js";

const unknown = () => json(200, { outcome: "UNKNOWN" });
const validId = value => typeof value === "string" && value.length > 0 && value.length <= 200;

export async function onRequestGet({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) throw new Error("Missing D1");
    const authentication = await requireAuthenticated(request, db);
    if (authentication.ok === false) return authentication.response;
    if (authentication.ok !== true) throw new TypeError("Invalid authentication result");
    if (!supportsMergeEvidence(request)) return clientUpgradeResponse();

    const params = new URL(request.url).searchParams;
    const mutationId = params.get("mutationId");
    const entityId = params.get("entityId");
    const digest = params.get("digest");
    if (params.size !== 3 || !validId(mutationId) || !validId(entityId) || !/^[0-9a-f]{64}$/.test(digest ?? "")) {
      return apiError(400, "INVALID_REQUEST", "Invalid request.");
    }

    const row = await db.prepare("SELECT result_json FROM applied_mutations WHERE mutation_id = ? AND household_id = ? LIMIT 1")
      .bind(mutationId, authentication.context.householdId).first();
    // A request can still be in flight. Journal absence never proves non-application.
    if (!row) return unknown();
    const stored = JSON.parse(row.result_json);
    if (stored?.calendarEntityId !== entityId || stored.digest !== digest) return unknown();
    const result = stored.result;
    if (!["APPLIED", "MERGED"].includes(result?.status) || !Number.isSafeInteger(result.revision) || result.revision < 1) {
      throw new TypeError("Invalid mutation journal");
    }
    return json(200, { outcome: "COMMITTED", result });
  } catch {
    return apiError(500, "INTERNAL_ERROR", "Internal server error.");
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "GET");
}
