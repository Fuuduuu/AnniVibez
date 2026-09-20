const MAX_JSON_BODY_BYTES = 8192;
const INVALID_REQUEST = { ok: false, code: "INVALID_REQUEST" };

function jsonHeaders(headers) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  result.set("Cache-Control", "no-store");
  return result;
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(";").map((part) => part.trim());
  if (parts[0].toLowerCase() !== "application/json") return false;
  if (parts.length === 1) return true;
  if (parts.length !== 2) return false;
  const [name, charset] = parts[1].split("=").map((part) => part.trim().toLowerCase());
  return name === "charset" && charset === "utf-8";
}

function codePointLength(value) {
  return Array.from(value).length;
}

function normalizedString(value, maximum) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (codePointLength(trimmed) < 1 || codePointLength(trimmed) > maximum) return null;
  return trimmed;
}

async function readBodyBytes(request) {
  const declaredLength = request.headers.get("content-length");
  if (/^\d+$/.test(declaredLength ?? "") && Number(declaredLength) > MAX_JSON_BODY_BYTES) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(headers) });
}

export function apiError(status, code, message, headers) {
  return json(status, { error: { code, message } }, headers);
}

export function requireMethod(request, method) {
  if (request.method === method) return null;
  return apiError(405, "METHOD_NOT_ALLOWED", "Method not allowed.", { Allow: method });
}

export async function readJsonObject(request, options = {}) {
  void options;
  if (!isJsonContentType(request.headers.get("content-type"))) return INVALID_REQUEST;
  try {
    const bytes = await readBodyBytes(request);
    if (!bytes) return INVALID_REQUEST;
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (value === null || Array.isArray(value) || typeof value !== "object") return INVALID_REQUEST;
    return { ok: true, value };
  } catch {
    return INVALID_REQUEST;
  }
}

export function validateCreateHouseholdInput(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object") return INVALID_REQUEST;
  const allowed = new Set(["userName", "householdName", "householdAddress", "deviceName"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return INVALID_REQUEST;

  const userName = normalizedString(value.userName, 80);
  const householdName = normalizedString(value.householdName, 120);
  const deviceName = normalizedString(value.deviceName, 120);
  if (!userName || !householdName || !deviceName) return INVALID_REQUEST;

  let householdAddress = null;
  if (Object.hasOwn(value, "householdAddress") && value.householdAddress !== null) {
    householdAddress = normalizedString(value.householdAddress, 240);
    if (!householdAddress) return INVALID_REQUEST;
  }

  return {
    ok: true,
    value: { userName, householdName, householdAddress, deviceName },
  };
}
