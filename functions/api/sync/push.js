import { requireAuthenticated } from "../../_lib/auth.js";
import { apiError, readJsonObject, requireMethod } from "../../_lib/http.js";
import { pushMutations } from "../../_lib/mergeCapability.js";
import { applyCalendarMutation } from "../../_lib/sync.js";

const MAX_MUTATIONS = 8;

function internalError() {
  return apiError(500, "INTERNAL_ERROR", "Internal server error.");
}

function invalidRequest() {
  return apiError(400, "INVALID_REQUEST", "Invalid request.");
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) return internalError();
    const authentication = await requireAuthenticated(request, db);
    if (authentication.ok === false) return authentication.response;
    if (authentication.ok !== true) throw new TypeError("Invalid authentication result");
    if (new URL(request.url).searchParams.size !== 0) return invalidRequest();

    const body = await readJsonObject(request, {
      maxBytes: 65536, oversizeCode: "PAYLOAD_TOO_LARGE",
    });
    if (body.code === "PAYLOAD_TOO_LARGE") {
      return apiError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
    }
    if (body.ok !== true) return invalidRequest();
    const input = body.value;
    if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "mutations")
      || !Array.isArray(input.mutations) || input.mutations.length > MAX_MUTATIONS) return invalidRequest();

    return await pushMutations(request, input.mutations, (mutation, supportsMergeEvidence) =>
      applyCalendarMutation({ db, context: authentication.context, mutation, supportsMergeEvidence, clock: () => new Date().toISOString() }));
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "POST");
}
