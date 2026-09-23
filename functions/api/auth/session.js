import { requireAuthenticated } from "../../_lib/auth.js";
import { findSessionMetadataByTrustedContext } from "../../_lib/db.js";
import { apiError, json, requireMethod } from "../../_lib/http.js";

function internalError() {
  return apiError(500, "INTERNAL_ERROR", "Internal server error.");
}

function unauthorized() {
  return apiError(401, "UNAUTHORIZED", "Authentication required.", { "WWW-Authenticate": "Bearer" });
}

function requireRecord(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new TypeError("Invalid session metadata");
  return value;
}

function requireString(value) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Invalid session metadata");
  return value;
}

function projectMetadata(value) {
  const metadata = requireRecord(value);
  const session = requireRecord(metadata.session);
  const account = requireRecord(metadata.account);
  const household = requireRecord(metadata.household);
  const role = account.role;
  const address = household.address;
  if (role !== "OWNER" && role !== "MEMBER") throw new TypeError("Invalid session metadata");
  if (address !== null && typeof address !== "string") throw new TypeError("Invalid session metadata");
  if (!Number.isInteger(household.revision) || household.revision < 1) throw new TypeError("Invalid session metadata");

  return {
    session: {
      id: requireString(session.id),
      deviceName: requireString(session.deviceName),
      createdAt: requireString(session.createdAt),
      lastSeenAt: requireString(session.lastSeenAt),
    },
    account: {
      userId: requireString(account.userId),
      displayName: requireString(account.displayName),
      role,
    },
    household: {
      id: requireString(household.id),
      name: requireString(household.name),
      address,
      revision: household.revision,
      createdAt: requireString(household.createdAt),
      updatedAt: requireString(household.updatedAt),
    },
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env?.DB;
    if (!db) return internalError();

    const authentication = await requireAuthenticated(request, db);
    if (authentication.ok === false) return authentication.response;
    if (authentication.ok !== true) throw new TypeError("Invalid authentication result");

    const context = requireRecord(authentication.context);
    const trustedContext = {
      sessionId: requireString(context.sessionId),
      userId: requireString(context.userId),
      householdId: requireString(context.householdId),
    };
    const metadata = await findSessionMetadataByTrustedContext(db, trustedContext);
    if (metadata === null) return unauthorized();

    return json(200, projectMetadata(metadata));
  } catch {
    return internalError();
  }
}

export function onRequest({ request }) {
  return requireMethod(request, "GET");
}
