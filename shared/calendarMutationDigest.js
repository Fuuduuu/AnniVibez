const DIGEST_PREFIX = "majandus:v1:sync-mutation:";

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJsonValue(value[key])]));
    }
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortedJsonValue(value));
}

// Both callers supply the already-canonical Calendar request, excluding its mutation ID.
export async function digestCanonicalCalendarMutation({ entityType, entityId, operation, baseRevision, patch }) {
  const canonical = canonicalJson({ v: 1, entityType, entityId, operation, baseRevision, patch });
  const bytes = new TextEncoder().encode(DIGEST_PREFIX + canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
