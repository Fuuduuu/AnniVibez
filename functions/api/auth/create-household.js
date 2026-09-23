import { apiError, json, readJsonObject, requireMethod, validateCreateHouseholdInput } from "../../_lib/http.js";
import { createHousehold, publicHouseholdCreation } from "../../_lib/households.js";

function invalidRequest() {
  return apiError(400, "INVALID_REQUEST", "Invalid request.");
}

function internalError() {
  return apiError(500, "INTERNAL_ERROR", "Internal server error.");
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) return internalError();

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return invalidRequest();

    const validation = validateCreateHouseholdInput(parsed.value);
    if (!validation.ok) return invalidRequest();

    const result = await createHousehold({
      db,
      input: parsed.value,
      clock: () => new Date().toISOString(),
    });
    if (!result.ok && result.code === "INVALID_REQUEST") return invalidRequest();

    return json(201, publicHouseholdCreation(result));
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "POST");
}
