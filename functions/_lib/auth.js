import { hashSecret } from "./crypto.js";
import { findActiveSessionByHash } from "./db.js";
import { apiError } from "./http.js";

const BEARER_DEVICE_TOKEN = /^[Bb][Ee][Aa][Rr][Ee][Rr] (m1s_[A-Za-z0-9_-]{43})$/;

function isTrustedField(value) {
  return typeof value === "string" && value.length > 0;
}

export async function authenticateDevice(request, db) {
  const match = BEARER_DEVICE_TOKEN.exec(request.headers.get("Authorization") ?? "");
  if (!match) return null;

  const tokenHash = await hashSecret("device-session", match[1]);
  const session = await findActiveSessionByHash(db, tokenHash);
  if (session === null) return null;

  const { sessionId, userId, householdId, role } = session;
  if (![sessionId, userId, householdId, role].every(isTrustedField)) {
    throw new Error("Invalid trusted authentication context");
  }
  return { sessionId, userId, householdId, role };
}

export async function requireAuthenticated(request, db) {
  const context = await authenticateDevice(request, db);
  if (context !== null) return { ok: true, context };
  return {
    ok: false,
    response: apiError(
      401,
      "UNAUTHORIZED",
      "Authentication required.",
      { "WWW-Authenticate": "Bearer" },
    ),
  };
}
